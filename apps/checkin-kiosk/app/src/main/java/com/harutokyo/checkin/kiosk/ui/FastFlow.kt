package com.harutokyo.checkin.kiosk.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.camera.Captured
import com.harutokyo.checkin.kiosk.camera.FaceRecorder
import com.harutokyo.checkin.kiosk.camera.PassportScanner
import com.harutokyo.checkin.kiosk.contract.GuestInput
import com.harutokyo.checkin.kiosk.contract.KioskGuest
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.NoPassport
import com.harutokyo.checkin.kiosk.contract.SaveResult
import com.harutokyo.checkin.kiosk.data.UploadWait
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.time.LocalDate
import java.util.Locale

// 빠른 체크인(F1~F7b, 목표: 4명 약 3분). 로그인 흐름 요약:
//   F1 여권 비추기(ScanScreen — 예약 찾기) → F2 예약 찾음 · 여권 N개 안내 → 자리마다 [F3 여권 → (저장) → F4 얼굴 5초] 반복
//   → F6b 한 번에 검토(사는 곳 · 연락처) → F7b 마지막 질문 + 약관 동의 → 올리기 끝나면 완료.
// 자리마다 소개 · 「읽는 중」 · 확인 화면이 없다 — 여권이 읽히면 바로 저장하고 얼굴로 넘어간다. 읽지 못한 분만 T3x → 직접 입력(ConfirmScreen).
// 여권 사진 · 얼굴 영상은 뒤에서 차례로 올린다(data/UploadQueue.kt). 손님 정보는 로그에 남기지 않는다.

enum class FastPhase { Ready, Passport, NoPassport, Failed, Confirm, Face, Review, Edit, Final }

/** 이 흐름이 서버 · 올리기 줄에 시키는 일(KioskRoot 가 ViewModel 에 이어 준다). */
class FastActions(
    val save: suspend (GuestInput) -> SaveResult,
    val setParty: suspend (Int) -> KioskStay?,
    val saveRoute: suspend (String, String) -> SaveResult,
    val saveConsent: suspend () -> SaveResult,
    val enqueuePassport: (guestId: String, jpeg: ByteArray) -> Unit,
    val enqueueFace: (guestId: String, file: File) -> Unit,
    val faceFailed: (guestId: String) -> Unit,
    val retryUploads: () -> Unit,
    val awaitUploads: suspend () -> UploadWait,
)

/** 「두 번째 분」 — 10번째까지는 언어별 서수, 넘으면 「N번째 분」 꼴. */
@Composable
private fun ordinal(index: Int): String {
    val names = stringArrayResource(R.array.fast_ordinals)
    return keepKoreanWords(names.getOrNull(index) ?: str(R.string.guests_seat, index + 1))
}

