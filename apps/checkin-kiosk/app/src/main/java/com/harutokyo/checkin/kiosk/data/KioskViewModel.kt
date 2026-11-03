package com.harutokyo.checkin.kiosk.data

import android.app.Application
import android.content.Context
import android.os.BatteryManager
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.harutokyo.checkin.kiosk.BuildConfig
import com.harutokyo.checkin.kiosk.contract.CONTRACT_VERSION
import com.harutokyo.checkin.kiosk.contract.Contract
import com.harutokyo.checkin.kiosk.contract.DeviceInfo
import com.harutokyo.checkin.kiosk.contract.EnrollResponse
import com.harutokyo.checkin.kiosk.contract.FindQuery
import com.harutokyo.checkin.kiosk.contract.FindResponse
import com.harutokyo.checkin.kiosk.contract.FindResult
import com.harutokyo.checkin.kiosk.contract.ConsentBody
import com.harutokyo.checkin.kiosk.contract.GuestInput
import com.harutokyo.checkin.kiosk.contract.RouteBody
import com.harutokyo.checkin.kiosk.contract.SaveGuestBody
import com.harutokyo.checkin.kiosk.contract.SaveResponse
import com.harutokyo.checkin.kiosk.contract.SaveResult
import com.harutokyo.checkin.kiosk.contract.saveResultOf
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.PartyResponse
import com.harutokyo.checkin.kiosk.contract.findResultOf
import com.harutokyo.checkin.kiosk.contract.PingResponse
import com.harutokyo.checkin.kiosk.contract.SettingsResponse
import com.harutokyo.checkin.kiosk.kiosk.PinGuard
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.io.File
import java.io.IOException

// 기기 상태: 등록(토큰) · 계약(설정) · 연결 · 폐기. 화면은 이 상태만 본다.
// 계약은 마지막으로 받은 것을 암호화해 저장 — 인터넷이 끊겨도 그 설정으로 동작한다(FR-K15).

enum class Phase { Loading, Enroll, Ready, UpdateRequired }

enum class EnrollError { Invalid, RateLimited, Network, Server }

data class KioskState(
    val phase: Phase = Phase.Loading,
    val device: DeviceInfo? = null,
    val contract: Contract? = null,
    val settingsVersion: String? = null,
    val online: Boolean = true,
    val revoked: Boolean = false,
)

@Serializable
private data class EnrollBody(val code: String, val deviceModel: String, val osVersion: String, val appVersion: String)

@Serializable
private data class PartyBody(val sessionId: String, val partySize: Int)

@Serializable
private data class PingBody(val battery: Int, val appVersion: String, val osVersion: String)

class KioskViewModel(application: Application) : AndroidViewModel(application) {
    private val vault = TokenVault(application)

    /** 직원 PIN 시도 횟수 — 화면이 다시 만들어져도(회전 등) 이어서 센다. */
    val pinGuard = PinGuard()
    private val _state = MutableStateFlow(KioskState())
    val state: StateFlow<KioskState> = _state.asStateFlow()

    init {
        val token = vault.get(KEY_TOKEN)
        val cached = vault.get(KEY_SETTINGS)?.let { runCatching { Api.json.decodeFromString<SettingsResponse>(it) }.getOrNull() }
        if (token == null) {
            _state.value = KioskState(phase = Phase.Enroll)
        } else {
            _state.value = KioskState(
                phase = if (cached?.contract != null) Phase.Ready else Phase.Loading,
                device = cached?.device,
                contract = cached?.contract,
                settingsVersion = cached?.settingsVersion,
            )
            viewModelScope.launch { refreshSettings() }
        }
        viewModelScope.launch { pingLoop() }
    }

    suspend fun enroll(code: String): EnrollError? {
        val body = Api.json.encodeToString(EnrollBody(code, Build.MODEL, Build.VERSION.RELEASE, BuildConfig.VERSION_NAME))
        val result = try {
            Api.request("POST", "/api/device/enroll", null, body)
        } catch (_: IOException) {
            return EnrollError.Network
        }
        val parsed = runCatching { Api.json.decodeFromString<EnrollResponse>(result.body) }.getOrNull()
        return when {
            parsed?.ok == true && parsed.token != null -> {
                vault.put(KEY_TOKEN, parsed.token)
                _state.update { it.copy(phase = Phase.Loading, device = parsed.device, revoked = false) }
                refreshSettings()
                null
            }
            result.status == 429 -> EnrollError.RateLimited
            result.status == 404 || result.status == 400 -> EnrollError.Invalid
            else -> EnrollError.Server
        }
    }

