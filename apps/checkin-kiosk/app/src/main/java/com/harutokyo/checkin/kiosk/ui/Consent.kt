package com.harutokyo.checkin.kiosk.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harutokyo.checkin.kiosk.R
import kotlinx.coroutines.launch

// 시안 G3b — 약관 한 칸 동의(44 FR-K09). 개인정보는 법 의무로 받는 것이라 체크 칸 없이 안내로 알린다(43 §2-1, 2026-11-03).
// 동의 화면은 이제 빠른 체크인의 마지막 화면(ui/FastFlow.kt F7b)에 들어 있고, 여기엔 거기서 쓰는 체크 칸 · 약관 전문 창만 남았다.
// 약관 전문은 계약의 termsText(건물 · 언어별)를 화면 전체로 — 없으면 「직원에게 물어봐 주세요」.

/** 고른 언어의 약관 → 없으면 일본어 → 아무거나. */
fun termsFor(termsText: Map<String, String>, language: String): String? =
    (termsText[language] ?: termsText["ja"] ?: termsText.values.firstOrNull())?.takeIf { it.isNotBlank() }

/** 체크 칸 한 줄(시안 label — 40dp 상자, 줄 전체가 누르는 곳). */
@Composable
internal fun CheckRow(title: String, sub: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 104.dp)
            .semantics { toggleableState = ToggleableState(on) }
            .clickable(role = Role.Checkbox) { onChange(!on) }
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(40.dp)
                .background(if (on) G.Text else Color.Transparent, Radius)
                .border(BorderStroke(2.dp, if (on) G.Text else Color(0xFF8E9198)), Radius),
            contentAlignment = Alignment.Center,
        ) {
            if (on) Text("✓", color = G.Ink, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(22.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium, lineHeight = 30.sp)
            Spacer(Modifier.height(6.dp))
            Text(sub, color = G.Muted, fontSize = 16.sp, lineHeight = 22.sp)
        }
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(G.Line))
}

/** 약관 전문 — 화면 전체. 뒤로 가기 · 닫기로 돌아간다. */
@Composable
internal fun TermsOverlay(text: String?, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    Column(Modifier.fillMaxSize().background(G.Bg).clickable(enabled = false) {}.then(GUTTER)) {
        Text(str(R.string.consent_terms), color = G.Text, fontSize = 32.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(24.dp))
        Column(Modifier.weight(1f).fillMaxWidth().background(G.Surface, Radius).verticalScroll(rememberScrollState()).padding(28.dp)) {
            Text(text ?: str(R.string.terms_empty), color = if (text == null) G.Muted else G.Text, fontSize = 19.sp, lineHeight = 30.sp)
        }
        Spacer(Modifier.height(16.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            PrimaryButton(str(R.string.terms_close), onClick = onClose)
        }
    }
}
