package com.harutokyo.checkin.kiosk.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.harutokyo.checkin.kiosk.R
import com.harutokyo.checkin.kiosk.contract.BlockReason
import com.harutokyo.checkin.kiosk.contract.FindResult
import com.harutokyo.checkin.kiosk.camera.Captured
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.PassportQuery
import com.harutokyo.checkin.kiosk.contract.ProveResult
import com.harutokyo.checkin.kiosk.data.KioskViewModel
import com.harutokyo.checkin.kiosk.data.Phase
import com.harutokyo.checkin.kiosk.data.StepTimer
import com.harutokyo.checkin.kiosk.kiosk.Kiosk
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 화면 흐름(빠른 체크인): 등록 안 됨 → E 등록 / 등록됨 → G1 언어 → F1 여권 비추기(→ 예약 찾기) → F2 예약 찾음 → (자리마다 여권 · 얼굴 5초) → F6b 검토 → F7b 마지막 질문 + 동의 → 완료(G4).
// F1 에서 「코드로 찾기」 · 「이름으로 찾기」 → T1k · T1 (FindScreen). 찾기 결과: 못 찾음 T1x · 지금은 못 함 T1b · 이미 체크인 T1c.
// 자리마다 화면은 ui/FastFlow.kt 안에서 돈다(Screen.Fast). 단계마다 걸린 시간은 StepTimer 가 「KioskTiming」 로그 한 줄로 남긴다.
// 손님이 손을 떼고 idleSecondsInput(기본 240초) 지나면 G1 로 돌아간다(FR-K12) — 올리다 만 것은 버린다.

private val PHRASE_BREAK = LineBreak(LineBreak.Strategy.HighQuality, LineBreak.Strictness.Default, LineBreak.WordBreak.Phrase)

private enum class Screen { Language, Scan, Proof, Find, NotFound, Blocked, CheckedIn, Fast, Done }