private fun personName(draft: PersonDraft): String = "${draft.surname} ${draft.given}".trim().uppercase()

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FastCheckin(
    stay: KioskStay,
    first: Captured?,
    language: String,
    termsText: Map<String, String>,
    actions: FastActions,
    onStay: (KioskStay) -> Unit,
    onSessionGone: () -> Unit,
    onBack: () -> Unit,
    onCall: () -> Unit,
    onStep: (String) -> Unit,
    /** 이름으로 찾은 예약인가 — 여권이 저장돼야 방 비밀번호를 보여 주므로, 여권 없이 가려는 분께 미리 알린다. */
    byName: Boolean,
    onDone: () -> Unit,
) {
    val stayNow by rememberUpdatedState(stay)
    val scope = rememberCoroutineScope()
    var phase by remember { mutableStateOf(FastPhase.Ready) }
    var doneIds by remember { mutableStateOf(emptyList<String>()) }
    var people by remember { mutableStateOf(emptyMap<String, SavedPerson>()) }
    // 대표자가 F1 에서 비춘 여권 — 첫 자리에서 한 번 쓰고 비운다.
    var shot by remember { mutableStateOf(first) }
    val repShot = first?.mrz != null
    var captured by remember { mutableStateOf<Captured?>(null) }
    var failures by remember { mutableIntStateOf(0) }
    var mode by remember { mutableStateOf(FormMode.Mrz) }
    var reason by remember { mutableStateOf<NoPassport?>(null) }
    var seatIndex by remember { mutableIntStateOf(0) }
    var faceId by remember { mutableStateOf<String?>(null) }
    var faceBroken by remember { mutableStateOf(false) }
    var passportRead by remember { mutableStateOf(false) }
    var lastName by remember { mutableStateOf<String?>(null) }
    var editId by remember { mutableStateOf<String?>(null) }
    var partyOpen by remember { mutableStateOf(false) }
    // 저장 중복 방지: 같은 자리를 두 번 저장하지 않게(자동 찍기 + 수동 셔터 등).
    var savingCapture by remember { mutableStateOf(false) }
    // 새 분 저장이 실패했다(서버엔 저장됐을 수도) — 다시 저장하기 전에 서버 명단을 새로 읽어 확인한다.
    var uncertainSave by remember { mutableStateOf(false) }
    // 얼굴만 하는 자리(웹 사전 등록 동행자)는 이름을 보여 주고 손님이 「시작」을 눌러야 녹화한다 — 앞사람 얼굴이 이 분 이름으로 저장되지 않게.
    var faceGate by remember { mutableStateOf(false) }

    val seats = maxOf(stay.partySize, stay.guests.size)
    val representative = stay.guests.firstOrNull { it.isRepresentative }

    fun nameOf(id: String): String =
        people[id]?.let { personName(it.draft) } ?: stayNow.guests.firstOrNull { it.id == id }?.name.orEmpty().uppercase()

    // 새 분(id 없음)을 저장한다. 앞서 한 번 실패했다면 먼저 명단을 새로 읽어, 같은 이름이 이미 생겼으면 그 id 를 다시 쓴다.
    suspend fun saveOnce(input: GuestInput, draft: PersonDraft): SaveResult {
        val before = stayNow.guests.map { it.id }.toSet()
        if (input.id == null && uncertainSave) {
            val fresh = actions.setParty(stayNow.partySize)
            val match = fresh?.let { matchSavedGuest(it, before, draft) }
            // 서버에 이미 있는 분이다 — 고친 내용도 그 id 로 다시 보낸다(편집이 사라지지 않게).
            if (fresh != null && match != null) return actions.save(input.copy(id = match.id))
        }
        val result = actions.save(input)
        if (input.id == null && result is SaveResult.Failed) uncertainSave = true
        return result
    }

    // 저장된 분 + 얼굴까지 끝난 분 처리 뒤 다음 자리로.
    fun saved(id: String, updated: KioskStay, person: SavedPerson, jpeg: ByteArray?) {
        savingCapture = false
        uncertainSave = false
        faceBroken = false
        faceGate = false
        onStay(updated)
        people = people + (id to person)
        if (jpeg != null) actions.enqueuePassport(id, jpeg)
        faceId = id
        phase = FastPhase.Face
    }

    fun saveCapture(c: Captured, guest: KioskGuest?) {
        val mrz = c.mrz ?: return
        if (savingCapture) return
        // 성별 X · 읽히지 않은 생년월일이면 서버에 저장하지 않는다(저장하면 자리가 끝난 것으로 보이고 마지막에 막힌다) — 확인 화면에서 채운다.
        if (!mrzDraftComplete(mrz)) {
            reason = null
            captured = c
            mode = FormMode.Mrz
            passportRead = true
            faceId = null
            faceBroken = false
            phase = FastPhase.Confirm
            return
        }
        savingCapture = true
        reason = null
        faceBroken = false
        val draft = draftOf(mrz, null)
        val input = guestInputOf(guest, draft, FormMode.Mrz, null, mrz, askAddress = false)
        captured = c
        mode = FormMode.Mrz
        passportRead = true
        faceId = null
        // 저장하는 동안 얼굴 화면을 먼저 보여 준다(녹화는 저장이 끝나면 시작).
        phase = FastPhase.Face
        scope.launch {
            when (val result = saveOnce(input, draft)) {
                is SaveResult.Saved -> {
                    val id = result.guestId ?: input.id
                    if (id == null) {
                        savingCapture = false
                        faceBroken = false
                        phase = FastPhase.Confirm
                    } else {
                        saved(id, result.stay, SavedPerson(draft, FormMode.Mrz, null, mrz), c.jpeg)
                    }
                }
                SaveResult.SessionGone -> onSessionGone()
                // 서버가 받지 않았다(칸 부족 · 네트워크) — 손님이 확인 화면에서 고쳐 저장한다.
                else -> {
                    savingCapture = false
                    faceBroken = false
                    phase = FastPhase.Confirm
                }
            }
        }
    }

    fun advance(updated: KioskStay, ids: List<String>) {
        val plan = nextSeatPlan(updated, ids.toSet())
        captured = null
        failures = 0
        reason = null
        mode = FormMode.Mrz
        faceId = null
        faceBroken = false
        faceGate = false
        savingCapture = false
        uncertainSave = false
        passportRead = false
        if (plan == null) {
            phase = FastPhase.Review
            return
        }
        seatIndex = plan.index
        val guest = updated.guests.getOrNull(plan.index)
        if (plan.task == SeatTask.FaceOnly) {
            faceId = guest?.id
            faceGate = true
            phase = FastPhase.Face
            return
        }
        val isRep = guest?.isRepresentative == true || (updated.guests.none { it.isRepresentative } && plan.index == 0)
        val pending = shot
        if (isRep && pending?.mrz != null) {
            shot = null
            saveCapture(pending, guest)
        } else {
            phase = FastPhase.Passport
        }
    }

    fun finishSeat(id: String) {
        val ids = if (id in doneIds) doneIds else doneIds + id
        doneIds = ids
        lastName = nameOf(id)
        advance(stayNow, ids)
    }

    LaunchedEffect(faceId, faceBroken) {
        val id = faceId
        if (id != null && faceBroken && phase == FastPhase.Face) {
            faceBroken = false
            actions.faceFailed(id)
            finishSeat(id)
        }
    }

    val seatNo = seatIndex + 1
    LaunchedEffect(phase, seatIndex) {
        onStep(
            when (phase) {
                FastPhase.Ready -> "f2"
                FastPhase.Passport, FastPhase.NoPassport, FastPhase.Failed, FastPhase.Confirm -> "passport $seatNo"
                FastPhase.Face -> "face $seatNo"
                FastPhase.Review, FastPhase.Edit -> "review"
                FastPhase.Final -> "final"
            },
        )
    }

    val header = ordinal(seatIndex) + " · $seatNo/$seats"
    val chips = doneIds.map(::nameOf)
    val seatGuest = stay.guests.getOrNull(seatIndex)
    val seatIsRep = seatGuest?.isRepresentative == true || (representative == null && seatIndex == 0)

    when (phase) {
        FastPhase.Ready -> {
            ReadyScreen(
                stay = stay,
                repName = representative?.name ?: first?.mrz?.let { "${it.surname} ${it.givenNames}".trim() },
                repShot = repShot,
                doneIds = doneIds.toSet(),
                onBack = onBack,
                onCall = onCall,
                onParty = { partyOpen = true },
                onStart = { advance(stay, doneIds) },
            )
            if (partyOpen) {
                PartyOverlay(stay, onChange = { size -> actions.setParty(size)?.also(onStay) != null }, onClose = { partyOpen = false })
            }
        }
        FastPhase.Passport -> SeatPassportScreen(
            header = header,
            title = str(R.string.fast_pass_title, ordinal(seatIndex)),
            toast = lastName?.let { str(R.string.fast_pass_toast, it) },
            chips = chips,
            onNone = { phase = FastPhase.NoPassport },
            onUnavailable = {
                reason = NoPassport.CameraOff
                phase = FastPhase.NoPassport
            },
            onCaptured = { c ->
                if (c.mrz != null) {
                    saveCapture(c, seatGuest)
                } else {
                    captured = c
                    failures += 1
                    phase = FastPhase.Failed
                }
            },
        )
        FastPhase.Failed -> FailedScreen(
            who = header,
            photo = captured?.jpeg,
            second = failures >= 2,
            onBack = { phase = FastPhase.Passport },
            onRetake = {
                captured = null
                phase = FastPhase.Passport
            },
            onType = {
                mode = FormMode.Manual
                phase = FastPhase.Confirm
            },
        )
        FastPhase.NoPassport -> NoPassportScreen(
            who = header,
            cameraOff = reason == NoPassport.CameraOff,
            proofNotice = proofNoticeNeeded(byName, people),
            onBack = {
                reason = null
                phase = FastPhase.Passport
            },
            onCall = onCall,
            onPick = { picked ->
                reason = picked
                captured = null
                mode = when (picked) {
                    NoPassport.Child -> FormMode.Child
                    NoPassport.JapanResident -> FormMode.Resident
                    NoPassport.NotShown, NoPassport.CameraOff -> FormMode.Staff
                }
                phase = FastPhase.Confirm
            },
        )
        FastPhase.Confirm -> {
            val askAddress = mode == FormMode.Resident
            ConfirmScreen(
                key = "$seatIndex-$mode-${captured?.mrz?.raw}",
                who = header,
                mode = mode,
                mrzValid = captured?.mrz?.valid,
                initial = captured?.mrz?.let { draftOf(it, null) } ?: PersonDraft(),
                askAddress = askAddress,
                askContact = false,
                representativeName = if (!seatIsRep && mode != FormMode.Resident) representative?.name else null,
                last = false,
                canRetake = mode == FormMode.Mrz || mode == FormMode.Manual,
                onBack = { phase = if (reason != null) FastPhase.NoPassport else FastPhase.Passport },
                onRetake = {
                    captured = null
                    phase = FastPhase.Passport
                },
                onSubmit = { draft ->
                    val input = guestInputOf(seatGuest, draft, mode, reason, captured?.mrz, askAddress)
                    when (val result = saveOnce(input, draft)) {
                        is SaveResult.Saved -> {
                            val id = result.guestId ?: input.id
                            if (id == null) {
                                emptyList()
                            } else {
                                val withPhoto = captured?.jpeg?.takeIf { mode == FormMode.Mrz || mode == FormMode.Manual }
                                passportRead = withPhoto != null
                                saved(id, result.stay, SavedPerson(draft, mode, reason, captured?.mrz), withPhoto)
                                null
                            }
                        }
                        is SaveResult.Invalid -> result.fields.ifEmpty { listOf("") }
                        SaveResult.SessionGone -> {
                            onSessionGone()
                            null
                        }
                        SaveResult.Failed -> emptyList()
                    }
                },
            )
        }
        FastPhase.Face -> key(seatIndex) {
            FaceScreen(
                header = header,
                passportRead = passportRead,
                active = faceId != null && !faceGate,
                gateName = if (faceGate) nameOf(faceId.orEmpty()) else null,
                onStart = { faceGate = false },
                chips = chips,
                onRecorded = { file ->
                    val id = faceId
                    if (phase == FastPhase.Face && id != null) {
                        actions.enqueueFace(id, file)
                        finishSeat(id)
                    } else {
                        file.delete()
                    }
                },
                onFailed = {
                    val id = faceId
                    if (phase != FastPhase.Face) return@FaceScreen
                    if (id == null) {
                        faceBroken = true
                    } else {
                        actions.faceFailed(id)
                        finishSeat(id)
                    }
                },
            )
        }
        FastPhase.Review -> ReviewScreen(
            stay = stay,
            people = people,
            language = language,
            onBack = { phase = FastPhase.Ready },
            onCall = onCall,
            onEdit = { id ->
                editId = id
                phase = FastPhase.Edit
            },
            onSave = { address, contact ->
                val rep = representative
                val savedRep = rep?.let { people[it.id] }
                if (rep == null || savedRep == null) {
                    phase = FastPhase.Final
                    true
                } else {
                    val draft = savedRep.draft.copy(
                        address = address ?: savedRep.draft.address,
                        contact = contact ?: savedRep.draft.contact,
                    )
                    val input = guestInputOf(rep, draft, savedRep.mode, savedRep.reason, savedRep.mrz, askAddress = address != null || savedRep.mode == FormMode.Resident, askContact = contact != null)
                    when (val result = actions.save(input)) {
                        is SaveResult.Saved -> {
                            onStay(result.stay)
                            people = people + (rep.id to savedRep.copy(draft = draft))
                            phase = FastPhase.Final
                            true
                        }
                        SaveResult.SessionGone -> {
                            onSessionGone()
                            true
                        }
                        else -> false
                    }
                }
            },
        )
        FastPhase.Edit -> {
            val id = editId
            val person = id?.let { people[it] }
            val guest = stay.guests.firstOrNull { it.id == id }
            if (id == null || person == null) {
                LaunchedEffect(Unit) { phase = FastPhase.Review }
            } else {
                ConfirmScreen(
                    key = "edit-$id",
                    who = nameOf(id),
                    mode = person.mode,
                    mrzValid = person.mrz?.valid,
                    initial = person.draft,
                    askAddress = person.mode == FormMode.Resident,
                    askContact = false,
                    representativeName = null,
                    last = true,
                    canRetake = false,
                    onBack = { phase = FastPhase.Review },
                    onRetake = {},
                    onSubmit = { draft ->
                        val input = guestInputOf(guest, draft, person.mode, person.reason, person.mrz, person.mode == FormMode.Resident)
                        when (val result = actions.save(input)) {
                            is SaveResult.Saved -> {
                                onStay(result.stay)
                                people = people + (id to SavedPerson(draft, person.mode, person.reason, person.mrz, confirmed = true))
                                phase = FastPhase.Review
                                null
                            }
                            is SaveResult.Invalid -> result.fields.ifEmpty { listOf("") }
                            SaveResult.SessionGone -> {
                                onSessionGone()
                                null
                            }
                            SaveResult.Failed -> emptyList()
                        }
                    },
                )
            }
        }
        FastPhase.Final -> FinalScreen(
            stay = stayNow,
            language = language,
            termsText = termsText,
            actions = actions,
            onStay = onStay,
            onSessionGone = onSessionGone,
            onBack = { phase = FastPhase.Review },
            onCall = onCall,
            onDone = onDone,
        )
    }
}

