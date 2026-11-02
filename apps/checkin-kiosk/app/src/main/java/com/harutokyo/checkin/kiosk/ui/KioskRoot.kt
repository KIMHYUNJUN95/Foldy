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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
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
import com.harutokyo.checkin.kiosk.contract.KioskStay
import com.harutokyo.checkin.kiosk.contract.SaveResult
import com.harutokyo.checkin.kiosk.data.KioskViewModel
import com.harutokyo.checkin.kiosk.data.Phase
import com.harutokyo.checkin.kiosk.kiosk.Kiosk
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 화면 흐름(16 §5): 등록 안 됨 → E 등록 / 등록됨 → G1 언어 → G2 메뉴 → T1 찾기 → T2 명부 → T3 여권 · 확인 → T3s 어디서 · 어디로 → G3b 동의(→ 다음 묶음: 동영상 · 완료).
// 찾기 결과: 못 찾음 T1x · 지금은 못 함 T1b · 이미 체크인 T1c.
// 손님이 손을 떼고 idleSecondsInput(기본 240초) 지나면 G1 로 돌아간다(FR-K12).

private val PHRASE_BREAK = LineBreak(LineBreak.Strategy.HighQuality, LineBreak.Strictness.Default, LineBreak.WordBreak.Phrase)

private enum class Screen { Language, Menu, Find, NotFound, Blocked, CheckedIn, Guests, Passport, Consent, ComingNext }

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
    var notFound by remember { mutableStateOf<FindResult?>(null) }
    var blocked by remember { mutableStateOf<FindResult.Blocked?>(null) }
    var session by remember { mutableStateOf<String?>(null) }
    var stay by remember { mutableStateOf<KioskStay?>(null) }
    val reset = {
        screen = Screen.Language
        language = "ja"
        form = FindForm()
        findError = null
        notFound = null
        blocked = null
        session = null
        stay = null
    }
    val scope = rememberCoroutineScope()
    val activity = LocalActivity.current!!

    // 뒤로 가기로 앱을 나가지 못하게 — 화면 안 뒤로 버튼만 쓴다.
    BackHandler { reset() }

    // 손님 화면이든 직원 PIN · 메뉴든 손을 떼고 idleSecondsInput 지나면 G1 로(직원 창이 열린 채 남지 않게).
    val idleSeconds = state.contract?.idleSecondsInput ?: 240
    LaunchedEffect(screen, staff, lastTouch, idleSeconds) {
        if (screen == Screen.Language && staff == StaffStep.Closed) return@LaunchedEffect
        delay(idleSeconds * 1000L)
        reset()
        staff = StaffStep.Closed
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
                            onCall = { screen = Screen.ComingNext },
                            onPick = { code ->
                                language = code
                                screen = Screen.Menu
                            },
                        )
                        Screen.Menu -> MenuScreen(
                            language = language,
                            onBack = reset,
                            onLanguage = { screen = Screen.Language },
                            onPick = { screen = if (it == "checkin") Screen.Find else Screen.ComingNext },
                        )
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
                                onBack = { screen = Screen.Menu },
                                onLanguage = { screen = Screen.Language },
                                onCall = { screen = Screen.ComingNext },
                                onSubmit = {
                                    when (val result = model.find(form.query())) {
                                        is FindResult.Found -> {
                                            session = result.sessionId
                                            stay = result.stay
                                            // 예약 언어가 있으면 그 언어로(FR-K01) — 이 건물이 쓰는 언어일 때만.
                                            val languages = state.contract?.languages.orEmpty()
                                            if (result.language != null && result.language in languages) language = result.language
                                            screen = if (result.checkedIn) Screen.CheckedIn else Screen.Guests
                                        }
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
                            onBack = { screen = Screen.Find },
                            onCall = { screen = Screen.ComingNext },
                            onRetry = { screen = Screen.Find },
                        )
                        Screen.Blocked -> BlockedScreen(
                            reason = blocked?.reason ?: BlockReason.Expired,
                            checkInDate = blocked?.checkInDate,
                            onBack = { screen = Screen.Find },
                            onCall = { screen = Screen.ComingNext },
                            onHome = reset,
                        )
                        Screen.CheckedIn -> stay?.let { current ->
                            CheckedInScreen(
                                stay = current,
                                onBack = { screen = Screen.Find },
                                onCall = { screen = Screen.ComingNext },
                                onRoom = { screen = Screen.ComingNext },
                                onMore = { screen = Screen.Guests },
                                onHome = reset,
                            )
                        }
                        Screen.Guests -> stay?.let { current ->
                            GuestsScreen(
                                stay = current,
                                onBack = { screen = Screen.Find },
                                onCall = { screen = Screen.ComingNext },
                                onParty = { size ->
                                    val updated = session?.let { model.setParty(it, size) }
                                    if (updated != null) stay = updated
                                    updated != null
                                },
                                onStart = { screen = if (current.guests.isNotEmpty() && emptySeats(current) == 0 && !needsRoute(current)) afterGuests(current) else Screen.Passport },
                            )
                        }
                        Screen.Passport -> {
                            val current = stay
                            val id = session
                            if (current != null && id != null) {
                                PassportFlow(
                                    stay = current,
                                    onSave = { model.saveGuest(id, it) },
                                    onUpload = { guestId, jpeg -> model.uploadPassport(id, guestId, jpeg) },
                                    onRoute = { prev, next -> model.saveRoute(id, prev, next) },
                                    onStay = { stay = it },
                                    onSessionGone = reset,
                                    onBack = { screen = Screen.Guests },
                                    onCall = { screen = Screen.ComingNext },
                                    onDone = { screen = afterGuests(stay ?: current) },
                                )
                            }
                        }
                        Screen.Consent -> {
                            val id = session
                            if (id != null) {
                                ConsentScreen(
                                    termsText = state.contract?.termsText.orEmpty(),
                                    language = language,
                                    onBack = { screen = Screen.Guests },
                                    onCall = { screen = Screen.ComingNext },
                                    onAgree = {
                                        when (val saved = model.saveConsent(id, language)) {
                                            is SaveResult.Saved -> {
                                                stay = saved.stay
                                                // 다음 묶음: 확인 동영상 · 완료.
                                                screen = Screen.ComingNext
                                                true
                                            }
                                            SaveResult.SessionGone -> {
                                                reset()
                                                true
                                            }
                                            else -> false
                                        }
                                    },
                                )
                            }
                        }
                        Screen.ComingNext -> ComingNextScreen(onBack = { screen = Screen.Language })
                    }
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

/** 명부가 끝난 뒤 — 아직 동의 전이면 동의(G3b), 미리 동의했으면 다음 단계. */
private fun afterGuests(stay: KioskStay): Screen = if (stay.consented) Screen.ComingNext else Screen.Consent

@Composable
private fun Centered(text: String) {
    Column(Modifier.fillMaxSize().padding(64.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(text, color = G.Muted, fontSize = 19.sp)
        }
    }
}
