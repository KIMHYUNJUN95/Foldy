package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.BlockReason
import com.harutokyo.checkin.kiosk.contract.CodeQuery
import com.harutokyo.checkin.kiosk.contract.FindQuery
import com.harutokyo.checkin.kiosk.contract.FindResponse
import com.harutokyo.checkin.kiosk.contract.FindResult
import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.NameQuery
import com.harutokyo.checkin.kiosk.contract.findResultOf
import com.harutokyo.checkin.kiosk.data.Api
import com.harutokyo.checkin.kiosk.ui.SeatState
import com.harutokyo.checkin.kiosk.ui.emptySeats
import com.harutokyo.checkin.kiosk.ui.seatStateOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// 서버 `/api/kiosk/find` 응답 모양(apps/checkin src/app/api/kiosk/find/route.ts)과 맞는지.
class LookupTest {
    private fun parse(body: String) = findResultOf(Api.json.decodeFromString<FindResponse>(body))

    @Test
    fun requestUsesModeLikeServer() {
        val code = Api.json.encodeToString(FindQuery.serializer(), CodeQuery("123456"))
        assertEquals("""{"mode":"code","code":"123456"}""", code)
        val name = Api.json.encodeToString(FindQuery.serializer(), NameQuery("HU", "DANIEL", "2026-11-05"))
        assertEquals("""{"mode":"name","lastName":"HU","firstName":"DANIEL","checkInDate":"2026-11-05"}""", name)
    }

    @Test
    fun foundAndCheckedIn() {
        val stay = """{"stayId":"s","rooms":["403"],"checkInDate":"2026-11-05","checkOutDate":"2026-11-07","nights":2,"partySize":2,"guestCountExpected":2,"guests":[]}"""
        val found = parse("""{"ok":true,"result":"found","session_id":"x","language":"en","stay":$stay,"contract_version":1}""")
        assertTrue(found is FindResult.Found && !found.checkedIn && found.language == "en" && found.stay.rooms == listOf("403"))
        val done = parse("""{"ok":true,"result":"checked_in","session_id":"x","stay":$stay}""")
        assertTrue(done is FindResult.Found && done.checkedIn)
    }

    @Test
    fun failures() {
        assertEquals(FindResult.NotFound(3), parse("""{"ok":false,"error":"not_found","remaining":3}"""))
        assertEquals(FindResult.Locked(java.time.Instant.parse("2026-11-02T10:21:00Z").toEpochMilli()), parse("""{"ok":false,"error":"locked","locked_until":"2026-11-02T10:21:00.000Z"}"""))
        assertEquals(FindResult.Blocked(BlockReason.TooEarly, "2026-11-09"), parse("""{"ok":false,"error":"blocked","reason":"too_early","check_in_date":"2026-11-09"}"""))
        assertEquals(FindResult.Blocked(BlockReason.Busy, null), parse("""{"ok":false,"error":"blocked","reason":"busy"}"""))
        assertEquals(FindResult.Blocked(BlockReason.OtherBuilding, null), parse("""{"ok":false,"error":"blocked","reason":"other_building"}"""))
        assertEquals(FindResult.Server, parse("""{"ok":false,"error":"server_error"}"""))
        assertEquals(FindResult.Server, findResultOf(null))
    }

    @Test
    fun seats() {
        assertEquals(SeatState.Empty, seatStateOf(null))
        assertEquals(SeatState.Done, seatStateOf(KioskGuest("a")))
        assertEquals(SeatState.PhotoOnly, seatStateOf(KioskGuest("a", missing = listOf("passport_photo"))))
        assertEquals(SeatState.Partial, seatStateOf(KioskGuest("a", missing = listOf("passport_photo", "address"))))
        val stay = KioskStay(
            stayId = "s", checkInDate = "2026-11-05", checkOutDate = "2026-11-07", nights = 2, partySize = 3, guestCountExpected = 2,
            guests = listOf(KioskGuest("a"), KioskGuest("b", missing = listOf("passport_photo"))),
        )
        // 칸이 남은 사람 1 + 빈 자리 1.
        assertEquals(2, emptySeats(stay))
    }
}
