package com.harutokyo.checkin.kiosk.ui

import android.content.res.Configuration
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import java.util.Locale

// 시안 G 「밤의 키오스크」 토큰(캔버스 BCPPdekM… G1~G4) — 사전 등록 웹(apps/checkin globals.css)과 같은 색.
object G {
    val Bg = Color(0xFF0D0E10)
    val Text = Color(0xFFF2F1EE)
    val Muted = Color(0xFFA3A6AC)
    val Line = Color(0xFF2A2D32)
    val LineStrong = Color(0xFF4A4E55)
    val Surface = Color(0xFF17191C)
    val Ink = Color(0xFF14161A)
    val Sand = Color(0xFFCDBB9E)
    val Sage = Color(0xFFB4C48E)
    val Sky = Color(0xFFA8C6D8)
    val Clay = Color(0xFFD6AE9B)
    val Error = Color(0xFFE58A7B)
}

/** 계약 언어 코드 → 리소스 언어(values-ja · en · zh-rCN · ko). */
fun localeOf(code: String): Locale = when (code) {
    "zh-Hans" -> Locale.SIMPLIFIED_CHINESE
    "en" -> Locale.ENGLISH
    "ko" -> Locale.KOREAN
    else -> Locale.JAPANESE
}

/** 손님이 고른 언어로 문구를 바꾼다 — 기기 언어 설정은 건드리지 않는다. */
@Composable
fun Localized(code: String, content: @Composable () -> Unit) {
    val base = LocalContext.current
    val configuration = LocalConfiguration.current
    val localized = remember(code, configuration) {
        val config = Configuration(configuration).apply { setLocale(localeOf(code)) }
        base.createConfigurationContext(config)
    }
    CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides localized.resources.configuration) {
        content()
    }
}

/** 앱 문구. 한국어는 낱말 안에서 줄이 바뀌지 않게 글자 사이를 붙인다(일본어는 PHRASE_BREAK 가 맡는다). */
@Composable
fun str(@StringRes id: Int, vararg args: Any): String = keepKoreanWords(stringResource(id, *args))

/** 한글 글자 사이에 WORD JOINER(U+2060)를 넣어 띄어쓰기에서만 줄을 바꾸게 한다(CSS word-break: keep-all 과 같은 효과). */
fun keepKoreanWords(text: String): String {
    if (text.none(::isHangul)) return text
    return buildString(text.length * 2) {
        text.forEachIndexed { index, char ->
            if (index > 0 && isHangul(char) && isHangul(text[index - 1])) append('⁠')
            append(char)
        }
    }
}

private fun isHangul(char: Char): Boolean = char in '가'..'힣'
