package com.harutokyo.checkin.kiosk.ui

import com.harutokyo.checkin.kiosk.contract.AddressBody
import com.harutokyo.checkin.kiosk.contract.GuestAddress
import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import java.text.Normalizer

// 집 주소(대표자 + 동행자 모두, 명부에 전체 주소) 판정 — 화면 없음, 테스트로 덮는다(AddressFlowTest).
// 흐름: F6b 검토 「맞아요」 → 주소 화면(대표자 주소 한 칸) → 「모두 같아요」면 바로 저장 · 「다른 분이 있어요」면 다른 분 화면 → F7b.
// 서버 계약: others 에는 다른 주소를 적은 분만(서버가 그 분 자신의 일본 거주 여부로 검사), 나머지는 대표자 글을 그대로 받는다.
// 길이 기준은 서버(apps/checkin `POST /api/kiosk/address`)와 같게: 외국 8자 이상 · 일본 거주 5자 이상 · 200자 이하.
// 손님 주소는 로그에 남기지 않는다.

const val ADDRESS_MAX = 200
const val ADDRESS_MIN_FOREIGN = 8
const val ADDRESS_MIN_RESIDENT = 5

/** 칸 위 언어 힌트 — 외국 손님은 영어 자판, 일본 거주는 일본어 자판(영어로 바꿀 수 있다). 기기 자판 설정은 16번 문서 참고. */
const val KEYBOARD_FOREIGN = "en-US"
const val KEYBOARD_RESIDENT = "ja-JP"

// 서버 `normalizeAddress`(apps/checkin/src/lib/guest/address.ts)의 글자 바꾸기와 같은 목록 — 폰이 자동으로 넣는 글자는 지우지 않고 바꾼다.
private val ZERO_WIDTH = Regex("[\\u200b-\\u200d\\ufeff]")
private val SPACE_LIKE = Regex("[\\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]")
private val CURLY_SINGLE = Regex("[\\u2018\\u2019\\u02bc]")
private val CURLY_DOUBLE = Regex("[\\u201c\\u201d]")
private val DASHES = Regex("[\\u2010-\\u2015]")
// JS `\s` 와 같은 공백 모음(NBSP 등은 앞서 공백으로 바뀐다). `(?U)` 는 Android 정규식이 못 읽어 쓰지 않는다.
private const val WS = "\\t\\n\\u000b\\u000c\\r \\u2028\\u2029"
private val LINE_BREAK = Regex("[$WS]*,?[$WS]*[\\r\\n]+[$WS]*")
private val BLANKS = Regex("[ \\t\\u000b\\u000c]+")
private val EDGE = Regex("^[$WS,]+|[$WS,]+$")

/** NFC → 안 보이는 글자 지우기 → 공백 비슷한 글자는 공백 · 곡선 따옴표는 ' " · 긴 줄표는 - (서버와 같은 순서). */
private fun substitute(input: String): String = Normalizer.normalize(input, Normalizer.Form.NFC)
    .replace(ZERO_WIDTH, "")
    .replace(SPACE_LIKE, " ")
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, "\"")
    .replace(DASHES, "-")

/**
 * 외국 손님 칸에 들어갈 수 있는 글자만 남긴다(서버 `addressError` 와 같은 규칙):
 * 먼저 서버처럼 글자를 바꾼 뒤(`Block 1–2` → `Block 1-2`, `O’Connell` → `O'Connell`, NBSP → 공백),
 * ASCII 0x20..0x7E · 라틴 글자(글자이면서 라틴 문자, 전각 제외 — ª º 포함) · 앞 글자에 붙는 결합 악센트만 남긴다.
 * 줄바꿈은 그대로(보낼 때 「, 」), 탭은 공백. × ÷ · 그리스 · 키릴 · 가나 · 한글 · 한자 · 전각 영문 · 이모지는 버린다.
 * 깨끗한 글은 같은 글을 돌려준다 — 그래서 자판의 글자 조합(밑줄 친 글자)이 끊기지 않는다.
 */
fun filterForeignAddress(input: String): String {
    val text = substitute(input)
    val out = StringBuilder(text.length)
    var index = 0
    while (index < text.length) {
        val point = text.codePointAt(index)
        index += Character.charCount(point)
        when {
            point == '\n'.code -> out.append('\n')
            point == '\r'.code -> Unit
            point == '\t'.code -> out.append(' ')
            allowedForeign(point, out) -> out.appendCodePoint(point)
        }
    }
    return out.toString()
}