    suspend fun refreshSettings(): Boolean {
        val token = vault.get(KEY_TOKEN) ?: return false
        val result = try {
            Api.request("GET", "/api/kiosk/settings", token, null)
        } catch (_: IOException) {
            _state.update { it.copy(online = false, phase = if (it.contract != null) Phase.Ready else Phase.Loading) }
            return false
        }
        if (result.status == 401) {
            forget(revoked = true)
            return false
        }
        val parsed = runCatching { Api.json.decodeFromString<SettingsResponse>(result.body) }.getOrNull()
        val contract = parsed?.contract
        if (parsed?.ok != true || contract == null) {
            _state.update { it.copy(online = true) }
            return false
        }
        if (contract.contractVersion != CONTRACT_VERSION) {
            _state.update { it.copy(phase = Phase.UpdateRequired, online = true) }
            return false
        }
        vault.put(KEY_SETTINGS, result.body)
        _state.update {
            it.copy(phase = Phase.Ready, device = parsed.device, contract = contract, settingsVersion = parsed.settingsVersion, online = true)
        }
        return true
    }

    /** 예약 찾기(시안 T1 · T1k). 401 이면 기기가 해제된 것 — 등록 화면으로. */
    suspend fun find(query: FindQuery): FindResult {
        val token = vault.get(KEY_TOKEN) ?: return FindResult.Server
        val result = try {
            Api.request("POST", "/api/kiosk/find", token, Api.json.encodeToString(FindQuery.serializer(), query))
        } catch (_: IOException) {
            _state.update { it.copy(online = false) }
            return FindResult.Network
        }
        if (result.status == 401) {
            forget(revoked = true)
            return FindResult.Server
        }
        _state.update { it.copy(online = true) }
        return findResultOf(runCatching { Api.json.decodeFromString<FindResponse>(result.body) }.getOrNull())
    }

    /** 시안 T2 인원 ±. 실패하면 null(화면은 그대로). */
    suspend fun setParty(sessionId: String, partySize: Int): KioskStay? {
        val token = vault.get(KEY_TOKEN) ?: return null
        val result = try {
            Api.request("POST", "/api/kiosk/party", token, Api.json.encodeToString(PartyBody(sessionId, partySize)))
        } catch (_: IOException) {
            _state.update { it.copy(online = false) }
            return null
        }
        return runCatching { Api.json.decodeFromString<PartyResponse>(result.body) }.getOrNull()?.stay
    }

    /** 시안 T3c · T3n — 한 사람 명부 저장. */
    suspend fun saveGuest(sessionId: String, guest: GuestInput): SaveResult =
        post("/api/kiosk/guests", Api.json.encodeToString(SaveGuestBody(sessionId, guest)))

    /** 시안 T3s — 전 숙박지 · 다음 행선지(대표자, 같은 값을 쓰는 동행자도). */
    suspend fun saveRoute(sessionId: String, prevStay: String, nextDest: String): SaveResult =
        post("/api/kiosk/route", Api.json.encodeToString(RouteBody(sessionId, prevStay, nextDest)))

    /** 시안 G3b — 약관 · 개인정보 두 칸 동의(대표자 이름으로 한 줄). */
    suspend fun saveConsent(sessionId: String, locale: String): SaveResult =
        post("/api/kiosk/consent", Api.json.encodeToString(ConsentBody(sessionId, terms = true, locale = locale)))

    /** 빠른 체크인 — 얼굴 영상(MP4 5초). 저장한 사람에게만. */
    suspend fun uploadFace(sessionId: String, guestId: String, file: File): UploadResult =
        sendUpload { token -> Api.uploadFile("/api/kiosk/face", token, mapOf("session_id" to sessionId, "guest_id" to guestId), "face.mp4", "video/mp4", file) }

    /** 뒤에서 차례로 올리는 줄(여권 사진 → 얼굴 영상). 화면은 기다리지 않는다. */
    private val uploads = UploadQueue(viewModelScope) { job ->
        when (job.kind) {
            UploadKind.Passport -> job.jpeg?.let { uploadPassport(job.sessionId, job.guestId, it) } ?: UploadResult.GiveUp
            UploadKind.Face -> job.file?.let { uploadFace(job.sessionId, job.guestId, it) } ?: UploadResult.GiveUp
        }
    }
    val uploadCounts: StateFlow<UploadCounts> = uploads.counts

