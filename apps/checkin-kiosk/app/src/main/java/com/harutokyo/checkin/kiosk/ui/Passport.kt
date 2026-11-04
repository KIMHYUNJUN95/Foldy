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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.camera.Captured
import com.harutokyo.checkin.kiosk.camera.PassportPreview
import com.harutokyo.checkin.kiosk.camera.PassportScanner
import com.harutokyo.checkin.kiosk.camera.ScanPhase
import com.harutokyo.checkin.kiosk.camera.ScanUpdate
import com.harutokyo.checkin.kiosk.contract.NoPassport
import com.harutokyo.checkin.kiosk.contract.RouteValue
import kotlinx.coroutines.launch

// 시안 T3x(못 읽음) · T3n(여권 없음) · T3c(확인) — 빠른 체크인(ui/FastFlow.kt)이 가져다 쓰는 조각들과 여권 카메라 칸.

internal val Edge = Color(0xFF3A4030)

/** 위 줄 아래 「묵는 분 1 / 3」. */
@Composable
internal fun Who(text: String) {
    Text(text, color = G.Sand, fontSize = 17.sp, fontWeight = FontWeight.Medium)
    Spacer(Modifier.height(14.dp))
}

/**
 * 여권 카메라 칸(F1 · F3 공용). 같은 번호가 이어서 읽히면 저절로 찍고(scanner), 틀 · 진행 막대를 그린다.
 * 카메라 권한은 여기서 묻는다. 못 쓰면 onUnavailable. scanner 는 부르는 쪽이 만들고 닫는다(수동 셔터가 같은 scanner 를 쓴다).
 */
@Composable
internal fun PassportCamera(scanner: PassportScanner, height: Dp, onCaptured: (Captured) -> Unit, onUnavailable: () -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        if (!ok) onUnavailable()
    }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }
    var update by remember { mutableStateOf(ScanUpdate(ScanPhase.Starting)) }
    val holding = update.phase == ScanPhase.Holding || update.phase == ScanPhase.Capturing
    val bracket by animateColorAsState(if (holding) G.Sage else G.Text, tween(150), label = "bracket")
    val progress by animateFloatAsState(if (holding) update.progress else 0f, tween(if (holding) 120 else 200), label = "progress")
    Box(Modifier.fillMaxWidth().height(height).background(Color.Black, Radius)) {
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
}

@Composable
internal fun Photo(jpeg: ByteArray?, modifier: Modifier) {
    val bitmap = remember(jpeg) { jpeg?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() } }
    Box(modifier.background(G.Surface, Radius)) {
        if (bitmap != null) Image(bitmap, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
    }
}

/** T3x — 여권을 읽지 못했어요. 두 번째부터는 직접 입력이 큰 버튼. */
@Composable
internal fun FailedScreen(who: String, photo: ByteArray?, second: Boolean, onBack: () -> Unit, onRetake: () -> Unit, onType: () -> Unit) {
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
internal fun NoPassportScreen(who: String, cameraOff: Boolean, proofNotice: Boolean, onBack: () -> Unit, onCall: () -> Unit, onPick: (NoPassport) -> Unit) {
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
        if (proofNotice) {
            Spacer(Modifier.height(24.dp))
            Column(Modifier.fillMaxWidth().background(G.Sand.copy(alpha = 0.14f), Radius).border(BorderStroke(1.dp, G.Sand), Radius).padding(20.dp)) {
                Text(str(R.string.nopass_proof_notice), color = G.Sand, fontSize = 18.sp, lineHeight = 27.sp)
                Spacer(Modifier.height(16.dp))
                StaffCallBlock(onCall)
            }
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
internal fun ConfirmScreen(
    key: String,
    who: String,
    mode: FormMode,
    mrzValid: Boolean?,
    initial: PersonDraft,
    askAddress: Boolean,
    askContact: Boolean,
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
        val empty = requiredMissing(draft, mode, askAddress, askContact)
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
        }
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Bottom) {
            Field(str(R.string.field_age), draft.age, "age" in bad, Modifier.weight(1f), hint = str(R.string.field_age_hint), max = 3, number = true) {
                update(draft.copy(age = it.filter(Char::isDigit)))
            }
            Column(Modifier.weight(1f)) {
                Text(str(R.string.field_gender), color = if ("gender" in bad) G.Error else G.Muted, fontSize = 16.sp)
                Spacer(Modifier.height(10.dp))
                Segmented(
                    str(R.string.gender_male), str(R.string.gender_female), rightOn = draft.gender == "female",
                ) { female -> update(draft.copy(gender = if (female) "female" else "male")) }
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
        if (askContact) {
            Spacer(Modifier.height(18.dp))
            Field(str(R.string.field_contact), draft.contact, "contact" in bad, Modifier.fillMaxWidth(), hint = str(R.string.field_contact_hint), max = 120, plain = true) {
                update(draft.copy(contact = it))
            }
        }
    }
}

/** 고칠 수 있는 칸(시안 .g-in). 빨간 테두리 = 비었거나 틀림. */
@Composable
internal fun Field(
    label: String,
    value: String,
    bad: Boolean,
    modifier: Modifier,
    hint: String? = null,
    max: Int = 60,
    number: Boolean = false,
    single: Boolean = true,
    plain: Boolean = false,
    /** 라벨 오른쪽 작은 표시(예: 「예약에서」). */
    tag: String? = null,
    onChange: (String) -> Unit,
) {
    Column(modifier) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = if (bad) G.Error else G.Muted, fontSize = 16.sp, modifier = Modifier.weight(1f, fill = false))
            if (tag != null) {
                Spacer(Modifier.width(12.dp))
                Text(tag, color = G.Sage, fontSize = 14.sp)
            }
        }
        Spacer(Modifier.height(10.dp))
        BasicTextField(
            value = value,
            onValueChange = { onChange(it.take(max)) },
            singleLine = single,
            textStyle = TextStyle(color = G.Text, fontSize = 24.sp),
            cursorBrush = SolidColor(G.Text),
            keyboardOptions = KeyboardOptions(
                capitalization = if (plain) KeyboardCapitalization.None else if (single) KeyboardCapitalization.Characters else KeyboardCapitalization.Sentences,
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
internal fun TextLink(text: String, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.CenterStart) {
        Text(text, color = G.Muted, fontSize = 16.sp)
    }
}

/** 한 질문의 답 — border(국경) · japan(일본 안, 도시 또는 직접 쓰기). */
internal data class RouteAnswer(val border: Boolean? = null, val city: String? = null, val other: Boolean = false, val text: String = "") {
    fun value(prev: Boolean): String? = when (border) {
        true -> RouteValue.of(prev, border = true, city = null, other = "")
        false -> if (city != null) RouteValue.of(prev, false, city, "") else if (other) RouteValue.of(prev, false, null, text) else null
        null -> null
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun RouteQuestion(
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
internal fun Choice(title: String, sub: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
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
internal fun Chip(text: String, on: Boolean, onClick: () -> Unit) {
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
