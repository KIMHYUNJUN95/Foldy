package com.harutokyo.checkin.kiosk.kiosk

// 직원 PIN 막 누르기 막기(FR-K18). 5번 틀리면 1분 잠금, 다시 5번 틀릴 때마다 두 배(최대 15분). 맞히면 처음으로.
// 횟수 · 잠금 끝은 기기 저장소에 남긴다(2026-11-13) — 앱을 껐다 켜도 이어서 센다(오프라인 대입을 재시작으로 풀지 못하게).
// 온라인이면 서버(`POST /api/kiosk/pin`)가 따로 센다.

/** 저장 자리 — 앱은 암호화 저장소(TokenVault), 테스트는 메모리. 값은 "실패|라운드|잠금끝". */
interface PinGuardStore {
    fun load(): String?
    fun save(value: String)
}

class PinGuard(
    private val tries: Int = 5,
    private val baseLockMs: Long = 60_000,
    private val maxLockMs: Long = 15 * 60_000,
    private val store: PinGuardStore? = null,
) {
    private var failures = 0
    private var rounds = 0
    var lockedUntil = 0L
        private set

    init {
        store?.load()?.split("|")?.takeIf { it.size == 3 }?.let { parts ->
            failures = parts[0].toIntOrNull()?.coerceAtLeast(0) ?: 0
            rounds = parts[1].toIntOrNull()?.coerceAtLeast(0) ?: 0
            lockedUntil = parts[2].toLongOrNull()?.coerceAtLeast(0) ?: 0
        }
    }

    fun remainingMs(now: Long): Long = (lockedUntil - now).coerceAtLeast(0)

    /** 틀렸을 때. 잠금이 걸리면 잠금 끝 시각, 아니면 null. */
    fun fail(now: Long): Long? {
        failures++
        if (failures < tries) {
            persist()
            return null
        }
        failures = 0
        rounds++
        val lock = (baseLockMs shl (rounds - 1).coerceAtMost(10)).coerceAtMost(maxLockMs)
        lockedUntil = now + lock
        persist()
        return lockedUntil
    }

    /** 서버가 잠갔을 때 — 그 시각까지 기기에서도 막는다. */
    fun lockUntil(until: Long) {
        failures = 0
        lockedUntil = maxOf(lockedUntil, until)
        persist()
    }

    fun pass() {
        failures = 0
        rounds = 0
        lockedUntil = 0
        persist()
    }

    private fun persist() {
        store?.save("$failures|$rounds|$lockedUntil")
    }
}
