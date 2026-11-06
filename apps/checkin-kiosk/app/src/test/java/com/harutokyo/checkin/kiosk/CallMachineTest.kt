package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.call.CallEffect
import com.harutokyo.checkin.kiosk.call.CallEvent
import com.harutokyo.checkin.kiosk.call.CallMachine
import com.harutokyo.checkin.kiosk.call.CallState
import com.harutokyo.checkin.kiosk.call.FailKind
import com.harutokyo.checkin.kiosk.call.StaffPresence
import com.harutokyo.checkin.kiosk.call.PollStatus
import com.harutokyo.checkin.kiosk.call.callStepOf
import com.harutokyo.checkin.kiosk.call.callUiActive
import org.junit.Assert.assertEquals
import org.junit.Test

// 직원 통화 상태 기계(46 §6). 손님을 멈추지 않는다 — 모든 실패는 Failed(E3) 로 이어지고 Dismiss 로 누른 자리에 돌아간다.
class CallMachineTest {
    private val m = CallMachine

    private fun ringing(deadline: Long = 45_000) = CallState.Ringing(1, "c1", "passport", "en", deadline)
    private fun joining() = CallState.Joining("c1", "passport", "en", since = 10_000)
    private fun connected() = CallState.Connected("c1", since = 12_000, step = "passport", language = "en")

    private fun press() = m.reduce(CallState.Idle, CallEvent.Press(1, "passport", "en"))

    @Test fun pressStartsRequestingAndPostsCall() {
        val t = press()
        assertEquals(CallState.Requesting(1, "passport", "en"), t.state)
        assertEquals(listOf<CallEffect>(CallEffect.PostCall("passport", "en")), t.effects)
    }

    @Test fun pressIsIgnoredWhileACallIsRunning() {
        for (s in listOf(CallState.Requesting(1, "a", "en"), ringing(), joining(), connected())) {
            val t = m.reduce(s, CallEvent.Press(2, "face", "ja"))
            assertEquals(s, t.state)
            assertEquals(emptyList<CallEffect>(), t.effects)
        }
    }

    @Test fun createdMovesToRinging() {
        val t = m.reduce(CallState.Requesting(1, "passport", "en"), CallEvent.Created(1, "c1", 45_000))
        assertEquals(ringing(), t.state)
        assertEquals(emptyList<CallEffect>(), t.effects)
    }

    @Test fun rejectedAndNetworkLeadToUnavailable() {
        val t = m.reduce(CallState.Requesting(1, "passport", "en"), CallEvent.Rejected(1))
        assertEquals(CallState.Failed(FailKind.Unavailable, "passport", "en"), t.state)
    }

    @Test fun cancelWhileRequestingGoesIdleAndLateCreatedIsCancelledOnServer() {
        val c = m.reduce(CallState.Requesting(1, "passport", "en"), CallEvent.Cancel)
        assertEquals(CallState.Idle, c.state)
        val late = m.reduce(c.state, CallEvent.Created(1, "c9", 45_000))
        assertEquals(CallState.Idle, late.state)
        assertEquals(listOf<CallEffect>(CallEffect.Cancel("c9")), late.effects)
    }

    @Test fun lateRejectedAfterCancelIsIgnored() {
        val t = m.reduce(CallState.Idle, CallEvent.Rejected(1))
        assertEquals(CallState.Idle, t.state)
    }

    @Test fun lateCreatedWhileANewerAttemptIsInFlightIsLeftAlone() {
        // 서버는 새 호출 때 낡은 행을 먼저 닫거나 같은 통화를 다시 내준다 — 여기서 취소하면 새 통화를 죽일 수 있다.
        val t = m.reduce(CallState.Requesting(2, "passport", "en"), CallEvent.Created(1, "old", 45_000))
        assertEquals(CallState.Requesting(2, "passport", "en"), t.state)
        assertEquals(emptyList<CallEffect>(), t.effects)
    }

