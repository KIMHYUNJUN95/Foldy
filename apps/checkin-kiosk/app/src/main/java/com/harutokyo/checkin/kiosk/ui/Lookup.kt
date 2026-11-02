package com.harutokyo.checkin.kiosk.ui

import android.text.format.DateFormat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.contract.BlockReason
import com.harutokyo.checkin.kiosk.contract.CodeQuery
import com.harutokyo.checkin.kiosk.contract.FindQuery
import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.NameQuery
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// 예약 찾기 · 명부(시안 T1 · T1k · T1x · T1b · T1c · T2, 캔버스 BCPPdekM… 「태블릿 예약 찾기 · 명부」 줄).
// 체크인 흐름은 5단계 — 찾기(1) · 명부(2) · 여권(3) · 동의(4) · 동영상/완료(5).

private val TOKYO: ZoneId = ZoneId.of("Asia/Tokyo")

fun todayTokyo(): LocalDate = LocalDate.now(TOKYO)

/** 찾기 칸 값 — 「못 찾음」에서 돌아와도 넣은 값이 남게 바깥(KioskRoot)에 둔다. */
data class FindForm(
    val byCode: Boolean = false,
    val lastName: String = "",
    val firstName: String = "",
    /** 오늘에서 며칠 전인지(0 = 오늘, 1 = 어제, 그 밖 = 「다른 날」). 음수 = 앞날. */
    val daysAgo: Int = 0,
    val otherDay: Boolean = false,
    val code: String = "",
) {
    val date: LocalDate get() = todayTokyo().minusDays(daysAgo.toLong())
    val ready: Boolean get() = if (byCode) code.length == 6 else lastName.isNotBlank() && firstName.isNotBlank()
    fun query(): FindQuery =
        if (byCode) CodeQuery(code) else NameQuery(lastName.trim(), firstName.trim(), date.toString())
}

fun parseDate(value: String?): LocalDate? = value?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

/** 「10월 30일 (금)」처럼 그 언어 순서로. */
@Composable
fun shortDate(date: LocalDate): String {
    val locale = LocalConfiguration.current.locales[0]
    val pattern = remember(locale) { DateFormat.getBestDateTimePattern(locale, "MMMdEEE") }
    return date.format(DateTimeFormatter.ofPattern(pattern, locale))
}

/** 위 줄: 뒤로 · 단계 막대 · (언어). */
@Composable
private fun StepTop(step: Int, onBack: () -> Unit, language: String? = null, onLanguage: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        OutlineButton(str(R.string.back), onClick = onBack)
        Spacer(Modifier.weight(1f))
        Row(Modifier.semantics { contentDescription = "$step / 5" }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(5) { index -> Box(Modifier.size(36.dp, 4.dp).background(if (index < step) G.Text else G.Line, Radius)) }
        }
        Spacer(Modifier.weight(1f))
        if (language != null && onLanguage != null) OutlineButton(language, onClick = onLanguage) else Spacer(Modifier.width(1.dp))
    }
}

/** 아래 줄: 직원 호출 · 큰 버튼. */
@Composable
private fun BottomRow(onCall: () -> Unit, primary: String, enabled: Boolean = true, onPrimary: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        OutlineButton(str(R.string.staff_call), onClick = onCall)
        Spacer(Modifier.weight(1f))
        PrimaryButton(primary, enabled = enabled, onClick = onPrimary)
    }
}

@Composable
private fun Heading(title: String, body: String?) {
    Text(title, color = G.Text, fontSize = 48.sp, fontWeight = FontWeight.Medium, lineHeight = 56.sp)
    if (body != null) {
        Spacer(Modifier.height(16.dp))
        Text(body, color = G.Muted, fontSize = 19.sp, lineHeight = 28.sp)
    }
}

