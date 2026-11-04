package com.harutokyo.checkin.kiosk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.contract.AccessKind
import com.harutokyo.checkin.kiosk.contract.CompleteResult
import com.harutokyo.checkin.kiosk.contract.CompleteRoom
import com.harutokyo.checkin.kiosk.contract.CompleteShared
import com.harutokyo.checkin.kiosk.contract.CompletionInfo
import com.harutokyo.checkin.kiosk.contract.accessKindOf
import com.harutokyo.checkin.kiosk.contract.codeTextSize
import com.harutokyo.checkin.kiosk.contract.signLabelOf
import com.harutokyo.checkin.kiosk.contract.addressFor
import com.harutokyo.checkin.kiosk.contract.isAllRoomsSameNote
import com.harutokyo.checkin.kiosk.contract.isFirstFloorPrefix
import com.harutokyo.checkin.kiosk.contract.needsStaffForCode
import kotlinx.coroutines.delay

// G4 체크인 완료(방 번호 · 문 비밀번호) + 직원 부르기 화면. 비밀번호는 이 화면 상태에만 두고 로그 · 저장하지 않는다.

/** 문패 색(시안 G4 — 갈색 문패에 흰 글씨). */
private val DoorSign = Color(0xFF8B4826)

private sealed interface DoneState {
    data object Loading : DoneState
    data class Ready(val info: CompletionInfo) : DoneState
    data class Incomplete(val reason: String?) : DoneState
    data class Failed(val network: Boolean) : DoneState
    data object VerifyRequired : DoneState
    data class Blocked(val reason: String?) : DoneState
}

/**
 * 완료 화면. 들어오면 서버에 「마쳤다」를 알리고(다시 보내도 안전) 방 번호 · 비밀번호를 받는다.
 * 손이 닿지 않고 [idleSeconds] 가 지나면 처음으로 — 손이 닿으면 다시 세되, 총 [idleSeconds]×4 를 넘기면 그대로 돌아간다(비밀번호가 계속 떠 있지 않게).
 * [paused] 는 직원 호출 창이 위에 열려 있을 때 세기를 멈춘다.
 */
@Composable
fun CompletionScreen(
    language: String,
    idleSeconds: Int,
    paused: Boolean,
    complete: suspend () -> CompleteResult,
    onSessionGone: () -> Unit,
    /** 명부가 덜 찼다고 할 때 빠른 체크인 화면으로 되돌린다 — 되돌렸으면 true(이 화면은 막다른 길을 그리지 않는다). */
    onRoster: () -> Boolean,
    onCall: () -> Unit,
    onHome: () -> Unit,
) {
    var state by remember { mutableStateOf<DoneState>(DoneState.Loading) }
    var attempt by remember { mutableIntStateOf(0) }
    val completeNow by rememberUpdatedState(complete)
    val goneNow by rememberUpdatedState(onSessionGone)
    val rosterNow by rememberUpdatedState(onRoster)
    LaunchedEffect(attempt) {
        state = DoneState.Loading
        state = when (val result = completeNow()) {
            is CompleteResult.Done -> DoneState.Ready(result.info)
            is CompleteResult.Incomplete -> {
                if (result.reason == "roster" && rosterNow()) DoneState.Loading else DoneState.Incomplete(result.reason)
            }
            CompleteResult.SessionGone -> {
                goneNow()
                DoneState.Loading
            }
            CompleteResult.VerifyRequired -> DoneState.VerifyRequired
            is CompleteResult.Blocked -> DoneState.Blocked(result.reason)
            CompleteResult.Network -> DoneState.Failed(network = true)
            CompleteResult.Server -> DoneState.Failed(network = false)
        }
    }

    // 처음으로 돌아가기까지 남은 초 — 비밀번호가 보이는 동안만 센다.
    val limit = idleSeconds.coerceAtLeast(5)
    var remaining by remember { mutableIntStateOf(limit) }
    var total by remember { mutableIntStateOf(0) }
    val ready = state is DoneState.Ready
    val pausedNow by rememberUpdatedState(paused)
    val homeNow by rememberUpdatedState(onHome)
    // 직원 호출 창이 열려 있는 동안은 남은 초를 멈추되, 총 시간(상한)에는 센다 — 자리를 떠난 뒤 창을 닫으면 다음 사람에게 비밀번호가 다시 보이지 않게.
    val capNow = limit * 4
    LaunchedEffect(ready) {
        if (!ready) return@LaunchedEffect
        remaining = limit
        total = 0
        while (true) {
            delay(1000)
            total++
            if (pausedNow) continue
            remaining--
            if (remaining <= 0 || total >= capNow) {
                homeNow()
                return@LaunchedEffect
            }
        }
    }
    // 창이 닫히는 순간 상한을 이미 넘었으면 다음 초를 기다리지 않고 바로 처음으로.
    LaunchedEffect(paused) {
        if (!paused && ready && total >= capNow) homeNow()
    }

    val message = when (val current = state) {
        is DoneState.Failed -> str(if (current.network) R.string.error_network else R.string.error_server)
        is DoneState.Incomplete -> str(
            when (current.reason) {
                "consent" -> R.string.g4_incomplete_consent
                "roster" -> R.string.g4_incomplete_roster
                else -> R.string.g4_incomplete_other
            },
        )
        DoneState.VerifyRequired -> str(R.string.g4_verify_body)
        is DoneState.Blocked -> str(if (current.reason == "expired") R.string.g4_blocked_expired else R.string.g4_blocked_cancelled)
        else -> null
    }
    // 다시 시도해도 같은 결과인 상태(확인 필요 · 막힌 예약)는 다시 해 보기 없이 처음으로만.
    val retryable = state is DoneState.Failed || state is DoneState.Incomplete
    val verify = state is DoneState.VerifyRequired
    val primary = when {
        state is DoneState.Ready -> str(R.string.g4_finish)
        retryable -> str(R.string.g4_retry)
        else -> str(R.string.home)
    }
    val title = when (state) {
        DoneState.VerifyRequired -> R.string.g4_title_verify
        is DoneState.Blocked -> R.string.g4_title_blocked
        else -> R.string.g4_title_problem
    }

    Box(
        Modifier.fillMaxSize().pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    awaitPointerEvent(PointerEventPass.Initial)
                    remaining = limit
                }
            }
        },
    ) {
        ScrollPage(bottom = {
            if (state !is DoneState.Loading) {
                BottomRow(onCall, primary, onPrimary = { if (ready || !retryable) onHome() else attempt++ })
            }
        }) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Logo(onHold = {})
                Spacer(Modifier.weight(1f))
                if (ready) Text(str(R.string.g4_countdown, remaining), color = G.Muted, fontSize = 15.sp)
            }
            Spacer(Modifier.height(32.dp))
            when (val current = state) {
                DoneState.Loading -> {
                    Spacer(Modifier.height(120.dp))
                    Text(str(R.string.g4_loading), color = G.Muted, fontSize = 22.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                }
                is DoneState.Ready -> Details(current.info, language, onCall)
                else -> {
                    Heading(str(title), message)
                    if (verify) {
                        // 여권이 없는 분도 바로 직원을 부를 수 있게 크게.
                        Spacer(Modifier.height(32.dp))
                        StaffCallBlock(onCall)
                    }
                    if (retryable) {
                        Spacer(Modifier.height(40.dp))
                        OutlineButton(str(R.string.home), onClick = onHome)
                    }
                }
            }
        }
    }
}