    @Test fun lateCreatedWithTheSameIdAsTheRunningCallIsNeverCancelled() {
        for (s in listOf(ringing(), joining(), connected())) {
            val t = m.reduce(s, CallEvent.Created(1, "c1", 45_000))
            assertEquals(s, t.state)
            assertEquals(emptyList<CallEffect>(), t.effects)
        }
    }

    @Test fun lateCreatedWithAnotherIdWhileRingingIsCancelled() {
        val t = m.reduce(ringing(), CallEvent.Created(0, "stale", 45_000))
        assertEquals(listOf<CallEffect>(CallEffect.Cancel("stale")), t.effects)
    }

    @Test fun connectedPollAboutEndedCallEndsWithoutTellingServer() {
        for (p in listOf(PollStatus.Ended, PollStatus.Canceled, PollStatus.Failed, PollStatus.NoAnswer, PollStatus.Gone)) {
            val t = m.reduce(connected(), CallEvent.Polled(p))
            assertEquals(p.toString(), CallState.Idle, t.state)
            assertEquals(listOf<CallEffect>(CallEffect.Disconnect), t.effects)
        }
    }

    @Test fun connectedPollStillAcceptedOrFailedReadKeepsTheCall() {
        assertEquals(connected(), m.reduce(connected(), CallEvent.Polled(PollStatus.Accepted("t", "u"))).state)
        assertEquals(connected(), m.reduce(connected(), CallEvent.Polled(PollStatus.Ringing)).state)
        assertEquals(connected(), m.reduce(connected(), CallEvent.PollFailed).state)
    }

    @Test fun pollRingingStays() {
        assertEquals(ringing(), m.reduce(ringing(), CallEvent.Polled(PollStatus.Ringing)).state)
    }

    @Test fun pollAcceptedJoinsRoom() {
        val t = m.reduce(ringing(), CallEvent.Polled(PollStatus.Accepted("tok", "wss://x")), nowMs = 10_000)
        assertEquals(joining(), t.state)
        assertEquals(listOf<CallEffect>(CallEffect.Connect("wss://x", "tok")), t.effects)
    }

    @Test fun pollAcceptedWithoutTokenFailsAndEnds() {
        val t = m.reduce(ringing(), CallEvent.Polled(PollStatus.Accepted(null, null)))
        assertEquals(CallState.Failed(FailKind.Unavailable, "passport", "en"), t.state)
        assertEquals(listOf<CallEffect>(CallEffect.End("c1")), t.effects)
    }

    @Test fun pollNoAnswerShowsNoOneAnswered() {
        val t = m.reduce(ringing(), CallEvent.Polled(PollStatus.NoAnswer))
        assertEquals(CallState.Failed(FailKind.NoAnswer, "passport", "en"), t.state)
        assertEquals(emptyList<CallEffect>(), t.effects)
    }

    @Test fun pollCanceledFailedEndedGoneAreUnavailable() {
        for (p in listOf(PollStatus.Canceled, PollStatus.Failed, PollStatus.Ended, PollStatus.Gone)) {
            val t = m.reduce(ringing(), CallEvent.Polled(p))
            assertEquals(p.toString(), CallState.Failed(FailKind.Unavailable, "passport", "en"), t.state)
        }
    }

    @Test fun pollFailureKeepsRingingUntilDeadlinePlusGrace() {
        assertEquals(ringing(), m.reduce(ringing(), CallEvent.PollFailed).state)
        assertEquals(ringing(), m.reduce(ringing(), CallEvent.Tick(45_000 + 7_999)).state)
        val t = m.reduce(ringing(), CallEvent.Tick(45_000 + 8_001))
        assertEquals(CallState.Failed(FailKind.NoAnswer, "passport", "en"), t.state)
        assertEquals(listOf<CallEffect>(CallEffect.Cancel("c1")), t.effects)
    }

    @Test fun cancelWhileRingingCancelsOnServer() {
        val t = m.reduce(ringing(), CallEvent.Cancel)
        assertEquals(CallState.Idle, t.state)
        assertEquals(listOf<CallEffect>(CallEffect.Cancel("c1")), t.effects)
    }