@Composable
fun KioskRoot(model: KioskViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    var screen by remember { mutableStateOf(Screen.Language) }
    var language by remember { mutableStateOf("ja") }
    var staff by remember { mutableStateOf(StaffStep.Closed) }
    var lastTouch by remember { mutableLongStateOf(System.currentTimeMillis()) }
    // 찾기 칸 · 결과(손님 한 명분 — 처음으로 돌아가면 지운다).
    var form by remember { mutableStateOf(FindForm()) }
    var findError by remember { mutableStateOf<String?>(null) }
    var scanError by remember { mutableStateOf<String?>(null) }
    var notFound by remember { mutableStateOf<FindResult?>(null) }
    var blocked by remember { mutableStateOf<FindResult.Blocked?>(null) }
    var session by remember { mutableStateOf<String?>(null) }
    var stay by remember { mutableStateOf<KioskStay?>(null) }
    // F1 에서 찍은 대표자 여권(이름으로 찾은 경우엔 없음).
    var firstShot by remember { mutableStateOf<Captured?>(null) }
    // 이름으로 찾았고 예약하신 분 여권으로 본인 확인을 기다리는 예약 번호 — 확인되기 전엔 예약 내용도 입력도 없다.
    var proofSession by remember { mutableStateOf<String?>(null) }
    // 이름이 안 맞아 멈춘 상태 · 마지막으로 보낸 여권 두 줄(같은 줄을 연달아 보내지 않는다).
    var proofHeld by remember { mutableStateOf(false) }
    var lastProofRaw by remember { mutableStateOf<String?>(null) }
    // 완료 화면이 빠른 체크인에서 왔나 · 명부 되돌리기는 한 번만.
    var doneFromFast by remember { mutableStateOf(false) }
    var rosterBounced by remember { mutableStateOf(false) }
    val timer = remember { StepTimer() }
    // 직원 부르기 — 흐름 위에 덮어 보여 준다(진행 중인 체크인 · 올리기 줄을 잃지 않게). G1 의 호출만 별도 화면이다.
    var callOpen by remember { mutableStateOf(false) }
    val callOpenNow by rememberUpdatedState(callOpen)
    val reset = {
        callOpen = false
        screen = Screen.Language
        language = "ja"
        form = FindForm()
        findError = null
        scanError = null
        notFound = null
        blocked = null
        session = null
        stay = null
        firstShot = null
        proofSession = null
        proofHeld = false
        lastProofRaw = null
        doneFromFast = false
        rosterBounced = false
        model.clearUploads()
        timer.reset()
    }
    // 예약을 찾았다 — 예약 언어가 있으면 그 언어로(FR-K01, 이 건물이 쓰는 언어일 때만). 이미 체크인했으면 T1c, 아니면 F2.
    fun foundStay(result: FindResult.Found, languages: List<String>, shot: Captured?) {
        // 새로 찾았다 — 앞 찾기의 확인 기다림 · 되돌리기는 모두 없던 일.
        proofSession = null
        proofHeld = false
        lastProofRaw = null
        doneFromFast = false
        rosterBounced = false
        session = result.sessionId
        model.openUploads(result.sessionId)
        stay = result.stay
        firstShot = shot
        if (result.language != null && result.language in languages) language = result.language
        screen = if (result.checkedIn) Screen.CheckedIn else Screen.Fast
    }
    // 이름으로 찾았다 — 예약 내용 없이 여권 확인 화면으로. 확인 전에는 올리기 줄도 열지 않는다.
    fun proofNeeded(result: FindResult.ProofNeeded, languages: List<String>) {
        proofSession = result.sessionId
        proofHeld = false
        lastProofRaw = null
        session = null
        stay = null
        firstShot = null
        doneFromFast = false
        rosterBounced = false
        scanError = null
        if (result.language != null && result.language in languages) language = result.language
        screen = Screen.Proof
    }
    // 확인 기다림은 확인 화면과 그 잠금 화면에서만 산다 — 다른 어느 화면으로 나가도(막힘 · 언어 · 찾기 · 처음으로) 지워 다음 손님이 앞 손님 확인 화면으로 가지 않게.
    LaunchedEffect(screen) {
        if (screen != Screen.Proof && screen != Screen.NotFound) proofSession = null
    }
    val scope = rememberCoroutineScope()
    val activity = LocalActivity.current!!

    // 뒤로 가기로 앱을 나가지 못하게 — 화면 안 뒤로 버튼만 쓴다.
    BackHandler { reset() }
    // 직원 부르기 창이 열려 있으면 뒤로 가기는 그 창만 닫는다(위 핸들러보다 나중에 등록 = 우선).
    BackHandler(enabled = callOpen) { callOpen = false }

    // 손님 화면이든 직원 PIN · 메뉴든 손을 떼고 idleSecondsInput 지나면 G1 로(직원 창이 열린 채 남지 않게).
    val idleSeconds = state.contract?.idleSecondsInput ?: 240
    LaunchedEffect(screen, staff, lastTouch, idleSeconds) {
        if (screen == Screen.Language && staff == StaffStep.Closed) return@LaunchedEffect
        delay(idleSeconds * 1000L)
        reset()
        staff = StaffStep.Closed
    }

    // 걸린 시간: 처음으로 돌아온 뒤 첫 손길부터 「language」 단계가 시작된다(G1 에 서 있던 시간은 재지 않는다).
    LaunchedEffect(lastTouch) {
        if (screen == Screen.Language && state.phase == Phase.Ready && staff == StaffStep.Closed) timer.enter("language")
    }

    // 잠금 상태는 직원 창을 열 때 다시 읽고, 풀기 · 잠그기 뒤엔 바로 바꾼다(단추 글자가 늦게 바뀌지 않게).
    var locked by remember { mutableStateOf(false) }
    LaunchedEffect(staff) { locked = Kiosk.isLocked(activity) }

    // 일본어 · 한국어는 낱말 중간에서 줄을 바꾸지 않게(구 단위 줄바꿈, Android 13+).
    CompositionLocalProvider(LocalTextStyle provides LocalTextStyle.current.copy(lineBreak = PHRASE_BREAK)) {
        Box(
            Modifier
                .fillMaxSize()
                .background(G.Bg)
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            awaitPointerEvent(PointerEventPass.Initial)
                            lastTouch = System.currentTimeMillis()
                        }
                    }
                },
        ) {
            Localized(if (state.phase == Phase.Ready) language else "ja") {
                when (state.phase) {
                    Phase.Loading -> Centered(stringResource(R.string.loading))
                    Phase.UpdateRequired -> Centered("App update required · アプリの更新が必要です")
                    Phase.Enroll -> EnrollScreen(revoked = state.revoked, onSubmit = model::enroll)
                    Phase.Ready -> when (screen) {
                        Screen.Language -> LanguageScreen(
                            languages = state.contract?.languages ?: listOf("ja", "en", "zh-Hans", "ko"),
                            online = state.online,
                            hasContacts = !state.contract?.supportContacts.isNullOrEmpty(),
                            onStaff = { staff = StaffStep.Pin },
                            onCall = { callOpen = true },
                            onPick = { code ->
                                language = code
                                screen = Screen.Scan
                            },
                        )
                        Screen.Scan -> {
                            val networkError = str(R.string.error_network)
                            val serverError = str(R.string.error_server)
                            LaunchedEffect(Unit) { timer.enter("f1") }
                            ScanScreen(
                                languageName = languageName(language),
                                error = scanError,
                                onBack = reset,
                                onLanguage = { screen = Screen.Language },
                                onCall = { callOpen = true },
                                onByCode = {
                                    form = form.copy(byCode = true)
                                    screen = Screen.Find
                                },
                                onByName = {
                                    form = form.copy(byCode = false)
                                    screen = Screen.Find
                                },
                                onPassport = { shot ->
                                    // 검사 숫자가 맞는 읽기만 예약 찾기에 보낸다 — 틀리게 읽힌 것은 다시 찍게 둔다.
                                    val mrz = shot.mrz?.takeIf { it.valid } ?: return@ScanScreen false
                                    // 직원 부르기 창이 위에 열려 있으면 읽힌 여권은 버린다(창 뒤에서 F2 로 넘어가지 않게). 카메라는 다시 켜진다.
                                    if (callOpenNow) return@ScanScreen false
                                    scanError = null
                                    // 못 찾음 화면에 같은 이름이 보이도록 찾기 칸에도 넣어 둔다(날짜는 오늘).
                                    form = FindForm(byCode = false, lastName = mrz.surname, firstName = mrz.givenNames)
                                    when (val result = model.find(PassportQuery(mrz.surname, mrz.givenNames))) {
                                        is FindResult.Found -> {
                                            foundStay(result, state.contract?.languages.orEmpty(), shot)
                                            true
                                        }
                                        is FindResult.ProofNeeded -> {
                                            proofNeeded(result, state.contract?.languages.orEmpty())
                                            true
                                        }
                                        is FindResult.NotFound, is FindResult.Locked -> {
                                            notFound = result
                                            screen = Screen.NotFound
                                            true
                                        }
                                        is FindResult.Blocked -> {
                                            blocked = result
                                            screen = Screen.Blocked
                                            true
                                        }
                                        FindResult.Network -> {
                                            scanError = networkError
                                            false
                                        }
                                        FindResult.Server -> {
                                            scanError = serverError
                                            false
                                        }
                                    }
                                },
                            )
                        }
                        Screen.Proof -> {
                            val networkError = str(R.string.error_network)
                            val serverError = str(R.string.error_server)
                            val mismatch = str(R.string.proof_mismatch)
                            val retryHint = str(R.string.proof_retry)
                            val id = proofSession
                            ScanScreen(
                                languageName = languageName(language),
                                error = scanError,
                                proof = true,
                                held = proofHeld,
                                onRetake = {
                                    proofHeld = false
                                    scanError = null
                                },
                                onBack = {
                                    proofSession = null
                                    screen = Screen.Scan
                                },
                                onLanguage = { screen = Screen.Language },
                                onCall = { callOpen = true },
                                onByCode = {
                                    form = form.copy(byCode = true)
                                    screen = Screen.Find
                                },
                                onByName = {},
                                onNoPassport = { callOpen = true },
                                onPassport = { shot ->
                                    // 검사 숫자가 맞는 읽기만 보낸다. 직원 호출 창이 열려 있으면 버린다.
                                    val mrz = shot.mrz?.takeIf { it.valid } ?: return@ScanScreen false
                                    if (callOpenNow || id == null) return@ScanScreen false
                                    // 방금 이름이 안 맞았던 같은 줄은 다시 보내지 않고 멈춘 채 메시지를 보인다.
                                    if (mrz.raw == lastProofRaw) {
                                        scanError = mismatch
                                        proofHeld = true
                                        return@ScanScreen false
                                    }
                                    scanError = null
                                    when (val result = model.prove(id, mrz.raw)) {
                                        // 맞다 — 찍은 여권을 대표자 것으로 이어 받아 보통 길로(F2 · 이미 체크인이면 T1c). 다시 찍지 않는다.
                                        is ProveResult.Matched -> {
                                            foundStay(result.found, state.contract?.languages.orEmpty(), shot)
                                            true
                                        }
                                        ProveResult.Unreadable -> {
                                            scanError = retryHint
                                            false
                                        }
                                        ProveResult.NameMismatch -> {
                                            scanError = mismatch
                                            lastProofRaw = mrz.raw
                                            proofHeld = true
                                            false
                                        }
                                        ProveResult.SessionGone -> {
                                            reset()
                                            true
                                        }
                                        is ProveResult.Blocked -> {
                                            blocked = result.blocked
                                            screen = Screen.Blocked
                                            true
                                        }
                                        is ProveResult.Locked -> {
                                            notFound = FindResult.Locked(result.untilMillis)
                                            screen = Screen.NotFound
                                            true
                                        }
                                        ProveResult.Network -> {
                                            scanError = networkError
                                            false
                                        }
                                        ProveResult.Server -> {
                                            scanError = serverError
                                            false
                                        }
                                    }
                                },
                            )
                        }
                        Screen.Find -> {
                            val networkError = str(R.string.error_network)
                            val serverError = str(R.string.error_server)
                            FindScreen(
                                form = form,
                                languageName = languageName(language),
                                error = findError,
                                onForm = {
                                    form = it
                                    findError = null
                                },
                                onBack = { screen = Screen.Scan },
                                onLanguage = { screen = Screen.Language },
                                onCall = { callOpen = true },
                                onSubmit = {
                                    when (val result = model.find(form.query())) {
                                        is FindResult.Found -> foundStay(result, state.contract?.languages.orEmpty(), null)
                                        is FindResult.ProofNeeded -> proofNeeded(result, state.contract?.languages.orEmpty())
                                        is FindResult.NotFound, is FindResult.Locked -> {
                                            notFound = result
                                            screen = Screen.NotFound
                                        }
                                        is FindResult.Blocked -> {
                                            blocked = result
                                            screen = Screen.Blocked
                                        }
                                        FindResult.Network -> findError = networkError
                                        FindResult.Server -> findError = serverError
                                    }
                                },
                            )
                        }
                        Screen.NotFound -> NotFoundScreen(
                            form = form,
                            remaining = (notFound as? FindResult.NotFound)?.remaining ?: 0,
                            lockedUntil = (notFound as? FindResult.Locked)?.untilMillis,
                            onBack = { screen = if (proofSession != null) Screen.Proof else Screen.Scan },
                            onCall = { callOpen = true },
                            onRetry = { screen = if (proofSession != null) Screen.Proof else Screen.Scan },
                        )
                        Screen.Blocked -> BlockedScreen(
                            reason = blocked?.reason ?: BlockReason.Expired,
                            checkInDate = blocked?.checkInDate,
                            onBack = { screen = Screen.Scan },
                            onCall = { callOpen = true },
                            onHome = reset,
                        )
                        Screen.CheckedIn -> stay?.let { current ->
                            CheckedInScreen(
                                stay = current,
                                onBack = { screen = Screen.Scan },
                                onCall = { callOpen = true },
                                onRoom = {
                                    doneFromFast = false
                                    screen = Screen.Done
                                },
                                onMore = { callOpen = true },
                                onHome = reset,
                            )
                        }
                        Screen.Fast -> {
                            val current = stay
                            val id = session
                            if (current != null && id != null) {
                                FastCheckin(
                                    stay = current,
                                    first = firstShot,
                                    language = language,
                                    termsText = state.contract?.termsText.orEmpty(),
                                    actions = FastActions(
                                        save = { model.saveGuest(id, it) },
                                        setParty = { model.setParty(id, it) },
                                        saveRoute = { prev, next -> model.saveRoute(id, prev, next) },
                                        saveConsent = { model.saveConsent(id, language) },
                                        enqueuePassport = { guestId, jpeg -> model.enqueuePassport(id, guestId, jpeg) },
                                        enqueueFace = { guestId, file -> model.enqueueFace(id, guestId, file) },
                                        faceFailed = model::faceFailed,
                                        retryUploads = model::retryUploads,
                                        awaitUploads = model::awaitUploads,
                                    ),
                                    onStay = { stay = it },
                                    onSessionGone = reset,
                                    // 처음 화면(F1)으로 — 이 예약의 올리기 줄 · 임시 파일을 비운다(다음 손님에게 넘어가지 않게).
                                    onBack = {
                                        model.clearUploads()
                                        firstShot = null
                                        session = null
                                        stay = null
                                        screen = Screen.Scan
                                    },
                                    onCall = { callOpen = true },
                                    onStep = timer::enter,
                                    onDone = {
                                        timer.enter("done")
                                        timer.finish()
                                        doneFromFast = true
                                        screen = Screen.Done
                                    },
                                )
                            }
                        }
                        // G4 완료 — 방 번호 · 문 비밀번호. 비밀번호는 이 화면 상태에만 있고, 처음으로 돌아가면 화면과 함께 사라진다.
                        Screen.Done -> session?.let { id ->
                            CompletionScreen(
                                language = language,
                                idleSeconds = state.contract?.idleSecondsDone ?: 30,
                                paused = callOpen,
                                complete = { model.complete(id) },
                                onSessionGone = reset,
                                // 빠른 체크인 끝에서 명부가 덜 찼다고 하면 막다른 화면 대신 그 분들을 채우러 돌아간다(한 번만 — 다시 막히면 직원 호출).
                                onRoster = {
                                    if (doneFromFast && !rosterBounced) {
                                        rosterBounced = true
                                        doneFromFast = false
                                        firstShot = null
                                        screen = Screen.Fast
                                        true
                                    } else {
                                        false
                                    }
                                },
                                onCall = { callOpen = true },
                                onHome = reset,
                            )
                        }
                    }
                }
            }
            if (callOpen) {
                Box(Modifier.fillMaxSize().background(G.Bg).pointerInput(Unit) { detectTapGestures { } }) {
                    Localized(language) { StaffCallScreen(contacts = state.contract?.supportContacts.orEmpty(), onBack = { callOpen = false }) }
                }
            }
            // 직원 화면은 손님이 고른 언어가 아니라 기기 언어로.
            if (staff != StaffStep.Closed) {
                StaffOverlay(
                    step = staff,
                    pin = state.contract?.staffPin,
                    guard = model.pinGuard,
                    device = state.device,
                    locked = locked,
                    deviceOwner = Kiosk.isDeviceOwner(activity),
                    onStep = { staff = it },
                    onRefresh = { scope.launch { model.refreshSettings() } },
                    onUnlock = {
                        Kiosk.unlock(activity)
                        locked = false
                    },
                    onLock = {
                        Kiosk.lock(activity)
                        locked = Kiosk.isDeviceOwner(activity)
                    },
                    onReenroll = {
                        staff = StaffStep.Closed
                        model.forget()
                    },
                )
            }
        }
    }
}

@Composable
private fun Centered(text: String) {
    Column(Modifier.fillMaxSize().padding(64.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(text, color = G.Muted, fontSize = 19.sp)
        }
    }
}
