package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.ui.keepKoreanWords
import org.junit.Assert.assertEquals
import org.junit.Test

class KeepWordsTest {
    @Test fun joinsHangulInsideWords() = assertEquals("여\u2060권 준\u2060비", keepKoreanWords("여권 준비"))

    @Test fun leavesOtherScriptsAlone() {
        assertEquals("Please have your passport ready", keepKoreanWords("Please have your passport ready"))
        assertEquals("パスポート", keepKoreanWords("パスポート"))
    }

    @Test fun breaksOnlyAtSpaces() {
        val out = keepKoreanWords("QR 코드를 카메라에")
        assertEquals("QR 코⁠드⁠를 카⁠메⁠라⁠에", out)
        assertEquals("QR 코드를 카메라에", out.replace("⁠", ""))
    }
}