@Composable
private fun Details(info: CompletionInfo, language: String, onCall: () -> Unit) {
    val who = listOfNotNull(
        info.leadName,
        info.guestCount.takeIf { it > 0 }?.let { str(R.string.g4_guests, it) },
    ).joinToString(" · ").ifEmpty { null }
    Heading(str(R.string.g4_title), who)
    // 다른 체크인 화면과 같은 「10월 30일 (금)」 꼴. 읽지 못하는 값이면 받은 그대로.
    val checkIn = info.checkInDate?.let { raw -> parseDate(raw)?.let { shortDate(it) } ?: raw }
    val checkOut = info.checkOutDate?.let { raw -> parseDate(raw)?.let { shortDate(it) } ?: raw }
    if (checkIn != null || checkOut != null) {
        Spacer(Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            if (checkIn != null) InfoBox(str(R.string.g4_checkin), Modifier.weight(1f)) { Text(checkIn, color = G.Text, fontSize = 22.sp, fontWeight = FontWeight.Medium) }
            if (checkOut != null) InfoBox(str(R.string.g4_checkout), Modifier.weight(1f)) { Text(checkOut, color = G.Text, fontSize = 22.sp, fontWeight = FontWeight.Medium) }
        }
    }
    Spacer(Modifier.height(32.dp))
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        for (room in info.rooms) RoomCard(room, language, hasShared = info.shared.isNotEmpty())
    }
    if (info.shared.isNotEmpty()) {
        Spacer(Modifier.height(32.dp))
        Text(str(R.string.g4_shared_title), color = G.Muted, fontSize = 16.sp)
        Spacer(Modifier.height(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (item in info.shared) SharedRow(item)
        }
    }
    if (needsStaffForCode(info)) {
        // 들어갈 비밀번호가 없다 — 직원 호출을 눈에 띄게(방 카드에 안내가 이미 있으면 글은 중복하지 않는다).
        Spacer(Modifier.height(24.dp))
        if (info.rooms.isEmpty()) {
            Text(str(R.string.g4_staff_code), color = G.Sand, fontSize = 19.sp, lineHeight = 28.sp)
            Spacer(Modifier.height(16.dp))
        }
        StaffCallBlock(onCall)
    }
    val address = addressFor(info.address, language)
    if (address != null) {
        Spacer(Modifier.height(24.dp))
        InfoBox(str(R.string.g4_address), Modifier.fillMaxWidth()) { Text(address, color = G.Text, fontSize = 19.sp, lineHeight = 28.sp) }
    }
    Spacer(Modifier.height(16.dp))
}

