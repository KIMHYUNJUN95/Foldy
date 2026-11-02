package com.harutokyo.checkin.kiosk.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.camera.Captured
import com.harutokyo.checkin.kiosk.camera.PassportPreview
import com.harutokyo.checkin.kiosk.camera.PassportScanner
import com.harutokyo.checkin.kiosk.camera.ScanPhase
import com.harutokyo.checkin.kiosk.camera.ScanUpdate
import com.harutokyo.checkin.kiosk.contract.GuestInput
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.NoPassport
import com.harutokyo.checkin.kiosk.contract.RouteValue
import com.harutokyo.checkin.kiosk.contract.SaveResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 시안 T3a(안내) · T3(카메라) · T3r(읽는 중) · T3c(확인) · T3x(못 읽음) · T3n(여권 없음) · T3s(어디서 · 어디로).
// 한 분씩: 안내(첫 분만) → 카메라 → 읽는 중 → 확인 → 저장 → 사진 올리기 → 다음 분. 다 되면 대표자에게 T3s, 끝나면 onDone.
// 움직임은 짧게: 하얀 번쩍임 없음 · 모서리 색 150ms · 진행 막대 비우기 200ms(시안 메모).

private enum class Step { Intro, Camera, Reading, Confirm, Failed, NoPassport, Route }

private val Edge = Color(0xFF3A4030)

