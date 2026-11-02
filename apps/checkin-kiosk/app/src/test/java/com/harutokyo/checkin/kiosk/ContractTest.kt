package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.contract.CONTRACT_VERSION
import com.harutokyo.checkin.kiosk.contract.Contract
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
}
