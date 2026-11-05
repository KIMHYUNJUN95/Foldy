package com.harutokyo.checkin.kiosk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalConfiguration
import kotlinx.coroutines.delay
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.contract.GuestAddress
import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.SaveResult
import kotlinx.coroutines.launch

// 집 주소 화면(검토 F6b 다음, 최종 F7b 앞). 판정은 AddressFlow.kt, 서버는 `POST /api/kiosk/address`.
//   대표자 주소 한 칸 → (유효 + 자판 닫힘) 「모두 같아요」 → 저장하고 바로 다음 / 「다른 분이 있어요」 → 다른 분 화면.
//   한 명뿐이면 질문 없이 「다음」. 손님 주소는 로그에 남기지 않는다.

private enum class AddressStep { Representative, Different }

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AddressScreens(
    stay: KioskStay,
    people: Map<String, SavedPerson>,
    nameOf: (String) -> String,
    /** FastCheckin 이 들고 있는 입력 — 없으면 서버에 저장된 주소에서 만든다. */
    draft: AddressDraft?,
    onDraft: (AddressDraft) -> Unit,
    onBack: () -> Unit,
    onCall: () -> Unit,
    onSave: suspend (representativeAddress: String, others: List<GuestAddress>) -> SaveResult,
) {
    val rep: KioskGuest = stay.guests.firstOrNull { it.isRepresentative } ?: stay.guests.firstOrNull() ?: return
    val others = stay.guests.filter { it.id in otherGuestIds(stay) }
    val repResident = isResident(rep, people[rep.id])
    fun residentOf(id: String): Boolean = others.firstOrNull { it.id == id }?.let { isResident(it, people[it.id]) } == true

    // 시작 입력: 들고 있던 것, 없으면 서버에 저장된 주소(대표자와 다른 주소가 있는 분은 그 값을 지킨 채 「다른 주소」).
    val seed = remember { draft ?: initialAddressDraft(stay) }
    var step by remember {
        mutableStateOf(if (addressStart(seed, repResident) == AddressStart.Different) AddressStep.Different else AddressStep.Representative)
    }
    var text by remember { mutableStateOf(seed.text) }
    // 「다른 분」 화면에서 입력칸인 분들(id → 글).
    var different by remember { mutableStateOf(seed.different) }
    LaunchedEffect(text, different) { onDraft(AddressDraft(text, different)) }
    var bad by remember { mutableStateOf(emptyList<String>()) }
    var failed by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val imeVisible = WindowInsets.isImeVisible
    val single = onlyOneGuest(stay)
    val guestCount = maxOf(stay.partySize, stay.guests.size)
    val valid = addressValid(text, repResident)
    val language = LocalConfiguration.current.locales[0].language
    // 유효해지면 「모두 같아요?」 묶음이 자판 위 보이는 곳까지 올라오게 한다 — 키 입력마다가 아니라 나타날 때 · 자판이 열리고 닫힐 때만.
    val questionBlock = remember { BringIntoViewRequester() }
    val showQuestionBlock = step == AddressStep.Representative && !single && valid
    LaunchedEffect(showQuestionBlock, imeVisible) {
        if (showQuestionBlock) {
            delay(250)
            questionBlock.bringIntoView()
        }
    }
    val closeKeyboard: () -> Unit = {
        focus.clearFocus()
        keyboard?.hide()
    }

    fun send(diff: Map<String, String>) {
        if (saving) return
        saving = true
        failed = false
        bad = emptyList()
        scope.launch {
            when (val result = onSave(cleanAddress(text), addressOthersOf(text, others.map { it.id }, diff))) {
                is SaveResult.Invalid -> {
                    bad = result.fields.ifEmpty { listOf("") }
                    // 대표자 칸이 틀렸으면 그 칸이 있는 화면으로.
                    if (addressErrorOf(bad, null)) step = AddressStep.Representative
                }
                SaveResult.Failed -> failed = true
                else -> Unit // 저장됨 · 세션 끝 — 화면이 바뀐다
            }
            saving = false
        }
    }

    Box(Modifier.fillMaxSize().imePadding()) {
        when (step) {
            AddressStep.Representative -> ScrollPage(bottom = {
                Column {
                    if (failed || bad.isNotEmpty()) {
                        Text(str(if (failed) R.string.save_error else R.string.invalid_fields), color = G.Error, fontSize = 16.sp)
                        Spacer(Modifier.height(12.dp))
                    }
                    if (single) {
                        BottomRow(onCall, str(R.string.addr_next), enabled = valid && !saving) { send(emptyMap()) }
                    } else {
                        Row { OutlineButton(str(R.string.staff_call), onClick = onCall) }
                    }
                }
            }) {
                StepTop(3, onBack)
                Spacer(Modifier.height(36.dp))
                Who(nameOf(rep.id))
                Heading(str(R.string.addr_title), str(if (repResident) R.string.addr_hint else R.string.addr_hint_foreign))
                Spacer(Modifier.height(28.dp))
                AddressField(
                    label = str(R.string.addr_label),
                    value = text,
                    bad = addressErrorOf(bad, null) || showAddressError(text, repResident, imeVisible),
                    resident = repResident,
                    autoFocus = !valid,
                    onDone = closeKeyboard,
                ) {
                    text = it
                    failed = false
                    bad = emptyList()
                }
                // 자판이 닫혔는지와 상관없이 유효하면 바로 진행할 수 있다(완료 키가 안 먹는 기기에서도 막히지 않게).
                if (!single && valid) {
                    Spacer(Modifier.height(36.dp))
                    Column(Modifier.bringIntoViewRequester(questionBlock)) {
                    if (showSameQuestion(single, valid, different.isNotEmpty())) {
                        Text(str(R.string.addr_same_q, peopleCountLabel(guestCount, language)), color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium, lineHeight = 32.sp)
                        Spacer(Modifier.height(16.dp))
                        PrimaryButton(str(R.string.addr_yes_all), Modifier.fillMaxWidth(), enabled = !saving) {
                            closeKeyboard()
                            send(emptyMap())
                        }
                        Spacer(Modifier.height(12.dp))
                        OutlineButton(str(R.string.addr_no_some), Modifier.fillMaxWidth(), center = true) {
                            closeKeyboard()
                            bad = emptyList()
                            step = AddressStep.Different
                        }
                    } else {
                        // 이미 다른 주소가 있는 분이 있다 — 묻지 않고 다른 분 화면에서 확인한다.
                        PrimaryButton(str(R.string.addr_next), Modifier.fillMaxWidth()) {
                            closeKeyboard()
                            bad = emptyList()
                            step = AddressStep.Different
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                    }
                }
            }
            AddressStep.Different -> ScrollPage(bottom = {
                Column {
                    if (failed || bad.isNotEmpty()) {
                        Text(str(if (failed) R.string.save_error else R.string.invalid_fields), color = G.Error, fontSize = 16.sp)
                        Spacer(Modifier.height(12.dp))
                    }
                    BottomRow(onCall, str(R.string.addr_next), enabled = differentCanSave(different, others.map { it.id }, ::residentOf, text) && !saving) { send(different) }
                }
            }) {
                StepTop(3, { step = AddressStep.Representative })
                Spacer(Modifier.height(36.dp))
                Heading(str(R.string.addr_diff_title), str(R.string.addr_diff_body))
                Spacer(Modifier.height(28.dp))
                for (guest in others) {
                    val own = different[guest.id]
                    if (own == null) {
                        Row(
                            Modifier.fillMaxWidth().padding(bottom = 10.dp)
                                .background(G.Surface, Radius)
                                .clickable(role = Role.Button) {
                                    bad = emptyList()
                                    different = different + (guest.id to "")
                                }
                                .heightIn(min = 92.dp).padding(horizontal = 22.dp, vertical = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(nameOf(guest.id), color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium)
                                Spacer(Modifier.height(4.dp))
                                Text(cleanAddress(text), color = G.Muted, fontSize = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                            Spacer(Modifier.width(16.dp))
                            Text(str(R.string.fast_tap_fix), color = G.Sand, fontSize = 16.sp)
                        }
                    } else {
                        val resident = residentOf(guest.id)
                        Column(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
                            AddressField(
                                label = nameOf(guest.id),
                                value = own,
                                bad = addressErrorOf(bad, guest.id) || showAddressError(own, resident, imeVisible),
                                resident = resident,
                                autoFocus = own.isEmpty(),
                                onDone = closeKeyboard,
                            ) {
                                different = different + (guest.id to it)
                                failed = false
                                bad = emptyList()
                            }
                            Box(Modifier.heightIn(min = 56.dp).clickable(role = Role.Button) { different = different - guest.id }, contentAlignment = Alignment.CenterStart) {
                                Text(str(R.string.addr_use_same), color = G.Sand, fontSize = 16.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 주소 한 칸(여러 줄) — 외국 손님은 영어 자판 + 입력 걸러내기, 일본 거주는 일본어 자판(영어로 바꿀 수 있다). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AddressField(
    label: String,
    value: String,
    bad: Boolean,
    resident: Boolean,
    autoFocus: Boolean,
    onDone: () -> Unit,
    onChange: (String) -> Unit,
) {
    // 칸이 눌리면(자판이 올라오면) 칸 아래 여백까지 보이는 곳으로 — 아래 줄(직원 호출)에 붙지 않게.
    val requester = remember { BringIntoViewRequester() }
    var focused by remember { mutableStateOf(false) }
    val imeUp = WindowInsets.isImeVisible
    // 자판이 다 올라온 뒤(올라오는 중에 한 번 맞추면 뷰가 줄어들며 다시 어긋난다)에 맞춘다.
    LaunchedEffect(focused, imeUp) {
        if (focused) {
            delay(350)
            requester.bringIntoView()
        }
    }
    Column(
        Modifier.fillMaxWidth()
            .bringIntoViewRequester(requester)
            .onFocusChanged { state -> focused = state.hasFocus },
    ) {
        Field(
            label, value, bad, Modifier.fillMaxWidth(),
            hint = str(if (resident) R.string.addr_example_jp else R.string.addr_example),
            max = ADDRESS_MAX, single = false, minLines = 3,
            keyboardLocale = if (resident) KEYBOARD_RESIDENT else KEYBOARD_FOREIGN,
            filter = if (resident) null else ::filterForeignAddress,
            ime = ImeAction.Done, onDone = onDone, autoFocus = autoFocus,
            onChange = onChange,
        )
        // 영어 자판만 받는 칸은 왜 글자가 안 들어가는지 알려 준다.
        if (!resident) {
            Spacer(Modifier.height(8.dp))
            Text(str(R.string.addr_latin_note), color = G.Muted, fontSize = 16.sp, lineHeight = 22.sp)
        }
        // 오류는 칸 바로 아래에(색만으로 알리지 않는다).
        if (bad) {
            Spacer(Modifier.height(8.dp))
            Text(str(R.string.addr_error), color = G.Error, fontSize = 16.sp, lineHeight = 22.sp)
        }
        Spacer(Modifier.height(24.dp))
    }
}
