package com.harutokyo.checkin.kiosk.data

import com.harutokyo.checkin.kiosk.contract.SaveResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.io.File

// 빠른 체크인의 뒤쪽 올리기 줄 — 여권 사진 · 얼굴 영상을 한 개씩 차례로 보낸다(손님은 기다리지 않는다).
// 네트워크 오류 · 5xx 만 최대 3번(0.8초 · 1.6초 쉬고) 다시 보낸다. 서버가 영구히 거절한 건(404 · 409 · 413 · 415 · 429 …)은 다시 보내지 않고
// 「포기」로 세어 완료를 막지 않는다(얼굴 · 여권 각각 표시만 — 직원이 나중에 판단). session_gone · 기기 해제(401)면 전부 버리고 멈춘다.
// 「끝」 = 서버가 ok 로 답한 것. 영상 파일은 올림이 확인된 뒤에만 지운다. 손님 정보(이름 · 번호)는 로그에 남기지 않는다.

enum class UploadKind { Passport, Face }

class UploadJob(
    val kind: UploadKind,
    val sessionId: String,
    val guestId: String,
    val jpeg: ByteArray? = null,
    val file: File? = null,
)

data class UploadCounts(
    /** 보내는 중 + 기다리는 것. */
    val pending: Int = 0,
    /** 네트워크 · 5xx 로 재시도까지 해도 못 보낸 것(다시 누르면 또 보낸다). */
    val failed: Int = 0,
    /** 카메라 · 녹화가 실패했거나 파일이 너무 크거나 서버가 영구히 거절해 포기한 얼굴 수. */
    val faceFailed: Int = 0,
    /** 서버가 영구히 거절해 포기한 여권 사진 수. */
    val passportGivenUp: Int = 0,
)

/** 한 건을 보낸 결과. Retry = 네트워크 · 5xx, GiveUp = 영구 거절, Gone = session_gone, Revoked = 401(기기 해제). */
sealed interface UploadResult {
    data object Ok : UploadResult
    data object Retry : UploadResult
    data object GiveUp : UploadResult
    data object Gone : UploadResult
    data object Revoked : UploadResult
}

/** 서버 응답 → 결과. 테스트로 덮는다(HTTP 없음). */
fun uploadResultOf(status: Int, response: SaveResponse?): UploadResult = when {
    response?.ok == true && status in 200..299 -> UploadResult.Ok
    status == 401 -> UploadResult.Revoked
    status == 409 && response?.error == "session_gone" -> UploadResult.Gone
    status >= 500 -> UploadResult.Retry
    status in 400..499 -> UploadResult.GiveUp
    else -> UploadResult.Retry
}

sealed interface UploadWait {
    data object Done : UploadWait
    data class Failed(val count: Int) : UploadWait
    data object SessionGone : UploadWait
}

/** 서버가 받는 얼굴 영상 상한(Vercel 본문 4MB). 넘으면 올리지 않고 얼굴 실패로 센다. */
const val MAX_FACE_BYTES = 4L * 1024 * 1024

/** Retry(네트워크 · 5xx)만 다시 보낸다. 그 밖의 결과는 바로 돌려준다. 테스트로 덮는다. */
suspend fun uploadWithRetry(
    attempts: Int = 3,
    backoffMs: Long = 800,
    pause: suspend (Long) -> Unit = { delay(it) },
    call: suspend () -> UploadResult,
): UploadResult {
    var result: UploadResult = UploadResult.Retry
    for (attempt in 1..attempts) {
        result = call()
        if (result !is UploadResult.Retry) return result
        if (attempt < attempts) pause(backoffMs * attempt)
    }
    return result
}

/** 한 번에 한 건. 모든 상태 변경은 scope(메인)에서만 — 보내는 일만 IO 로 나간다. */
class UploadQueue(
    private val scope: CoroutineScope,
    private val pause: suspend (Long) -> Unit = { delay(it) },
    private val send: suspend (UploadJob) -> UploadResult,
) {
    private val waiting = ArrayDeque<UploadJob>()
    private val failedJobs = mutableListOf<UploadJob>()
    private val faceFailedIds = mutableSetOf<String>()
    private val passportGivenUpIds = mutableSetOf<String>()
    // 지금 열려 있는 예약 — clear() 뒤에 늦게 들어오는 옛 손님 항목은 버린다.
    private var openSession: String? = null
    private var current: UploadJob? = null
    private var worker: Job? = null
    private var gone = false
    private val _counts = MutableStateFlow(UploadCounts())
    val counts: StateFlow<UploadCounts> = _counts.asStateFlow()

    /** 새 손님의 예약을 연다(이전 줄은 비운다). 이 예약이 아닌 항목은 enqueue 에서 버린다. */
    fun open(sessionId: String) {
        clear()
        openSession = sessionId
    }

    fun enqueue(job: UploadJob) {
        if (gone || job.sessionId != openSession) {
            job.file?.delete()
            return
        }
        waiting.addLast(job)
        publish()
        pump()
    }

    /** 얼굴 녹화를 못 했거나 파일이 상한을 넘었다 — 막지 않고 표시만(직원이 나중에 판단). */
    fun markFaceFailed(guestId: String, file: File? = null) {
        file?.delete()
        if (openSession == null) return
        faceFailedIds += guestId
        publish()
    }

    /** 못 보낸 것을 다시 줄에 넣는다(「동의하고 끝내기」를 다시 눌렀을 때). */
    fun retryFailed() {
        if (failedJobs.isEmpty()) return
        waiting.addAll(failedJobs)
        failedJobs.clear()
        publish()
        pump()
    }

    /** 줄이 빌 때까지 기다린다. */
    suspend fun awaitIdle(): UploadWait {
        _counts.first { it.pending == 0 }
        return when {
            gone -> UploadWait.SessionGone
            failedJobs.isNotEmpty() -> UploadWait.Failed(failedJobs.size)
            else -> UploadWait.Done
        }
    }

    /** 처음으로 돌아갈 때 — 줄 · 임시 영상 파일을 모두 비운다. */
    fun clear() {
        worker?.cancel()
        worker = null
        waiting.forEach { it.file?.delete() }
        failedJobs.forEach { it.file?.delete() }
        current?.file?.delete()
        waiting.clear()
        failedJobs.clear()
        faceFailedIds.clear()
        passportGivenUpIds.clear()
        current = null
        openSession = null
        gone = false
        publish()
    }

    private fun pump() {
        if (worker?.isActive == true) return
        worker = scope.launch {
            while (true) {
                val job = waiting.removeFirstOrNull() ?: break
                current = job
                publish()
                val result = uploadWithRetry(pause = pause) { send(job) }
                current = null
                when (result) {
                    UploadResult.Ok -> job.file?.delete()
                    UploadResult.GiveUp -> {
                        job.file?.delete()
                        if (job.kind == UploadKind.Face) faceFailedIds += job.guestId else passportGivenUpIds += job.guestId
                    }
                    UploadResult.Gone, UploadResult.Revoked -> {
                        gone = true
                        job.file?.delete()
                        waiting.forEach { it.file?.delete() }
                        waiting.clear()
                    }
                    UploadResult.Retry -> failedJobs += job
                }
                publish()
            }
        }
    }

    private fun publish() {
        _counts.value = UploadCounts(
            pending = waiting.size + (if (current != null) 1 else 0),
            failed = failedJobs.size,
            faceFailed = faceFailedIds.size,
            passportGivenUp = passportGivenUpIds.size,
        )
    }
}