// ── F1 ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * F1 — 예약하신 분의 여권을 비춰 주세요. 여권이 읽히면(onPassport) 이름으로 오늘 예약을 찾는다.
 * onPassport 가 true 를 돌려주면 다른 화면으로 넘어간 것, false 면(네트워크 · 서버 오류) 카메라를 다시 켠다.
 */
@Composable
fun ScanScreen(
    languageName: String,
    error: String?,
    onBack: () -> Unit,
    onLanguage: () -> Unit,
    onCall: () -> Unit,
    onByCode: () -> Unit,
    onByName: () -> Unit,
    onPassport: suspend (Captured) -> Boolean,
) {
    var scanKey by remember { mutableIntStateOf(0) }
    var working by remember { mutableStateOf(false) }
    var unreadable by remember { mutableStateOf(false) }
    var unavailable by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // 다시 읽을 때마다 새 scanner(= 새 카메라 묶음)로 바꿔 자동 찍기를 다시 켠다.
    val scanner = remember(scanKey) { PassportScanner() }
    DisposableEffect(scanner) { onDispose { scanner.close() } }
    ScrollPage(bottom = { Row { OutlineButton(str(R.string.staff_call), onClick = onCall) } }) {
        StepTop(1, onBack, languageName, onLanguage)
        Spacer(Modifier.height(36.dp))
        Heading(str(R.string.fast_f1_title), str(R.string.fast_f1_body))
        Spacer(Modifier.height(28.dp))
        if (unavailable) {
            Box(Modifier.fillMaxWidth().height(560.dp).background(G.Surface, Radius), contentAlignment = Alignment.Center) {
                Text(str(R.string.camera_denied), color = G.Muted, fontSize = 19.sp)
            }
        } else {
            key(scanKey) {
                PassportCamera(
                    scanner = scanner,
                    height = 560.dp,
                    onCaptured = { shot ->
                        // 못 읽었거나 검사 숫자가 틀리게 읽혔다 — 알리고 다시 읽는다(틀린 읽기는 예약 찾기에 보내지 않는다).
                        if (shot.mrz == null || !shot.mrz.valid) {
                            unreadable = true
                            scanKey += 1
                        } else if (!working) {
                            working = true
                            unreadable = false
                            scope.launch {
                                val moved = onPassport(shot)
                                if (!moved) {
                                    working = false
                                    scanKey += 1
                                }
                            }
                        }
                    },
                    onUnavailable = { unavailable = true },
                )
            }
        }
        Spacer(Modifier.height(18.dp))
        if (working) {
            Text(str(R.string.fast_f1_searching), color = G.Sage, fontSize = 19.sp)
        } else if (error != null) {
            Text(error, color = G.Error, fontSize = 16.sp)
        } else if (unreadable) {
            Text(str(R.string.fast_f1_retry), color = G.Sand, fontSize = 17.sp)
        }
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            OutlineButton(str(R.string.fast_f1_by_code), Modifier.weight(1f), onClick = onByCode)
            OutlineButton(str(R.string.fast_f1_by_name), Modifier.weight(1f), onClick = onByName)
        }
    }
}