@Composable
fun PassportFlow(
    stay: KioskStay,
    onSave: suspend (GuestInput) -> SaveResult,
    onUpload: suspend (String, ByteArray) -> SaveResult,
    onRoute: suspend (String, String) -> SaveResult,
    onStay: (KioskStay) -> Unit,
    onSessionGone: () -> Unit,
    onBack: () -> Unit,
    onCall: () -> Unit,
    onDone: () -> Unit,
) {
    var done by remember { mutableStateOf(emptySet<String>()) }
    var step by remember { mutableStateOf(Step.Intro) }
    var captured by remember { mutableStateOf<Captured?>(null) }
    var failures by remember { mutableIntStateOf(0) }
    var mode by remember { mutableStateOf(FormMode.Mrz) }
    var reason by remember { mutableStateOf<NoPassport?>(null) }
    // 저장은 됐는데 사진 올리기만 못 했을 때 — 다시 누르면 같은 분을 고친다.
    var savedId by remember { mutableStateOf<String?>(null) }

    val seat = nextSeat(stay, done)
    val seats = maxOf(stay.partySize, stay.guests.size)
    LaunchedEffect(seat) {
        if (seat == null) {
            if (needsRoute(stay)) step = Step.Route else onDone()
        }
    }
    if (seat == null && step != Step.Route) return
    val guest = seat?.let { stay.guests.getOrNull(it) }
    val representative = stay.guests.firstOrNull { it.isRepresentative }
    val isRepresentative = guest?.isRepresentative == true || (representative == null && seat == 0)
    val who = str(R.string.passport_who, (seat ?: 0) + 1, seats)

    val startOver = {
        captured = null
        failures = 0
        reason = null
        savedId = null
        mode = FormMode.Mrz
    }
    val next: (KioskStay, String?) -> Unit = { updated, id ->
        if (id != null) done = done + id
        startOver()
        onStay(updated)
        step = Step.Camera
    }

    when (step) {
        Step.Intro -> IntroScreen(
            who = who,
            onBack = onBack,
            onCall = onCall,
            onNone = { step = Step.NoPassport },
            onCamera = { step = Step.Camera },
        )
        Step.Camera -> CameraScreen(
            who = who,
            onBack = onBack,
            onType = {
                mode = FormMode.Manual
                step = Step.Confirm
            },
            onUnavailable = {
                reason = NoPassport.CameraOff
                step = Step.NoPassport
            },
            onCaptured = {
                captured = it
                step = Step.Reading
            },
        )
        Step.Reading -> ReadingScreen(
            who = who,
            photo = captured?.jpeg,
            read = captured?.mrz != null,
            onFinished = {
                if (captured?.mrz != null) {
                    mode = FormMode.Mrz
                    step = Step.Confirm
                } else {
                    failures += 1
                    step = Step.Failed
                }
            },
        )
        Step.Failed -> FailedScreen(
            who = who,
            photo = captured?.jpeg,
            second = failures >= 2,
            onBack = onBack,
            onRetake = {
                captured = null
                step = Step.Camera
            },
            onType = {
                mode = FormMode.Manual
                step = Step.Confirm
            },
        )
        Step.NoPassport -> NoPassportScreen(
            who = who,
            cameraOff = reason == NoPassport.CameraOff,
            onBack = { step = Step.Camera },
            onCall = onCall,
            onPick = { picked ->
                reason = picked
                captured = null
                mode = when (picked) {
                    NoPassport.Child -> FormMode.Child
                    NoPassport.JapanResident -> FormMode.Resident
                    NoPassport.NotShown, NoPassport.CameraOff -> FormMode.Staff
                }
                step = Step.Confirm
            },
        )
        Step.Confirm -> {
            val askAddress = isRepresentative || mode == FormMode.Resident
            ConfirmScreen(
                key = "${seat}-${mode}-${captured?.mrz?.raw}",
                who = who,
                mode = mode,
                mrzValid = captured?.mrz?.valid,
                initial = captured?.mrz?.let { draftOf(it, if (isRepresentative) representative?.address ?: guest?.address else null) }
                    ?: PersonDraft(address = if (isRepresentative) guest?.address.orEmpty() else ""),
                askAddress = askAddress,
                representativeName = if (!isRepresentative && mode != FormMode.Resident) representative?.name else null,
                last = seat == seats - 1 && !needsRoute(stay),
                canRetake = mode == FormMode.Mrz || mode == FormMode.Manual,
                onBack = onBack,
                onRetake = {
                    captured = null
                    step = Step.Camera
                },
                onSubmit = { draft ->
                    val input = guestInputOf(guest, draft, mode, reason, captured?.mrz, askAddress).let { if (savedId != null) it.copy(id = savedId) else it }
                    when (val saved = onSave(input)) {
                        is SaveResult.Saved -> {
                            val id = saved.guestId ?: input.id
                            val photo = captured?.jpeg
                            if (photo != null && id != null && (mode == FormMode.Mrz || mode == FormMode.Manual)) {
                                savedId = id
                                when (val uploaded = onUpload(id, photo)) {
                                    is SaveResult.Saved -> {
                                        next(uploaded.stay, id)
                                        null
                                    }
                                    SaveResult.SessionGone -> {
                                        onSessionGone()
                                        null
                                    }
                                    else -> {
                                        onStay(saved.stay)
                                        emptyList()
                                    }
                                }
                            } else {
                                next(saved.stay, id)
                                null
                            }
                        }
                        is SaveResult.Invalid -> saved.fields.ifEmpty { listOf("") }
                        SaveResult.SessionGone -> {
                            onSessionGone()
                            null
                        }
                        SaveResult.Failed -> emptyList()
                    }
                },
            )
        }
        Step.Route -> RouteScreen(
            onBack = onBack,
            onCall = onCall,
            onSubmit = { prev, nextDest ->
                when (val saved = onRoute(prev, nextDest)) {
                    is SaveResult.Saved -> {
                        onStay(saved.stay)
                        onDone()
                        true
                    }
                    SaveResult.SessionGone -> {
                        onSessionGone()
                        true
                    }
                    else -> false
                }
            },
        )
    }
}

/** 위 줄 아래 「묵는 분 1 / 3」. */
@Composable
private fun Who(text: String) {
    Text(text, color = G.Sand, fontSize = 17.sp, fontWeight = FontWeight.Medium)
    Spacer(Modifier.height(14.dp))
}

