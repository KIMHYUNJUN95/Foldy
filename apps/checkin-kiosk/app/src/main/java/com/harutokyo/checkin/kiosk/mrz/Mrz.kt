package com.harutokyo.checkin.kiosk.mrz

import java.time.LocalDate

// 여권 아래 두 줄(MRZ, ICAO 9303 TD3 — 44자 × 2줄) 읽기. ML Kit 이 읽은 글자에서 두 줄을 찾아 검사 숫자로 확인한다(16 §1-0 ②).
// 화면(T3r · T3c)은 이 결과만 본다. 검사 숫자가 하나라도 틀리면 valid = false — 값은 채우되 손님 · 직원이 확인한다.

data class MrzResult(
    val surname: String,
    val givenNames: String,
    val documentNumber: String,
    /** ISO 3166-1 alpha-3(독일 「D」는 DEU 로). */
    val nationality: String,
    /** yyyy-MM-dd */
    val birthDate: String?,
    /** "male" · "female" · null(「<」 · X) */
    val sex: String?,
    val expiryDate: String?,
    /** 번호 · 생년월일 · 만료일 · 합계 검사 숫자가 모두 맞음. */
    val valid: Boolean,
    /** 두 줄 원문(\n 으로 이음) — 직원이 손 입력과 비교(guests.mrz_raw). */
    val raw: String,
)

object Mrz {
    private const val LEN = 44

    /** OCR 글자 덩어리 → MRZ. 두 줄을 못 찾거나 번호 · 생년월일 검사 숫자가 틀리면 null(다시 찍기). */
    fun parse(ocrText: String, today: LocalDate = LocalDate.now()): MrzResult? {
        val lines = ocrText.lines().map(::clean).filter { it.length >= 40 && '<' in it }
        for (i in 0 until lines.size - 1) {
            val first = lines[i]
            if (!first.startsWith("P")) continue
            val result = parseLines(fit(first), fit(lines[i + 1]), today)
            if (result != null) return result
        }
        return null
    }

    fun parseLines(line1: String, line2Raw: String, today: LocalDate = LocalDate.now()): MrzResult? {
        if (line1.length != LEN || line2Raw.length != LEN || line1[0] != 'P') return null
        // 숫자 자리에 잘못 읽힌 글자(O→0 등)만 고친다. 번호 · 선택 칸은 글자도 올 수 있어 그대로.
        val line2 = buildString {
            line2Raw.forEachIndexed { index, char ->
                append(if (index in NUMERIC) toDigit(char) else char)
            }
        }
        // 번호는 글자 · 숫자가 섞여 O · 0 을 가릴 수 없다 — 검사 숫자가 맞는 쪽을 고른다.
        val number = line2.substring(0, 9).let { read ->
            listOf(read, read.replace('O', '0'), read.replace('0', 'O')).firstOrNull { check(it) == line2[9] } ?: read
        }
        val birth = line2.substring(13, 19)
        val expiry = line2.substring(21, 27)
        val numberOk = check(number) == line2[9]
        val birthOk = check(birth) == line2[19]
        if (!numberOk || !birthOk) return null
        val expiryOk = check(expiry) == line2[27]
        val optionalOk = line2[42] == '<' && line2.substring(28, 42).all { it == '<' } || check(line2.substring(28, 42)) == line2[42]
        val composite = check(number + line2[9] + line2.substring(13, 20) + line2.substring(21, 43)) == line2[43]

        val names = line1.substring(5).trimEnd('<')
        val split = names.indexOf("<<")
        val surname = (if (split >= 0) names.substring(0, split) else names).toLetters()
        val given = (if (split >= 0) names.substring(split + 2) else "").toLetters()
        return MrzResult(
            surname = surname,
            givenNames = given,
            documentNumber = number.trimEnd('<'),
            nationality = nationality(line2.substring(10, 13)),
            birthDate = date(birth, today, past = true),
            sex = when (line2[20]) {
                'M' -> "male"
                'F' -> "female"
                else -> null
            },
            expiryDate = date(expiry, today, past = false),
            valid = expiryOk && optionalOk && composite,
            raw = "$line1\n$line2",
        )
    }

    /** 검사 숫자(가중치 7 · 3 · 1). */
    fun check(field: String): Char {
        var sum = 0
        field.forEachIndexed { index, char ->
            val value = when (char) {
                in '0'..'9' -> char - '0'
                in 'A'..'Z' -> char - 'A' + 10
                else -> 0
            }
            sum += value * WEIGHTS[index % 3]
        }
        return '0' + sum % 10
    }

    private val WEIGHTS = intArrayOf(7, 3, 1)
    private val NUMERIC = setOf(9, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 43)

    private fun clean(line: String): String =
        line.uppercase().replace('«', '<').replace(" ", "").filter { it in 'A'..'Z' || it in '0'..'9' || it == '<' }

    /** OCR 이 끝의 「<」를 빼먹거나 더 붙인 경우 44자로 맞춘다. */
    private fun fit(line: String): String = if (line.length >= LEN) line.substring(0, LEN) else line.padEnd(LEN, '<')

    private fun toDigit(char: Char): Char = when (char) {
        'O', 'Q', 'D' -> '0'
        'I', 'L' -> '1'
        'Z' -> '2'
        'S' -> '5'
        'G' -> '6'
        'B' -> '8'
        else -> char
    }

    private fun String.toLetters(): String = replace('<', ' ').replace('0', 'O').replace(Regex("\\s+"), " ").trim()

    private fun nationality(code: String): String {
        val trimmed = code.replace('0', 'O').trimEnd('<')
        return if (trimmed == "D") "DEU" else trimmed
    }

    private fun date(yymmdd: String, today: LocalDate, past: Boolean): String? {
        if (!yymmdd.all(Char::isDigit)) return null
        val yy = yymmdd.substring(0, 2).toInt()
        val month = yymmdd.substring(2, 4).toInt()
        val day = yymmdd.substring(4, 6).toInt()
        val nowYy = today.year % 100
        // 생년월일: 올해 두 자리보다 크면 1900년대. 만료일: 늘 2000년대.
        val year = if (past) (if (yy > nowYy) 1900 + yy else 2000 + yy) else 2000 + yy
        return runCatching { LocalDate.of(year, month, day).toString() }.getOrNull()
    }
}
