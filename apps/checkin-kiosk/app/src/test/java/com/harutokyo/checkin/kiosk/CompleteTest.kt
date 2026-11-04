package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.AccessKind
import com.harutokyo.checkin.kiosk.contract.CompleteAddress
import com.harutokyo.checkin.kiosk.contract.CompleteResponse
import com.harutokyo.checkin.kiosk.contract.CompleteResult
import com.harutokyo.checkin.kiosk.contract.CompletionInfo
import com.harutokyo.checkin.kiosk.contract.CompleteRoom
import com.harutokyo.checkin.kiosk.contract.CompleteShared
import com.harutokyo.checkin.kiosk.contract.accessKindOf
import com.harutokyo.checkin.kiosk.contract.addressFor
import com.harutokyo.checkin.kiosk.contract.codeTextSize
import com.harutokyo.checkin.kiosk.contract.completeResultOf
import com.harutokyo.checkin.kiosk.contract.signLabelOf
import com.harutokyo.checkin.kiosk.contract.isAllRoomsSameNote
import com.harutokyo.checkin.kiosk.contract.isFirstFloorPrefix
import com.harutokyo.checkin.kiosk.contract.needsStaffForCode
import com.harutokyo.checkin.kiosk.data.Api
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CompleteTest {
    private fun parse(json: String) = Api.json.decodeFromString<CompleteResponse>(json)

    @Test
    fun parsesFullResponseWithNullCodes() {
        val response = parse(
            """{"ok":true,"already":false,"rooms":[{"label":"201","code":null},{"label":"202","code":"4821#"}],
            "shared":[{"label_key":"keyBoxPassword","code":"1234","prefix_key":"floor1","note_key":"allRoomsSame"}],
            "address":{"ko":null,"ja":"東京","en":null},"check_in_date":"2026-11-04","check_out_date":"2026-11-05",
            "guest_count":2,"lead_name":"KIM TARO","staff_check_count":1,"unknown":"x"}""",
        )
        val done = completeResultOf(200, response) as CompleteResult.Done
        assertEquals(2, done.info.rooms.size)
        assertNull(done.info.rooms[0].code)
        assertEquals("1234", done.info.shared[0].code)
        assertEquals("2026-11-05", done.info.checkOutDate)
        assertEquals(2, done.info.guestCount)
        assertEquals(1, done.info.staffCheckCount)
    }

    @Test
    fun incompleteAndSessionGoneAndFailures() {
        assertEquals(CompleteResult.Incomplete("consent"), completeResultOf(409, parse("""{"ok":false,"error":"incomplete","reason":"consent"}""")))
        assertEquals(CompleteResult.Incomplete("roster"), completeResultOf(409, parse("""{"ok":false,"error":"incomplete","reason":"roster"}""")))
        assertEquals(CompleteResult.SessionGone, completeResultOf(409, parse("""{"ok":false,"error":"session_gone"}""")))
        assertEquals(CompleteResult.Server, completeResultOf(500, null))
        assertEquals(CompleteResult.Server, completeResultOf(400, parse("""{"ok":false,"error":"invalid"}""")))
    }

    @Test
    fun dropsBlankRoomsAndSharedCodes() {
        val done = completeResultOf(200, parse("""{"ok":true,"rooms":[{"label":" "}],"shared":[{"label_key":"keyBox","code":""}]}""")) as CompleteResult.Done
        assertTrue(done.info.rooms.isEmpty())
        assertTrue(done.info.shared.isEmpty())
    }

    @Test
    fun infoToStringHidesCodes() {
        val info = CompletionInfo(listOf(CompleteRoom("201", "9999")), listOf(CompleteShared("keyBox", "7777")), null, null, null, 1, null, 0)
        assertFalse(info.toString().contains("9999"))
        assertFalse(info.toString().contains("7777"))
    }

    @Test
    fun labelKeysMapToTheFourKindsTheServerSends() {
        assertEquals(AccessKind.DoorPassword, accessKindOf("doorPassword"))
        assertEquals(AccessKind.RoomPassword, accessKindOf("roomPassword"))
        assertEquals(AccessKind.KeyBox, accessKindOf("keyBox"))
        assertEquals(AccessKind.KeyBoxPassword, accessKindOf("keyBoxPassword"))
        // 서버가 주지 않는 모양 · 창고 계열 · 빈 값은 일반 이름(원문 키를 그리지 않는다)
        assertEquals(AccessKind.Generic, accessKindOf("storagePassword"))
        assertEquals(AccessKind.Generic, accessKindOf("calendarMapAccessKindDoorPassword"))
        assertEquals(AccessKind.Generic, accessKindOf("somethingNew"))
        assertEquals(AccessKind.Generic, accessKindOf(""))
    }

    @Test
    fun prefixAndNoteOnlyForKnownKeys() {
        assertTrue(isFirstFloorPrefix("floor1"))
        assertFalse(isFirstFloorPrefix("floor2"))
        assertFalse(isFirstFloorPrefix("calendarMapAccessFloor1"))
        assertFalse(isFirstFloorPrefix(null))
        assertTrue(isAllRoomsSameNote("allRoomsSame"))
        assertFalse(isAllRoomsSameNote("other"))
        assertFalse(isAllRoomsSameNote(null))
    }

    @Test
    fun unitNameParsesAndDefaultsToFalse() {
        val done = completeResultOf(200, parse("""{"ok":true,"rooms":[{"label":"오쿠보A","code":null,"unit_name":true},{"label":"201"}]}""")) as CompleteResult.Done
        assertTrue(done.info.rooms[0].unitName)
        assertFalse(done.info.rooms[1].unitName)
    }

    @Test
    fun buildingNameIsDrawnOnlyInKorean() {
        val building = CompleteRoom("오쿠보A", null, unitName = true)
        assertEquals("오쿠보A", signLabelOf(building, "ko"))
        assertNull(signLabelOf(building, "ja"))
        assertNull(signLabelOf(building, "en"))
        assertNull(signLabelOf(building, "zh-Hans"))
        // 보통 방 번호는 언어와 상관없이 그대로
        for (lang in listOf("ko", "ja", "en", "zh-Hans")) assertEquals("201", signLabelOf(CompleteRoom("201"), lang))
        assertNull(signLabelOf(CompleteRoom(" "), "ko"))
    }

    @Test
    fun verifyRequiredAndBlockedMapToDeadEndStates() {
        assertEquals(CompleteResult.VerifyRequired, completeResultOf(403, parse("""{"ok":false,"error":"verify_required"}""")))
        assertEquals(CompleteResult.Blocked("cancelled"), completeResultOf(409, parse("""{"ok":false,"error":"blocked","reason":"cancelled"}""")))
        assertEquals(CompleteResult.Blocked("expired"), completeResultOf(409, parse("""{"ok":false,"error":"blocked","reason":"expired"}""")))
        // 같은 오류 이름이라도 상태 코드가 다르면 일반 오류
        assertEquals(CompleteResult.Server, completeResultOf(500, parse("""{"ok":false,"error":"verify_required"}""")))
    }

    @Test
    fun codeSizeShrinksForLongCodes() {
        assertEquals(64, codeTextSize(4, big = false))
        assertTrue(codeTextSize(20, big = false) < codeTextSize(8, big = false))
        assertEquals(26, codeTextSize(20, big = false))
        assertEquals(40, codeTextSize(5, big = true))
        assertEquals(26, codeTextSize(20, big = true))
    }

    @Test
    fun addressFollowsGuestLanguage() {
        val all = CompleteAddress(ko = "서울", ja = "東京", en = "Tokyo")
        assertEquals("서울", addressFor(all, "ko"))
        assertEquals("東京", addressFor(all, "ja"))
        assertEquals("Tokyo", addressFor(all, "en"))
        assertEquals("Tokyo", addressFor(all, "zh-Hans"))
        // 그 언어가 비면 영어 → 일본어 → 한국어
        assertEquals("Tokyo", addressFor(CompleteAddress(ko = null, ja = "東京", en = "Tokyo"), "ko"))
        assertEquals("東京", addressFor(CompleteAddress(ko = "서울", ja = "東京", en = null), "zh-Hans"))
        assertEquals("서울", addressFor(CompleteAddress(ko = "서울", ja = " ", en = null), "ja"))
        assertNull(addressFor(CompleteAddress(null, null, null), "en"))
        assertNull(addressFor(CompleteAddress(" ", "", null), "ko"))
        assertNull(addressFor(null, "ja"))
    }

    private fun info(rooms: List<CompleteRoom>, shared: List<CompleteShared>) = CompletionInfo(rooms, shared, null, null, null, 1, null, 0)

    @Test
    fun staffNoticeWhenSomeRoomHasNoWayIn() {
        val shared = listOf(CompleteShared("keyBoxPassword", "1234"))
        // 방 비밀번호가 없어도 공용 비밀번호가 있으면 안내 없음
        assertFalse(needsStaffForCode(info(listOf(CompleteRoom("201", null)), shared)))
        assertFalse(needsStaffForCode(info(listOf(CompleteRoom("201", "4821#"), CompleteRoom("202", null)), shared)))
        // 모든 방에 방 비밀번호가 있으면 공용이 없어도 안내 없음
        assertFalse(needsStaffForCode(info(listOf(CompleteRoom("201", "4821#"), CompleteRoom("202", "7)")), emptyList())))
        // 공용이 없고 비밀번호 없는 방이 하나라도 있으면 안내
        assertTrue(needsStaffForCode(info(listOf(CompleteRoom("201", null)), emptyList())))
        assertTrue(needsStaffForCode(info(listOf(CompleteRoom("201", "1"), CompleteRoom("202", " ")), emptyList())))
        assertTrue(needsStaffForCode(info(emptyList(), emptyList())))
    }
}
