package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.StaffPin
import com.harutokyo.checkin.kiosk.kiosk.Pin
import com.harutokyo.checkin.kiosk.kiosk.PinCheck
import com.harutokyo.checkin.kiosk.kiosk.PinGuard
import com.harutokyo.checkin.kiosk.kiosk.PinVerdict
import com.harutokyo.checkin.kiosk.kiosk.pinCheckOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// 서버 devicePin(apps/checkin/src/lib/device/pin.ts)이 만든 기기별 값과 같아야 한다 —
// salt "0123456789abcdef", PIN 4821, 기기 "dev-1", 비밀값 "test-secret"(서버 device.test.ts 고정 벡터).
class PinTest {
    private val stored = StaffPin(
        algorithm = "pbkdf2-sha256-hmac-device",
        iterations = 120_000,
        salt = "MDEyMzQ1Njc4OWFiY2RlZg==",
        deviceSalt = "im6jm7ygxmtL2HAC8Xbj7RR64Gi9bYt4oFaL+1ayBsY=",
        keyBytes = 32,
        hash = "MydjpKau9Y4/P7M0CbXQgo9Uv+mUW2URaI88xfthAJY=",
    )

    @Test fun rightPinPasses() = assertTrue(Pin.verify("4821", stored))
    @Test fun wrongPinFails() = assertFalse(Pin.verify("4822", stored))
    @Test fun noPinFails() = assertFalse(Pin.verify("4821", null))
    @Test fun otherAlgorithmFails() = assertFalse(Pin.verify("4821", stored.copy(algorithm = "pbkdf2-sha256")))
    @Test fun otherDeviceSaltFails() = assertFalse(Pin.verify("4821", stored.copy(deviceSalt = "MDEyMzQ1Njc4OWFiY2RlZg==")))

    // ── 온라인이면 서버 판정, 연결이 없을 때만 기기 대조 ──
    @Test fun serverResponses() {
        assertEquals(PinCheck.Ok, pinCheckOf(200, """{"ok":true}"""))
        assertEquals(PinCheck.Wrong, pinCheckOf(403, """{"ok":false,"error":"wrong","remaining":4}"""))
        assertEquals(PinCheck.Locked(java.time.Instant.parse("2026-11-13T06:10:00Z").toEpochMilli()), pinCheckOf(429, """{"ok":false,"error":"locked","locked_until":"2026-11-13T06:10:00Z"}"""))
        assertEquals(PinCheck.Unset, pinCheckOf(409, """{"ok":false,"error":"unset"}"""))
        // 서버가 망가졌으면 기기 대조로(오프라인과 같게) — 직원이 잠금을 못 푸는 일이 없게.
        assertEquals(PinCheck.Offline, pinCheckOf(500, """{"ok":false,"error":"server_error"}"""))
        assertEquals(PinCheck.Offline, pinCheckOf(502, "<html>"))
    }

    @Test fun serverOkPassesEvenIfLocalHashIsStale() {
        val guard = PinGuard()
        assertEquals(PinVerdict.Pass, Pin.decide(PinCheck.Ok, "9999", stored, guard, now = 0))
    }

    @Test fun serverWrongFailsEvenIfLocalHashMatches() {
        val guard = PinGuard()
        assertEquals(PinVerdict.Wrong, Pin.decide(PinCheck.Wrong, "4821", stored, guard, now = 0))
    }

    @Test fun serverLockSetsGuard() {
        val guard = PinGuard()
        assertEquals(PinVerdict.Locked, Pin.decide(PinCheck.Locked(600_000), "4821", stored, guard, now = 0))
        assertEquals(600_000, guard.remainingMs(0))
    }

    @Test fun offlineFallsBackToDeviceValue() {
        val guard = PinGuard()
        assertEquals(PinVerdict.Pass, Pin.decide(PinCheck.Offline, "4821", stored, guard, now = 0))
        assertEquals(PinVerdict.Wrong, Pin.decide(PinCheck.Offline, "4822", stored, guard, now = 0))
    }

    @Test fun unsetOnServerIsWrong() {
        assertEquals(PinVerdict.Wrong, Pin.decide(PinCheck.Unset, "4821", stored, PinGuard(), now = 0))
    }
}