// ── F2 ──────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ReadyScreen(
    stay: KioskStay,
    repName: String?,
    repShot: Boolean,
    doneIds: Set<String>,
    onBack: () -> Unit,
    onCall: () -> Unit,
    onParty: () -> Unit,
    onStart: () -> Unit,
) {
    val seats = maxOf(stay.partySize, stay.guests.size)
    val passports = passportsToShow(stay, repShot)
    ScrollPage(bottom = { BottomRow(onCall, str(R.string.fast_start), onPrimary = onStart) }) {
        StepTop(2, onBack)
        Spacer(Modifier.height(36.dp))
        Heading(
            if (repName.isNullOrBlank()) str(R.string.guests_title) else str(R.string.fast_found_title, repName.uppercase()),
            null,
        )
        Spacer(Modifier.height(28.dp))
        Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            InfoBox(str(R.string.guests_room), Modifier.weight(1f).fillMaxHeight()) {
                Text(stay.rooms.joinToString(", ").ifEmpty { "—" }, color = G.Text, fontSize = 28.sp, fontWeight = FontWeight.Medium)
            }
            InfoBox(str(R.string.guests_dates), Modifier.weight(1.3f).fillMaxHeight()) {
                val from = parseDate(stay.checkInDate)
                val to = parseDate(stay.checkOutDate)
                val dates = if (from != null && to != null) "${monthDay(from)} → ${monthDay(to)}" else stay.checkInDate
                Text(dates, color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium)
                Text(str(R.string.guests_nights, stay.nights), color = G.Muted, fontSize = 15.sp)
            }
            InfoBox(str(R.string.guests_party), Modifier.weight(1f).fillMaxHeight()) {
                Text(str(R.string.fast_party_count, stay.partySize), color = G.Text, fontSize = 28.sp, fontWeight = FontWeight.Medium)
            }
        }
        Spacer(Modifier.height(20.dp))
        Column(Modifier.fillMaxWidth().background(G.Sand, Radius).padding(horizontal = 28.dp, vertical = 24.dp)) {
            Text(
                if (passports > 0) str(R.string.fast_cards_title, passports) else str(R.string.fast_cards_title_face),
                color = G.Ink, fontSize = 28.sp, fontWeight = FontWeight.Medium, lineHeight = 36.sp,
            )
            Spacer(Modifier.height(8.dp))
            Text(str(R.string.fast_cards_body), color = G.Ink.copy(alpha = 0.8f), fontSize = 18.sp, lineHeight = 26.sp)
        }
        Spacer(Modifier.height(24.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(G.LineStrong))
        for (index in 0 until seats) {
            val guest = stay.guests.getOrNull(index)
            val line = if (guest != null && guest.id in doneIds) SeatLine.Done else seatLineOf(stay, index, repShot)
            Row(Modifier.fillMaxWidth().heightIn(min = 88.dp).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text((index + 1).toString(), color = G.Muted, fontSize = 15.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.width(44.dp))
                Column(Modifier.weight(1f)) {
                    Text(guest?.name?.uppercase() ?: ordinal(index), color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        str(
                            when (line) {
                                SeatLine.RepShot -> R.string.fast_seat_rep
                                SeatLine.FaceOnly -> R.string.fast_seat_face
                                SeatLine.Done -> R.string.fast_seat_done
                                SeatLine.Todo -> R.string.fast_seat_todo
                            },
                        ),
                        color = if (line == SeatLine.Done || line == SeatLine.RepShot) G.Sage else G.Muted, fontSize = 15.sp,
                    )
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(G.Line))
        }
        Spacer(Modifier.height(18.dp))
        Text(str(R.string.fast_child_note), color = G.Muted, fontSize = 16.sp, lineHeight = 24.sp)
        Box(Modifier.heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onParty), contentAlignment = Alignment.CenterStart) {
            Text(str(R.string.fast_change_party), color = G.Sand, fontSize = 18.sp, textDecoration = TextDecoration.Underline)
        }
    }
}