/** T3a — 여권 사진 면을 찍을게요. */
@Composable
private fun IntroScreen(who: String, onBack: () -> Unit, onCall: () -> Unit, onNone: () -> Unit, onCamera: () -> Unit) {
    ScrollPage(bottom = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            OutlineButton(str(R.string.passport_none), onClick = onNone)
            Spacer(Modifier.weight(1f))
            PrimaryButton(str(R.string.passport_camera_on), onClick = onCamera)
        }
    }) {
        StepTop(3, onBack)
        Spacer(Modifier.height(40.dp))
        Who(who)
        Heading(str(R.string.passport_intro_title), str(R.string.passport_intro_body))
        Spacer(Modifier.height(36.dp))
        PassportPicture(Modifier.fillMaxWidth().height(300.dp))
        Spacer(Modifier.height(12.dp))
        Text(str(R.string.passport_intro_mrz), color = G.Sage, fontSize = 16.sp)
        Spacer(Modifier.height(28.dp))
        for ((index, tip) in listOf(R.string.passport_tip_open, R.string.passport_tip_lines, R.string.passport_tip_glare).withIndex()) {
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.Top) {
                Text((index + 1).toString(), color = G.Muted, fontSize = 17.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.width(36.dp))
                Text(str(tip), color = G.Text, fontSize = 20.sp, lineHeight = 28.sp)
            }
        }
        Spacer(Modifier.height(24.dp))
        Text(str(R.string.passport_retention), color = G.Muted, fontSize = 15.sp, lineHeight = 22.sp)
        Spacer(Modifier.height(12.dp))
        TextLink(str(R.string.staff_call), onCall)
    }
}

/** 여권 사진 면 그림(사진 칸 · 글 줄 · 아래 두 줄 강조). */
@Composable
private fun PassportPicture(modifier: Modifier) {
    Canvas(modifier.background(G.Surface, Radius)) {
        val w = size.width
        val h = size.height
        val page = androidx.compose.ui.geometry.Size(minOf(w * 0.7f, h * 1.42f), h * 0.84f)
        val left = (w - page.width) / 2
        val top = (h - page.height) / 2
        drawRoundRect(G.LineStrong, Offset(left, top), page, androidx.compose.ui.geometry.CornerRadius(8f), style = Stroke(2f))
        drawRoundRect(G.Line, Offset(left + page.width * 0.05f, top + page.height * 0.12f), androidx.compose.ui.geometry.Size(page.width * 0.24f, page.height * 0.5f), androidx.compose.ui.geometry.CornerRadius(6f))
        for (line in 0 until 5) {
            val y = top + page.height * (0.16f + line * 0.1f)
            drawLine(G.Line, Offset(left + page.width * 0.36f, y), Offset(left + page.width * (0.92f - line * 0.06f), y), 6f, StrokeCap.Round)
        }
        for (line in 0 until 2) {
            val y = top + page.height * (0.78f + line * 0.1f)
            drawLine(G.Sage, Offset(left + page.width * 0.05f, y), Offset(left + page.width * 0.95f, y), 7f, StrokeCap.Round)
        }
    }
}