    @Test fun pollAfterCancelRaceIsIgnored() {
        val t = m.reduce(CallState.Idle, CallEvent.Polled(PollStatus.Accepted("t", "u")))
        assertEquals(CallState.Idle, t.state)
        assertEquals(emptyList<CallEffect>(), t.effects)
    }

    @Test fun joinedConnects() {
        val t = m.reduce(joining(), CallEvent.Joined(), nowMs = 12_000)
        assertEquals(connected(), t.state)
    }

    @Test fun joinFailureAndTimeoutFallToUnavailableAndTearDown() {
        for (e in listOf(CallEvent.JoinFailed, CallEvent.JoinTimeout)) {
            val t = m.reduce(joining(), e)
            assertEquals(CallState.Failed(FailKind.Unavailable, "passport", "en"), t.state)
            assertEquals(listOf(CallEffect.Disconnect, CallEffect.End("c1")), t.effects)
        }
    }

    @Test fun cancelWhileJoiningDisconnectsAndEnds() {
        val t = m.reduce(joining(), CallEvent.Cancel)
        assertEquals(CallState.Idle, t.state)
        assertEquals(listOf(CallEffect.Disconnect, CallEffect.End("c1")), t.effects)
    }

    @Test fun hangUpEndsCall() {
        val t = m.reduce(connected(), CallEvent.Cancel)
        assertEquals(CallState.Idle, t.state)
        assertEquals(listOf(CallEffect.Disconnect, CallEffect.End("c1")), t.effects)
    }

    @Test fun staffLeavingEndsCallBackToIdle() {
        for (s in listOf(joining(), connected())) {
            val t = m.reduce(s, CallEvent.RemoteLeft)
            assertEquals(CallState.Idle, t.state)
            assertEquals(listOf(CallEffect.Disconnect, CallEffect.End("c1")), t.effects)
        }
    }

    @Test fun lateJoinAfterCancelIsDisconnected() {
        val t = m.reduce(CallState.Idle, CallEvent.Joined())
        assertEquals(CallState.Idle, t.state)
        assertEquals(listOf<CallEffect>(CallEffect.Disconnect), t.effects)
    }

    @Test fun lateJoinFailureAfterCancelIsQuiet() {
        val t = m.reduce(CallState.Idle, CallEvent.JoinFailed)
        assertEquals(CallState.Idle, t.state)
        assertEquals(emptyList<CallEffect>(), t.effects)
    }

    @Test fun tickDoesNothingOutsideRinging() {
        for (s in listOf(CallState.Idle, joining(), connected())) {
            assertEquals(s, m.reduce(s, CallEvent.Tick(10_000_000)).state)
        }
    }

    @Test fun dismissFromFailedGoesIdle() {
        val failed = CallState.Failed(FailKind.NoAnswer, "face", "ko")
        assertEquals(CallState.Idle, m.reduce(failed, CallEvent.Dismiss).state)
        assertEquals(CallState.Idle, m.reduce(failed, CallEvent.Cancel).state)
    }

    @Test fun retryFromFailedCallsAgainWithSameStep() {
        val failed = CallState.Failed(FailKind.NoAnswer, "face", "ko")
        val t = m.reduce(failed, CallEvent.Retry(2))
        assertEquals(CallState.Requesting(2, "face", "ko"), t.state)
        assertEquals(listOf<CallEffect>(CallEffect.PostCall("face", "ko")), t.effects)
    }

    @Test fun retryOutsideFailedIsIgnored() {
        assertEquals(CallState.Idle, m.reduce(CallState.Idle, CallEvent.Retry(2)).state)
        assertEquals(ringing(), m.reduce(ringing(), CallEvent.Retry(2)).state)
    }