    /** 예약을 찾았다 — 올리기 줄을 이 예약으로 연다(이전 손님 것은 비운다). */
    fun openUploads(sessionId: String) = uploads.open(sessionId)

    fun enqueuePassport(sessionId: String, guestId: String, jpeg: ByteArray) =
        uploads.enqueue(UploadJob(UploadKind.Passport, sessionId, guestId, jpeg = jpeg))

    /** 4MB 를 넘는 영상은 올리지 않고 얼굴 실패로 센다(서버 상한). */
    fun enqueueFace(sessionId: String, guestId: String, file: File) {
        if (!file.exists() || file.length() > MAX_FACE_BYTES) uploads.markFaceFailed(guestId, file)
        else uploads.enqueue(UploadJob(UploadKind.Face, sessionId, guestId, file = file))
    }

    fun faceFailed(guestId: String) = uploads.markFaceFailed(guestId)

    fun retryUploads() = uploads.retryFailed()

    suspend fun awaitUploads(): UploadWait = uploads.awaitIdle()

    /** 처음으로 돌아갈 때 — 못 보낸 것 · 임시 영상 파일을 버린다. */
    fun clearUploads() = uploads.clear()

    /** 업로드 한 건 — 401 이면 post() 처럼 기기 해제(등록 화면으로), 네트워크 오류는 Retry. */
    private suspend fun sendUpload(call: suspend (String) -> Api.HttpResult): UploadResult {
        val token = vault.get(KEY_TOKEN) ?: return UploadResult.Revoked
        val result = try {
            call(token)
        } catch (_: IOException) {
            _state.update { it.copy(online = false) }
            return UploadResult.Retry
        }
        val outcome = uploadResultOf(result.status, runCatching { Api.json.decodeFromString<SaveResponse>(result.body) }.getOrNull())
        if (outcome == UploadResult.Revoked) forget(revoked = true) else _state.update { it.copy(online = true) }
        return outcome
    }

    /** 시안 T3 — 찍은 여권 사진(JPEG). 저장한 사람에게만. */
    suspend fun uploadPassport(sessionId: String, guestId: String, jpeg: ByteArray): UploadResult =
        sendUpload { token -> Api.upload("/api/kiosk/passport", token, mapOf("session_id" to sessionId, "guest_id" to guestId), "passport.jpg", jpeg) }

    private suspend fun post(path: String, body: String): SaveResult {
        val token = vault.get(KEY_TOKEN) ?: return SaveResult.Failed
        val result = try {
            Api.request("POST", path, token, body)
        } catch (_: IOException) {
            _state.update { it.copy(online = false) }
            return SaveResult.Failed
        }
        if (result.status == 401) {
            forget(revoked = true)
            return SaveResult.Failed
        }
        _state.update { it.copy(online = true) }
        return saveResultOf(result.status, runCatching { Api.json.decodeFromString<SaveResponse>(result.body) }.getOrNull())
    }

    /** 직원 메뉴 「기기 다시 등록」 · 서버가 폐기를 알렸을 때. 토큰 · 저장된 설정을 지운다. */
    fun forget(revoked: Boolean = false) {
        vault.clear()
        _state.value = KioskState(phase = Phase.Enroll, revoked = revoked)
    }

    private suspend fun pingLoop() {
        while (true) {
            delay(PING_MS)
            val token = vault.get(KEY_TOKEN) ?: continue
            val body = Api.json.encodeToString(PingBody(battery(), BuildConfig.VERSION_NAME, Build.VERSION.RELEASE))
            val result = try {
                Api.request("POST", "/api/device/ping", token, body)
            } catch (_: IOException) {
                _state.update { it.copy(online = false) }
                continue
            }
            if (result.status == 401) {
                forget(revoked = true)
                continue
            }
            val parsed = runCatching { Api.json.decodeFromString<PingResponse>(result.body) }.getOrNull()
            _state.update { it.copy(online = true) }
            if (parsed?.settingsVersion != null && parsed.settingsVersion != _state.value.settingsVersion) refreshSettings()
        }
    }

    private fun battery(): Int {
        val manager = getApplication<Application>().getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100)
    }

    private companion object {
        const val KEY_TOKEN = "device_token"
        const val KEY_SETTINGS = "settings"
        const val PING_MS = 5 * 60_000L
    }
}