/** T3 — 카메라. 같은 번호가 이어서 읽히면 저절로 찍고, 8초 안에 못 찍으면 「직접 찍기」를 보인다. */
@Composable
private fun CameraScreen(who: String, onBack: () -> Unit, onType: () -> Unit, onUnavailable: () -> Unit, onCaptured: (Captured) -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        if (!ok) onUnavailable()
    }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }
    val scanner = remember { PassportScanner() }
    DisposableEffect(Unit) { onDispose { scanner.close() } }
    var update by remember { mutableStateOf(ScanUpdate(ScanPhase.Starting)) }
    var shutter by remember { mutableStateOf(false) }
    var shooting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(granted) {
        if (!granted) return@LaunchedEffect
        delay(8_000)
        shutter = true
    }
    val holding = update.phase == ScanPhase.Holding || update.phase == ScanPhase.Capturing
    val bracket by animateColorAsState(if (holding) G.Sage else G.Text, tween(150), label = "bracket")
    val progress by animateFloatAsState(if (holding) update.progress else 0f, tween(if (holding) 120 else 200), label = "progress")

    ScrollPage(bottom = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            OutlineButton(str(R.string.camera_type), onClick = onType)
            Spacer(Modifier.weight(1f))
            if (shutter) {
                PrimaryButton(str(R.string.camera_shutter), enabled = !shooting) {
                    shooting = true
                    scope.launch {
                        val shot = scanner.shoot()
                        shooting = false
                        if (shot != null) onCaptured(shot)
                    }
                }
            }
        }
    }) {
        StepTop(3, onBack)
        Spacer(Modifier.height(32.dp))
        Who(who)
        Heading(str(R.string.camera_title), str(R.string.camera_body))
        Spacer(Modifier.height(28.dp))
        Box(Modifier.fillMaxWidth().height(680.dp).background(Color.Black, Radius)) {
            if (granted) {
                PassportPreview(
                    scanner = scanner,
                    modifier = Modifier.fillMaxSize(),
                    onUpdate = { update = it },
                    onCaptured = onCaptured,
                    onUnavailable = onUnavailable,
                )
            }
            Text(
                "↑ " + str(R.string.camera_up),
                color = G.Muted, fontSize = 15.sp,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 16.dp),
            )
            // 여권 틀 — 네 모서리 · 아래 두 줄 자리.
            Canvas(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 96.dp)) {
                val len = 56f
                val stroke = 6f
                val w = size.width
                val h = size.height
                for ((x, y, dx, dy) in listOf(
                    listOf(0f, 0f, 1f, 1f), listOf(w, 0f, -1f, 1f), listOf(0f, h, 1f, -1f), listOf(w, h, -1f, -1f),
                )) {
                    drawLine(bracket, Offset(x, y), Offset(x + dx * len, y), stroke, StrokeCap.Round)
                    drawLine(bracket, Offset(x, y), Offset(x, y + dy * len), stroke, StrokeCap.Round)
                }
                val band = h * 0.78f
                drawRoundRect(
                    bracket.copy(alpha = 0.5f), Offset(w * 0.04f, band), androidx.compose.ui.geometry.Size(w * 0.92f, h * 0.17f),
                    androidx.compose.ui.geometry.CornerRadius(8f), style = Stroke(2f),
                )
            }
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 32.dp, vertical = 22.dp)) {
                Text(
                    str(if (holding) R.string.camera_hold else R.string.camera_find),
                    color = if (holding) G.Sage else G.Text, fontSize = 20.sp, fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.height(10.dp))
                Box(Modifier.fillMaxWidth().height(4.dp).background(G.Line, Radius)) {
                    Box(Modifier.fillMaxWidth(progress).height(4.dp).background(G.Sage, Radius))
                }
            }
        }
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for (tip in listOf(R.string.camera_short_open, R.string.camera_short_lines, R.string.camera_short_glare)) {
                Box(Modifier.border(BorderStroke(1.dp, G.Line), Radius).padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text(str(tip), color = G.Muted, fontSize = 15.sp)
                }
            }
        }
    }
}

@Composable
private fun Photo(jpeg: ByteArray?, modifier: Modifier) {
    val bitmap = remember(jpeg) { jpeg?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() } }
    Box(modifier.background(G.Surface, Radius)) {
        if (bitmap != null) Image(bitmap, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
    }
}