    @Test fun stepIsTheScreenTheGuestPressedFrom() {
        assertEquals("welcome", callStepOf("language", null))
        assertEquals("passport", callStepOf("scan", null))
        assertEquals("passport", callStepOf("proof", null))
        assertEquals("find", callStepOf("find", null))
        assertEquals("find", callStepOf("notfound", null))
        assertEquals("find", callStepOf("blocked", null))
        assertEquals("find", callStepOf("checkedin", null))
        assertEquals("done", callStepOf("done", null))
        assertEquals("find", callStepOf("fast", "f2"))
        assertEquals("passport", callStepOf("fast", "passport 2"))
        assertEquals("passport", callStepOf("fast", "review"))
        assertEquals("face", callStepOf("fast", "face 1"))
        assertEquals("address", callStepOf("fast", "address"))
        assertEquals("other", callStepOf("fast", "final"))
        assertEquals("other", callStepOf("fast", null))
        assertEquals("other", callStepOf("whatever", null))
    }

    // 직원 미입장 · 이탈 규칙(46 §6): 입장 뒤 20초 안에 안 들어오면 E3, 통화 중 나간 뒤 15초 안에 안 돌아오면 끝.
    private fun waiting() = CallState.Connected("c1", since = 12_000, staff = StaffPresence.Never, step = "passport", language = "en")
    private fun present() = CallState.Connected("c1", since = 12_000, staff = StaffPresence.Present, step = "passport", language = "en")
    private fun gone() = CallState.Connected("c1", since = 12_000, staff = StaffPresence.Gone, step = "passport", language = "en")

    @Test fun joinedWithStaffAlreadyInRoomIsPresent() {
        assertEquals(present(), m.reduce(joining(), CallEvent.Joined(staffPresent = true), nowMs = 12_000).state)
        assertEquals(waiting(), m.reduce(joining(), CallEvent.Joined(), nowMs = 12_000).state)
    }

    @Test fun staffJoinAndLeaveMoveBetweenPresenceStates() {
        assertEquals(present(), m.reduce(waiting(), CallEvent.StaffJoined).state)
        assertEquals(gone(), m.reduce(present(), CallEvent.StaffLeft).state)
        assertEquals(present(), m.reduce(gone(), CallEvent.StaffJoined).state)
    }

    @Test fun staffNeverCameFallsToE3AndEnds() {
        val t = m.reduce(waiting(), CallEvent.StaffTimeout)
        assertEquals(CallState.Failed(FailKind.Unavailable, "passport", "en"), t.state)
        assertEquals(listOf(CallEffect.Disconnect, CallEffect.End("c1")), t.effects)
    }

    @Test fun staffGoneTooLongEndsTheCallBackToIdle() {
        val t = m.reduce(gone(), CallEvent.StaffTimeout)
        assertEquals(CallState.Idle, t.state)
        assertEquals(listOf(CallEffect.Disconnect, CallEffect.End("c1")), t.effects)
    }

    @Test fun staffTimeoutWhilePresentOrElsewhereDoesNothing() {
        for (s in listOf(present(), CallState.Idle, joining(), ringing())) {
            assertEquals(s, m.reduce(s, CallEvent.StaffTimeout).state)
        }
    }

    @Test fun staffEventsOutsideAConnectedCallAreIgnored() {
        for (s in listOf(CallState.Idle, joining(), ringing())) {
            assertEquals(s, m.reduce(s, CallEvent.StaffJoined).state)
            assertEquals(s, m.reduce(s, CallEvent.StaffLeft).state)
        }
    }

    @Test fun roomGoneStillEndsAtOnce() {
        assertEquals(CallState.Idle, m.reduce(gone(), CallEvent.RemoteLeft).state)
    }
}

// 연락처 화면은 설정이 바뀌어도 그대로 — 통화 화면 · 카메라 hold 는 통화를 시작했거나 권한을 기다리는 동안에만.
class CallUiModeTest {
    @Test fun contactsScreenStaysWhenNoCallWasStarted() {
        assertEquals(false, callUiActive(callLive = false, permissionPending = false))
    }

    @Test fun callScreenWhileLiveOrWaitingForPermission() {
        assertEquals(true, callUiActive(callLive = true, permissionPending = false))
        assertEquals(true, callUiActive(callLive = false, permissionPending = true))
    }
}
