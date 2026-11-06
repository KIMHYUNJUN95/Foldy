package com.harutokyo.checkin.kiosk.call

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 서버 쪽(네트워크). 던지지 않는다 — 실패는 반환값으로. */
interface CallApi {
    suspend fun create(step: String, language: String, sessionId: String?, nowMs: Long): CreateResult
    /** null = 읽지 못했다. */
    suspend fun status(callId: String): PollStatus?
    suspend fun cancel(callId: String)
    suspend fun end(callId: String)
}

/** LiveKit 방. connect 는 실패하면 던진다. */
interface RoomGateway {
    /** 방이 끊겼다(서버가 닫음 · 재접속 실패). 바로 통화 끝. */
    var onRemoteLeft: (() -> Unit)?
    var onStaffJoined: (() -> Unit)?
    var onStaffLeft: (() -> Unit)?
    /** 지금 방에 직원(상대 참가자)이 있나. */
    val hasStaff: Boolean
    suspend fun connect(url: String, token: String)
    fun disconnect()
}

/**
 * [CallMachine] 의 효과를 실행한다(1.5초 폴링 · 입장 20초 제한 · 서버에 취소/끝 알림). 모든 호출은 한 스레드(Main)에서.
 * 서버에 보내는 취소/끝은 화면이 사라져도 끝까지 한 번 더 시도한다(NonCancellable) — 남은 통화가 직원 화면에서 울리지 않게.
 */
class CallController(
    private val scope: CoroutineScope,
    private val api: CallApi,
    private val room: RoomGateway,
    private val clock: () -> Long,
    private val pollMs: Long = 1_500,
    private val joinTimeoutMs: Long = 20_000,
    private val staffJoinMs: Long = 20_000,
    private val staffReturnMs: Long = 15_000,
    private val checkMs: Long = 30_000,
) {
    private val _state = MutableStateFlow<CallState>(CallState.Idle)
    val state: StateFlow<CallState> = _state.asStateFlow()
    private var attempt = 0
    private var sessionId: String? = null
    private var pollJob: Job? = null
    private var joinJob: Job? = null
    private var connectJob: Job? = null
    private var staffJob: Job? = null
    private var checkJob: Job? = null
    private var staffJobFor: StaffPresence? = null

    init {
        room.onRemoteLeft = { dispatch(CallEvent.RemoteLeft) }
        room.onStaffJoined = { dispatch(CallEvent.StaffJoined) }
        room.onStaffLeft = { dispatch(CallEvent.StaffLeft) }
    }

    /** [permitted] 가 false(카메라 · 마이크 권한 거부)이면 서버를 부르지 않고 바로 안내 화면으로. */
    fun start(step: String, language: String, sessionId: String? = null, permitted: Boolean = true) {
        if (_state.value !is CallState.Idle) return
        this.sessionId = sessionId
        if (!permitted) {
            _state.value = CallState.Failed(FailKind.Unavailable, step, language)
            return
        }
        dispatch(CallEvent.Press(++attempt, step, language))
    }

    /** [permitted] 가 false(권한이 아직 거부 상태)이면 서버를 부르지 않고 E3 를 그대로 둔다 — 직원 앱이 울리면 안 된다. */
    fun retry(permitted: Boolean = true) {
        if (!permitted) return
        dispatch(CallEvent.Retry(++attempt))
    }
    fun cancel() = dispatch(CallEvent.Cancel)
    fun dismiss() = dispatch(CallEvent.Dismiss)

    private fun dispatch(event: CallEvent) {
        val t = CallMachine.reduce(_state.value, event, clock())
        _state.value = t.state
        for (effect in t.effects) run(effect)
        syncJobs()
    }

    private fun run(effect: CallEffect) {
        when (effect) {
            is CallEffect.PostCall -> {
                val mine = attempt
                scope.launch {
                    when (val r = api.create(effect.step, effect.language, sessionId, clock())) {
                        is CreateResult.Ok -> dispatch(CallEvent.Created(mine, r.callId, r.deadlineMs))
                        is CreateResult.Rejected -> dispatch(CallEvent.Rejected(mine))
                    }
                }
            }
            is CallEffect.Cancel -> scope.launch { withContext(NonCancellable) { api.cancel(effect.callId) } }
            is CallEffect.End -> scope.launch { withContext(NonCancellable) { api.end(effect.callId) } }
            is CallEffect.Connect -> connectJob = scope.launch {
                val ok = try {
                    room.connect(effect.url, effect.token)
                    true
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (_: Throwable) {
                    false
                }
                dispatch(if (ok) CallEvent.Joined(room.hasStaff) else CallEvent.JoinFailed)
            }
            CallEffect.Disconnect -> runCatching { room.disconnect() }
        }
    }

    // 상태에 맞는 반복 작업만 살려 둔다: 울리는 동안 폴링, 입장하는 동안 20초 시계.
    private fun syncJobs() {
        syncStaffTimer()
        if (_state.value is CallState.Connected) {
            if (checkJob?.isActive != true) checkJob = scope.launch { checkLoop() }
        } else {
            checkJob?.cancel()
            checkJob = null
        }
        val s = _state.value
        if (s is CallState.Ringing) {
            if (pollJob?.isActive != true) pollJob = scope.launch { pollLoop() }
        } else {
            pollJob?.cancel()
            pollJob = null
        }
        // 입장 중이 아니게 되면(취소 · 시간 초과) 끝나지 않은 입장 시도도 멈춘다.
        if (s !is CallState.Joining) {
            connectJob?.cancel()
            connectJob = null
        }
        if (s is CallState.Joining) {
            if (joinJob?.isActive != true) joinJob = scope.launch {
                delay(joinTimeoutMs)
                dispatch(CallEvent.JoinTimeout)
            }
        } else {
            joinJob?.cancel()
            joinJob = null
        }
    }

    // 통화 중 직원이 없으면 시계를 돌린다: 처음 들어오기를 20초, 나간 뒤 돌아오기를 15초.
    private fun syncStaffTimer() {
        val s = _state.value
        val waitingFor = (s as? CallState.Connected)?.staff?.takeIf { it != StaffPresence.Present }
        if (waitingFor == staffJobFor && staffJob?.isActive == true) return
        staffJob?.cancel()
        staffJob = null
        staffJobFor = waitingFor
        if (waitingFor != null) staffJob = scope.launch {
            delay(if (waitingFor == StaffPresence.Never) staffJoinMs else staffReturnMs)
            dispatch(CallEvent.StaffTimeout)
        }
    }

    // 통화 중 30초마다 서버에 상태를 묻는다. 읽지 못하면(네트워크) 통화를 끊지 않는다.
    private suspend fun checkLoop() {
        while (true) {
            delay(checkMs)
            val s = _state.value as? CallState.Connected ?: return
            val result = api.status(s.callId)
            dispatch(if (result == null) CallEvent.PollFailed else CallEvent.Polled(result))
            if (_state.value !is CallState.Connected) return
        }
    }

    private suspend fun pollLoop() {
        while (true) {
            delay(pollMs)
            val s = _state.value as? CallState.Ringing ?: return
            val result = api.status(s.callId)
            if (_state.value !== s && _state.value !is CallState.Ringing) return
            dispatch(if (result == null) CallEvent.PollFailed else CallEvent.Polled(result))
            dispatch(CallEvent.Tick(clock()))
            if (_state.value !is CallState.Ringing) return
        }
    }
}