/** T3r — 찍었어요. 읽는 중(세 줄을 차례로 「읽음」). */
@Composable
private fun ReadingScreen(who: String, photo: ByteArray?, read: Boolean, onFinished: () -> Unit) {
    var shown by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        if (read) {
            repeat(3) {
                delay(260)
                shown = it + 1
            }
            delay(300)
        } else {
            delay(700)
        }
        onFinished()
    }
    ScrollPage {
        Spacer(Modifier.height(80.dp))
        Who(who)
        Heading(str(R.string.reading_title), str(R.string.reading_body))
        Spacer(Modifier.height(32.dp))
        Photo(photo, Modifier.fillMaxWidth().height(500.dp))
        Spacer(Modifier.height(24.dp))
        for ((index, label) in listOf(R.string.reading_name, R.string.reading_number, R.string.reading_rest).withIndex()) {
            val ok = index < shown
            Row(Modifier.fillMaxWidth().heightIn(min = 64.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(str(label), color = G.Text, fontSize = 20.sp, modifier = Modifier.weight(1f))
                Text(str(if (ok) R.string.reading_done else R.string.reading_wait), color = if (ok) G.Sage else G.Muted, fontSize = 17.sp)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(G.Line))
        }
    }
}

/** T3x — 여권을 읽지 못했어요. 두 번째부터는 직접 입력이 큰 버튼. */
@Composable
private fun FailedScreen(who: String, photo: ByteArray?, second: Boolean, onBack: () -> Unit, onRetake: () -> Unit, onType: () -> Unit) {
    ScrollPage(bottom = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            if (second) OutlineButton(str(R.string.retake), onClick = onRetake) else OutlineButton(str(R.string.type_in), onClick = onType)
            Spacer(Modifier.weight(1f))
            if (second) PrimaryButton(str(R.string.type_in), onClick = onType) else PrimaryButton(str(R.string.retake), onClick = onRetake)
        }
    }) {
        StepTop(3, onBack)
        Spacer(Modifier.height(40.dp))
        Who(who)
        Heading(str(R.string.failed_title), str(R.string.failed_body))
        Spacer(Modifier.height(32.dp))
        Photo(photo, Modifier.fillMaxWidth().height(420.dp))
        Spacer(Modifier.height(28.dp))
        for (tip in listOf(R.string.passport_tip_lines, R.string.passport_tip_glare)) {
            Text("· " + str(tip), color = G.Text, fontSize = 19.sp, lineHeight = 28.sp, modifier = Modifier.padding(vertical = 6.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text(str(R.string.failed_hint), color = G.Muted, fontSize = 16.sp, lineHeight = 24.sp)
    }
}

/** T3n — 여권이 없으신가요? */
@Composable
private fun NoPassportScreen(who: String, cameraOff: Boolean, onBack: () -> Unit, onCall: () -> Unit, onPick: (NoPassport) -> Unit) {
    ScrollPage(bottom = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            OutlineButton(str(R.string.staff_call), onClick = onCall)
            Spacer(Modifier.weight(1f))
            if (!cameraOff) OutlineButton(str(R.string.nopass_back), onClick = onBack)
        }
    }) {
        StepTop(3, onBack)
        Spacer(Modifier.height(40.dp))
        Who(who)
        Heading(str(R.string.nopass_title), str(R.string.nopass_body))
        if (cameraOff) {
            Spacer(Modifier.height(16.dp))
            Text(str(R.string.camera_denied), color = G.Sand, fontSize = 17.sp)
        }
        Spacer(Modifier.height(32.dp))
        val options = buildList {
            add(Triple(NoPassport.Child, R.string.nopass_child, R.string.nopass_child_sub))
            add(Triple(NoPassport.JapanResident, R.string.nopass_japan, R.string.nopass_japan_sub))
            add(Triple(NoPassport.NotShown, R.string.nopass_notshown, R.string.nopass_staff_sub))
            add(Triple(NoPassport.CameraOff, R.string.nopass_camera, R.string.nopass_staff_sub))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(G.LineStrong))
        for ((value, title, sub) in options) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 104.dp)
                    .background(if (cameraOff && value == NoPassport.CameraOff) G.Surface else Color.Transparent)
                    .clickable(role = Role.Button) { onPick(value) }
                    .padding(horizontal = 8.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(str(title), color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.height(6.dp))
                    Text(str(sub), color = G.Muted, fontSize = 16.sp)
                }
                Text("›", color = G.Muted, fontSize = 30.sp)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(G.Line))
        }
        Spacer(Modifier.height(24.dp))
        Text(str(R.string.nopass_note), color = G.Muted, fontSize = 15.sp, lineHeight = 22.sp)
    }
}

