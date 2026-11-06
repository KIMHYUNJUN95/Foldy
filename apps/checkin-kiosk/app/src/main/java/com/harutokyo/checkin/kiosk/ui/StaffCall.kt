package com.harutokyo.checkin.kiosk.ui

import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.StartOffsetType
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.call.CallState
import com.harutokyo.checkin.kiosk.call.FailKind
import io.livekit.android.renderer.TextureViewRenderer
import kotlinx.coroutines.delay

// 직원 통화 화면 E1 부르는 중 · E2 통화 중 · E3 받는 직원 없음 / 연결 실패(46 §6, 시안 「재수정 · 직원 통화」).
// 원칙: 직원 얼굴은 어떤 경우에도 그리지 않는다 — E2 는 손님 자신의 카메라뿐. 어떤 실패도 E3 → 뒤로 = 누른 자리.

private val EaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)

/**
 * 통화 화면 하나. [state] 가 Idle 이면 권한을 묻는 짧은 동안이므로 E1 을 그린다.
 * [video] 는 E2 에 채울 손님 카메라(LiveKit 이 붙이는 칸).
 */
@Composable
fun StaffCallFlow(
    state: CallState,
    contacts: Map<String, String>,
    video: @Composable (Modifier) -> Unit,
    onCancel: () -> Unit,
    onHangUp: () -> Unit,
    onBack: () -> Unit,
    onRetry: () -> Unit,
) {
    when (state) {
        is CallState.Connected -> TalkingScreen(since = state.since, video = video, onHangUp = onHangUp)
        is CallState.Failed -> NoAnswerScreen(kind = state.kind, contacts = contacts, onBack = onBack, onRetry = onRetry)
        else -> RingingScreen(onCancel = onCancel)
    }
}

/** 시스템 애니메이션 끔(개발자 옵션 · 접근성 「동작 줄이기」)이면 움직임을 멈춘다. */
@Composable
private fun reduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

/** 눌렀을 때 .97 로 작아졌다 돌아오는 단추 바탕(120ms). */
@Composable
private fun CallButton(
    text: String,
    modifier: Modifier = Modifier,
    fill: Color? = null,
    textColor: Color = G.Text,
    onClick: () -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, tween(120, easing = EaseOut), label = "press")
    Box(
        modifier
            .scale(scale)
            .heightIn(min = 80.dp)
            .then(if (fill != null) Modifier.background(fill, Radius) else Modifier.border(BorderStroke(1.dp, G.LineStrong), Radius))
            .clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = textColor, fontSize = 20.sp, fontWeight = if (fill != null) FontWeight.SemiBold else FontWeight.Medium, textAlign = TextAlign.Center)
    }
}

/** E1 — 원 하나가 2초 간격으로 퍼진다. */
@Composable
private fun RingingScreen(onCancel: () -> Unit) {
    val still = reduceMotion()
    ScrollPage(bottom = {
        Column {
            Text(str(R.string.calling_note), color = G.Muted, fontSize = 21.sp, lineHeight = 31.sp)
            Spacer(Modifier.height(28.dp))
            CallButton(str(R.string.cancel), Modifier.fillMaxWidth(), onClick = onCancel)
        }
    }) {
        Spacer(Modifier.height(48.dp))
        Text(str(R.string.calling_title), color = G.Text, fontSize = 44.sp, fontWeight = FontWeight.Medium, lineHeight = 52.sp)
        Box(Modifier.fillMaxWidth().heightIn(min = 420.dp), contentAlignment = Alignment.Center) { Orb(still) }
    }
}

@Composable
private fun Orb(still: Boolean) {
    val transition = rememberInfiniteTransition(label = "ring")
    // 퍼지는 테두리 둘이 1초 어긋나게 — 한 번에 하나만 보인다. 가장 큰 크기에서 투명해진다.
    val a by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(2000, easing = EaseOut), RepeatMode.Restart), label = "a")
    val b by transition.animateFloat(
        0f, 1f,
        infiniteRepeatable(tween(2000, easing = EaseOut), RepeatMode.Restart, StartOffset(1000, StartOffsetType.FastForward)),
        label = "b",
    )
    Box(Modifier.size(300.dp), contentAlignment = Alignment.Center) {
        for (phase in listOf(a, b)) {
            val p = if (still) 0.25f else phase
            Box(
                Modifier
                    .size(168.dp)
                    .scale(1f + 0.7f * p)
                    .alpha(if (still) 0.25f else 0.45f * (1f - p))
                    .border(BorderStroke(1.5.dp, G.Sand), CircleShape),
            )
        }
        Box(Modifier.size(168.dp).background(G.Surface, CircleShape), contentAlignment = Alignment.Center) { PhoneGlyph() }
    }
}