private fun allowedForeign(point: Int, before: CharSequence): Boolean = when {
    point in 0x20..0x7E -> true
    point in 0xFF00..0xFFEF -> false // 전각 형태(ＡＢＣ １２３)
    // 결합 악센트는 합쳐지지 않고 남은 것만, 앞에 글자가 있을 때만.
    point in 0x0300..0x036F -> before.isNotEmpty() && before.last() != ' ' && before.last() != '\n'
    else -> Character.isLetter(point) && Character.UnicodeScript.of(point) == Character.UnicodeScript.LATIN
}

/** 서버 `latinOnly`: 글자 하나라도 허용 밖이면 false. (결합 악센트는 서버처럼 어디서든 허용.) */
private fun latinOnly(value: String): Boolean {
    if (value.isEmpty()) return false
    var index = 0
    while (index < value.length) {
        val point = value.codePointAt(index)
        index += Character.charCount(point)
        val ok = when {
            point in 0x20..0x7E -> true
            point in 0x0300..0x036F -> true
            point in 0xFF00..0xFFEF -> false
            else -> Character.isLetter(point) && Character.UnicodeScript.of(point) == Character.UnicodeScript.LATIN
        }
        if (!ok) return false
    }
    return true
}

/** 보낼 글 — 서버 `normalizeAddress` 와 같다: 글자 바꾸기 · 줄바꿈은 「, 」 · 겹친 공백 하나 · 양끝 공백과 쉼표 제거. */
fun cleanAddress(input: String): String = substitute(input).trim()
    .replace(LINE_BREAK, ", ")
    .replace(BLANKS, " ")
    .replace(EDGE, "")

/** 서버 `addressError` 와 같은 판정. 통과하면 null, 아니면 "too_short" · "too_long" · "not_latin". */
fun addressError(input: String, resident: Boolean): String? {
    val value = cleanAddress(input)
    if (value.length > ADDRESS_MAX) return "too_long"
    if (!resident && !latinOnly(value)) return if (value.isEmpty()) "too_short" else "not_latin"
    if (value.length < (if (resident) ADDRESS_MIN_RESIDENT else ADDRESS_MIN_FOREIGN)) return "too_short"
    return null
}

/** 서버와 같은 검사를 통과하는가(길이 + 외국인은 영문만). */
fun addressValid(input: String, resident: Boolean): Boolean = addressError(input, resident) == null

/** 일본에 사는 분인가 — 이번에 「일본 주소」로 적었거나 서버에 그렇게 올라 있다. */
fun isResident(guest: KioskGuest?, saved: SavedPerson?): Boolean =
    saved?.mode == FormMode.Resident || guest?.hasJapanAddress == true

/**
 * 주소 화면이 필요한가. 모든 분에게 주소가 있으면(웹 사전 등록) 건너뛴다.
 * 서버가 address 를 빈 칸으로 알려 준 분이 있거나, 대표자 주소가 비어 있으면 필요.
 */
fun needsAddress(stay: KioskStay): Boolean {
    if (stay.guests.isEmpty()) return false
    return stay.guests.any { "address" in it.missing || (it.isRepresentative && it.address.isNullOrBlank()) }
}

/** 손님이 한 명뿐인가 — 그러면 「모두 같아요」 질문을 하지 않는다. */
fun onlyOneGuest(stay: KioskStay): Boolean = maxOf(stay.partySize, stay.guests.size) <= 1

/** 대표자(없으면 첫 분)를 뺀 분들의 id — `others` 에 대표자 id 가 들어가면 서버가 거절한다. */
fun otherGuestIds(stay: KioskStay): List<String> {
    val repId = (stay.guests.firstOrNull { it.isRepresentative } ?: stay.guests.firstOrNull())?.id
    return stay.guests.filter { it.id != repId }.map { it.id }
}

/**
 * `others` — 대표자와 **다른 주소를 실제로 적은** 분만. 나머지(「모두 같아요」 포함)는 빼야 서버가 대표자 글을 글자 검사 없이 이어 준다
 * (일본 거주 대표자 + 외국 동행자가 `address.<id>` 오류 없이 같은 주소를 쓸 수 있다). 대표자와 같은 글을 적었으면 뺀다.
 */
fun addressOthersOf(representativeAddress: String, otherIds: List<String>, different: Map<String, String>): List<GuestAddress> {
    val rep = cleanAddress(representativeAddress)
    return otherIds.mapNotNull { id ->
        val own = different[id]?.let(::cleanAddress) ?: return@mapNotNull null
        if (own == rep) null else GuestAddress(id, own)
    }
}

fun addressBodyOf(sessionId: String, representativeAddress: String, otherIds: List<String>, different: Map<String, String>): AddressBody =
    AddressBody(sessionId, cleanAddress(representativeAddress), addressOthersOf(representativeAddress, otherIds, different))

