package com.harutokyo.checkin.kiosk.data

import android.os.SystemClock
import android.util.Log

// 빠른 체크인 소요 시간(목표: 4명 약 3분). 화면에 들어간 순간(단조 시계)만 적고, 끝나면 한 줄로 로그에 남긴다.
// 단계 이름만 — 손님 이름 · 여권 번호 같은 정보는 넣지 않는다. 흐름이 처음으로 돌아가면 reset.
class StepTimer(private val clock: () -> Long = { SystemClock.elapsedRealtime() }) {
    private val names = mutableListOf<String>()
    private val starts = mutableListOf<Long>()

    /** 이 단계에 들어갔다. 같은 단계가 이어서 불리면 무시한다. */
    fun enter(step: String) {
        if (names.lastOrNull() == step) return
        names += step
        starts += clock()
    }

    fun reset() {
        names.clear()
        starts.clear()
    }

    /** 「language=1200 f1=8400 … total=181000」 — 마지막 단계는 끝난 시각까지. */
    fun summary(): String {
        if (names.isEmpty()) return "total=0"
        val end = clock()
        val parts = names.indices.map { index ->
            val next = starts.getOrNull(index + 1) ?: end
            "${names[index]}=${next - starts[index]}"
        }
        return (parts + "total=${end - starts.first()}").joinToString(" ")
    }

    /** 완료 — 한 줄 로그 후 비운다. */
    fun finish() {
        if (names.isEmpty()) return
        Log.i("KioskTiming", summary())
        reset()
    }
}
