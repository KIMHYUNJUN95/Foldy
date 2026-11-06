package com.harutokyo.checkin.kiosk.call

import com.harutokyo.checkin.kiosk.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.time.Instant

// apps/checkin `/api/kiosk/call*` 약속(46 §5) 파싱. 이해하지 못한 응답은 전부 「실패」 쪽이다.

sealed interface CreateResult {
    data class Ok(val callId: String, val deadlineMs: Long) : CreateResult
    data class Rejected(val error: String?) : CreateResult
}

@Serializable
private data class CreateBody(val step: String, val language: String, val sessionId: String? = null)

@Serializable
private data class CreateResponse(val ok: Boolean = false, val callId: String? = null, val ringDeadlineAt: String? = null, val error: String? = null)

@Serializable
private data class StatusResponse(val ok: Boolean = false, val status: String? = null, val token: String? = null, val url: String? = null)

object CallWire {
    const val RING_MS = 45_000L

    /** [sessionId]: 진행 중인 체크인 세션 값(있을 때만). 서버가 증명 흐름을 거친 경우에만 stay 에 잇는다 — 기기가 stay 를 직접 지정하지 않는다. */
    fun createBody(step: String, language: String, sessionId: String? = null): String = Api.json.encodeToString(CreateBody(step, language, sessionId))

    /**
     * [nowMs] 는 기기 시계(단조), [wallMs] 는 달력 시각. 서버 마감이 지금으로부터 0~2분 안일 때만 믿고, 아니면(시계 어긋남 · 읽기 실패) 45초.
     */
    fun parseCreate(status: Int, body: String, nowMs: Long, wallMs: Long = System.currentTimeMillis()): CreateResult {
        val parsed = runCatching { Api.json.decodeFromString<CreateResponse>(body) }.getOrNull()
        val id = parsed?.callId?.takeIf { it.isNotBlank() }
        if (status !in 200..299 || parsed?.ok != true || id == null) return CreateResult.Rejected(parsed?.error)
        val remaining = parsed.ringDeadlineAt?.let { runCatching { Instant.parse(it).toEpochMilli() - wallMs }.getOrNull() }
            ?.takeIf { it in 1..120_000 } ?: RING_MS
        return CreateResult.Ok(id, nowMs + remaining)
    }

    /** null = 읽을 수 없다(서버 오류 · 깨진 응답) — 반복문이 다음 차례에 다시 묻는다. */
    fun parsePoll(status: Int, body: String): PollStatus? {
        if (status == 404 || status == 401 || status == 403) return PollStatus.Gone
        if (status !in 200..299) return null
        val parsed = runCatching { Api.json.decodeFromString<StatusResponse>(body) }.getOrNull() ?: return null
        if (!parsed.ok) return null
        return when (parsed.status) {
            "ringing" -> PollStatus.Ringing
            "accepted" -> PollStatus.Accepted(parsed.token, parsed.url)
            "no_answer" -> PollStatus.NoAnswer
            "canceled" -> PollStatus.Canceled
            "failed" -> PollStatus.Failed
            "ended" -> PollStatus.Ended
            else -> null
        }
    }
}
