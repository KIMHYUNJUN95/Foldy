package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.mrz.MrzResult
import com.harutokyo.checkin.kiosk.ui.FormMode
import com.harutokyo.checkin.kiosk.ui.PersonDraft
import com.harutokyo.checkin.kiosk.ui.SavedPerson
import com.harutokyo.checkin.kiosk.ui.mrzDraftComplete
import com.harutokyo.checkin.kiosk.ui.proofNoticeNeeded
import com.harutokyo.checkin.kiosk.ui.reviewReady
import com.harutokyo.checkin.kiosk.ui.seatComplete
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// 성별 X · 읽히지 않은 생년월일 → 칸이 비어 자리가 끝난 것으로 치지 않는다. 서버가 받는 성별은 male · female 뿐이라 X 는 null 로 두고 손님이 고른다.
class ProofFlowTest {
    private fun mrz(sex: String?, birth: String?) = MrzResult("KIM", "A", "A1234567", "USA", birth, sex, "2030-01-01", true, "raw")

    @Test
    fun passportReadWithoutSexOrBirthIsNotComplete() {
        assertTrue(mrzDraftComplete(mrz("male", "1990-01-01")))
        assertFalse(mrzDraftComplete(mrz(null, "1990-01-01")))
        assertFalse(mrzDraftComplete(mrz("female", null)))
    }

    @Test
    fun seatCompleteNeedsAgeAndGender() {
        val full = PersonDraft("KIM", "A", "USA", "A1234567", "35", "female")
        assertTrue(seatComplete(SavedPerson(full, FormMode.Mrz, null, null)))
        assertFalse(seatComplete(SavedPerson(full.copy(gender = null), FormMode.Mrz, null, null)))
        assertFalse(seatComplete(SavedPerson(full.copy(age = ""), FormMode.Mrz, null, null)))
    }

    private fun stay(vararg guests: KioskGuest) =
        KioskStay("s", emptyList(), "2026-11-02", "2026-11-03", 1, guests.size, guests.size, guests = guests.toList())

    @Test
    fun reviewStaysClosedUntilRequiredFieldsAreFilled() {
        val a = KioskGuest("a", "KIM A", isRepresentative = true)
        val b = KioskGuest("b", "LEE B")
        val full = PersonDraft("KIM", "A", "USA", "A1234567", "35", "male")
        assertTrue(reviewReady(stay(a, b), mapOf("a" to SavedPerson(full, FormMode.Mrz, null, null), "b" to SavedPerson(full, FormMode.Mrz, null, null))))
        // 한 분의 성별이 비었다
        assertFalse(reviewReady(stay(a, b), mapOf("a" to SavedPerson(full, FormMode.Mrz, null, null), "b" to SavedPerson(full.copy(gender = null), FormMode.Mrz, null, null))))
        // 이번에 저장하지 않은 분은 서버가 알려 준 빈 칸으로 본다
        assertFalse(reviewReady(stay(a, KioskGuest("c", "X", missing = listOf("gender"))), mapOf("a" to SavedPerson(full, FormMode.Mrz, null, null))))
        assertTrue(reviewReady(stay(a, KioskGuest("c", "X")), mapOf("a" to SavedPerson(full, FormMode.Mrz, null, null))))
    }

    @Test
    fun noPassportNoticeOnlyForNameLookupsWithoutASavedPassport() {
        val full = PersonDraft("KIM", "A", "USA", "A1234567", "35", "male")
        assertTrue(proofNoticeNeeded(true, emptyMap()))
        assertFalse(proofNoticeNeeded(false, emptyMap()))
        assertFalse(proofNoticeNeeded(true, mapOf("a" to SavedPerson(full, FormMode.Mrz, null, null))))
        assertTrue(proofNoticeNeeded(true, mapOf("a" to SavedPerson(full, FormMode.Staff, null, null))))
    }
}