/** 둘 중 하나 고르기(시안 .g-seg). */
@Composable
private fun Segmented(left: String, right: String, rightOn: Boolean, onPick: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).border(BorderStroke(1.dp, G.Line), Radius).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for ((label, on) in listOf(left to !rightOn, right to rightOn)) {
            Box(
                Modifier.weight(1f).fillMaxHeight().heightIn(min = 60.dp)
                    .background(if (on) G.Text else Color.Transparent, Radius)
                    .clickable(role = Role.Tab) { onPick(label == right) }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = if (on) G.Ink else G.Muted, fontSize = 18.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}

/** 글자 칸(시안 .g-in). 누르면 시스템 글자판. */
@Composable
private fun NameField(label: String, value: String, modifier: Modifier, last: Boolean, onChange: (String) -> Unit, onDone: () -> Unit) {
    Column(modifier) {
        Text(label, color = G.Muted, fontSize = 16.sp)
        Spacer(Modifier.height(10.dp))
        BasicTextField(
            value = value,
            onValueChange = { onChange(it.take(60)) },
            singleLine = true,
            textStyle = TextStyle(color = G.Text, fontSize = 26.sp),
            cursorBrush = SolidColor(G.Text),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                autoCorrectEnabled = false,
                imeAction = if (last) ImeAction.Search else ImeAction.Next,
            ),
            keyboardActions = KeyboardActions(onSearch = { onDone() }),
            decorationBox = { inner ->
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 76.dp).background(G.Surface, Radius)
                        .border(BorderStroke(1.dp, G.Line), Radius).padding(horizontal = 22.dp, vertical = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) { inner() }
            },
        )
    }
}

/** 날짜 칸 하나(시안 .g-day). */
@Composable
private fun DayChoice(title: String, sub: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.heightIn(min = 84.dp)
            .background(if (on) G.Text else Color.Transparent, Radius)
            .border(BorderStroke(1.dp, if (on) G.Text else G.Line), Radius)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, color = if (on) G.Ink else G.Text, fontSize = 21.sp, fontWeight = FontWeight.Medium)
        Text(sub, color = if (on) G.LineStrong else G.Muted, fontSize = 14.sp)
    }
}

/** T1 · T1k — 예약 찾기. */
@Composable
fun FindScreen(
    form: FindForm,
    languageName: String,
    error: String?,
    onForm: (FindForm) -> Unit,
    onBack: () -> Unit,
    onLanguage: () -> Unit,
    onCall: () -> Unit,
    onSubmit: suspend () -> Unit,
) {
    var working by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val submit: () -> Unit = {
        if (form.ready && !working) {
            working = true
            scope.launch {
                onSubmit()
                working = false
            }
        }
    }
    ScrollPage(bottom = {
        BottomRow(onCall, if (working) str(R.string.find_working) else str(R.string.find_submit), enabled = form.ready && !working, onPrimary = submit)
    }) {
        StepTop(1, onBack, languageName, onLanguage)
        Spacer(Modifier.height(40.dp))
        Heading(str(R.string.find_title), str(if (form.byCode) R.string.find_body_code else R.string.find_body_name))
        Spacer(Modifier.height(32.dp))
        Segmented(str(R.string.find_mode_name), str(R.string.find_mode_code), form.byCode) { onForm(form.copy(byCode = it)) }
        Spacer(Modifier.height(32.dp))
        if (form.byCode) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Digits(form.code, 6) }
            Spacer(Modifier.height(32.dp))
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Keypad(
                    onDigit = { if (form.code.length < 6) onForm(form.copy(code = form.code + it)) },
                    onDelete = { onForm(form.copy(code = form.code.dropLast(1))) },
                )
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                NameField(str(R.string.find_last), form.lastName, Modifier.weight(1f), last = false, onChange = { onForm(form.copy(lastName = it)) }, onDone = submit)
                NameField(str(R.string.find_first), form.firstName, Modifier.weight(1f), last = true, onChange = { onForm(form.copy(firstName = it)) }, onDone = submit)
            }
            Spacer(Modifier.height(28.dp))
            Text(str(R.string.find_date), color = G.Muted, fontSize = 16.sp)
            Spacer(Modifier.height(10.dp))
            val today = todayTokyo()
            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                DayChoice(str(R.string.find_today), shortDate(today), !form.otherDay && form.daysAgo == 0, Modifier.weight(1f).fillMaxHeight()) {
                    onForm(form.copy(daysAgo = 0, otherDay = false))
                }
                DayChoice(str(R.string.find_yesterday), shortDate(today.minusDays(1)), !form.otherDay && form.daysAgo == 1, Modifier.weight(1f).fillMaxHeight()) {
                    onForm(form.copy(daysAgo = 1, otherDay = false))
                }
                DayChoice(str(R.string.find_other), if (form.otherDay) shortDate(form.date) else "…", form.otherDay, Modifier.weight(1f).fillMaxHeight()) {
                    onForm(form.copy(otherDay = true, daysAgo = if (form.otherDay) form.daysAgo else -1))
                }
            }
            if (form.otherDay) {
                Spacer(Modifier.height(12.dp))
                // 다른 날: 앞뒤로 하루씩(달력 대신 — 거의 오늘 근처라서). 어제보다 앞 · 30일 뒤보다 먼 날은 서버 기간 밖.
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    OutlineButton("‹ " + str(R.string.find_prev_day), onClick = { if (form.daysAgo < 1) onForm(form.copy(daysAgo = form.daysAgo + 1)) })
                    Spacer(Modifier.weight(1f))
                    Text(shortDate(form.date), color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.weight(1f))
                    OutlineButton(str(R.string.find_next_day) + " ›", onClick = { if (form.daysAgo > -30) onForm(form.copy(daysAgo = form.daysAgo - 1)) })
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(str(R.string.find_late_hint), color = G.Muted, fontSize = 15.sp)
            Spacer(Modifier.height(6.dp))
            Text(str(R.string.find_name_hint), color = G.Muted, fontSize = 15.sp)
        }
        if (error != null) {
            Spacer(Modifier.height(16.dp))
            Text(error, color = G.Error, fontSize = 16.sp)
        }
    }
}

