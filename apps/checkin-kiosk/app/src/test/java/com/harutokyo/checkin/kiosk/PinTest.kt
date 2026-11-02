package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.StaffPin
import com.harutokyo.checkin.kiosk.kiosk.Pin
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// 서버 hashPin(apps/checkin/src/lib/device/pin.ts)이 만든 값과 같아야 한다 — salt "0123456789abcdef", PIN 4821.
class PinTest {
    private val stored = StaffPin(
        algorithm = "pbkdf2-sha256",
        iterations = 120_000,
        salt = "MDEyMzQ1Njc4OWFiY2RlZg==",
        hash = "0dvGFoqvbnCjiEin5eZVtRkoXNrfFZ98oZIPbUKK2U0=",
    )

    @Test fun rightPinPasses() = assertTrue(Pin.verify("4821", stored))
    @Test fun wrongPinFails() = assertFalse(Pin.verify("4822", stored))
    @Test fun noPinFails() = assertFalse(Pin.verify("4821", null))
    @Test fun otherAlgorithmFails() = assertFalse(Pin.verify("4821", stored.copy(algorithm = "md5")))
}