private fun monthDay(date: LocalDate) = "${date.monthValue}/${date.dayOfMonth}"

/** 인원 바꾸기 — T2 의 ± 칸을 그대로 쓴다. 바꿔도 막지 않는다(FR-K05). */
@Composable
private fun PartyOverlay(stay: KioskStay, onChange: suspend (Int) -> Boolean, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Box(
        Modifier.fillMaxSize().background(Color(0xCC000000)).pointerInput(Unit) { detectTapGestures { onClose() } },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.width(520.dp).background(G.Surface, Radius).pointerInput(Unit) { detectTapGestures { } }.padding(32.dp),
        ) {
            Text(str(R.string.guests_party), color = G.Muted, fontSize = 17.sp)
            Spacer(Modifier.height(16.dp))
            PartyStepper(stay, busy) { next ->
                if (!busy) {
                    busy = true
                    scope.launch {
                        error = !onChange(next)
                        busy = false
                    }
                }
            }
            if (error) {
                Spacer(Modifier.height(12.dp))
                Text(str(R.string.party_error), color = G.Error, fontSize = 15.sp)
            }
            Spacer(Modifier.height(24.dp))
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                PrimaryButton(str(R.string.confirm), onClick = onClose)
            }
        }
    }
}

// ── F3 · F4 ─────────────────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NameChips(names: List<String>) {
    if (names.isEmpty()) return
    Spacer(Modifier.height(18.dp))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (name in names) {
            Box(Modifier.border(BorderStroke(1.dp, Edge), Radius).padding(horizontal = 16.dp, vertical = 10.dp)) {
                Text("✓ $name", color = G.Sage, fontSize = 16.sp)
            }
        }
    }
}

