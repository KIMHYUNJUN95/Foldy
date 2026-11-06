package com.harutokyo.checkin.kiosk.call

// 직원 통화 흐름 판단(46 §3 · §6). 화면 · 네트워크와 떨어진 순수 상태 기계 — 효과(CallEffect)는 CallController 가 실행한다.
// 원칙: 손님을 멈추지 않는다. 어떤 실패도 Failed(E3)로 이어지고, Dismiss 로 누른 자리에 돌아간다.

enum class FailKind { NoAnswer, Unavailable }

/** 방 안의 직원: 아직 안 들어옴(입장 뒤 20초) · 있음 · 나갔다(15초 안에 돌아와야 한다). */
enum class StaffPresence { Never, Present, Gone }

sealed interface CallState {
    data object Idle : CallState

    /** 서버에 호출을 만드는 중. [attempt] 는 취소 뒤 늦게 오는 앞 호출의 응답과 구별하는 번호. */
    data class Requesting(val attempt: Int, val step: String, val language: String) : CallState

    /** 울리는 중(E1). [deadlineMs] 는 기기 시계 기준 마감 — 서버가 no_answer 를 알려 주는 게 정상 경로, 이건 응답이 끊겼을 때의 안전망. */
    data class Ringing(val attempt: Int, val callId: String, val step: String, val language: String, val deadlineMs: Long) : CallState

    data class Joining(val callId: String, val step: String, val language: String, val since: Long) : CallState
    data class Connected(val callId: String, val since: Long, val staff: StaffPresence = StaffPresence.Never, val step: String = "other", val language: String = "ja") : CallState

    /** E3. step · language 는 「다시 부르기」용. */
    data class Failed(val kind: FailKind, val step: String, val language: String) : CallState
}

sealed interface PollStatus {
    data object Ringing : PollStatus
    data class Accepted(val token: String?, val url: String?) : PollStatus
    data object NoAnswer : PollStatus
    data object Canceled : PollStatus
    data object Failed : PollStatus
    data object Ended : PollStatus

    /** 404 · 401 — 이 기기의 통화가 아니다. */
    data object Gone : PollStatus
}

sealed interface CallEvent {
    data class Press(val attempt: Int, val step: String, val language: String) : CallEvent
    data class Created(val attempt: Int, val callId: String, val deadlineMs: Long) : CallEvent
    /** 호출을 만들지 못했다(꺼짐 · 설정 없음 · 네트워크 · 서버 오류 · 권한 거부 전부). */
    data class Rejected(val attempt: Int) : CallEvent
    data class Polled(val status: PollStatus) : CallEvent
    data object PollFailed : CallEvent
    data class Tick(val nowMs: Long) : CallEvent
    /** [staffPresent]: 입장 순간 직원이 이미 방에 있었다. */
    data class Joined(val staffPresent: Boolean = false) : CallEvent
    data object StaffJoined : CallEvent
    data object StaffLeft : CallEvent
    /** 직원 기다림 시간 초과(Never 20초 · Gone 15초). */
    data object StaffTimeout : CallEvent
    data object JoinFailed : CallEvent
    data object JoinTimeout : CallEvent
    data object RemoteLeft : CallEvent
    /** 손님이 취소 · 끊기 · 뒤로 가기, 또는 화면을 떠남 · 앱이 백그라운드로 감 — 지금 상태에 맞게 정리한다. */
    data object Cancel : CallEvent
    data object Dismiss : CallEvent
    data class Retry(val attempt: Int) : CallEvent
}

sealed interface CallEffect {
    data class PostCall(val step: String, val language: String) : CallEffect
    data class Cancel(val callId: String) : CallEffect
    data class End(val callId: String) : CallEffect
    data class Connect(val url: String, val token: String) : CallEffect
    data object Disconnect : CallEffect
}

data class Transition(val state: CallState, val effects: List<CallEffect> = emptyList())

object CallMachine {
    /** 서버가 no_answer 로 바꾼 뒤 우리가 기다려 주는 여유 — 응답이 끊겨도 이만큼 지나면 E3 로 보낸다. */
    const val GRACE_MS = 8_000L

