package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.NoPassport
import com.harutokyo.checkin.kiosk.mrz.MrzResult
import com.harutokyo.checkin.kiosk.ui.FormMode
import com.harutokyo.checkin.kiosk.ui.ReviewWarn
import com.harutokyo.checkin.kiosk.ui.SavedPerson
import com.harutokyo.checkin.kiosk.ui.SeatLine
import com.harutokyo.checkin.kiosk.ui.SeatPlan
import com.harutokyo.checkin.kiosk.ui.SeatTask
import com.harutokyo.checkin.kiosk.ui.addressOf
import com.harutokyo.checkin.kiosk.ui.countryName
import com.harutokyo.checkin.kiosk.ui.matchSavedGuest
import com.harutokyo.checkin.kiosk.ui.needsLivingPlace
import com.harutokyo.checkin.kiosk.ui.nextSeatPlan
import com.harutokyo.checkin.kiosk.ui.passportsToShow
import com.harutokyo.checkin.kiosk.ui.reviewWarnOf
import com.harutokyo.checkin.kiosk.ui.seatLineOf
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
    fun routeForEveryRepresentativeIncludingJapanResident() {
        assertTrue(needsRoute(stay(1, rep)))
        assertTrue(needsRoute(stay(1, rep.copy(hasJapanAddress = true))))
        assertFalse(needsRoute(stay(1, rep.copy(missing = emptyList()))))
    }

    @Test
    fun formRulesFollowMode() {
        val empty = PersonDraft()
        assertEquals(listOf("lastName", "firstName", "nationality", "passportNumber", "age", "gender", "address", "contact"), requiredMissing(empty, FormMode.Mrz, true, true))
        assertEquals(listOf("lastName", "firstName", "nationality", "age", "gender"), requiredMissing(empty, FormMode.Child, false))
        assertEquals(listOf("lastName", "firstName", "age", "gender", "address"), requiredMissing(empty, FormMode.Resident, true))
        assertEquals(listOf("age"), requiredMissing(PersonDraft("A", "B", "KOR", "X1234567", "131", "male"), FormMode.Mrz, false))
    }

    @Test
    fun companionDoesNotSendAddressAndChildReasonMarksChild() {
        val draft = PersonDraft("kim", "b", "kor", "", "7", "female", "Seoul", "a@b.c")
        val input = guestInputOf(companion, draft, FormMode.Child, NoPassport.Child, null, askAddress = false)
        assertEquals("child", input.guestType)
        assertEquals("child", input.noPassportReason)
        assertNull(input.address)
        assertNull(input.contact)
        assertEquals(7, input.age)
        assertNull(input.passportNumber)
        assertEquals("KOR", input.nationality)
        val resident = guestInputOf(null, draft, FormMode.Resident, NoPassport.JapanResident, null, askAddress = true)
        assertTrue(resident.hasJapanAddress)
        assertNull(resident.nationality)
        assertEquals("Seoul", resident.address)
        assertEquals("female", resident.gender)
        assertEquals(7, resident.age)
        val repInput = guestInputOf(null, draft, FormMode.Manual, null, null, askAddress = true, askContact = true)
        assertEquals("a@b.c", repInput.contact)
    }
}

class FastFlowTest {
    private fun stay(partySize: Int, vararg guests: KioskGuest) =
        KioskStay("s", emptyList(), "2026-11-02", "2026-11-03", 1, partySize, partySize, guests = guests.toList())

    private val rep = KioskGuest("r", "KIM A", isRepresentative = true, missing = listOf("passport_photo", "address", "prev_stay"))
    // 웹 사전 등록으로 칸은 다 찼다(여권 사진 있음). 얼굴 영상만 없거나 있거나.
    private val preNoFace = KioskGuest("p", "LEE B")
    private val preWithFace = KioskGuest("q", "LEE C", hasFaceVideo = true)

    @Test
    fun plansFullSeatsEmptySeatsAndFaceOnlyForPreRegistered() {
        // 대표자(여권 없음) → 전체, 사전 등록 + 얼굴 없음 → 얼굴만, 사전 등록 + 얼굴 있음 → 건너뜀, 빈 자리 → 전체.
        val s = stay(4, rep, preNoFace, preWithFace)
        assertEquals(SeatPlan(0, SeatTask.Full), nextSeatPlan(s, emptySet()))
        assertEquals(SeatPlan(1, SeatTask.FaceOnly), nextSeatPlan(s, setOf("r")))
        assertEquals(SeatPlan(3, SeatTask.Full), nextSeatPlan(s, setOf("r", "p")))
        assertNull(nextSeatPlan(s.copy(partySize = 3), setOf("r", "p")))
    }

    @Test
    fun savedGuestIsNotAskedAgainEvenIfServerStillListsMissing() {
        // 대표자를 방금 저장했지만 주소는 검토 화면에서 받는다 — 서버 missing 에 address 가 남아도 같은 자리를 다시 묻지 않는다.
        assertEquals(SeatPlan(1, SeatTask.FaceOnly), nextSeatPlan(stay(2, rep, preNoFace), setOf("r")))
    }

