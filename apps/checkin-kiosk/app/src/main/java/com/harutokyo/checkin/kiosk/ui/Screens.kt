package com.harutokyo.checkin.kiosk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.data.EnrollError
import kotlinx.coroutines.launch

// 화면은 세로 800×1280 기준(시안 G). Android 16+ 큰 화면은 세로 고정을 무시할 수 있어 가로(넓은 쪽이 긴 화면)에서는
// 2열로 바꾸고, 넘치면 스크롤한다(한 화면에 스크롤 하나). 타일 · 단추 높이는 최소값이라 글자를 키우면 늘어난다.

private val GUTTER = Modifier.padding(horizontal = 56.dp, vertical = 40.dp)

/** 손님 화면 위 줄 — 표지(5초 누르면 직원) · 시각. */
@Composable
private fun TopBar(onStaff: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Logo(onHold = onStaff)
        Spacer(Modifier.weight(1f))
        Clock()
    }
}

/** 위는 스크롤, 아래 줄(단추)은 늘 보이게. */
@Composable
private fun ScrollPage(bottom: (@Composable () -> Unit)? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().then(GUTTER)) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) { content() }
        if (bottom != null) {
            Spacer(Modifier.height(16.dp))
            bottom()
        }
    }
}

/** E — 기기 등록(관리자 화면이 낸 8자리 코드). */
@Composable
fun EnrollScreen(revoked: Boolean, onSubmit: suspend (String) -> EnrollError?) {
    var code by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<EnrollError?>(null) }
    val scope = rememberCoroutineScope()
    ScrollPage(bottom = {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            PrimaryButton(
                if (working) str(R.string.enroll_working) else str(R.string.enroll_submit),
                enabled = code.length == 8 && !working,
            ) {
                working = true
                scope.launch {
                    error = onSubmit(code)
                    working = false
                    if (error != null) code = ""
                }
            }
        }
    }) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(40.dp))
            Text(str(R.string.enroll_title), color = G.Text, fontSize = 36.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(12.dp))
            Text(str(R.string.enroll_body), color = G.Muted, fontSize = 17.sp)
            if (revoked) {
                Spacer(Modifier.height(16.dp))
                Text(str(R.string.revoked), color = G.Sand, fontSize = 16.sp)
            }
            Spacer(Modifier.height(40.dp))
            Digits(code, 8)
            Box(Modifier.heightIn(min = 48.dp).padding(vertical = 12.dp)) {
                val message = when (error) {
                    EnrollError.Invalid -> str(R.string.enroll_invalid)
                    EnrollError.RateLimited -> str(R.string.enroll_rate)
                    EnrollError.Network -> str(R.string.error_network)
                    EnrollError.Server -> str(R.string.error_server)
                    null -> null
                }
                if (message != null) Text(message, color = G.Error, fontSize = 16.sp)
            }
            Keypad(
                onDigit = { if (code.length < 8 && !working) { code += it; error = null } },
                onDelete = { if (!working) code = code.dropLast(1) },
            )
        }
    }
}

private data class LangOption(val code: String, val name: String, val color: Color)

private val LANGS = listOf(
    LangOption("ja", "日本語", G.Sand),
    LangOption("en", "English", G.Sage),
    LangOption("zh-Hans", "简体中文", G.Sky),
    LangOption("ko", "한국어", G.Clay),
)