/** 남은 초(잠금). 0 이 되면 풀린다. */
@Composable
private fun secondsUntil(untilMillis: Long): Int {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(untilMillis) {
        while (now < untilMillis) {
            delay(500)
            now = System.currentTimeMillis()
        }
    }
    return (((untilMillis - now) + 999) / 1000).toInt().coerceAtLeast(0)
}

@Composable
private fun Tip(number: Int, text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(number.toString(), color = G.Sand, fontSize = 16.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.width(28.dp).padding(top = 2.dp))
        Text(text, color = G.Text, fontSize = 18.sp, lineHeight = 27.sp)
    }
}

@Composable
private fun KeyValue(key: String, value: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 84.dp).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(key, color = G.Muted, fontSize = 15.sp, modifier = Modifier.width(150.dp))
        Text(value, color = G.Text, fontSize = 25.sp, fontWeight = FontWeight.Medium)
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(G.Line))
}

/** T1x — 못 찾음(어느 칸이 틀렸는지는 말하지 않는다). 잠기면 남은 초 동안 다시 찾기를 막는다. */
@Composable
fun NotFoundScreen(form: FindForm, remaining: Int, lockedUntil: Long?, onBack: () -> Unit, onCall: () -> Unit, onRetry: () -> Unit) {
    val seconds = lockedUntil?.let { secondsUntil(it) } ?: 0
    ScrollPage(bottom = {
        if (seconds > 0) {
            Text(str(R.string.notfound_locked, seconds), color = G.Sand, fontSize = 16.sp)
        } else if (remaining in 1..4) {
            Text(str(R.string.notfound_tries, remaining), color = G.Muted, fontSize = 16.sp)
        }
        Spacer(Modifier.height(18.dp))
        BottomRow(onCall, str(R.string.notfound_retry), enabled = seconds == 0, onPrimary = onRetry)
    }) {
        StepTop(1, onBack)
        Spacer(Modifier.height(40.dp))
        Heading(str(R.string.notfound_title), str(R.string.notfound_body))
        Spacer(Modifier.height(32.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(G.LineStrong))
        if (form.byCode) {
            KeyValue(str(R.string.label_code), form.code)
        } else {
            KeyValue(str(R.string.label_name), "${form.lastName} ${form.firstName}".trim().uppercase())
            KeyValue(str(R.string.find_date), shortDate(form.date))
        }
        Spacer(Modifier.height(32.dp))
        Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
            if (form.byCode) {
                Tip(1, str(R.string.notfound_tip_digits))
                Tip(2, str(R.string.notfound_tip_prereg))
            } else {
                Tip(1, str(R.string.notfound_tip_spelling))
                Tip(2, str(R.string.notfound_tip_booker))
                Tip(3, str(R.string.notfound_tip_code))
            }
        }
    }
}

