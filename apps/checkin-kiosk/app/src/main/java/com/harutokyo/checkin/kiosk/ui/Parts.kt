package com.harutokyo.checkin.kiosk.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

val Radius = RoundedCornerShape(6.dp)

/** STAY ARI 표지(시안 G 왼쪽 위). 5초 누르고 있으면 직원 해제(FR-K18). */
@Composable
fun Logo(onHold: () -> Unit) {
    Canvas(
        Modifier
            .size(width = 30.dp, height = 35.dp)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    val released = withTimeoutOrNull(HOLD_MS) { waitForUpOrCancellation() }
                    if (released == null) onHold()
                }
            },
    ) {
        val sx = size.width / 60f
        val sy = size.height / 70f
        val flag = Path().apply {
            moveTo(0f, 0f); lineTo(60 * sx, 0f); lineTo(60 * sx, 50 * sy); lineTo(30 * sx, 30 * sy); lineTo(0f, 50 * sy); close()
        }
        drawPath(flag, G.Text)
        for ((x, y) in listOf(23 to 50, 32 to 50, 23 to 59, 32 to 59)) {
            drawRect(G.Text, Offset(x * sx, y * sy), Size(7 * sx, 7 * sy))
        }
    }
}

private const val HOLD_MS = 5_000L

/** 도쿄 시각(시안 G 오른쪽 위). */
@Composable
fun Clock() {
    var now by remember { mutableStateOf(ZonedDateTime.now(TOKYO)) }
    LaunchedEffect(Unit) {
        while (true) {
            now = ZonedDateTime.now(TOKYO)
            delay(20_000)
        }
    }
    Text(now.format(DateTimeFormatter.ofPattern("HH:mm")), color = G.Muted, fontSize = 13.sp, letterSpacing = 0.8.sp)
}

private val TOKYO: ZoneId = ZoneId.of("Asia/Tokyo")

/** 큰 흰 버튼(시안 .g-btn). */
@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier
            .sizeIn(minWidth = 300.dp, minHeight = 80.dp)
            .background(if (enabled) G.Text else G.Line, Radius)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 40.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (enabled) G.Ink else G.Muted, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** 테두리만 있는 버튼(시안 .g-call · .g-back). */
@Composable
fun OutlineButton(text: String, modifier: Modifier = Modifier, sub: String? = null, onClick: () -> Unit) {
    Row(
        modifier
            .heightIn(min = if (sub == null) 64.dp else 72.dp)
            .border(BorderStroke(1.dp, G.LineStrong), Radius)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 24.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text(text, color = G.Text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
            if (sub != null) Text(sub, color = G.Muted, fontSize = 13.sp)
        }
    }
}

/** 색 타일(시안 .tile). 높이는 최소값 — 글자를 키워도 잘리지 않고 늘어난다. 안은 위 · 아래로 벌린다. */
@Composable
fun Tile(
    color: Color,
    minHeight: Dp,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .heightIn(min = minHeight)
            .background(color, Radius)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 28.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.SpaceBetween,
        content = content,
    )
}

/** 되돌릴 수 없는 일 단추(테두리 · 글자 빨강). */
@Composable
fun DangerButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 64.dp)
            .border(BorderStroke(1.dp, G.Error), Radius)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(text, color = G.Error, fontSize = 17.sp, fontWeight = FontWeight.Medium)
    }
}
