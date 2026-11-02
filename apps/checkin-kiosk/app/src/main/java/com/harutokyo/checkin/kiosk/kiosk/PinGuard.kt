package com.harutokyo.checkin.kiosk.kiosk

// 직원 PIN 막 누르기 막기(FR-K18). 5번 틀리면 1분 잠금, 다시 5번 틀릴 때마다 두 배(최대 15분). 맞히면 처음으로.
// 앱 프로세스가 사는 동안만 센다(ViewModel 이 들고 있다) — 4자리 PIN 을 손으로 다 눌러 보는 것을 막는 정도.
class PinGuard(
    private val tries: Int = 5,
    private val baseLockMs: Long = 60_000,
    private val maxLockMs: Long = 15 * 60_000,
) {
    private var failures = 0
    private var rounds = 0
    var lockedUntil = 0L
        private set

    fun remainingMs(now: Long): Long = (lockedUntil - now).coerceAtLeast(0)

    /** 틀렸을 때. 잠금이 걸리면 잠금 끝 시각, 아니면 null. */
    fun fail(now: Long): Long? {
        failures++
        if (failures < tries) return null
        failures = 0
        rounds++
        val lock = (baseLockMs shl (rounds - 1).coerceAtMost(10)).coerceAtMost(maxLockMs)
        lockedUntil = now + lock
        return lockedUntil
    }

    fun pass() {
        failures = 0
        rounds = 0
        lockedUntil = 0
    }
}