    @Test
    fun passportCountSkipsRepresentativeShotOnFirstScreen() {
        val s = stay(3, rep, preNoFace)
        // 대표자(F1 에서 찍음)는 빼고, 사전 등록 분도 빼고, 빈 자리 하나.
        assertEquals(1, passportsToShow(s, repShot = true))
        assertEquals(2, passportsToShow(s, repShot = false))
        assertEquals(SeatLine.RepShot, seatLineOf(s, 0, repShot = true))
        assertEquals(SeatLine.Todo, seatLineOf(s, 0, repShot = false))
        assertEquals(SeatLine.FaceOnly, seatLineOf(s, 1, repShot = true))
        assertEquals(SeatLine.Todo, seatLineOf(s, 2, repShot = true))
        assertEquals(SeatLine.Done, seatLineOf(stay(2, rep, preWithFace), 1, repShot = true))
    }

    @Test
    fun lostResponseReusesTheGuestThatAppearedWithSameName() {
        val before = setOf("r")
        val fresh = stay(2, rep, KioskGuest("n", "SMITH JOHN"))
        val draft = PersonDraft("Smith", "John")
        assertEquals("n", matchSavedGuest(fresh, before, draft)?.id)
        // 이름 순서가 바뀌어 저장돼도, 부호가 섞여도 같은 사람.
        assertEquals("n", matchSavedGuest(stay(2, rep, KioskGuest("n", "JOHN, SMITH")), before, draft)?.id)
        // 원래 있던 분이거나 이름이 다르면 새 분이 아니다.
        assertNull(matchSavedGuest(fresh, setOf("r", "n"), draft))
        assertNull(matchSavedGuest(fresh, before, PersonDraft("KIM", "A")))
        assertNull(matchSavedGuest(stay(2, rep, KioskGuest("x", null)), before, draft))
    }

    @Test
    fun livingPlaceAddressIsCityThenCountry() {
        assertEquals("Chicago, United States", addressOf(" Chicago ", "United States"))
        assertEquals("Chicago", addressOf("Chicago", ""))
        assertEquals("United States", addressOf("", "United States"))
        assertNull(addressOf("  ", ""))
    }

    @Test
    fun countryNameFollowsLocaleAndFallsBackToCode() {
        assertEquals("United States", countryName("USA", java.util.Locale.ENGLISH))
        assertEquals("미국", countryName("usa", java.util.Locale.KOREAN))
        assertEquals("UNO", countryName("UNO", java.util.Locale.ENGLISH))
        assertEquals("", countryName(" ", java.util.Locale.ENGLISH))
    }

    private fun mrz(valid: Boolean) = MrzResult("KIM", "A", "A1234567", "USA", "1990-01-01", "male", "2030-01-01", valid, "raw")

    @Test
    fun reviewRowsWarnOnBadDigitsOrMissingFieldsUntilConfirmed() {
        val good = PersonDraft("KIM", "A", "USA", "A1234567", "35", "male")
        assertEquals(ReviewWarn.None, reviewWarnOf(SavedPerson(good, FormMode.Mrz, null, mrz(true))))
        assertEquals(ReviewWarn.Digits, reviewWarnOf(SavedPerson(good, FormMode.Mrz, null, mrz(false))))
        assertEquals(ReviewWarn.Missing, reviewWarnOf(SavedPerson(good.copy(age = ""), FormMode.Mrz, null, mrz(true))))
        assertEquals(ReviewWarn.None, reviewWarnOf(SavedPerson(good, FormMode.Mrz, null, mrz(false), confirmed = true)))
        assertEquals(ReviewWarn.None, reviewWarnOf(null))
    }

    @Test
    fun livingPlaceIsSkippedForJapanResidentWithAddress() {
        val saved = SavedPerson(PersonDraft("KIM", "A", address = "Tokyo"), FormMode.Resident, null, null)
        assertFalse(needsLivingPlace(rep, saved))
        assertTrue(needsLivingPlace(rep, SavedPerson(PersonDraft("KIM", "A"), FormMode.Mrz, null, null)))
        // 웹으로 이미 끝난 대표자(저장한 입력 없음, 서버에 주소 있음)는 묻지 않는다.
        assertFalse(needsLivingPlace(rep.copy(missing = emptyList()), null))
        assertFalse(needsLivingPlace(null, null))
    }
}

class ConsentTest {
    @Test
    fun termsFallBackToJapaneseThenAnything() {
        val terms = mapOf("ja" to "約款", "en" to "Terms")
        assertEquals("Terms", com.harutokyo.checkin.kiosk.ui.termsFor(terms, "en"))
        assertEquals("約款", com.harutokyo.checkin.kiosk.ui.termsFor(terms, "ko"))
        assertEquals("X", com.harutokyo.checkin.kiosk.ui.termsFor(mapOf("en" to "X"), "ko"))
        assertNull(com.harutokyo.checkin.kiosk.ui.termsFor(mapOf("ja" to " "), "ja"))
    }
}