    fun reduce(state: CallState, event: CallEvent, nowMs: Long = 0L): Transition = when (event) {
        is CallEvent.Press ->
            if (state is CallState.Idle) Transition(CallState.Requesting(event.attempt, event.step, event.language), listOf(CallEffect.PostCall(event.step, event.language)))
            else Transition(state)

        is CallEvent.Retry ->
            if (state is CallState.Failed) Transition(CallState.Requesting(event.attempt, state.step, state.language), listOf(CallEffect.PostCall(state.step, state.language)))
            else Transition(state)

        is CallEvent.Created -> when {
            state is CallState.Requesting && state.attempt == event.attempt ->
                Transition(CallState.Ringing(state.attempt, event.callId, state.step, state.language, event.deadlineMs))
            // 취소했거나 다른 호출로 넘어간 뒤 늦게 온 응답. 아무 통화도 없으면 서버에 만들어진 호출을 닫는다.
            // 새 호출이 진행 중(서버가 낡은 행을 스스로 닫거나 같은 통화를 다시 내준다)이거나 같은 통화가 이미 이어지고 있으면 건드리지 않는다.
            state is CallState.Requesting || runningCallId(state) == event.callId -> Transition(state)
            else -> Transition(state, listOf(CallEffect.Cancel(event.callId)))
        }

        is CallEvent.Rejected ->
            if (state is CallState.Requesting && state.attempt == event.attempt) Transition(CallState.Failed(FailKind.Unavailable, state.step, state.language))
            else Transition(state)

        is CallEvent.Polled -> when (state) {
            is CallState.Ringing -> polled(state, event.status, nowMs)
            // 통화 중 30초마다 서버에 묻는다(권한 회수 · 30분 한도). 서버가 이미 닫았거나 모르는 통화면 end 없이 끝낸다.
            is CallState.Connected -> when (event.status) {
                PollStatus.Ringing, is PollStatus.Accepted -> Transition(state)
                else -> Transition(CallState.Idle, listOf(CallEffect.Disconnect))
            }
            else -> Transition(state)
        }

        CallEvent.PollFailed -> Transition(state)

        is CallEvent.Tick ->
            if (state is CallState.Ringing && event.nowMs > state.deadlineMs + GRACE_MS) {
                Transition(CallState.Failed(FailKind.NoAnswer, state.step, state.language), listOf(CallEffect.Cancel(state.callId)))
            } else {
                Transition(state)
            }

        is CallEvent.Joined -> when (state) {
            is CallState.Joining -> Transition(CallState.Connected(state.callId, nowMs, if (event.staffPresent) StaffPresence.Present else StaffPresence.Never, state.step, state.language))
            // 취소한 뒤 늦게 입장이 끝났다 — 바로 나간다.
            is CallState.Idle -> Transition(state, listOf(CallEffect.Disconnect))
            else -> Transition(state)
        }

        CallEvent.JoinFailed, CallEvent.JoinTimeout ->
            if (state is CallState.Joining) Transition(CallState.Failed(FailKind.Unavailable, state.step, state.language), listOf(CallEffect.Disconnect, CallEffect.End(state.callId)))
            else Transition(state)

        CallEvent.StaffJoined ->
            if (state is CallState.Connected) Transition(state.copy(staff = StaffPresence.Present)) else Transition(state)

        CallEvent.StaffLeft ->
            if (state is CallState.Connected && state.staff == StaffPresence.Present) Transition(state.copy(staff = StaffPresence.Gone)) else Transition(state)

        CallEvent.StaffTimeout -> when {
            state is CallState.Connected && state.staff == StaffPresence.Never -> {
                // 들어온 직원이 없다 — 빈 통화 화면에 가두지 않는다(E3, 「다시 부르기」는 같은 단계로).
                Transition(CallState.Failed(FailKind.Unavailable, state.step, state.language), teardown(state.callId))
            }
            state is CallState.Connected && state.staff == StaffPresence.Gone -> Transition(CallState.Idle, teardown(state.callId))
            else -> Transition(state)
        }

        CallEvent.RemoteLeft -> when (state) {
            is CallState.Joining -> Transition(CallState.Idle, teardown(state.callId))
            is CallState.Connected -> Transition(CallState.Idle, teardown(state.callId))
            else -> Transition(state)
        }

        CallEvent.Cancel -> when (state) {
            is CallState.Ringing -> Transition(CallState.Idle, listOf(CallEffect.Cancel(state.callId)))
            is CallState.Joining -> Transition(CallState.Idle, teardown(state.callId))
            is CallState.Connected -> Transition(CallState.Idle, teardown(state.callId))
            else -> Transition(CallState.Idle)
        }

        CallEvent.Dismiss -> if (state is CallState.Failed) Transition(CallState.Idle) else Transition(state)
    }

    private fun runningCallId(state: CallState): String? = when (state) {
        is CallState.Ringing -> state.callId
        is CallState.Joining -> state.callId
        is CallState.Connected -> state.callId
        else -> null
    }

    private fun teardown(callId: String) = listOf(CallEffect.Disconnect, CallEffect.End(callId))

    private fun polled(state: CallState.Ringing, status: PollStatus, nowMs: Long): Transition = when (status) {
        PollStatus.Ringing -> Transition(state)
        is PollStatus.Accepted -> {
            val url = status.url?.takeIf { it.isNotBlank() }
            val token = status.token?.takeIf { it.isNotBlank() }
            if (url != null && token != null) Transition(CallState.Joining(state.callId, state.step, state.language, nowMs), listOf(CallEffect.Connect(url, token)))
            else Transition(CallState.Failed(FailKind.Unavailable, state.step, state.language), listOf(CallEffect.End(state.callId)))
        }
        PollStatus.NoAnswer -> Transition(CallState.Failed(FailKind.NoAnswer, state.step, state.language))
        PollStatus.Canceled, PollStatus.Failed, PollStatus.Ended, PollStatus.Gone ->
            Transition(CallState.Failed(FailKind.Unavailable, state.step, state.language))
    }
}

/** 누른 자리 → 서버가 받는 단계 값(46 §4: welcome · find · passport · face · address · done · other). [fastStep] 은 빠른 체크인 안의 단계(StepTimer 이름). */
fun callStepOf(screen: String, fastStep: String?): String = when (screen) {
    "language" -> "welcome"
    "scan", "proof" -> "passport"
    "find", "notfound", "blocked", "checkedin" -> "find"
    "done" -> "done"
    "fast" -> when {
        fastStep == null -> "other"
        fastStep == "f2" -> "find"
        fastStep.startsWith("passport") || fastStep == "review" -> "passport"
        fastStep.startsWith("face") -> "face"
        fastStep == "address" -> "address"
        else -> "other"
    }
    else -> "other"
}

/**
 * 열린 직원 호출 창이 통화 화면(E1~E3 · 카메라 hold)인가, 연락처 화면인가. 설정 켜짐 여부가 아니라 「열 때 통화를 시작했나」로 정한다 —
 * 연락처 화면이 열린 채 설정이 켜져도 호출 없는 E1 이 뜨지 않고, 통화 중 설정이 꺼져도 통화 화면을 지킨다.
 */
fun callUiActive(callLive: Boolean, permissionPending: Boolean): Boolean = callLive || permissionPending
