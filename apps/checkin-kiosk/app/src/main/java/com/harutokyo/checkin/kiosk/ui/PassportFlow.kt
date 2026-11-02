package com.harutokyo.checkin.kiosk.ui

import com.harutokyo.checkin.kiosk.contract.GuestInput
import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.MrzPayload
import com.harutokyo.checkin.kiosk.contract.NoPassport
import com.harutokyo.checkin.kiosk.mrz.Mrz
import com.harutokyo.checkin.kiosk.mrz.MrzResult
import java.time.LocalDate

// 여권 · 명부 흐름의 판정(화면 없음 — 테스트로 덮는다). 시안 T3a → T3 → T3r → T3c(또는 T3x · T3n) → 다음 분 → T3s.

/** 확인 화면(T3c)이 무엇을 묻는지. */
enum class FormMode { Mrz, Manual, Child, Resident, Staff }

/** 한 분 입력 칸. 나이는 숫자 글자, 성별은 "male" · "female". */
data class PersonDraft(
    val surname: String = "",
    val given: String = "",
    val nationality: String = "",
    val number: String = "",
    val age: String = "",
    val gender: String? = null,
    val address: String = "",
    val contact: String = "",
)

fun draftOf(mrz: MrzResult, address: String?, contact: String? = null, today: LocalDate = Mrz.tokyoToday()): PersonDraft = PersonDraft(
    surname = mrz.surname,
    given = mrz.givenNames,
    nationality = mrz.nationality,
    number = mrz.documentNumber,
    age = Mrz.ageOn(mrz.birthDate, today)?.toString().orEmpty(),
    gender = mrz.sex,
    address = address.orEmpty(),
    contact = contact.orEmpty(),
)

/** 이 화면 흐름에서 채우는 칸만(전 숙박지 · 다음 행선지는 T3s, 동행자 주소는 대표자 값을 서버가 이어 준다). */
fun personMissing(guest: KioskGuest): List<String> =
    guest.missing.filter { it != "prev_stay" && it != "next_dest" && (guest.isRepresentative || it != "address") }

/** 다음에 할 자리(0부터). 이번에 이미 저장한 분은 다시 묻지 않는다 — 서버가 아직 빠졌다고 해도(직원 확인). 없으면 null. */
fun nextSeat(stay: KioskStay, done: Set<String>): Int? {
    val seats = maxOf(stay.partySize, stay.guests.size)
    for (index in 0 until seats) {
        val guest = stay.guests.getOrNull(index)
        if (guest == null) return index
        if (guest.id in done) continue
        if (personMissing(guest).isNotEmpty()) return index
    }
    return null
}

/** 대표자에게 전 숙박지 · 다음 행선지가 남았는지(일본에 사는 분도 묻는다 — 모든 분 명부 항목). */
fun needsRoute(stay: KioskStay): Boolean {
    val representative = stay.guests.firstOrNull { it.isRepresentative } ?: return false
    return "prev_stay" in representative.missing || "next_dest" in representative.missing
}

/** 나이 글자 → 0..130, 아니면 null. */
fun parseAge(text: String): Int? = text.trim().takeIf { Regex("^\\d{1,3}$").matches(it) }?.toInt()?.takeIf { it in 0..130 }

/** 화면에서 빈 칸(빨간 칸) — 서버도 다시 검사한다. 칸 이름은 서버 `fields` 와 같게. */
fun requiredMissing(draft: PersonDraft, mode: FormMode, askAddress: Boolean, askContact: Boolean = false): List<String> = buildList {
    if (draft.surname.isBlank()) add("lastName")
    if (draft.given.isBlank()) add("firstName")
    if (mode != FormMode.Resident) {
        if (!Regex("^[A-Z]{3}$").matches(draft.nationality.trim().uppercase())) add("nationality")
        if (mode != FormMode.Child && mode != FormMode.Staff && !Regex("^[A-Z0-9]{5,12}$").matches(cleanNumber(draft.number))) add("passportNumber")
    }
    if (parseAge(draft.age) == null) add("age")
    if (draft.gender == null) add("gender")
    if (askAddress && draft.address.isBlank()) add("address")
    if (askContact && draft.contact.isBlank()) add("contact")
}

private fun cleanNumber(value: String) = value.uppercase().replace(Regex("[\\s-]"), "")

/** 저장할 몸통. 동행자는 주소를 보내지 않는다(서버가 대표자 값을 이어 준다) — 일본에 사는 분은 본인 주소. */
fun guestInputOf(
    guest: KioskGuest?,
    draft: PersonDraft,
    mode: FormMode,
    reason: NoPassport?,
    mrz: MrzResult?,
    askAddress: Boolean,
    askContact: Boolean = false,
): GuestInput {
    val resident = mode == FormMode.Resident
    val passport = mode == FormMode.Mrz || mode == FormMode.Manual || (mode == FormMode.Staff && draft.number.isNotBlank())
    return GuestInput(
        id = guest?.id,
        lastName = draft.surname.trim().uppercase(),
        firstName = draft.given.trim().uppercase(),
        guestType = if (mode == FormMode.Child || guest?.isChild == true) "child" else "adult",
        hasJapanAddress = resident,
        nationality = if (resident) null else draft.nationality.trim().uppercase().ifEmpty { null },
        passportNumber = if (passport) cleanNumber(draft.number).ifEmpty { null } else null,
        age = parseAge(draft.age),
        gender = draft.gender,
        address = if (askAddress) draft.address.trim().ifEmpty { null } else null,
        contact = if (askContact) draft.contact.trim().take(120).ifEmpty { null } else null,
        noPassportReason = reason?.code,
        mrz = if (mode == FormMode.Mrz && mrz != null) MrzPayload(mrz.raw, mrz.valid) else null,
    )
}