/** T1b — 찾았지만 지금은 못 함(사유별). 손님 이름은 다시 보여 주지 않는다. */
@Composable
fun BlockedScreen(reason: BlockReason, checkInDate: String?, onBack: () -> Unit, onCall: () -> Unit, onHome: () -> Unit) {
    val (title, body) = when (reason) {
        BlockReason.TooEarly -> str(R.string.blocked_too_early_title) to
            str(R.string.blocked_too_early_body, parseDate(checkInDate)?.let { shortDate(it) } ?: "")
        BlockReason.Expired -> str(R.string.blocked_expired_title) to str(R.string.blocked_expired_body)
        BlockReason.Cancelled -> str(R.string.blocked_cancelled_title) to str(R.string.blocked_cancelled_body)
        BlockReason.OtherBuilding -> str(R.string.blocked_other_title) to str(R.string.blocked_other_body)
        BlockReason.Busy -> str(R.string.blocked_busy_title) to str(R.string.blocked_busy_body)
    }
    ScrollPage(bottom = { BottomRow(onCall, str(R.string.home), onPrimary = onHome) }) {
        StepTop(1, onBack)
        Spacer(Modifier.height(40.dp))
        Heading(title, body)
    }
}

/** T1c — 이미 체크인함. 방 번호 · 비밀번호는 코드를 한 번 더 받아야 보인다(다음 묶음). */
@Composable
fun CheckedInScreen(stay: KioskStay, onBack: () -> Unit, onCall: () -> Unit, onRoom: () -> Unit, onMore: () -> Unit, onHome: () -> Unit) {
    val empty = emptySeats(stay)
    ScrollPage(bottom = { BottomRow(onCall, str(R.string.home), onPrimary = onHome) }) {
        StepTop(5, onBack)
        Spacer(Modifier.height(40.dp))
        Heading(str(R.string.done_title), str(R.string.done_body))
        Spacer(Modifier.height(40.dp))
        Tile(G.Sand, minHeight = 240.dp, modifier = Modifier.fillMaxWidth(), onClick = onRoom) {
            Column {
                Text(str(R.string.done_room), color = G.Ink, fontSize = 36.sp, fontWeight = FontWeight.Medium, lineHeight = 42.sp)
                Spacer(Modifier.height(12.dp))
                Text(str(R.string.done_room_body), color = G.Ink.copy(alpha = 0.8f), fontSize = 18.sp)
            }
        }
        if (empty > 0) {
            Spacer(Modifier.height(12.dp))
            Column(
                Modifier.fillMaxWidth().heightIn(min = 180.dp).background(G.Surface, Radius).border(BorderStroke(1.dp, G.Line), Radius)
                    .clickable(role = Role.Button, onClick = onMore).padding(horizontal = 28.dp, vertical = 24.dp),
            ) {
                Text(str(R.string.done_more), color = G.Text, fontSize = 30.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(12.dp))
                Text(str(R.string.done_more_body, empty), color = G.Muted, fontSize = 17.sp)
            }
        }
    }
}

/** 아직 다 안 된 자리 수 — 저장했지만 칸이 남은 사람 + 빈 자리. */
fun emptySeats(stay: KioskStay): Int =
    stay.guests.count { it.missing.isNotEmpty() } + (stay.partySize - stay.guests.size).coerceAtLeast(0)

/** 명부 한 줄의 상태(시안 T2). 테스트로 덮는다. */
enum class SeatState { Done, PhotoOnly, Partial, Empty }

fun seatStateOf(guest: KioskGuest?): SeatState = when {
    guest == null -> SeatState.Empty
    guest.missing.isEmpty() -> SeatState.Done
    guest.missing == listOf("passport_photo") -> SeatState.PhotoOnly
    else -> SeatState.Partial
}