/** T3c — 여권에서 읽었어요(고칠 수 있는 칸). 저장 결과: null = 넘어감, 빈 목록 = 저장 실패, 칸 목록 = 빨간 칸. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConfirmScreen(
    key: String,
    who: String,
    mode: FormMode,
    mrzValid: Boolean?,
    initial: PersonDraft,
    askAddress: Boolean,
    representativeName: String?,
    last: Boolean,
    canRetake: Boolean,
    onBack: () -> Unit,
    onRetake: () -> Unit,
    onSubmit: suspend (PersonDraft) -> List<String>?,
) {
    var draft by remember(key) { mutableStateOf(initial) }
    var bad by remember(key) { mutableStateOf(emptyList<String>()) }
    var failed by remember(key) { mutableStateOf(false) }
    var saving by remember(key) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val submit = {
        val empty = requiredMissing(draft, mode, askAddress)
        if (empty.isNotEmpty()) {
            bad = empty
            failed = false
        } else if (!saving) {
            saving = true
            scope.launch {
                val result = onSubmit(draft)
                saving = false
                if (result != null) {
                    failed = result.isEmpty()
                    bad = result.filter { it.isNotEmpty() }
                }
            }
        }
    }
    ScrollPage(bottom = {
        Column {
            if (failed || bad.isNotEmpty()) {
                Text(str(if (failed) R.string.save_error else R.string.invalid_fields), color = G.Error, fontSize = 16.sp)
                Spacer(Modifier.height(12.dp))
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                if (canRetake) OutlineButton(str(R.string.retake), Modifier.heightIn(min = 64.dp), onClick = onRetake)
                Spacer(Modifier.weight(1f))
                PrimaryButton(str(if (last) R.string.confirm_done else R.string.confirm_next), enabled = !saving, onClick = submit)
            }
        }
    }) {
        StepTop(3, onBack)
        Spacer(Modifier.height(36.dp))
        Who(who)
        val title = when (mode) {
            FormMode.Mrz -> R.string.confirm_title
            FormMode.Child -> R.string.confirm_child_title
            FormMode.Resident -> R.string.confirm_resident_title
            FormMode.Manual, FormMode.Staff -> R.string.confirm_manual_title
        }
        Heading(str(title), str(if (mode == FormMode.Mrz) R.string.confirm_body else R.string.confirm_manual_body))
        if (mode == FormMode.Mrz && mrzValid != null) {
            Spacer(Modifier.height(20.dp))
            Text(
                if (mrzValid) "✓ " + str(R.string.confirm_checked) else str(R.string.confirm_check_warn),
                color = if (mrzValid) G.Sage else G.Sand, fontSize = 17.sp,
            )
        }
        Spacer(Modifier.height(28.dp))
        val update: (PersonDraft) -> Unit = {
            draft = it
            failed = false
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Field(str(R.string.field_surname), draft.surname, "lastName" in bad, Modifier.weight(1f)) { update(draft.copy(surname = it)) }
            Field(str(R.string.field_given), draft.given, "firstName" in bad, Modifier.weight(1f)) { update(draft.copy(given = it)) }
        }
        if (mode != FormMode.Resident) {
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Field(str(R.string.field_nationality), draft.nationality, "nationality" in bad, Modifier.weight(1f), hint = str(R.string.field_nationality_hint), max = 3) {
                    update(draft.copy(nationality = it.uppercase()))
                }
                if (mode != FormMode.Child) {
                    Field(str(R.string.field_number), draft.number, "passportNumber" in bad, Modifier.weight(1f), max = 12) {
                        update(draft.copy(number = it.uppercase()))
                    }
                } else {
                    Spacer(Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Bottom) {
                Field(str(R.string.field_birth), draft.birth, "birthDate" in bad, Modifier.weight(1f), hint = str(R.string.field_birth_hint), max = 10, number = true) {
                    update(draft.copy(birth = it))
                }
                Column(Modifier.weight(1f)) {
                    Text(str(R.string.field_gender), color = if ("gender" in bad) G.Error else G.Muted, fontSize = 16.sp)
                    Spacer(Modifier.height(10.dp))
                    Segmented(
                        str(R.string.gender_male), str(R.string.gender_female), rightOn = draft.gender == "female",
                    ) { female -> update(draft.copy(gender = if (female) "female" else "male")) }
                }
            }
        }
        if (askAddress) {
            Spacer(Modifier.height(18.dp))
            Field(
                str(if (mode == FormMode.Resident) R.string.field_address_jp else R.string.field_address),
                draft.address, "address" in bad, Modifier.fillMaxWidth(), hint = str(R.string.field_tap), max = 200, single = false,
            ) { update(draft.copy(address = it)) }
        } else if (representativeName != null) {
            Spacer(Modifier.height(24.dp))
            Column(Modifier.fillMaxWidth().border(BorderStroke(1.dp, Edge), Radius).padding(horizontal = 22.dp, vertical = 18.dp)) {
                Text(str(R.string.shared_title), color = G.Text, fontSize = 18.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(6.dp))
                Text(str(R.string.shared_body, representativeName), color = G.Muted, fontSize = 16.sp)
            }
        }
    }
}

/** 고칠 수 있는 칸(시안 .g-in). 빨간 테두리 = 비었거나 틀림. */
@Composable
private fun Field(
    label: String,
    value: String,
    bad: Boolean,
    modifier: Modifier,
    hint: String? = null,
    max: Int = 60,
    number: Boolean = false,
    single: Boolean = true,
    onChange: (String) -> Unit,
) {
    Column(modifier) {
        Text(label, color = if (bad) G.Error else G.Muted, fontSize = 16.sp)
        Spacer(Modifier.height(10.dp))
        BasicTextField(
            value = value,
            onValueChange = { onChange(it.take(max)) },
            singleLine = single,
            textStyle = TextStyle(color = G.Text, fontSize = 24.sp),
            cursorBrush = SolidColor(G.Text),
            keyboardOptions = KeyboardOptions(
                capitalization = if (single) KeyboardCapitalization.Characters else KeyboardCapitalization.Sentences,
                autoCorrectEnabled = false,
                keyboardType = if (number) KeyboardType.Number else KeyboardType.Text,
                imeAction = ImeAction.Next,
            ),
            decorationBox = { inner ->
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 72.dp).background(G.Surface, Radius)
                        .border(BorderStroke(1.dp, if (bad) G.Error else G.Line), Radius).padding(horizontal = 20.dp, vertical = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (value.isEmpty() && hint != null) Text(hint, color = G.Muted, fontSize = 20.sp)
                    inner()
                }
            },
        )
    }
}

