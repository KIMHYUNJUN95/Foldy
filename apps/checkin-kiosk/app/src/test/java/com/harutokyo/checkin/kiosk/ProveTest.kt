package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.BlockReason
import com.harutokyo.checkin.kiosk.contract.FindResponse
import com.harutokyo.checkin.kiosk.contract.FindResult
import com.harutokyo.checkin.kiosk.contract.ProveBody
import com.harutokyo.checkin.kiosk.contract.ProveResult
import com.harutokyo.checkin.kiosk.contract.findResultOf
import com.harutokyo.checkin.kiosk.contract.proveResultOf
import com.harutokyo.checkin.kiosk.data.Api
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// 이름으로 찾기 → proof_needed(예약 내용 없음) → 여권으로 prove.
class ProveTest {
    private fun parse(body: String) = Api.json.decodeFromString<FindResponse>(body)
    private val stay = """"stay":{"stayId":"x","rooms":["201"],"checkInDate":"2026-11-04","checkOutDate":"2026-11-05","nights":1,"partySize":2,"guestCountExpected":2}"""

    @Test
    fun findByNameReturnsProofNeededWithoutStay() {
        val result = findResultOf(parse("""{"ok":true,"result":"proof_needed","session_id":"s1","language":"en"}"""))
        assertEquals(FindResult.ProofNeeded("s1", "en"), result)
        assertEquals(FindResult.ProofNeeded("s1", null), findResultOf(parse("""{"ok":true,"result":"proof_needed","session_id":"s1","language":null}""")))
        // 세션 번호가 없으면 일반 오류
        assertEquals(FindResult.Server, findResultOf(parse("""{"ok":true,"result":"proof_needed"}""")))
    }

    @Test
    fun matchedProveLooksLikeAFind() {
        val found = proveResultOf(200, parse("""{"ok":true,"result":"found","session_id":"s1","language":"ja","checked_in_at":null,$stay}""")) as ProveResult.Matched
        assertEquals("s1", found.found.sessionId)
        assertFalse(found.found.checkedIn)
        val already = proveResultOf(200, parse("""{"ok":true,"result":"checked_in","session_id":"s1",$stay}""")) as ProveResult.Matched
        assertTrue(already.found.checkedIn)
    }

    @Test
    fun errorsMapToTheirOwnResults() {
        assertEquals(ProveResult.Unreadable, proveResultOf(400, parse("""{"ok":false,"error":"unreadable"}""")))
        assertEquals(ProveResult.NameMismatch, proveResultOf(403, parse("""{"ok":false,"error":"name_mismatch"}""")))
        assertTrue(proveResultOf(429, parse("""{"ok":false,"error":"locked","locked_until":"2026-11-04T10:00:00Z"}""")) is ProveResult.Locked)
        // 같은 오류 이름이라도 상태가 다르면 일반 오류 · 증명 안 된 세션(verify_required) · 본문 없음
        assertEquals(ProveResult.Server, proveResultOf(500, parse("""{"ok":false,"error":"name_mismatch"}""")))
        assertEquals(ProveResult.Server, proveResultOf(403, parse("""{"ok":false,"error":"verify_required"}""")))
        assertEquals(ProveResult.Server, proveResultOf(502, null))
    }

    @Test
    fun sessionGoneBlockedAndBusyHaveTheirOwnResults() {
        assertEquals(ProveResult.SessionGone, proveResultOf(409, parse("""{"ok":false,"error":"session_gone"}""")))
        val cancelled = proveResultOf(409, parse("""{"ok":false,"error":"blocked","reason":"cancelled"}""")) as ProveResult.Blocked
        assertEquals(BlockReason.Cancelled, cancelled.blocked.reason)
        val expired = proveResultOf(409, parse("""{"ok":false,"error":"blocked","reason":"expired","check_in_date":"2026-11-01"}""")) as ProveResult.Blocked
        assertEquals(BlockReason.Expired, expired.blocked.reason)
        val busyReason = proveResultOf(409, parse("""{"ok":false,"error":"blocked","reason":"busy"}""")) as ProveResult.Blocked
        assertEquals(BlockReason.Busy, busyReason.blocked.reason)
        // 상태가 409 가 아니면 session_gone 이라도 일반 오류
        assertEquals(ProveResult.Server, proveResultOf(500, parse("""{"ok":false,"error":"session_gone"}""")))
    }

    @Test
    fun proveBodyUsesSnakeCaseAndKeepsTheNewline() {
        val json = Api.json.encodeToString(ProveBody.serializer(), ProveBody("s1", "P<USA\nA1234"))
        assertTrue(json.contains("\"session_id\":\"s1\""))
        assertTrue(json.contains("\"mrz_raw\":\"P<USA\\nA1234\""))
    }
}