/** T2 — 예약 찾음 · 명부. 인원은 ± 로 바꾸되 막지 않는다(FR-K05). */
@Composable
fun GuestsScreen(
    stay: KioskStay,
    onBack: () -> Unit,
    onCall: () -> Unit,
    onParty: suspend (Int) -> Boolean,
    onStart: () -> Unit,
) {
    var busy by remember { mutableStateOf(false) }
    var partyError by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val change: (Int) -> Unit = { next ->
        if (!busy) {
            busy = true
            scope.launch {
                partyError = !onParty(next)
                busy = false
            }
        }
    }
    val seats = maxOf(stay.partySize, stay.guests.size)
    val allDone = emptySeats(stay) == 0
    ScrollPage(bottom = { BottomRow(onCall, str(if (allDone) R.string.guests_next else R.string.guests_start), onPrimary = onStart) }) {
        StepTop(2, onBack)
        Spacer(Modifier.height(40.dp))
        Heading(str(R.string.guests_title), str(R.string.guests_body))
        Spacer(Modifier.height(32.dp))
        Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            InfoBox(str(R.string.guests_room), Modifier.weight(1f).fillMaxHeight()) {
                Text(stay.rooms.joinToString(", ").ifEmpty { "—" }, color = G.Text, fontSize = 28.sp, fontWeight = FontWeight.Medium)
            }
            InfoBox(str(R.string.guests_dates), Modifier.weight(1f).fillMaxHeight()) {
                val from = parseDate(stay.checkInDate)
                val to = parseDate(stay.checkOutDate)
                val dates = if (from != null && to != null) shortDate(from) + " → " + shortDate(to) else stay.checkInDate
                Text(dates, color = G.Text, fontSize = 20.sp, fontWeight = FontWeight.Medium, lineHeight = 26.sp)
                Text(str(R.string.guests_nights, stay.nights), color = G.Muted, fontSize = 14.sp)
            }
            InfoBox(str(R.string.guests_party), Modifier.weight(1f).fillMaxHeight()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StepButton("−", str(R.string.guests_less), enabled = !busy && stay.partySize > maxOf(1, stay.guests.size)) { change(stay.partySize - 1) }
                    Text(
                        stay.partySize.toString(),
                        color = G.Text, fontSize = 30.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                    StepButton("+", str(R.string.guests_more), enabled = !busy && stay.partySize < 20) { change(stay.partySize + 1) }
                }
            }
        }
        if (partyError) {
            Spacer(Modifier.height(10.dp))
            Text(str(R.string.party_error), color = G.Error, fontSize = 15.sp)
        }
        Spacer(Modifier.height(32.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(G.LineStrong))
        for (index in 0 until seats) {
            val guest = stay.guests.getOrNull(index)
            SeatRow(index + 1, guest)
        }
        Spacer(Modifier.height(18.dp))
        Text(str(R.string.guests_child_hint), color = G.Muted, fontSize = 15.sp, lineHeight = 22.sp)
    }
}

@Composable
private fun InfoBox(label: String, modifier: Modifier, content: @Composable () -> Unit) {
    Column(modifier.background(G.Surface, Radius).padding(horizontal = 20.dp, vertical = 18.dp)) {
        Text(label, color = G.Muted, fontSize = 15.sp)
        Spacer(Modifier.height(8.dp))
        content()
    }
}

@Composable
private fun StepButton(symbol: String, label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(60.dp).border(BorderStroke(1.dp, if (enabled) G.LineStrong else G.Line), Radius)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Text(symbol, color = if (enabled) G.Text else G.Line, fontSize = 26.sp)
    }
}

@Composable
private fun SeatRow(number: Int, guest: KioskGuest?) {
    val state = seatStateOf(guest)
    val name = when {
        guest?.name != null -> guest.name
        else -> str(R.string.guests_seat, number)
    }
    val sub = buildList {
        if (guest?.isRepresentative == true) add(str(R.string.guests_rep))
        add(
            when (state) {
                SeatState.Done -> str(R.string.guests_sub_done)
                SeatState.PhotoOnly -> str(R.string.guests_sub_photo)
                SeatState.Partial -> str(R.string.guests_sub_partial)
                SeatState.Empty -> str(R.string.guests_sub_empty)
            },
        )
    }.joinToString(" · ")
    Row(Modifier.fillMaxWidth().heightIn(min = 104.dp).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(number.toString(), color = G.Muted, fontSize = 15.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.width(44.dp))
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            Text(name, color = G.Text, fontSize = 26.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            Text(sub, color = G.Muted, fontSize = 15.sp)
        }
        if (state == SeatState.Done) {
            Box(Modifier.heightIn(min = 60.dp).border(BorderStroke(1.dp, Color(0xFF3A4030)), Radius).padding(horizontal = 22.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
                Text("✓ " + str(R.string.guests_done), color = G.Sage, fontSize = 18.sp, fontWeight = FontWeight.Medium)
            }
        } else {
            Box(Modifier.heightIn(min = 60.dp).background(G.Sand, Radius).padding(horizontal = 22.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
                Text(str(R.string.guests_need), color = G.Ink, fontSize = 18.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(G.Line))
}
