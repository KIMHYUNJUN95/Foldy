package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.AddressBody
import com.harutokyo.checkin.kiosk.contract.GuestAddress
import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.saveResultOf
import com.harutokyo.checkin.kiosk.contract.SaveResponse
import com.harutokyo.checkin.kiosk.contract.SaveResult
import com.harutokyo.checkin.kiosk.data.Api
import com.harutokyo.checkin.kiosk.ui.AddressStart
import com.harutokyo.checkin.kiosk.ui.FormMode
import com.harutokyo.checkin.kiosk.ui.addressStart
import com.harutokyo.checkin.kiosk.ui.initialAddressDraft
import com.harutokyo.checkin.kiosk.ui.showAddressError
import com.harutokyo.checkin.kiosk.ui.showSameQuestion
import com.harutokyo.checkin.kiosk.ui.PersonDraft
import com.harutokyo.checkin.kiosk.ui.SavedPerson
import com.harutokyo.checkin.kiosk.ui.addressBodyOf
import com.harutokyo.checkin.kiosk.ui.addressError
import com.harutokyo.checkin.kiosk.ui.addressErrorOf
import com.harutokyo.checkin.kiosk.ui.addressValid
import com.harutokyo.checkin.kiosk.ui.cleanAddress
import com.harutokyo.checkin.kiosk.ui.differentCanSave
import com.harutokyo.checkin.kiosk.ui.differentReady
import com.harutokyo.checkin.kiosk.ui.koreanPeople
import com.harutokyo.checkin.kiosk.ui.peopleCountLabel
import com.harutokyo.checkin.kiosk.ui.filterForeignAddress
import com.harutokyo.checkin.kiosk.ui.isResident
import com.harutokyo.checkin.kiosk.ui.needsAddress
import com.harutokyo.checkin.kiosk.ui.onlyOneGuest
import com.harutokyo.checkin.kiosk.ui.otherGuestIds
import com.harutokyo.checkin.kiosk.ui.personMissing
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AddressFlowTest {
    private fun stay(partySize: Int, vararg guests: KioskGuest) =
        KioskStay("s", emptyList(), "2026-11-02", "2026-11-03", 1, partySize, partySize, guests = guests.toList())

    private val rep = KioskGuest("r", "KIM A", isRepresentative = true)
    private val companion = KioskGuest("c", "KIM B")

    // ── 영어 자판 입력 걸러내기 ────────────────────────────────────────────────────────────────

    @Test
    fun foreignFilterKeepsLatinDigitsSpacesAndAsciiPunctuation() {
        assertEquals("1600 Pennsylvania Ave NW, Apt #4-B", filterForeignAddress("1600 Pennsylvania Ave NW, Apt #4-B"))
        assertEquals("Calle de Alcalá 12, 2º", filterForeignAddress("Calle de Alcalá 12, 2º"))
        assertEquals("Müllerstraße 5 / Škoda", filterForeignAddress("Müllerstraße 5 / Škoda"))
        // 분리형 악센트는 합쳐서(NFC) 남긴다.
        assertEquals("Caf\u00e9 Road", filterForeignAddress("Cafe\u0301 Road"))
    }

    // 서버와 같은 사례표(apps/checkin/src/lib/guest/address-cases.json) — 서버 vitest 도 같은 파일을 읽는다.
    private fun sharedCases(): List<JsonObject> {
        val file = listOf("../../checkin/src/lib/guest/address-cases.json", "../checkin/src/lib/guest/address-cases.json", "apps/checkin/src/lib/guest/address-cases.json")
            .map(::File).first { it.exists() }
        return Json.parseToJsonElement(file.readText()).jsonArray.map { it.jsonObject }
    }

    @Test
    fun sharedCaseTableGivesTheSameVerdictAsTheServer() {
        val cases = sharedCases()
        assertTrue(cases.size >= 30)
        for (case in cases) {
            val name = case.getValue("name").jsonPrimitive.content
            val text = case.getValue("text").jsonPrimitive.content
            val japan = case.getValue("hasJapanAddress").jsonPrimitive.boolean
            val error = case.getValue("error").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(name, error, addressError(text, japan))
            assertEquals(name, error == null, addressValid(text, japan))
            // 입력 거르기는 서버가 통과시키는 글을 바꾸지 않는다(저장될 글이 같다).
            if (!japan && error == null) assertEquals(name, cleanAddress(text), cleanAddress(filterForeignAddress(text)))
        }
    }

    @Test
    fun filterAppliesServerSubstitutionsInsteadOfDeletingCharacters() {
        assertEquals("Block 1-2", filterForeignAddress("Block 1\u20132"))
        assertEquals("Block 1-2", filterForeignAddress("Block 1\u20122"))
        assertEquals("O'Connell", filterForeignAddress("O\u2019Connell"))
        assertEquals("O'Connell", filterForeignAddress("O\u02bcConnell"))
        assertEquals("a \"b\"", filterForeignAddress("a \u201cb\u201d"))
        assertEquals("Main St", filterForeignAddress("Main\u00a0St"))
        assertEquals("Main St", filterForeignAddress("Main\u2009St"))
        assertEquals("ab", filterForeignAddress("a\u200bb"))
    }

    @Test
    fun cleanAddressTrimsEdgeCommasLikeTheServer() {
        assertEquals("1234567", cleanAddress("1234567,"))
        assertEquals("USA, Boston", cleanAddress(",USA, Boston,\n"))
        assertFalse(addressValid("1234567,", resident = false))
        assertEquals("USA, Boston, 12 Main St", cleanAddress("USA\nBoston\n12 Main St"))
        assertEquals("Block 1-2 O'Connell", cleanAddress("Block 1\u20132\u00a0O\u2019Connell"))
    }

    @Test
    fun foreignFilterLeavesCleanTextUntouchedSoComposingIsNotReset() {
        for (text in listOf("12 Main St, Apt 3", "Nguy\u1ec5n Hu\u1ec7", "", "a")) assertEquals(text, filterForeignAddress(text))
    }

    @Test
    fun cleanAddressNormalizesToNfcBeforeLengthAndSending() {
        assertEquals("Caf\u00e9", cleanAddress("Cafe\u0301"))
        // 가나 탁점 분리형도 합친다.
        assertEquals("\u30ac", cleanAddress("\u30ab\u3099"))
        assertTrue(addressValid("Cafe\u0301 12345", resident = false))
        assertFalse(addressValid("Cafe\u0301 12", resident = false))
    }

    @Test
    fun foreignFilterDropsJapaneseKoreanChineseEmojiAndFullWidth() {
        assertEquals("Tokyo 1-2-3", filterForeignAddress("東京Tokyo 1-2-3"))
        assertEquals("Seoul", filterForeignAddress("서울Seoul"))
        assertEquals("Beijing 1", filterForeignAddress("北京Beijing 1"))
        assertEquals("Home", filterForeignAddress("Home😀"))
        // 전각 영문 · 숫자는 일본어 자판에서 나오므로 거른다.
        assertEquals("b", filterForeignAddress("ａb１"))
        assertEquals("", filterForeignAddress("あいう"))
    }

    @Test
    fun foreignFilterKeepsLineBreaksForTheServerRuleAndTurnsTabsIntoSpaces() {
        assertEquals("1 Main St\nLondon", filterForeignAddress("1 Main St\nLondon"))
        assertEquals("a b", filterForeignAddress("a\tb"))
    }

    // ── 길이 기준(서버와 같게) ─────────────────────────────────────────────────────────────────

    @Test
    fun validityThresholdsMirrorServer() {
        assertFalse(addressValid("1234567", resident = false))
        assertTrue(addressValid("12345678", resident = false))
        assertFalse(addressValid("1234", resident = true))
        assertTrue(addressValid("12345", resident = true))
        assertTrue(addressValid("a".repeat(200), resident = false))
        assertFalse(addressValid("a".repeat(201), resident = false))
        // 앞뒤 빈칸 · 연속 공백은 세지 않는다.
        assertFalse(addressValid("   1234567   ", resident = false))
        assertFalse(addressValid("1234     56", resident = false))
        assertEquals("1 Main St, London", cleanAddress("  1 Main  St\n London "))
    }

    // ── 누가 일본 거주인가 ─────────────────────────────────────────────────────────────────────

    @Test
    fun residentFollowsSavedModeOrServerFlag() {
        val saved = SavedPerson(PersonDraft("A", "B"), FormMode.Resident, null, null)
        assertTrue(isResident(rep, saved))
        assertTrue(isResident(rep.copy(hasJapanAddress = true), null))
        assertFalse(isResident(rep, SavedPerson(PersonDraft("A", "B"), FormMode.Mrz, null, null)))
        assertFalse(isResident(null, null))
    }

    // ── 주소 화면을 건너뛰는 경우 ──────────────────────────────────────────────────────────────

    @Test
    fun addressScreenIsAskedUnlessEveryGuestHasAddress() {
        // 키오스크에서 새로 저장한 분들: 서버가 address 가 비었다고 알려 준다.
        assertTrue(needsAddress(stay(2, rep.copy(missing = listOf("address")), companion.copy(missing = listOf("address")))))
        // 대표자만 비었다.
        assertTrue(needsAddress(stay(2, rep.copy(missing = listOf("address")), companion)))
        // 동행자 한 명만 비었다.
        assertTrue(needsAddress(stay(2, rep.copy(address = "Seoul, Korea"), companion.copy(missing = listOf("address")))))
        // 웹 사전 등록으로 모두 주소가 있다 → 건너뜀.
        assertFalse(needsAddress(stay(2, rep.copy(address = "Seoul, Korea"), companion.copy(address = "Seoul, Korea"))))
        // 명단이 없으면 물을 곳이 없다.
        assertFalse(needsAddress(stay(1)))
        // 대표자 주소가 비어 보이면(서버가 missing 을 안 줘도) 묻는다.
        assertTrue(needsAddress(stay(1, rep)))
    }

    @Test
    fun addressIsNotASeatTask() {
        // 주소가 비어 있어도 자리(여권 · 얼굴)를 다시 돌지 않는다 — 주소는 전용 화면에서 받는다.
        assertEquals(emptyList<String>(), personMissing(rep.copy(missing = listOf("address"))))
        assertEquals(emptyList<String>(), personMissing(companion.copy(missing = listOf("address", "prev_stay"))))
        assertEquals(listOf("passport_photo"), personMissing(rep.copy(missing = listOf("passport_photo", "address"))))
    }

    @Test
    fun singleGuestSkipsTheQuestion() {
        assertTrue(onlyOneGuest(stay(1, rep)))
        assertTrue(onlyOneGuest(stay(0, rep)))
        assertFalse(onlyOneGuest(stay(2, rep, companion)))
        // 인원은 둘인데 아직 한 명만 저장된 경우도 한 명이 아니다.
        assertFalse(onlyOneGuest(stay(2, rep)))
    }

    // ── 서버로 보낼 몸통 ───────────────────────────────────────────────────────────────────────

    @Test
    fun allSameSendsNoOthers() {
        // 서버는 others 에 없는 분에게 대표자 글을 글자 검사 없이 이어 준다.
        val body = addressBodyOf("sess", "  1 Main  St, London ", listOf("c", "d"), emptyMap())
        assertEquals(AddressBody("sess", "1 Main St, London", emptyList()), body)
    }

    @Test
    fun residentRepWithForeignCompanionSendsNoOthersWhenAllSame() {
        // 일본 거주 대표자 + 외국 동행자: 「모두 같아요」면 동행자를 others 에 넣지 않아야 `address.<id>` 오류가 안 난다.
        val body = addressBodyOf("sess", "東京都港区1-2-3 ○○ビル 101", listOf("foreign"), emptyMap())
        assertEquals(emptyList<GuestAddress>(), body.others)
        assertEquals("東京都港区1-2-3 ○○ビル 101", body.representativeAddress)
    }

    @Test
    fun someDifferSendsOnlyGuestsWhoseAddressWasTypedDifferently() {
        val body = addressBodyOf("sess", "1 Main St, London", listOf("c", "d", "e"), mapOf("d" to " 5 Rue X,  Paris "))
        assertEquals(listOf(GuestAddress("d", "5 Rue X, Paris")), body.others)
        assertEquals("1 Main St, London", body.representativeAddress)
        // 대표자와 같은 글을 적었으면 다른 주소가 아니다 — 보내지 않는다.
        assertEquals(emptyList<GuestAddress>(), addressBodyOf("s", "1 Main St, London", listOf("c"), mapOf("c" to "1  Main St, London")).others)
        // 명단에 없는 id 는 보내지 않는다.
        assertEquals(emptyList<GuestAddress>(), addressBodyOf("s", "1 Main St, London", listOf("c"), mapOf("zz" to "5 Rue X, Paris")).others)
    }

    @Test
    fun singleGuestBodyHasNoOthers() {
        assertEquals(emptyList<GuestAddress>(), addressBodyOf("sess", "1 Main St, London", emptyList(), emptyMap()).others)
    }

    @Test
    fun otherIdsNeverIncludeTheRepresentative() {
        assertEquals(listOf("c"), otherGuestIds(stay(2, rep, companion)))
        assertEquals(emptyList<String>(), otherGuestIds(stay(1, rep)))
        // 대표자 표시가 없으면 첫 분을 대표자로 본다(화면과 같은 규칙).
        assertEquals(listOf("c"), otherGuestIds(stay(2, companion.copy(id = "x"), companion)))
    }

    @Test
    fun bodyEncodesWithServerFieldNames() {
        val text = Api.json.encodeToString(addressBodyOf("sess", "1 Main St, London", listOf("c"), mapOf("c" to "5 Rue X, Paris")))
        assertTrue(text, text.contains("\"sessionId\":\"sess\""))
        assertTrue(text, text.contains("\"representativeAddress\":\"1 Main St, London\""))
        assertTrue(text, text.contains("\"others\":[{\"guestId\":\"c\",\"address\":\"5 Rue X, Paris\"}]"))
    }

    // ── 다른 분 화면 ───────────────────────────────────────────────────────────────────────────

    @Test
    fun differentScreenNeedsEveryOpenedRowToBePassingTheFullServerCheck() {
        val resident = { id: String -> id == "j" }
        val roster = listOf("c", "j")
        assertTrue(differentReady(emptyMap(), roster, resident))
        assertTrue(differentReady(mapOf("c" to "5 Rue de Rivoli, Paris", "j" to "\u6771\u4eac\u90fd1-2-3"), roster, resident))
        // 영어 8자 · 일본 거주 5자.
        assertFalse(differentReady(mapOf("c" to "Paris 1"), roster, resident))
        assertFalse(differentReady(mapOf("c" to "5 Rue de Rivoli, Paris", "j" to "\u6771\u4eac"), roster, resident))
        assertTrue(differentReady(mapOf("j" to "\u6771\u4eac\u90fd\u6e2f\u533a"), roster, resident))
        // 외국인 칸에 일본어를 쓰면 서버가 address.<id> 로 거절한다 — 여기서 막는다.
        assertFalse(differentReady(mapOf("c" to "\u6771\u4eac\u90fd\u6e2f\u533a1-2-3"), roster, resident))
        // 일본 거주 칸은 어떤 글자든 된다.
        assertTrue(differentReady(mapOf("j" to "Tokyo, Minato"), roster, resident))
    }

    @Test
    fun differentReadyIgnoresGuestsNoLongerInTheRoster() {
        val resident = { _: String -> false }
        // 명단에서 빠진 분(눈에 안 보이는 값)이 다음 버튼을 막지 않는다.
        assertTrue(differentReady(mapOf("gone" to "x", "c" to "5 Rue de Rivoli, Paris"), listOf("c"), resident))
        assertTrue(differentReady(mapOf("gone" to "x"), listOf("c"), resident))
    }

    // ── 서버 오류 칸 ───────────────────────────────────────────────────────────────────────────

    @Test
    fun serverFieldErrorsMapToRepresentativeAndGuestRows() {
        val fields = listOf("address", "address.c", "contact")
        assertTrue(addressErrorOf(fields, null))
        assertFalse(addressErrorOf(listOf("address.c"), null))
        assertTrue(addressErrorOf(fields, "c"))
        assertFalse(addressErrorOf(fields, "d"))
    }

    @Test
    fun invalidResponseCarriesTheAddressFields() {
        val response = Api.json.decodeFromString<SaveResponse>("""{"ok":false,"error":"invalid","fields":["address.c"]}""")
        assertEquals(SaveResult.Invalid(listOf("address.c")), saveResultOf(400, response))
        assertNull((saveResultOf(200, Api.json.decodeFromString<SaveResponse>("""{"ok":true}""")) as? SaveResult.Saved))
    }

    // ── 다시 들어왔을 때 · 저장된 주소 지키기 ─────────────────────────────────────────────────────

    private val repA = KioskGuest("r", "KIM A", isRepresentative = true, address = "1 Main St, London")

    @Test
    fun companionWithDifferentSavedAddressStartsAsDifferentAndKeepsItsValue() {
        val b = companion.copy(id = "b", address = "5 Rue de Rivoli, Paris")
        val draft = initialAddressDraft(stay(2, repA, b))
        assertEquals("1 Main St, London", draft.text)
        assertEquals(mapOf("b" to "5 Rue de Rivoli, Paris"), draft.different)
        // 대표자 주소가 이미 유효하니 「모두 같아요」를 묻지 않고 다른 분 화면에서 시작.
        assertEquals(AddressStart.Different, addressStart(draft, repResident = false))
        assertFalse(showSameQuestion(single = false, valid = true, hasDifferent = draft.different.isNotEmpty()))
    }

    @Test
    fun sameOrBlankCompanionsAreNotDifferent() {
        val same = companion.copy(id = "s", address = "  1 Main  St, London ")
        val blank = companion.copy(id = "n", address = null)
        val empty = companion.copy(id = "e", address = "   ")
        val draft = initialAddressDraft(stay(4, repA, same, blank, empty))
        assertEquals(emptyMap<String, String>(), draft.different)
        assertEquals(AddressStart.Representative, addressStart(draft, repResident = false))
        assertTrue(showSameQuestion(single = false, valid = true, hasDifferent = false))
    }

    @Test
    fun blankRepresentativeAddressStartsOnRepresentativeEvenWhenCompanionsHaveAddresses() {
        val b = companion.copy(id = "b", address = "5 Rue de Rivoli, Paris")
        val draft = initialAddressDraft(stay(2, rep, b))
        assertEquals("", draft.text)
        assertEquals(mapOf("b" to "5 Rue de Rivoli, Paris"), draft.different)
        assertEquals(AddressStart.Representative, addressStart(draft, repResident = false))
        // 대표자가 유효한 주소를 적으면 질문 대신 다른 분 화면으로.
        assertFalse(showSameQuestion(single = false, valid = true, hasDifferent = true))
    }

    @Test
    fun questionIsHiddenForSingleGuestOrInvalidText() {
        assertFalse(showSameQuestion(single = true, valid = true, hasDifferent = false))
        assertFalse(showSameQuestion(single = false, valid = false, hasDifferent = false))
    }

    @Test
    fun savedCompanionAddressSurvivesAReEntry() {
        // 저장 직후 서버가 모든 분의 주소를 돌려준다 → 다시 들어와도 B 의 주소가 다른 주소로 시작하고, 그대로 보내면 같은 값이다.
        val b = companion.copy(id = "b", address = "5 Rue de Rivoli, Paris")
        val draft = initialAddressDraft(stay(2, repA, b))
        val body = addressBodyOf("s", draft.text, otherGuestIds(stay(2, repA, b)), draft.different)
        assertEquals(listOf(GuestAddress("b", "5 Rue de Rivoli, Paris")), body.others)
    }

    // ── 키보드가 닫히지 않아도 진행 · 이유 표시 ───────────────────────────────────────────────

    @Test
    fun invalidReasonShowsOnlyWhenKeyboardClosedAndTextTypedButInvalid() {
        assertTrue(showAddressError(text = "Paris", resident = false, keyboardUp = false))
        assertFalse(showAddressError(text = "Paris", resident = false, keyboardUp = true))
        assertFalse(showAddressError(text = "1 Main St, London", resident = false, keyboardUp = false))
        // 아무것도 안 적었으면 오류 대신 안내 문구만.
        assertFalse(showAddressError(text = "  ", resident = false, keyboardUp = false))
        assertTrue(showAddressError(text = "東京", resident = true, keyboardUp = false))
    }

    // ── 다른 분 화면: 한 명이라도 달라야 저장 ─────────────────────────────────────────────────

    @Test
    fun differentScreenCannotSaveUntilSomeoneActuallyDiffers() {
        val resident = { _: String -> false }
        val roster = listOf("c", "d")
        val repText = "1 Main St, London"
        // 아무도 안 바꿨다(빈 목록) · 눌러서 입력칸만 열었다(빈 글) · 대표자와 같은 글.
        assertFalse(differentCanSave(emptyMap(), roster, resident, repText))
        assertFalse(differentCanSave(mapOf("c" to ""), roster, resident, repText))
        assertFalse(differentCanSave(mapOf("c" to "1  Main St, London"), roster, resident, repText))
        // 하나가 달라지면 저장 가능, 다른 열린 칸이 모자라면 아직.
        assertTrue(differentCanSave(mapOf("c" to "5 Rue de Rivoli, Paris"), roster, resident, repText))
        assertFalse(differentCanSave(mapOf("c" to "5 Rue de Rivoli, Paris", "d" to "Paris"), roster, resident, repText))
        // 이미 저장돼 있던 다른 주소로 시작해도 바로 가능(서버 값을 지킨다).
        assertTrue(differentCanSave(initialAddressDraft(stay(2, repA, companion.copy(id = "b", address = "5 Rue de Rivoli, Paris"))).different, listOf("b"), resident, repText))
        // 명단에서 빠진 분만 다르면 안 된다.
        assertFalse(differentCanSave(mapOf("gone" to "5 Rue de Rivoli, Paris"), roster, resident, repText))
    }

    // ── 한국어 사람 수 ────────────────────────────────────────────────────────────────────────

    @Test
    fun koreanPeopleUsesNativeNumbers() {
        val expected = mapOf(
            1 to "한 분", 2 to "두 분", 3 to "세 분", 4 to "네 분", 5 to "다섯 분", 6 to "여섯 분", 7 to "일곱 분", 8 to "여덟 분", 9 to "아홉 분",
            10 to "열 분", 11 to "열한 분", 12 to "열두 분", 13 to "열세 분", 14 to "열네 분", 19 to "열아홉 분",
            20 to "스무 분", 21 to "스물한 분", 24 to "스물네 분", 30 to "서른 분", 32 to "서른두 분", 40 to "마흔 분", 50 to "쉰 분",
            60 to "예순 분", 70 to "일흔 분", 80 to "여든 분", 90 to "아흔 분", 99 to "아흔아홉 분",
        )
        for ((n, text) in expected) assertEquals(n.toString(), text, koreanPeople(n))
        // 100 명 이상 · 0 이하는 숫자 그대로.
        assertEquals("100분", koreanPeople(100))
        assertEquals("0분", koreanPeople(0))
    }

    @Test
    fun peopleCountLabelFollowsLanguage() {
        assertEquals("세 분", peopleCountLabel(3, "ko"))
        assertEquals("3", peopleCountLabel(3, "ja"))
        assertEquals("4", peopleCountLabel(4, "en"))
        assertEquals("5", peopleCountLabel(5, "zh"))
    }
}
