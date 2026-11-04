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

// ── 빠른 체크인(F1~F7b) 판정 — 화면 없음, 테스트로 덮는다 ──────────────────────────────────────────────

/** 한 자리에서 할 일: Full = 여권 + 얼굴, FaceOnly = 웹 사전 등록으로 여권은 있고 얼굴 영상만 없음. */
enum class SeatTask { Full, FaceOnly }

data class SeatPlan(val index: Int, val task: SeatTask)

/**
 * 다음에 찍을 자리. 이번에 끝낸 분(done)은 건너뛴다. 명부가 다 된 분은 얼굴 영상이 없을 때만 FaceOnly, 있으면 건너뛴다.
 * 칸이 남았거나 빈 자리면 Full. 없으면 null(→ 검토 화면).
 */
fun nextSeatPlan(stay: KioskStay, done: Set<String>): SeatPlan? {
    val seats = maxOf(stay.partySize, stay.guests.size)
    for (index in 0 until seats) {
        val guest = stay.guests.getOrNull(index) ?: return SeatPlan(index, SeatTask.Full)
        if (guest.id in done) continue
        if (personMissing(guest).isNotEmpty()) return SeatPlan(index, SeatTask.Full)
        if (!guest.hasFaceVideo) return SeatPlan(index, SeatTask.FaceOnly)
    }
    return null
}

/** F2 「여권 N개」 — 대표자는 F1 에서 이미 찍었으니 빼고, 여권을 새로 비출 자리 수. */
fun passportsToShow(stay: KioskStay, repShot: Boolean): Int {
    val seats = maxOf(stay.partySize, stay.guests.size)
    var count = 0
    for (index in 0 until seats) {
        val guest = stay.guests.getOrNull(index)
        val full = guest == null || personMissing(guest).isNotEmpty()
        if (full && !(repShot && index == 0)) count += 1
    }
    return count
}

/** 사는 곳 한 줄 「도시, 나라」 — 빈 쪽은 뺀다. 둘 다 비면 null. */
fun addressOf(city: String, country: String): String? =
    listOf(city.trim(), country.trim()).filter { it.isNotEmpty() }.joinToString(", ").ifEmpty { null }

/** ISO3 국가 코드 → 그 언어 나라 이름. 모르는 코드(UNO 등)는 코드 그대로. */
fun countryName(code3: String, locale: java.util.Locale): String {
    val code = code3.trim().uppercase()
    if (code.isEmpty()) return ""
    val region = java.util.Locale.getISOCountries().firstOrNull { java.util.Locale("", it).isO3Country == code } ?: return code
    return java.util.Locale("", region).getDisplayCountry(locale).ifBlank { code }
}

/** 이번에 저장한 한 분의 입력(검토 화면 한 줄 · 다시 고치기용). */
data class SavedPerson(
    val draft: PersonDraft,
    val mode: FormMode,
    val reason: NoPassport?,
    val mrz: MrzResult?,
    /** 손님이 검토 화면에서 직접 확인해 저장했다 — 검사 숫자가 틀렸던 것도 이제 괜찮다. */
    val confirmed: Boolean = false,
)

/** 검토 화면 한 줄의 경고. */
enum class ReviewWarn { None, Digits, Missing }

fun reviewWarnOf(person: SavedPerson?): ReviewWarn = when {
    person == null -> ReviewWarn.None
    person.confirmed -> ReviewWarn.None
    requiredMissing(person.draft, person.mode, askAddress = false).isNotEmpty() -> ReviewWarn.Missing
    person.mrz?.valid == false -> ReviewWarn.Digits
    else -> ReviewWarn.None
}

/** 이 분의 필수 칸이 다 찼는가 — 안 찼으면 저장하지 않고(자리를 끝낸 것으로 치지 않고) 확인 화면에서 채우게 한다. */
fun seatComplete(person: SavedPerson): Boolean = requiredMissing(person.draft, person.mode, askAddress = false).isEmpty()

/** 여권에서 읽은 것만으로 저장해도 되는가(성별 X · 읽히지 않은 생년월일이면 아니오 → 확인 화면). */
fun mrzDraftComplete(mrz: MrzResult): Boolean = seatComplete(SavedPerson(draftOf(mrz, null), FormMode.Mrz, null, mrz))

/** 검토 화면 「맞아요」 — 필수 칸이 빈 분이 한 명이라도 있으면 막는다. 이번에 저장한 분은 화면 입력으로, 아닌 분은 서버가 알려 준 빈 칸으로 본다. */
fun reviewReady(stay: KioskStay, people: Map<String, SavedPerson>): Boolean = stay.guests.none { guest ->
    val person = people[guest.id]
    if (person != null) !person.confirmed && requiredMissing(person.draft, person.mode, askAddress = false).isNotEmpty()
    else personMissing(guest).isNotEmpty()
}

/** 이름으로 찾은 예약은 여권이 저장돼야 방 비밀번호를 보여 준다 — 여권 없이 가려는 분께 미리 알릴지. */
fun proofNoticeNeeded(byName: Boolean, people: Map<String, SavedPerson>): Boolean =
    byName && people.values.none { it.mode == FormMode.Mrz }

/** 대표자 사는 곳 칸을 묻는지 — 일본에 사는 분이 이미 주소를 썼거나, 서버에 주소가 있으면 묻지 않는다. */
fun needsLivingPlace(representative: KioskGuest?, saved: SavedPerson?): Boolean {
    if (representative == null) return false
    if (saved?.mode == FormMode.Resident && saved.draft.address.isNotBlank()) return false
    if (representative.hasJapanAddress && !representative.address.isNullOrBlank()) return false
    return saved != null || "address" in representative.missing
}

/** F2 명단 한 줄의 상태 — 대표자는 F1 에서 여권을 이미 찍었으면 RepShot(얼굴만 남음). */
enum class SeatLine { RepShot, Todo, FaceOnly, Done }

fun seatLineOf(stay: KioskStay, index: Int, repShot: Boolean): SeatLine {
    val guest = stay.guests.getOrNull(index)
    val full = guest == null || personMissing(guest).isNotEmpty()
    return when {
        full && index == 0 && repShot -> SeatLine.RepShot
        full -> SeatLine.Todo
        guest != null && !guest.hasFaceVideo -> SeatLine.FaceOnly
        else -> SeatLine.Done
    }
}

/**
 * 저장 응답을 잃었을 때 — 새로 만든 줄이 서버에 이미 있는지 찾는다. before = 저장 시도 전에 있던 분 id.
 * 이름이 같은(성 이름 · 이름 성 어느 순서든) 새 분이 있으면 그 분을 다시 쓴다(동행자가 두 번 생기지 않게).
 */
fun matchSavedGuest(fresh: KioskStay, before: Set<String>, draft: PersonDraft): KioskGuest? {
    fun norm(value: String) = value.uppercase().replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()
    val want = setOf(norm("${draft.surname} ${draft.given}"), norm("${draft.given} ${draft.surname}"))
    return fresh.guests.firstOrNull { guest ->
        val name = guest.name ?: return@firstOrNull false
        guest.id !in before && norm(name) in want
    }
}
