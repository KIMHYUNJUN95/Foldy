package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.NoPassport
import com.harutokyo.checkin.kiosk.ui.FormMode
import com.harutokyo.checkin.kiosk.ui.PersonDraft
import com.harutokyo.checkin.kiosk.ui.guestInputOf
import com.harutokyo.checkin.kiosk.ui.needsRoute
import com.harutokyo.checkin.kiosk.ui.nextSeat
import com.harutokyo.checkin.kiosk.ui.requiredMissing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PassportFlowTest {
    private fun stay(partySize: Int, vararg guests: KioskGuest) =
        KioskStay("s", emptyList(), "2026-11-02", "2026-11-03", 1, partySize, partySize, guests = guests.toList())

    private val rep = KioskGuest("r", "KIM A", isRepresentative = true, missing = listOf("passport_photo", "prev_stay", "next_dest"))
    private val companion = KioskGuest("c", "KIM B", missing = listOf("address"))

    @Test
    fun skipsRouteAndCompanionAddressWhenPickingNextSeat() {
        // 동행자의 주소 · 대표자의 행선지는 이 흐름에서 묻지 않는다 → 대표자(사진)만, 그다음 빈 자리.
        assertEquals(0, nextSeat(stay(3, rep, companion), emptySet()))
        assertEquals(2, nextSeat(stay(3, rep, companion), setOf("r")))
        assertNull(nextSeat(stay(2, rep, companion), setOf("r")))
    }

    @Test
    fun routeOnlyForForeignRepresentative() {
        assertTrue(needsRoute(stay(1, rep)))
        assertFalse(needsRoute(stay(1, rep.copy(hasJapanAddress = true))))
        assertFalse(needsRoute(stay(1, rep.copy(missing = emptyList()))))
    }

    @Test
    fun formRulesFollowMode() {
        val empty = PersonDraft()
        assertEquals(listOf("lastName", "firstName", "nationality", "passportNumber", "birthDate", "gender", "address"), requiredMissing(empty, FormMode.Mrz, true))
        assertEquals(listOf("lastName", "firstName", "nationality", "birthDate", "gender"), requiredMissing(empty, FormMode.Child, false))
        assertEquals(listOf("lastName", "firstName", "address"), requiredMissing(empty, FormMode.Resident, true))
    }

    @Test
    fun companionDoesNotSendAddressAndChildReasonMarksChild() {
        val draft = PersonDraft("kim", "b", "kor", "", "2018-01-02", "female", "Seoul")
        val input = guestInputOf(companion, draft, FormMode.Child, NoPassport.Child, null, askAddress = false)
        assertEquals("child", input.guestType)
        assertEquals("child", input.noPassportReason)
        assertNull(input.address)
        assertNull(input.passportNumber)
        assertEquals("KOR", input.nationality)
        val resident = guestInputOf(null, draft, FormMode.Resident, NoPassport.JapanResident, null, askAddress = true)
        assertTrue(resident.hasJapanAddress)
        assertNull(resident.nationality)
        assertEquals("Seoul", resident.address)
    }
}