@Composable
private fun TextLink(text: String, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.CenterStart) {
        Text(text, color = G.Muted, fontSize = 16.sp)
    }
}

/** T3s — 어디서 오셔서, 어디로 가세요? 두 갈래 + 도시. */
@Composable
private fun RouteScreen(onBack: () -> Unit, onCall: () -> Unit, onSubmit: suspend (String, String) -> Boolean) {
    var prev by remember { mutableStateOf(RouteAnswer()) }
    var nextDest by remember { mutableStateOf(RouteAnswer()) }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val prevValue = prev.value(true)
    val nextValue = nextDest.value(false)
    ScrollPage(bottom = {
        Column {
            if (failed) {
                Text(str(R.string.save_error), color = G.Error, fontSize = 16.sp)
                Spacer(Modifier.height(12.dp))
            }
            BottomRow(onCall, str(R.string.route_next), enabled = prevValue != null && nextValue != null && !saving) {
                if (prevValue != null && nextValue != null) {
                    saving = true
                    scope.launch {
                        failed = !onSubmit(prevValue, nextValue)
                        saving = false
                    }
                }
            }
        }
    }) {
        StepTop(3, onBack)
        Spacer(Modifier.height(40.dp))
        Heading(str(R.string.route_title), str(R.string.route_body))
        Spacer(Modifier.height(36.dp))
        RouteQuestion(
            title = str(R.string.route_q1), sub = str(R.string.route_q1_sub),
            border = str(R.string.route_arrived), borderSub = str(R.string.route_arrived_sub),
            japan = str(R.string.route_japan_prev), answer = prev,
        ) {
            prev = it
            failed = false
        }
        Spacer(Modifier.height(36.dp))
        RouteQuestion(
            title = str(R.string.route_q2), sub = str(R.string.route_q2_sub),
            border = str(R.string.route_leaving), borderSub = str(R.string.route_leaving_sub),
            japan = str(R.string.route_japan_next), answer = nextDest,
        ) {
            nextDest = it
            failed = false
        }
    }
}