/** F3 — 몇 번째 분 여권을 비춰 주세요. 읽히면 바로 저장하고 얼굴로. */
@Composable
private fun SeatPassportScreen(
    header: String,
    title: String,
    toast: String?,
    chips: List<String>,
    onNone: () -> Unit,
    onUnavailable: () -> Unit,
    onCaptured: (Captured) -> Unit,
) {
    val scanner = remember { PassportScanner() }
    DisposableEffect(Unit) { onDispose { scanner.close() } }
    var shutter by remember { mutableStateOf(false) }
    var shooting by remember { mutableStateOf(false) }
    var toastShown by remember { mutableStateOf(toast != null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        delay(8_000)
        shutter = true
    }
    LaunchedEffect(toast) {
        if (toast != null) {
            delay(4_000)
            toastShown = false
        }
    }
    ScrollPage(bottom = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            OutlineButton(str(R.string.passport_none), onClick = onNone)
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
        Spacer(Modifier.height(8.dp))
        Who(header)
        if (toast != null && toastShown) {
            Box(Modifier.fillMaxWidth().background(G.Surface, Radius).padding(horizontal = 22.dp, vertical = 16.dp)) {
                Text("✓ $toast", color = G.Sage, fontSize = 18.sp)
            }
            Spacer(Modifier.height(16.dp))
        }
        Text(title, color = G.Text, fontSize = 40.sp, fontWeight = FontWeight.Medium, lineHeight = 48.sp)
        Spacer(Modifier.height(24.dp))
        PassportCamera(scanner = scanner, height = 600.dp, onCaptured = onCaptured, onUnavailable = onUnavailable)
        NameChips(chips)
    }
}

/** F4 — 여권을 내리고 카메라를 봐 주세요(5초 녹화). 끝나면 저절로 다음으로. */
@Composable
private fun FaceScreen(
    header: String,
    passportRead: Boolean,
    active: Boolean,
    gateName: String?,
    onStart: () -> Unit,
    chips: List<String>,
    onRecorded: (File) -> Unit,
    onFailed: () -> Unit,
) {
    var progress by remember { mutableFloatStateOf(0f) }
    var recording by remember { mutableStateOf(false) }
    ScrollPage(bottom = {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text(str(R.string.fast_face_after), color = G.Muted, fontSize = 17.sp, textAlign = TextAlign.Center)
        }
    }) {
        Spacer(Modifier.height(8.dp))
        Who(header)
        Text(str(R.string.fast_face_title), color = G.Text, fontSize = 40.sp, fontWeight = FontWeight.Medium, lineHeight = 48.sp)
        Spacer(Modifier.height(12.dp))
        Text(str(if (passportRead) R.string.fast_face_sub_read else R.string.fast_face_sub), color = G.Sage, fontSize = 19.sp)
        Spacer(Modifier.height(24.dp))
        Box(Modifier.fillMaxWidth().height(620.dp).background(Color.Black, Radius)) {
            FaceRecorder(
                modifier = Modifier.fillMaxSize(),
                active = active,
                onProgress = { progress = it },
                onRecording = { recording = true },
                onRecorded = onRecorded,
                onFailed = onFailed,
            )
            if (gateName != null) {
                Column(
                    Modifier.fillMaxSize().background(Color(0xCC000000)).padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(str(R.string.fast_face_turn, gateName), color = G.Text, fontSize = 32.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center, lineHeight = 40.sp)
                    Spacer(Modifier.height(28.dp))
                    PrimaryButton(str(R.string.fast_start), onClick = onStart)
                }
            }
            if (recording) {
                Row(Modifier.align(Alignment.TopStart).padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(14.dp).background(G.Error, CircleShape))
                    Spacer(Modifier.width(10.dp))
                    Text(str(R.string.fast_recording), color = G.Text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                }
            }
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 32.dp, vertical = 24.dp).height(6.dp).background(G.Line, Radius)) {
                Box(Modifier.fillMaxWidth(progress).height(6.dp).background(G.Sage, Radius))
            }
        }
        NameChips(chips)
    }
}

// ── F6b ─────────────────────────────────────────────────────────────────────────────────────────────

