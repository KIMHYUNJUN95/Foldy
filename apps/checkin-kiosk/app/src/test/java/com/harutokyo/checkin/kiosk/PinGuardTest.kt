package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.kiosk.PinGuard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PinGuardTest {
    @Test fun locksAfterFiveFailures() {
        val guard = PinGuard()
        repeat(4) { assertNull(guard.fail(1_000)) }
        assertEquals(61_000L, guard.fail(1_000))
        assertEquals(60_000L, guard.remainingMs(1_000))
        assertEquals(0L, guard.remainingMs(61_000))
    }

    @Test fun lockDoublesUpToFifteenMinutes() {
        val guard = PinGuard()
        val locks = (1..6).map { round -> repeat(4) { guard.fail(0) }; guard.fail(0)!! }
        assertEquals(listOf(60_000L, 120_000L, 240_000L, 480_000L, 900_000L, 900_000L), locks)
    }

    @Test fun rightPinResets() {
        val guard = PinGuard()
        repeat(4) { guard.fail(0) }
        guard.pass()
        repeat(4) { assertNull(guard.fail(0)) }
        assertEquals(0L, guard.remainingMs(0))
    }
}
