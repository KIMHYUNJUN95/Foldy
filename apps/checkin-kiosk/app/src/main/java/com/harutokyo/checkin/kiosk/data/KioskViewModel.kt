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
