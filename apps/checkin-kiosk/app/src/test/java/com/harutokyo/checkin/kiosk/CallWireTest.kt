package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.call.CallWire
import com.harutokyo.checkin.kiosk.call.CreateResult
import com.harutokyo.checkin.kiosk.call.PollStatus
import com.harutokyo.checkin.kiosk.contract.Contract
import com.harutokyo.checkin.kiosk.data.Api
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// 서버 약속(46 §5) 파싱. 모르는 값 · 깨진 응답은 전부 「연결 못 함」 쪽으로 — 손님 화면이 멈추지 않게.
class CallWireTest {
    @Test fun createOkGivesCallIdAndDeadlineFromServerValue() {
        val r = CallWire.parseCreate(200, """{"ok":true,"callId":"c1","ringDeadlineAt":"2026-11-06T10:00:45.000Z"}""", nowMs = 1_000, wallMs = java.time.Instant.parse("2026-11-06T10:00:00.000Z").toEpochMilli())
        r as CreateResult.Ok
        assertEquals("c1", r.callId)
        assertEquals(1_000 + 45_000, r.deadlineMs)
    }

    @Test fun createOkWithUnreadableDeadlineFallsBackTo45Seconds() {
        val r = CallWire.parseCreate(200, """{"ok":true,"callId":"c1","ringDeadlineAt":"soon"}""", nowMs = 5_000) as CreateResult.Ok
        assertEquals(5_000 + 45_000, r.deadlineMs)
    }

    @Test fun createDeadlineFarFromNowIsDistrustedAsClockSkew() {
        val far = "2030-01-01T00:00:00Z"
        val r = CallWire.parseCreate(200, """{"ok":true,"callId":"c1","ringDeadlineAt":"$far"}""", nowMs = 5_000) as CreateResult.Ok
        assertEquals(5_000 + 45_000, r.deadlineMs)
    }

    @Test fun createRejectedKeepsErrorKey() {
        assertEquals(CreateResult.Rejected("disabled"), CallWire.parseCreate(200, """{"ok":false,"error":"disabled"}""", 0))
        assertEquals(CreateResult.Rejected("unconfigured"), CallWire.parseCreate(503, """{"ok":false,"error":"unconfigured"}""", 0))
    }

    @Test fun createGarbageOrServerErrorIsRejected() {
        assertTrue(CallWire.parseCreate(500, "<html>", 0) is CreateResult.Rejected)
        assertTrue(CallWire.parseCreate(200, """{"ok":true}""", 0) is CreateResult.Rejected)
        assertTrue(CallWire.parseCreate(401, "", 0) is CreateResult.Rejected)
    }

    @Test fun pollStatuses() {
        assertEquals(PollStatus.Ringing, CallWire.parsePoll(200, """{"ok":true,"status":"ringing"}"""))
        assertEquals(PollStatus.NoAnswer, CallWire.parsePoll(200, """{"ok":true,"status":"no_answer"}"""))
        assertEquals(PollStatus.Canceled, CallWire.parsePoll(200, """{"ok":true,"status":"canceled"}"""))
        assertEquals(PollStatus.Failed, CallWire.parsePoll(200, """{"ok":true,"status":"failed"}"""))
        assertEquals(PollStatus.Ended, CallWire.parsePoll(200, """{"ok":true,"status":"ended"}"""))
        assertEquals(PollStatus.Accepted("t", "wss://x"), CallWire.parsePoll(200, """{"ok":true,"status":"accepted","token":"t","url":"wss://x"}"""))
    }

    @Test fun pollNotFoundOrUnauthorizedIsGone() {
        assertEquals(PollStatus.Gone, CallWire.parsePoll(404, """{"ok":false}"""))
        assertEquals(PollStatus.Gone, CallWire.parsePoll(401, ""))
    }

    @Test fun pollUnknownStatusOrBrokenBodyIsNullSoTheLoopKeepsTrying() {
        assertEquals(null, CallWire.parsePoll(200, """{"ok":true,"status":"mystery"}"""))
        assertEquals(null, CallWire.parsePoll(502, "<html>"))
        assertEquals(null, CallWire.parsePoll(200, "not json"))
    }

    @Test fun createBodyHasStepAndLanguageOnly() {
        assertEquals("""{"step":"face","language":"zh-Hans"}""", CallWire.createBody("face", "zh-Hans"))
    }

    @Test fun createBodyCarriesSessionIdOnlyWhenThereIsOne() {
        assertEquals("""{"step":"face","language":"en","sessionId":"s1"}""", CallWire.createBody("face", "en", "s1"))
    }

    @Test fun contractStaffCallEnabledDefaultsToOffAndReadsTrue() {
        val base = javaClass.classLoader!!.getResource("contract-default.json")!!.readText()
        assertFalse(Api.json.decodeFromString<Contract>(base).staffCallEnabled)
        val on = base.replaceFirst("{", "{\"staffCallEnabled\":true,")
        assertTrue(Api.json.decodeFromString<Contract>(on).staffCallEnabled)
    }
}
