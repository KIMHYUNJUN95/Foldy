package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.SaveResponse
import com.harutokyo.checkin.kiosk.data.StepTimer
import com.harutokyo.checkin.kiosk.data.UploadJob
import com.harutokyo.checkin.kiosk.data.UploadKind
import com.harutokyo.checkin.kiosk.data.UploadQueue
import com.harutokyo.checkin.kiosk.data.UploadResult
import com.harutokyo.checkin.kiosk.data.uploadResultOf
import com.harutokyo.checkin.kiosk.data.UploadWait
import com.harutokyo.checkin.kiosk.data.uploadWithRetry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class UploadQueueTest {
    private val ok = UploadResult.Ok

    @Test
    fun mapsServerAnswersToRetryGiveUpOrGone() {
        fun r(status: Int, body: String) = uploadResultOf(status, kotlinx.serialization.json.Json { ignoreUnknownKeys = true }.decodeFromString<SaveResponse>(body))
        assertEquals(UploadResult.Ok, r(200, """{"ok":true}"""))
        assertEquals(UploadResult.Gone, r(409, """{"ok":false,"error":"session_gone"}"""))
        assertEquals(UploadResult.Revoked, r(401, """{"ok":false,"error":"unauthorized"}"""))
        // 영구 거절 — 다시 보내지 않는다.
        for (status in listOf(404, 413, 415, 429)) assertEquals(UploadResult.GiveUp, r(status, """{"ok":false,"error":"x"}"""))
        assertEquals(UploadResult.GiveUp, r(409, """{"ok":false,"error":"locked"}"""))
        // 서버 오류만 다시.
        assertEquals(UploadResult.Retry, r(500, """{"ok":false,"error":"server_error"}"""))
        assertEquals(UploadResult.Retry, r(503, """{"ok":false}"""))
        assertEquals(UploadResult.Retry, uploadResultOf(200, null))
    }

    @Test
    fun retriesOnlyRetryAndBacksOff() = runBlocking {
        val pauses = mutableListOf<Long>()
        var calls = 0
        val result = uploadWithRetry(pause = { pauses += it }) { if (++calls < 3) UploadResult.Retry else ok }
        assertEquals(ok, result)
        assertEquals(3, calls)
        assertEquals(listOf(800L, 1600L), pauses)
        calls = 0
        assertEquals(UploadResult.Retry, uploadWithRetry(pause = {}) { calls++; UploadResult.Retry })
        assertEquals(3, calls)
        for (final in listOf(UploadResult.GiveUp, UploadResult.Gone, UploadResult.Revoked)) {
            calls = 0
            assertEquals(final, uploadWithRetry(pause = {}) { calls++; final })
            assertEquals(1, calls)
        }
    }

    private fun queue(send: suspend (UploadJob) -> UploadResult) =
        UploadQueue(CoroutineScope(Dispatchers.Unconfined), pause = {}, send = send).also { it.open("sess") }

    private fun job(guest: String, file: File? = null, kind: UploadKind = UploadKind.Face, session: String = "sess") =
        UploadJob(kind, session, guest, file = file)

    @Test
    fun sendsInOrderDeletesConfirmedFileAndReportsDone() = runBlocking {
        val order = mutableListOf<String>()
        val file = File.createTempFile("face-test", ".mp4").also { it.writeText("x") }
        val q = queue { order += it.guestId; ok }
        q.enqueue(job("a", file))
        q.enqueue(job("b"))
        assertEquals(UploadWait.Done, q.awaitIdle())
        assertEquals(listOf("a", "b"), order)
        assertFalse(file.exists())
        assertEquals(0, q.counts.value.pending)
    }

    @Test
    fun keepsFileWhenRetryableFailureAndRetriesOnRequest() = runBlocking {
        var good = false
        val file = File.createTempFile("face-test", ".mp4").also { it.writeText("x") }
        val q = queue { if (good) ok else UploadResult.Retry }
        q.enqueue(job("a", file))
        assertEquals(UploadWait.Failed(1), q.awaitIdle())
        assertTrue(file.exists())
        good = true
        q.retryFailed()
        assertEquals(UploadWait.Done, q.awaitIdle())
        assertFalse(file.exists())
    }

    @Test
    fun permanentRejectionIsGivenUpAndDoesNotBlockCompletion() = runBlocking {
        val file = File.createTempFile("face-test", ".mp4").also { it.writeText("x") }
        var calls = 0
        val q = queue { calls++; UploadResult.GiveUp }
        q.enqueue(job("a", file))
        q.enqueue(job("b", kind = UploadKind.Passport))
        assertEquals(UploadWait.Done, q.awaitIdle())
        assertEquals(2, calls)
        assertEquals(1, q.counts.value.faceFailed)
        assertEquals(1, q.counts.value.passportGivenUp)
        assertEquals(0, q.counts.value.failed)
        assertFalse(file.exists())
    }

    @Test
    fun sessionGoneDropsEverythingAndOldSessionItemsAreIgnoredAfterClear() = runBlocking {
        val q = queue { UploadResult.Gone }
        q.enqueue(job("a"))
        q.enqueue(job("b"))
        assertEquals(UploadWait.SessionGone, q.awaitIdle())
        q.clear()
        // clear 뒤엔 예약이 닫혀 있다 — 늦게 오는 옛 항목은 버린다(파일도 지운다).
        val sent = mutableListOf<String>()
        val q2 = UploadQueue(CoroutineScope(Dispatchers.Unconfined), pause = {}) { sent += it.guestId; ok }
        q2.open("new")
        val stale = File.createTempFile("face-test", ".mp4")
        q2.enqueue(job("old", stale, session = "old"))
        q2.enqueue(job("fresh", session = "new"))
        assertEquals(UploadWait.Done, q2.awaitIdle())
        assertEquals(listOf("fresh"), sent)
        assertFalse(stale.exists())
        q2.clear()
        q2.enqueue(job("late", session = "new"))
        assertEquals(0, q2.counts.value.pending)
        assertEquals(listOf("fresh"), sent)
    }
}

class StepTimerTest {
    @Test
    fun summaryListsStepDurationsAndTotalWithoutDuplicates() {
        var now = 1_000L
        val timer = StepTimer { now }
        timer.enter("language")
        now += 1_200
        timer.enter("f1")
        timer.enter("f1")
        now += 8_000
        timer.enter("passport 2")
        now += 500
        assertEquals("language=1200 f1=8000 passport 2=500 total=9700", timer.summary())
        timer.reset()
        assertEquals("total=0", timer.summary())
    }
}