/** 한 질문의 답 — border(국경) · japan(일본 안, 도시 또는 직접 쓰기). */
private data class RouteAnswer(val border: Boolean? = null, val city: String? = null, val other: Boolean = false, val text: String = "") {
    fun value(prev: Boolean): String? = when (border) {
        true -> RouteValue.of(prev, border = true, city = null, other = "")
        false -> if (city != null) RouteValue.of(prev, false, city, "") else if (other) RouteValue.of(prev, false, null, text) else null
        null -> null
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RouteQuestion(
    title: String,
    sub: String,
    border: String,
    borderSub: String,
    japan: String,
    answer: RouteAnswer,
    onAnswer: (RouteAnswer) -> Unit,
) {
    Text(title, color = G.Text, fontSize = 26.sp, fontWeight = FontWeight.Medium, lineHeight = 34.sp)
    Spacer(Modifier.height(6.dp))
    Text(sub, color = G.Muted, fontSize = 16.sp)
    Spacer(Modifier.height(16.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Choice(border, borderSub, answer.border == true, Modifier.weight(1f)) { onAnswer(RouteAnswer(border = true)) }
        Choice(japan, str(R.string.route_city_sub), answer.border == false, Modifier.weight(1f)) {
            if (answer.border != false) onAnswer(RouteAnswer(border = false))
        }
    }
    if (answer.border == false) {
        Spacer(Modifier.height(14.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val cities = listOf("tokyo" to R.string.city_tokyo, "osaka" to R.string.city_osaka, "kyoto" to R.string.city_kyoto, "fukuoka" to R.string.city_fukuoka)
            for ((code, label) in cities) {
                Chip(str(label), answer.city == code) { onAnswer(answer.copy(city = code, other = false)) }
            }
            Chip(str(R.string.city_other), answer.other) { onAnswer(answer.copy(city = null, other = true)) }
        }
        if (answer.other) {
            Spacer(Modifier.height(14.dp))
            Field(str(R.string.city_other_hint), answer.text, false, Modifier.fillMaxWidth(), max = RouteValue.TEXT_MAX) {
                onAnswer(answer.copy(text = it))
            }
        }
    }
}

@Composable
private fun Choice(title: String, sub: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.heightIn(min = 104.dp)
            .background(if (on) G.Text else Color.Transparent, Radius)
            .border(BorderStroke(1.dp, if (on) G.Text else G.Line), Radius)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, color = if (on) G.Ink else G.Text, fontSize = 21.sp, fontWeight = FontWeight.Medium, lineHeight = 28.sp)
        Spacer(Modifier.height(4.dp))
        Text(sub, color = if (on) G.LineStrong else G.Muted, fontSize = 15.sp)
    }
}

@Composable
private fun Chip(text: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 60.dp)
            .background(if (on) G.Text else Color.Transparent, Radius)
            .border(BorderStroke(1.dp, if (on) G.Text else G.LineStrong), Radius)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 22.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (on) G.Ink else G.Text, fontSize = 19.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
    }
}