/** G1 — 언어 고르기. 손님이 없을 때 늘 이 화면. */
@Composable
fun LanguageScreen(
    languages: List<String>,
    online: Boolean,
    hasContacts: Boolean,
    onStaff: () -> Unit,
    onCall: () -> Unit,
    onPick: (String) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth > maxHeight
        ScrollPage(bottom = if (hasContacts) ({ OutlineButton("Call staff", sub = "スタッフを呼ぶ", onClick = onCall) }) else null) {
            TopBar(onStaff)
            if (!online) {
                Spacer(Modifier.height(16.dp))
                Box(Modifier.fillMaxWidth().background(G.Surface, Radius).padding(16.dp)) {
                    Text(str(R.string.offline), color = G.Sand, fontSize = 15.sp)
                }
            }
            Spacer(Modifier.height(if (wide) 40.dp else 72.dp))
            Text("Choose your language", color = G.Text, fontSize = 52.sp, fontWeight = FontWeight.Medium, lineHeight = 58.sp)
            Spacer(Modifier.height(14.dp))
            Text("言語を選択 · 选择语言 · 언어 선택", color = G.Muted, fontSize = 19.sp)
            Spacer(Modifier.height(if (wide) 32.dp else 48.dp))
            val options = LANGS.filter { it.code in languages }
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                for (row in options.chunked(if (wide) 2 else 1)) {
                    Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        for (option in row) {
                            Tile(option.color, minHeight = if (wide) 150.dp else 176.dp, modifier = Modifier.weight(1f).fillMaxHeight(), onClick = { onPick(option.code) }) {
                                Text(option.name, color = G.Ink, fontSize = 40.sp, fontWeight = FontWeight.Medium)
                                Spacer(Modifier.height(20.dp))
                                // 각 타일의 안내는 그 언어로.
                                Localized(option.code) {
                                    Text(str(R.string.lang_ready), color = G.Ink.copy(alpha = 0.72f), fontSize = 16.sp)
                                }
                            }
                        }
                        // 가로 2열에서 홀수 개면 빈 자리를 채워 타일 폭을 맞춘다.
                        if (row.size == 1 && wide) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/** G2 — 메뉴. 체크인이 크고, 미리 등록 · 안내가 작다. 가로면 체크인 왼쪽 · 둘은 오른쪽. */
@Composable
fun MenuScreen(language: String, onBack: () -> Unit, onLanguage: () -> Unit, onPick: (String) -> Unit) {
    val name = LANGS.firstOrNull { it.code == language }?.name ?: language
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth > maxHeight
        ScrollPage {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                OutlineButton(str(R.string.back), onClick = onBack)
                Spacer(Modifier.weight(1f))
                OutlineButton(name, onClick = onLanguage)
            }
            Spacer(Modifier.height(if (wide) 32.dp else 48.dp))
            Text(str(R.string.menu_title), color = G.Text, fontSize = 40.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(if (wide) 24.dp else 32.dp))
            if (wide) {
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    CheckinTile(Modifier.weight(1.4f).fillMaxHeight(), minHeight = 454.dp) { onPick("checkin") }
                    Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        SmallTile(G.Sage, str(R.string.menu_prereg), str(R.string.menu_prereg_body), Modifier.fillMaxWidth().weight(1f)) { onPick("prereg") }
                        SmallTile(G.Sky, str(R.string.menu_guide), str(R.string.menu_guide_body), Modifier.fillMaxWidth().weight(1f)) { onPick("guide") }
                    }
                }
            } else {
                CheckinTile(Modifier.fillMaxWidth(), minHeight = 500.dp) { onPick("checkin") }
                Spacer(Modifier.height(14.dp))
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    SmallTile(G.Sage, str(R.string.menu_prereg), str(R.string.menu_prereg_body), Modifier.weight(1f).fillMaxHeight()) { onPick("prereg") }
                    SmallTile(G.Sky, str(R.string.menu_guide), str(R.string.menu_guide_body), Modifier.weight(1f).fillMaxHeight()) { onPick("guide") }
                }
            }
        }
    }
}

@Composable
private fun CheckinTile(modifier: Modifier, minHeight: androidx.compose.ui.unit.Dp, onClick: () -> Unit) {
    Tile(G.Sand, minHeight = minHeight, modifier = modifier, onClick = onClick) {
        Column {
            Text(str(R.string.menu_checkin), color = G.Ink, fontSize = 56.sp, fontWeight = FontWeight.Medium, lineHeight = 62.sp)
            Spacer(Modifier.height(12.dp))
            Text(str(R.string.menu_checkin_body), color = G.Ink.copy(alpha = 0.75f), fontSize = 19.sp)
        }
        Spacer(Modifier.height(24.dp))
        Box(Modifier.background(G.Ink, Radius).padding(horizontal = 32.dp, vertical = 18.dp)) {
            Text(str(R.string.menu_start), color = G.Text, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun SmallTile(color: Color, title: String, body: String, modifier: Modifier, onClick: () -> Unit) {
    Tile(color, minHeight = 220.dp, modifier = modifier, onClick = onClick) {
        Column {
            Text(title, color = G.Ink, fontSize = 26.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(10.dp))
            Text(body, color = G.Ink.copy(alpha = 0.75f), fontSize = 16.sp)
        }
    }
}

/** 아직 안 지은 화면 자리. */
@Composable
fun ComingNextScreen(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().then(GUTTER)) {
        OutlineButton(str(R.string.back), onClick = onBack)
        Spacer(Modifier.weight(1f))
        Text(str(R.string.coming_next), color = G.Muted, fontSize = 22.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
        Spacer(Modifier.weight(1f))
    }
}
