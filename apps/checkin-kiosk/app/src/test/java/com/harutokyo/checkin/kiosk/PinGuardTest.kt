package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.kiosk.PinGuard
import com.harutokyo.checkin.kiosk.kiosk.PinGuardStore
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

    private class MemoryStore : PinGuardStore {
        var value: String? = null
        override fun load() = value
        override fun save(value: String) { this.value = value }
    }

    @Test fun lockSurvivesRestart() {
        val store = MemoryStore()
        val guard = PinGuard(store = store)
        repeat(5) { guard.fail(1_000) }
        val restarted = PinGuard(store = store)
        assertEquals(60_000L, restarted.remainingMs(1_000))
    }

    @Test fun failuresAndRoundsSurviveRestart() {
        val store = MemoryStore()
        val guard = PinGuard(store = store)
        repeat(5) { guard.fail(0) }
        repeat(3) { guard.fail(100_000) }
        val restarted = PinGuard(store = store)
        assertNull(restarted.fail(100_000))
        // 5번째(이어서 센 것) — 두 번째 라운드라 2분.
        assertEquals(220_000L, restarted.fail(100_000))
    }

    @Test fun passClearsStoredState() {
        val store = MemoryStore()
        val guard = PinGuard(store = store)
        repeat(5) { guard.fail(0) }
        guard.pass()
        assertEquals(0L, PinGuard(store = store).remainingMs(0))
    }

    @Test fun brokenStoredValueStartsFresh() {
        val store = MemoryStore().apply { value = "x|y" }
        assertEquals(0L, PinGuard(store = store).remainingMs(0))
    }
}