@Composable
private fun PhoneGlyph() {
    Canvas(Modifier.size(56.dp)) {
        val s = size.width / 24f
        val path = Path().apply {
            // 수화기 윤곽(24 격자) — 가운데 약간 안쪽으로 휜 곡선 + 양 끝 귀 · 입.
            moveTo(5.2f * s, 4f * s)
            lineTo(8.6f * s, 3.6f * s)
            lineTo(10.2f * s, 7.8f * s)
            lineTo(8.2f * s, 9.4f * s)
            cubicTo(9.2f * s, 11.6f * s, 12.4f * s, 14.8f * s, 14.6f * s, 15.8f * s)
            lineTo(16.2f * s, 13.8f * s)
            lineTo(20.4f * s, 15.4f * s)
            lineTo(20f * s, 18.8f * s)
            cubicTo(19.8f * s, 19.8f * s, 19f * s, 20.4f * s, 18f * s, 20.4f * s)
            cubicTo(10.8f * s, 20f * s, 4f * s, 13.2f * s, 3.6f * s, 6f * s)
            cubicTo(3.6f * s, 5f * s, 4.2f * s, 4.2f * s, 5.2f * s, 4f * s)
            close()
        }
        drawPath(path, G.Sand, style = Stroke(width = 1.4f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** E2 — 손님 카메라가 화면 가득. 위에 「직원과 통화 중」 · 시간, 아래에 「통화 끝내기」. */
@Composable
private fun TalkingScreen(since: Long, video: @Composable (Modifier) -> Unit, onHangUp: () -> Unit) {
    var elapsed by remember { mutableLongStateOf(0L) }
    LaunchedEffect(since) {
        while (true) {
            elapsed = (android.os.SystemClock.elapsedRealtime() - since) / 1000
            delay(1000)
        }
    }
    Box(Modifier.fillMaxSize().background(G.Surface)) {
        video(Modifier.fillMaxSize())
        Column(
            Modifier.align(Alignment.TopCenter).fillMaxWidth()
                // 밝은 영상 위에서도 제목 · 시간이 읽히게 글자 높이까지는 거의 불투명(제목 대비 6:1 이상), 아래 끝에서만 풀린다.
                .background(Brush.verticalGradient(0f to Color(0xEB0D0E10), 0.78f to Color(0xE60D0E10), 1f to Color.Transparent))
                .padding(start = 64.dp, end = 64.dp, top = 52.dp, bottom = 56.dp),
        ) {
            Text(str(R.string.talking_title), color = G.Text, fontSize = 40.sp, fontWeight = FontWeight.Medium, lineHeight = 46.sp)
            Spacer(Modifier.height(8.dp))
            Text(clock(elapsed), color = G.Text, fontSize = 22.sp, fontFamily = FontFamily.Monospace)
        }
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xD10D0E10))))
                .padding(start = 64.dp, end = 64.dp, top = 96.dp, bottom = 44.dp),
        ) {
            CallButton(str(R.string.talking_end), Modifier.fillMaxWidth(), fill = G.Error, textColor = G.Ink, onClick = onHangUp)
        }
    }
}

internal fun clock(seconds: Long): String {
    val s = seconds.coerceAtLeast(0)
    return "%02d:%02d".format(s / 60, s % 60)
}

/** E3 — 아무도 안 받음 / 연결하지 못함. 연락처 + 뒤로 · 다시 부르기. 연락처가 비어 있어도 말이 되게. */
@Composable
private fun NoAnswerScreen(kind: FailKind, contacts: Map<String, String>, onBack: () -> Unit, onRetry: () -> Unit) {
    val rows = contactRows(contacts)
    ScrollPage(bottom = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            CallButton(str(R.string.back), Modifier.width(200.dp), onClick = onBack)
            CallButton(str(R.string.call_again), Modifier.weight(1f), fill = G.Text, textColor = G.Ink, onClick = onRetry)
        }
    }) {
        Spacer(Modifier.height(48.dp))
        Heading(
            str(if (kind == FailKind.NoAnswer) R.string.call_nobody_title else R.string.call_failed_title),
            str(if (rows.isEmpty()) R.string.call_retry_hint_none else R.string.call_retry_hint),
        )
        Spacer(Modifier.height(40.dp))
        ContactRows(rows)
    }
}

/** 영상 칸 — LiveKit 이 손님 카메라를 그리는 TextureViewRenderer. */
@Composable
fun GuestCameraView(modifier: Modifier, attach: (TextureViewRenderer) -> Unit, detach: (TextureViewRenderer) -> Unit) {
    AndroidView(
        factory = { context -> TextureViewRenderer(context).also(attach) },
        modifier = modifier,
        // 오래 켜 두는 기기 — 화면을 떠날 때 그리기 면(GL)까지 풀어 누수가 쌓이지 않게.
        onRelease = { view ->
            detach(view)
            runCatching { view.release() }
        },
    )
}