/** F6b — 모두 한 번에 검토. 사는 곳(도시) · 연락처는 대표자 것만 받아 「맞아요」로 저장한다. */
@Composable
private fun ReviewScreen(
    stay: KioskStay,
    people: Map<String, SavedPerson>,
    language: String,
    onBack: () -> Unit,
    onCall: () -> Unit,
    onEdit: (String) -> Unit,
    onSave: suspend (address: String?, contact: String?) -> Boolean,
) {
    val locale = localeOf(language)
    val representative = stay.guests.firstOrNull { it.isRepresentative }
    val repSaved = representative?.let { people[it.id] }
    // 대표자를 이번에 저장한 경우에만 사는 곳 · 연락처를 받는다(웹 사전 등록으로 끝난 대표자는 이미 있다).
    val askPlace = needsLivingPlace(representative, repSaved)
    val askContact = repSaved != null
    val countryCode = repSaved?.draft?.nationality.orEmpty()
    var city by remember { mutableStateOf("") }
    var typedCountry by remember { mutableStateOf("") }
    val initialContact = remember { representative?.contact.orEmpty() }
    var contact by remember { mutableStateOf(initialContact) }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // 나라 이름: 여권 국적을 그 언어로 보여 주고, 명부에는 영어 이름으로 쓴다. 국적을 모르면 직접 쓴다.
    val countryShown = if (countryCode.isNotBlank()) countryName(countryCode, locale) else ""
    val countryStored = if (countryCode.isNotBlank()) countryName(countryCode, Locale.ENGLISH) else typedCountry
    val ready = reviewReady(stay, people) && (!askPlace || (city.isNotBlank() && countryStored.isNotBlank())) && (!askContact || contact.isNotBlank())

    ScrollPage(bottom = {
        Column {
            if (failed) {
                Text(str(R.string.save_error), color = G.Error, fontSize = 16.sp)
                Spacer(Modifier.height(12.dp))
            }
            BottomRow(onCall, str(R.string.confirm_done), enabled = ready && !saving) {
                saving = true
                failed = false
                scope.launch {
                    val ok = onSave(if (askPlace) addressOf(city, countryStored) else null, if (askContact) contact.trim() else null)
                    failed = !ok
                    saving = false
                }
            }
        }
    }) {
        StepTop(3, onBack)
        Spacer(Modifier.height(36.dp))
        Heading(str(R.string.fast_review_title, stay.guests.size), str(R.string.fast_review_body))
        Spacer(Modifier.height(28.dp))
        for (guest in stay.guests) {
            val person = people[guest.id]
            val warn = reviewWarnOf(person)
            val bad = warn != ReviewWarn.None
            Row(
                Modifier.fillMaxWidth().padding(bottom = 10.dp)
                    .background(if (bad) G.Sand.copy(alpha = 0.14f) else G.Surface, Radius)
                    .then(if (bad) Modifier.border(BorderStroke(1.dp, G.Sand), Radius) else Modifier)
                    .then(if (person != null) Modifier.clickable(role = Role.Button) { onEdit(guest.id) } else Modifier)
                    .heightIn(min = 92.dp).padding(horizontal = 22.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (bad) "!" else "✓", color = if (bad) G.Sand else G.Sage, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(40.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        (person?.let { personName(it.draft) } ?: guest.name.orEmpty()).uppercase(),
                        color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium,
                    )
                    Spacer(Modifier.height(4.dp))
                    val female = str(R.string.gender_female)
                    val male = str(R.string.gender_male)
                    val ageTemplate = R.string.fast_age
                    val detail = when {
                        warn == ReviewWarn.Digits -> str(R.string.fast_review_warn_digits)
                        warn == ReviewWarn.Missing -> str(R.string.fast_review_warn_missing)
                        person == null -> str(R.string.fast_seat_done)
                        else -> buildList {
                            if (person.draft.nationality.isNotBlank()) add(countryName(person.draft.nationality, locale))
                            parseAge(person.draft.age)?.let { add(str(ageTemplate, it)) }
                            when (person.draft.gender) {
                                "male" -> add(male)
                                "female" -> add(female)
                            }
                            if (person.draft.number.isNotBlank()) add(person.draft.number)
                        }.joinToString(" · ")
                    }
                    Text(detail, color = if (bad) G.Sand else G.Muted, fontSize = 16.sp)
                }
            }
        }
        if (askPlace) {
            Spacer(Modifier.height(24.dp))
            Text(str(R.string.fast_place_title), color = G.Text, fontSize = 24.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                if (countryCode.isNotBlank()) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(str(R.string.fast_place_country), color = G.Muted, fontSize = 16.sp)
                            Spacer(Modifier.width(12.dp))
                            Text(str(R.string.fast_place_country_tag), color = G.Sage, fontSize = 14.sp)
                        }
                        Spacer(Modifier.height(10.dp))
                        Box(Modifier.fillMaxWidth().heightIn(min = 72.dp).background(G.Surface, Radius).padding(horizontal = 20.dp, vertical = 12.dp), contentAlignment = Alignment.CenterStart) {
                            Text(countryShown, color = G.Text, fontSize = 24.sp)
                        }
                    }
                } else {
                    Field(str(R.string.fast_place_country), typedCountry, false, Modifier.weight(1f), max = 60, plain = true) { typedCountry = it }
                }
                Field(str(R.string.fast_place_city), city, false, Modifier.weight(1f), hint = str(R.string.fast_place_city_hint), max = 80, plain = true) {
                    city = it
                    failed = false
                }
            }
        }
        if (askContact) {
            Spacer(Modifier.height(18.dp))
            Field(
                str(R.string.fast_contact), contact, false, Modifier.fillMaxWidth(),
                hint = str(R.string.field_contact_hint), max = 120, plain = true,
                tag = if (initialContact.isNotBlank() && contact == initialContact) str(R.string.fast_contact_tag) else null,
            ) {
                contact = it
                failed = false
            }
        }
        Spacer(Modifier.height(18.dp))
        Text(str(R.string.fast_review_note), color = G.Muted, fontSize = 15.sp, lineHeight = 22.sp)
    }
}

