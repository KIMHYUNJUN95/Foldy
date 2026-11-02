package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.mrz.Mrz
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

// ICAO 9303 Part 4 예시 여권(유토피아 · ERIKSSON ANNA MARIA).
class MrzTest {
    private val today = LocalDate.of(2026, 11, 2)
    private val l1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<"
    private val l2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10"

    @Test
    fun icaoSpecimen() {
        val result = Mrz.parseLines(l1, l2, today)!!
        assertEquals("ERIKSSON", result.surname)
        assertEquals("ANNA MARIA", result.givenNames)
        assertEquals("L898902C3", result.documentNumber)
        assertEquals("UTO", result.nationality)
        assertEquals("1974-08-12", result.birthDate)
        assertEquals("female", result.sex)
        assertEquals("2012-04-15", result.expiryDate)
        assertTrue(result.valid)
        assertEquals("$l1\n$l2", result.raw)
    }

    @Test
    fun findsLinesInsideOcrNoise() {
        val ocr = "PASSPORT\nUtopia\nERIKSSON\n${l1.replace("<<<<", "< << <")}\n${l2.replace('0', 'O').take(40)}\n"
        val result = Mrz.parse(ocr, today)!!
        // 숫자 자리의 O 는 0 으로, 끝이 잘린 줄은 「<」로 채운다 — 합계 검사 숫자는 잘려서 틀림.
        assertEquals("L898902C3", result.documentNumber)
        assertEquals("1974-08-12", result.birthDate)
        assertFalse(result.valid)
    }

    @Test
    fun rejectsBadCheckDigits() {
        assertNull(Mrz.parseLines(l1, l2.replaceRange(9, 10, "7"), today))
        assertNull(Mrz.parseLines(l1, l2.replaceRange(19, 20, "1"), today))
        assertNull(Mrz.parse("hello\nworld", today))
        // 만료일만 틀리면 값은 주되 valid = false.
        assertFalse(Mrz.parseLines(l1, l2.replaceRange(27, 28, "1"), today)!!.valid)
    }

    @Test
    fun centuryAndGermany() {
        val young = "P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<"
        val number = "C01X00T47"
        val birth = "100812"
        val expiry = "300101"
        val body = number + Mrz.check(number) + "D<<" + birth + Mrz.check(birth) + "F" + expiry + Mrz.check(expiry) + "<<<<<<<<<<<<<<" + "<"
        val line2 = body + Mrz.check(body.substring(0, 10) + body.substring(13, 20) + body.substring(21, 43))
        val result = Mrz.parseLines(young, line2, today)!!
        assertEquals("DEU", result.nationality)
        assertEquals("2010-08-12", result.birthDate)
        assertEquals("2030-01-01", result.expiryDate)
        assertTrue(result.valid)
    }

    @Test
    fun ageCountsFullYearsInTokyoDate() {
        // 1974-08-12 생일: 2026-11-02 엔 52살, 생일 전날엔 51살, 생일 당일엔 52살.
        assertEquals(52, Mrz.ageOn("1974-08-12", today))
        assertEquals(51, Mrz.ageOn("1974-08-12", LocalDate.of(2026, 8, 11)))
        assertEquals(52, Mrz.ageOn("1974-08-12", LocalDate.of(2026, 8, 12)))
        assertEquals(0, Mrz.ageOn("2026-11-02", today))
        assertNull(Mrz.ageOn("2027-01-01", today))
        assertNull(Mrz.ageOn(null, today))
        assertNull(Mrz.ageOn("not-a-date", today))
    }

    @Test
    fun birthCenturyIsNeverInTheFuture() {
        val number = "L898902C3"
        fun birthOf(yymmdd: String): String? {
            val body = number + Mrz.check(number) + "UTO" + yymmdd + Mrz.check(yymmdd) + "F" + "300101" + Mrz.check("300101") + "<<<<<<<<<<<<<<<" + "0"
            return Mrz.parseLines(l1, body.padEnd(44, '<').take(44), today)?.birthDate
        }
        assertEquals("2026-03-01", birthOf("260301"))
        // 같은 해라도 오늘(11-02)보다 뒤면 미래 → 1900년대.
        assertEquals("1926-12-30", birthOf("261230"))
        assertEquals("1927-01-01", birthOf("270101"))
    }
}