/** 문패(방 번호) + 방 비밀번호. 방 비밀번호가 없으면 공용 비밀번호를 안내한다. 건물 이름이라 번역이 없으면 문패 없이 비밀번호만. */
@Composable
private fun RoomCard(room: CompleteRoom, language: String, hasShared: Boolean) {
    val code = room.code?.takeIf { it.isNotBlank() }
    val sign = signLabelOf(room, language)
    Row(
        Modifier.fillMaxWidth().background(G.Surface, Radius).border(BorderStroke(1.dp, G.Line), Radius).padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (sign != null) {
            Box(
                Modifier.widthIn(min = 150.dp, max = 220.dp).heightIn(min = 180.dp).background(DoorSign, Radius).padding(16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(sign, color = Color.White, fontSize = 52.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center, lineHeight = 58.sp)
            }
        }
        Column(Modifier.weight(1f)) {
            when {
                code != null -> {
                    Text(str(R.string.g4_kind_room), color = G.Muted, fontSize = 16.sp)
                    Spacer(Modifier.height(8.dp))
                    val size = codeTextSize(code.length, big = false)
                    Text(code, color = G.Text, fontSize = size.sp, lineHeight = (size + 8).sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium, letterSpacing = 1.sp)
                }
                hasShared -> Text(str(R.string.g4_use_shared), color = G.Text, fontSize = 20.sp, lineHeight = 28.sp)
                else -> Text(str(R.string.g4_staff_code), color = G.Sand, fontSize = 18.sp, lineHeight = 26.sp)
            }
        }
    }
}

@Composable
private fun SharedRow(item: CompleteShared) {
    val kind = when (accessKindOf(item.labelKey)) {
        AccessKind.DoorPassword -> str(R.string.g4_kind_door)
        AccessKind.RoomPassword -> str(R.string.g4_kind_room)
        AccessKind.KeyBox -> str(R.string.g4_kind_keybox)
        AccessKind.KeyBoxPassword -> str(R.string.g4_kind_keybox_code)
        AccessKind.Generic -> str(R.string.g4_kind_generic)
    }
    val label = if (isFirstFloorPrefix(item.prefixKey)) "${str(R.string.g4_floor1)} $kind" else kind
    Column(Modifier.fillMaxWidth().background(G.Surface, Radius).border(BorderStroke(1.dp, G.Line), Radius).padding(horizontal = 20.dp, vertical = 16.dp)) {
        Text(label, color = G.Muted, fontSize = 16.sp)
        Spacer(Modifier.height(6.dp))
        val size = codeTextSize(item.code.length, big = true)
        Text(item.code, color = G.Text, fontSize = size.sp, lineHeight = (size + 6).sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium, letterSpacing = 1.sp)
        if (isAllRoomsSameNote(item.noteKey)) {
            Spacer(Modifier.height(4.dp))
            Text(str(R.string.g4_note_all), color = G.Muted, fontSize = 15.sp)
        }
    }
}

/** 직원 부르기 — 계약의 연락처를 글자로만 보여 준다(전화를 직접 걸지 않는다, FR-K14). 비어 있는 종류는 숨긴다. */
@Composable
fun StaffCallScreen(contacts: Map<String, String>, onBack: () -> Unit) {
    val rows = listOf(
        "phone" to R.string.call_phone,
        "line" to R.string.call_line,
        "whatsapp" to R.string.call_whatsapp,
    ).mapNotNull { (key, label) -> contacts[key]?.trim()?.takeIf { it.isNotEmpty() }?.let { label to it } }
    ScrollPage(bottom = null) {
        OutlineButton(str(R.string.back), onClick = onBack)
        Spacer(Modifier.height(48.dp))
        Heading(str(R.string.call_title), str(if (rows.isEmpty()) R.string.call_none else R.string.call_body))
        Spacer(Modifier.height(40.dp))
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            for ((label, value) in rows) {
                InfoBox(str(label), Modifier.fillMaxWidth()) {
                    Text(value, color = G.Text, fontSize = 36.sp, fontWeight = FontWeight.Medium, fontFamily = FontFamily.Monospace)
                }
            }
        }
    }
}

/** 눈에 띄는 큰 「직원 호출」 단추(모래색 꽉 찬 줄) — 들어갈 방법이 없거나 여권이 없을 때. */
@Composable
internal fun StaffCallBlock(onCall: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().heightIn(min = 80.dp).background(G.Sand, Radius).clickable(role = Role.Button, onClick = onCall).padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(str(R.string.staff_call), color = G.Ink, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
    }
}