// ── F7b ─────────────────────────────────────────────────────────────────────────────────────────────

/** F7b — 마지막 두 가지(전 숙박지 · 다음 행선지 + 약관 동의 한 칸). 물을 게 없으면 올리기만 기다린다. */
@Composable
private fun FinalScreen(
    stay: KioskStay,
    language: String,
    termsText: Map<String, String>,
    actions: FastActions,
    onStay: (KioskStay) -> Unit,
    onSessionGone: () -> Unit,
    onBack: () -> Unit,
    onCall: () -> Unit,
    onDone: () -> Unit,
) {
    // 무엇을 물을지는 들어올 때 한 번 정한다(저장하면서 stay 가 바뀌어도 화면이 바뀌지 않게).
    val askRoute = remember { needsRoute(stay) }
    val askConsent = remember { !stay.consented }
    var prev by remember { mutableStateOf(RouteAnswer()) }
    var nextDest by remember { mutableStateOf(RouteAnswer()) }
    var terms by remember { mutableStateOf(false) }
    var reading by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val stayNow by rememberUpdatedState(stay)
    val prevValue = prev.value(true)
    val nextValue = nextDest.value(false)
    val ready = (!askRoute || (prevValue != null && nextValue != null)) && (!askConsent || terms)

    fun submit() {
        if (sending) return
        sending = true
        failed = false
        scope.launch {
            var current = stayNow
            var ok = true
            if (askRoute && needsRoute(current) && prevValue != null && nextValue != null) {
                when (val result = actions.saveRoute(prevValue, nextValue)) {
                    is SaveResult.Saved -> {
                        current = result.stay
                        onStay(result.stay)
                    }
                    SaveResult.SessionGone -> {
                        onSessionGone()
                        return@launch
                    }
                    else -> ok = false
                }
            }
            if (ok && askConsent && !current.consented) {
                when (val result = actions.saveConsent()) {
                    is SaveResult.Saved -> {
                        current = result.stay
                        onStay(result.stay)
                    }
                    SaveResult.SessionGone -> {
                        onSessionGone()
                        return@launch
                    }
                    else -> ok = false
                }
            }
            if (ok) {
                actions.retryUploads()
                when (actions.awaitUploads()) {
                    UploadWait.Done -> {
                        onDone()
                        return@launch
                    }
                    UploadWait.SessionGone -> {
                        onSessionGone()
                        return@launch
                    }
                    // 네트워크로 못 올린 사진 · 영상이 남았다 — 완료하면 예약이 닫혀 다시 못 보내므로 여기서 붙잡는다(다시 시도 · 직원 호출).
                    // 서버가 영구 거절한 것(GiveUp)은 줄에 안 남아 막지 않는다 — 서버가 직원 확인으로 센다.
                    is UploadWait.Failed -> ok = false
                }
            }
            failed = !ok
            sending = false
        }
    }

    val nothingToAsk = !askRoute && !askConsent
    LaunchedEffect(Unit) { if (nothingToAsk) submit() }

    ScrollPage(bottom = {
        Column {
            if (failed) {
                Text(str(R.string.save_error), color = G.Error, fontSize = 16.sp)
                Spacer(Modifier.height(12.dp))
            }
            BottomRow(
                onCall,
                str(
                    when {
                        sending -> R.string.fast_sending
                        nothingToAsk -> R.string.fast_retry
                        askConsent -> R.string.fast_final_go
                        else -> R.string.fast_finish
                    },
                ),
                enabled = ready && !sending,
                onPrimary = ::submit,
            )
        }
    }) {
        if (nothingToAsk) {
            Spacer(Modifier.height(120.dp))
            Heading(str(R.string.fast_sending), str(R.string.fast_sending_body))
        } else {
            StepTop(4, onBack)
            Spacer(Modifier.height(36.dp))
            Heading(str(if (askRoute && askConsent) R.string.fast_final_title else R.string.fast_final_title_one), null)
            if (askRoute) {
                Spacer(Modifier.height(32.dp))
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
            if (askConsent) {
                Spacer(Modifier.height(28.dp))
                CheckRow(str(R.string.consent_terms), str(R.string.consent_terms_sub), terms) {
                    terms = it
                    failed = false
                }
                Spacer(Modifier.height(6.dp))
                Box(Modifier.heightIn(min = 56.dp).clickable(role = Role.Button) { reading = true }, contentAlignment = Alignment.CenterStart) {
                    Text(str(R.string.consent_read), color = G.Sand, fontSize = 18.sp, textDecoration = TextDecoration.Underline)
                }
                Spacer(Modifier.height(12.dp))
                Text(str(R.string.fast_retention), color = G.Muted, fontSize = 15.sp, lineHeight = 22.sp)
            }
        }
    }
    if (reading) TermsOverlay(termsFor(termsText, language)) { reading = false }
}
