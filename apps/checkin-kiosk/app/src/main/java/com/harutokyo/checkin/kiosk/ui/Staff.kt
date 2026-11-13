package com.harutokyo.checkin.kiosk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.contract.DeviceInfo
import com.harutokyo.checkin.kiosk.contract.StaffPin
import com.harutokyo.checkin.kiosk.kiosk.Pin
import com.harutokyo.checkin.kiosk.kiosk.PinCheck
import com.harutokyo.checkin.kiosk.kiosk.PinGuard
import com.harutokyo.checkin.kiosk.kiosk.PinVerdict
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

enum class StaffStep { Closed, Pin, Menu, ConfirmReenroll }

private const val PIN_MAX = 8
private val PANEL = 420.dp

/** 직원 해제(FR-K18) — 표지 5초 → PIN → 직원 메뉴. 온라인이면 서버가 PIN 을 확인하고, 연결이 없을 때만 기기에서 대조한다. */
@Composable
fun StaffOverlay(
    step: StaffStep,
    pin: StaffPin?,
    guard: PinGuard,
    checkPin: suspend (String) -> PinCheck,
    device: DeviceInfo?,
    locked: Boolean,
    deviceOwner: Boolean,
    onStep: (StaffStep) -> Unit,
    onRefresh: () -> Unit,
    onUnlock: () -> Unit,
    onLock: () -> Unit,
    onReenroll: () -> Unit,
) {
    Box(
        Modifier.fillMaxSize().background(G.Bg.copy(alpha = 0.96f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        contentAlignment = Alignment.Center,
    ) {
        // 가로 화면 · 큰 글자에서도 넘치면 스크롤(한 화면에 스크롤 하나).
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (step) {
                StaffStep.Pin -> PinStep(pin, guard, checkPin, onCancel = { onStep(StaffStep.Closed) }, onOk = { onStep(StaffStep.Menu) })
                StaffStep.Menu -> Column(Modifier.width(PANEL), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(str(R.string.staff_menu_title), color = G.Text, fontSize = 32.sp, fontWeight = FontWeight.Medium)
                    if (device != null) {
                        Text("${str(R.string.staff_device)} · ${device.name} · ${device.propertyKey}", color = G.Muted, fontSize = 15.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    PrimaryButton(str(R.string.staff_refresh), modifier = Modifier.width(PANEL)) { onRefresh() }
                    if (deviceOwner) {
                        if (locked) {
                            OutlineButton(str(R.string.staff_unlock), modifier = Modifier.width(PANEL), onClick = onUnlock)
                        } else {
                            OutlineButton(str(R.string.staff_relock), modifier = Modifier.width(PANEL), onClick = onLock)
                        }
                    }
                    OutlineButton(str(R.string.staff_reenroll), modifier = Modifier.width(PANEL)) { onStep(StaffStep.ConfirmReenroll) }
                    OutlineButton(str(R.string.staff_close), modifier = Modifier.width(PANEL)) { onStep(StaffStep.Closed) }
                }
                // 되돌릴 수 없다 — 새 등록 코드가 있어야 다시 쓸 수 있어서 한 번 더 묻는다.
                StaffStep.ConfirmReenroll -> Column(Modifier.width(PANEL), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(str(R.string.staff_reenroll), color = G.Text, fontSize = 32.sp, fontWeight = FontWeight.Medium)
                    Text(str(R.string.staff_reenroll_confirm), color = G.Muted, fontSize = 17.sp, lineHeight = 26.sp)
                    Spacer(Modifier.height(10.dp))
                    OutlineButton(str(R.string.cancel), modifier = Modifier.width(PANEL)) { onStep(StaffStep.Menu) }
                    DangerButton(str(R.string.staff_reenroll_do), modifier = Modifier.width(PANEL), onClick = onReenroll)
                }
                StaffStep.Closed -> Unit
            }
        }
    }
}

@Composable
private fun PinStep(pin: StaffPin?, guard: PinGuard, checkPin: suspend (String) -> PinCheck, onCancel: () -> Unit, onOk: () -> Unit) {
    var value by remember { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var wrong by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val remaining = guard.remainingMs(now)
    LaunchedEffect(guard.lockedUntil) {
        while (guard.remainingMs(System.currentTimeMillis()) > 0) {
            now = System.currentTimeMillis()
            delay(500)
        }
        now = System.currentTimeMillis()
    }
    Text(str(R.string.staff_pin_title), color = G.Text, fontSize = 32.sp, fontWeight = FontWeight.Medium)
    Spacer(Modifier.height(28.dp))
    if (pin == null) {
        Text(str(R.string.staff_pin_unset), color = G.Sand, fontSize = 17.sp)
        Spacer(Modifier.height(28.dp))
        OutlineButton(str(R.string.staff_close), onClick = onCancel)
        return
    }
    val locked = remaining > 0
    Digits(value, maxOf(4, value.length), masked = true)
    Box(Modifier.heightIn(min = 44.dp).width(PANEL).padding(top = 14.dp), contentAlignment = Alignment.TopCenter) {
        when {
            locked -> Text(str(R.string.staff_pin_locked, ((remaining + 999) / 1000).toInt()), color = G.Error, fontSize = 16.sp)
            wrong -> Text(str(R.string.staff_pin_wrong), color = G.Error, fontSize = 16.sp)
        }
    }
    Keypad(
        onDigit = { if (!locked && value.length < PIN_MAX) { value += it; wrong = false } },
        onDelete = { value = value.dropLast(1) },
    )
    Spacer(Modifier.height(24.dp))
    PrimaryButton(str(R.string.confirm), enabled = !locked && !checking && value.length >= 4) {
        val entered = value
        checking = true
        scope.launch {
            val check = checkPin(entered)
            val at = System.currentTimeMillis()
            checking = false
            when (Pin.decide(check, entered, pin, guard, at)) {
                PinVerdict.Pass -> onOk()
                PinVerdict.Wrong, PinVerdict.Locked -> {
                    now = at
                    wrong = true
                    value = ""
                }
            }
        }
    }
    Spacer(Modifier.height(14.dp))
    OutlineButton(str(R.string.staff_close), onClick = onCancel)
}
