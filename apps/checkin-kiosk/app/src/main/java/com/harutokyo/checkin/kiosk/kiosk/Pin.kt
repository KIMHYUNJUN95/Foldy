package com.harutokyo.checkin.kiosk.kiosk

import com.harutokyo.checkin.kiosk.contract.StaffPin
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

// 직원 해제 PIN(FR-K18 · K24, 2026-11-13). 온라인이면 서버(`POST /api/kiosk/pin`)가 대조하고 서버 판정을 따른다.
// 연결이 없을 때만(또는 서버가 망가졌을 때) 계약의 기기별 값으로 대조한다 — 서버 apps/checkin/src/lib/device/pin.ts `devicePin` 과 같은 계산:
// HMAC-SHA256(deviceSalt, PBKDF2-SHA256(PIN, salt, iterations, keyBytes)). 원 해시는 기기에 오지 않는다. PIN 원문은 저장하지 않는다.

/** 서버 확인 결과. */
sealed interface PinCheck {
    data object Ok : PinCheck
    data object Wrong : PinCheck
    data class Locked(val untilMillis: Long) : PinCheck
    /** 건물에 PIN 이 없다(서버 기준). */
    data object Unset : PinCheck
    /** 연결 없음 · 서버 오류 — 기기 대조로. */
    data object Offline : PinCheck
}

enum class PinVerdict { Pass, Wrong, Locked }

@Serializable
private data class PinResponse(val ok: Boolean = false, val error: String? = null, @SerialName("locked_until") val lockedUntil: String? = null)

private val pinJson = Json { ignoreUnknownKeys = true }

/** `POST /api/kiosk/pin` 응답 → 결과. 테스트로 덮는다(HTTP 없음). */
fun pinCheckOf(status: Int, body: String): PinCheck {
    val parsed = runCatching { pinJson.decodeFromString<PinResponse>(body) }.getOrNull()
    return when {
        status == 200 && parsed?.ok == true -> PinCheck.Ok
        status == 403 && parsed?.error == "wrong" -> PinCheck.Wrong
        status == 429 && parsed?.error == "locked" ->
            PinCheck.Locked(parsed.lockedUntil?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } ?: (System.currentTimeMillis() + 10 * 60_000))
        status == 409 && parsed?.error == "unset" -> PinCheck.Unset
        else -> PinCheck.Offline
    }
}

object Pin {
    private val shape = Regex("^[0-9]{4,8}$")

    /** 오프라인 대조(계약의 기기별 값). */
    fun verify(pin: String, stored: StaffPin?): Boolean {
        if (stored == null || stored.algorithm != "pbkdf2-sha256-hmac-device" || !shape.matches(pin)) return false
        return try {
            val decoder = Base64.getDecoder()
            val spec = PBEKeySpec(pin.toCharArray(), decoder.decode(stored.salt), stored.iterations, stored.keyBytes * 8)
            val derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(decoder.decode(stored.deviceSalt), "HmacSHA256")) }
            MessageDigest.isEqual(mac.doFinal(derived), decoder.decode(stored.hash))
        } catch (_: IllegalArgumentException) {
            false
        }
    }

    /** 서버 결과 + 기기 대조 → 화면 판정. 잠금 · 횟수는 guard 에 남긴다(서버 잠금이면 그 시각까지). */
    fun decide(check: PinCheck, pin: String, stored: StaffPin?, guard: PinGuard, now: Long): PinVerdict {
        val passed = when (check) {
            PinCheck.Ok -> true
            PinCheck.Wrong, PinCheck.Unset -> false
            is PinCheck.Locked -> {
                guard.lockUntil(check.untilMillis)
                return PinVerdict.Locked
            }
            PinCheck.Offline -> verify(pin, stored)
        }
        if (passed) {
            guard.pass()
            return PinVerdict.Pass
        }
        return if (guard.fail(now) != null) PinVerdict.Locked else PinVerdict.Wrong
    }
}
