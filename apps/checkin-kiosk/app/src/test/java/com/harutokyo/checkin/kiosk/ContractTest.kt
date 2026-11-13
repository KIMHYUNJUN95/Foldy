package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.CONTRACT_VERSION
import com.harutokyo.checkin.kiosk.contract.Contract
import com.harutokyo.checkin.kiosk.contract.SettingsOutcome
import com.harutokyo.checkin.kiosk.contract.settingsOutcomeOf
import com.harutokyo.checkin.kiosk.data.Api
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// contract-default.json = 서버 buildContract(null) 출력. 서버 계약이 바뀌면 이 파일을 다시 뽑는다.
class ContractTest {
    private fun fixture(): String = javaClass.classLoader!!.getResource("contract-default.json")!!.readText()

    @Test fun parsesServerDefault() {
        val contract = Api.json.decodeFromString<Contract>(fixture())
        assertEquals(CONTRACT_VERSION, contract.contractVersion)
        assertEquals(listOf("ja", "en", "zh-Hans", "ko"), contract.languages)
        assertTrue(contract.fields.first { it.key == "name_roman" }.required)
        assertTrue(contract.fields.first { it.key == "passport_number" }.foreignOnly)
        assertEquals("이름(로마자)", contract.fields.first { it.key == "name_roman" }.label["ko"])
        assertNull(contract.staffPin)
    }

    @Test fun ignoresUnknownKeys() {
        val withExtra = fixture().replaceFirst("{", "{\"futureField\":true,")
        Api.json.decodeFromString<Contract>(withExtra)
    }

    // 계약 버전이 섞일 때(2026-11-13) — 해석하다 실패해도 Loading 에 멈추지 않게.
    private fun response(contract: String) = """{"ok":true,"device":{"id":"d","propertyKey":"stay_ari","name":"로비"},"settingsVersion":"v","contract":$contract}"""

    @Test fun currentContractIsOk() {
        assertTrue(settingsOutcomeOf(response(fixture())) is SettingsOutcome.Ok)
    }

    @Test fun oldContractWithoutDeviceSaltIsUpdateRequired() {
        val old = fixture().replaceFirst("\"contractVersion\":$CONTRACT_VERSION", "\"contractVersion\":1")
            .replace("\"staffPin\":null", "\"staffPin\":{\"algorithm\":\"pbkdf2-sha256\",\"iterations\":1,\"salt\":\"a\",\"hash\":\"b\"}")
        assertEquals(SettingsOutcome.UpdateRequired, settingsOutcomeOf(response(old)))
    }

    @Test fun newerContractIsUpdateRequired() {
        val newer = fixture().replaceFirst("\"contractVersion\":$CONTRACT_VERSION", "\"contractVersion\":${CONTRACT_VERSION + 1}")
        assertEquals(SettingsOutcome.UpdateRequired, settingsOutcomeOf(response(newer)))
    }

    @Test fun brokenBodyIsInvalid() {
        assertEquals(SettingsOutcome.Invalid, settingsOutcomeOf("<html>"))
        assertEquals(SettingsOutcome.Invalid, settingsOutcomeOf("""{"ok":false,"error":"server_error"}"""))
        // 같은 버전인데 모양이 깨졌으면 Invalid(앱이 고칠 수 없으니 화면은 캐시 · 업데이트 필요로).
        assertEquals(SettingsOutcome.Invalid, settingsOutcomeOf(response(fixture().replace("\"staffPin\":null", "\"staffPin\":{\"algorithm\":\"x\"}"))))
    }
}