/** 「누구 주소가 다른가요?」 — 지금 명단(otherIds)에 있는 분 중 입력칸인 분이 모두 서버 검사를 통과하는가(명단에서 빠진 분의 값은 보지 않는다). */
fun differentReady(different: Map<String, String>, otherIds: List<String>, residentOf: (String) -> Boolean): Boolean =
    different.all { (id, text) -> id !in otherIds || addressValid(text, residentOf(id)) }

/** 다른 분 화면의 「다음」 — 검사를 통과하고, 명단의 누군가 대표자와 실제로 다른 주소를 가졌을 때만(아무도 안 바꿨으면 「모두 같아요」와 같으니 막는다). */
fun differentCanSave(different: Map<String, String>, otherIds: List<String>, residentOf: (String) -> Boolean, representativeAddress: String): Boolean {
    val rep = cleanAddress(representativeAddress)
    return differentReady(different, otherIds, residentOf) &&
        otherIds.any { id -> different[id]?.let(::cleanAddress)?.let { it.isNotEmpty() && it != rep } == true }
}

private val KO_TENS = listOf("", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔")
private val KO_UNITS = listOf("", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉")

/** 「세 분」 — 1~99 는 고유어 수. 그 밖에는 「100분」처럼 숫자. */
fun koreanPeople(count: Int): String {
    if (count !in 1..99) return "${count}분"
    val tens = count / 10
    val unit = count % 10
    val head = if (tens == 2 && unit == 0) "스무" else KO_TENS[tens] + KO_UNITS[unit]
    return "$head 분"
}

/** 「모두 이 주소에 사시나요?」 앞에 들어갈 사람 수 글자 — 한국어만 「세 분」, 나머지는 숫자. */
fun peopleCountLabel(count: Int, language: String): String = if (language == "ko") koreanPeople(count) else count.toString()

/** 서버 오류 칸 목록에서 이 칸이 빨간가. guestId == null = 대표자 칸(`address`), 아니면 `address.<id>`. */
fun addressErrorOf(fields: List<String>, guestId: String?): Boolean =
    if (guestId == null) "address" in fields else "address.$guestId" in fields

// ── 다시 들어왔을 때 · 저장된 주소 지키기 ─────────────────────────────────────────────────────────────────

/** 주소 화면이 들고 있는 입력 — FastCheckin 이 들고 있어 화면을 나갔다 와도 사라지지 않는다. different = 대표자와 다른 주소를 가진(적은) 분들. */
data class AddressDraft(val text: String, val different: Map<String, String>)

enum class AddressStart { Representative, Different }

/**
 * 서버에 저장된 주소에서 시작 입력을 만든다. 대표자와 다른 주소가 이미 있는 분은 그 값을 지킨 채 「다른 주소」로 시작한다(보지 않은 값을 덮어쓰지 않게).
 * 주소가 비었거나 대표자와 같은 분은 넣지 않는다 — 「같음」으로 시작. 서버가 동행자 주소를 내려주지 않으면(null) 모두 같음.
 */
fun initialAddressDraft(stay: KioskStay): AddressDraft {
    val rep = stay.guests.firstOrNull { it.isRepresentative } ?: stay.guests.firstOrNull()
    val text = rep?.address.orEmpty()
    val repClean = cleanAddress(text)
    val different = LinkedHashMap<String, String>()
    for (guest in stay.guests) {
        if (guest.id == rep?.id) continue
        val own = guest.address?.let(::cleanAddress).orEmpty()
        if (own.isNotEmpty() && own != repClean) different[guest.id] = own
    }
    return AddressDraft(text, different)
}

/** 대표자 주소가 이미 유효하고 다른 주소가 있는 분이 있으면 바로 다른 분 화면에서 시작(「모두 같아요」를 묻지 않는다). */
fun addressStart(draft: AddressDraft, repResident: Boolean): AddressStart =
    if (draft.different.isNotEmpty() && addressValid(draft.text, repResident)) AddressStart.Different else AddressStart.Representative

/** 「모두 같아요?」를 묻는가 — 한 명뿐이면 아니고, 이미 다른 주소가 있는 분이 있으면 아니다(그땐 다음 → 다른 분 화면). 키보드가 닫혔는지와 무관. */
fun showSameQuestion(single: Boolean, valid: Boolean, hasDifferent: Boolean): Boolean = !single && valid && !hasDifferent

/** 칸 아래에 「주소를 다시 확인해 주세요」를 보이는가 — 뭔가 적었는데 기준에 못 미치고 자판이 닫혔을 때. */
fun showAddressError(text: String, resident: Boolean, keyboardUp: Boolean): Boolean =
    !keyboardUp && cleanAddress(text).isNotEmpty() && !addressValid(text, resident)
