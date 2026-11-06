package com.harutokyo.checkin.kiosk

import com.harutokyo.checkin.kiosk.call.CallApi
import com.harutokyo.checkin.kiosk.call.CallController
import com.harutokyo.checkin.kiosk.call.CallState
import com.harutokyo.checkin.kiosk.call.CreateResult
import com.harutokyo.checkin.kiosk.call.FailKind
import com.harutokyo.checkin.kiosk.call.PollStatus
import com.harutokyo.checkin.kiosk.call.RoomGateway
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// 흐름 전체(가짜 서버 · 가짜 방). 시간은 가상 시계.
@OptIn(ExperimentalCoroutinesApi::class)
class CallControllerTest {
    private class FakeApi(val scope: TestScope) : CallApi {
        var createGate: CompletableDeferred<CreateResult>? = null
        var create: CreateResult = CreateResult.Ok("c1", 0)
        val polls = ArrayDeque<PollStatus?>()
        val log = mutableListOf<String>()
        var statusCalls = 0
        override suspend fun create(step: String, language: String, sessionId: String?, nowMs: Long): CreateResult {
            log += "create:$step:$language:${sessionId ?: "-"}"
            return createGate?.await() ?: (create.let { if (it is CreateResult.Ok) it.copy(deadlineMs = nowMs + 45_000) else it })
        }
        override suspend fun status(callId: String): PollStatus? { statusCalls++; return polls.removeFirstOrNull() ?: PollStatus.Ringing }
        override suspend fun cancel(callId: String) { log += "cancel:$callId" }
        override suspend fun end(callId: String) { log += "end:$callId" }
    }

    private class FakeRoom : RoomGateway {
        var gate: CompletableDeferred<Unit>? = null
        var fail = false
        var disconnects = 0
        override var onRemoteLeft: (() -> Unit)? = null
        override var onStaffJoined: (() -> Unit)? = null
        override var onStaffLeft: (() -> Unit)? = null
        override var hasStaff = false
        override suspend fun connect(url: String, token: String) {
            gate?.await()
            if (fail) error("boom")
        }
        override fun disconnect() { disconnects++ }
    }

    private fun TestScope.rig(): Triple<CallController, FakeApi, FakeRoom> {
        val api = FakeApi(this)
        val room = FakeRoom()
        val controller = CallController(
            // 통화 중 확인 · 직원 시계처럼 끝나지 않는 반복은 시험이 끝나면 함께 멈춘다.
            scope = backgroundScope,
            api = api,
            room = room,
            clock = { currentTime },
        )
        return Triple(controller, api, room)
    }

    @Test fun ringAcceptJoinTalkThenStaffLeaves() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = rig()
        api.polls += PollStatus.Ringing
        api.polls += PollStatus.Accepted("tok", "wss://x")
        c.start("passport", "en")
        runCurrent()
        assertTrue(c.state.value is CallState.Ringing)
        advanceTimeBy(1_500 * 2 + 10)
        runCurrent()
        assertTrue(c.state.value is CallState.Connected)
        room.onRemoteLeft!!.invoke()
        runCurrent()
        assertEquals(CallState.Idle, c.state.value)
        assertEquals(1, room.disconnects)
        assertTrue(api.log.contains("end:c1"))
    }

    @Test fun noAnswerFromServerShowsE3WithoutCancel() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = rig()
        api.polls += PollStatus.NoAnswer
        c.start("welcome", "ja")
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(CallState.Failed(FailKind.NoAnswer, "welcome", "ja"), c.state.value)
        assertTrue(api.log.none { it.startsWith("cancel") })
    }

    @Test fun cancelBeforeServerAnswersClosesTheLateCall() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = rig()
        api.createGate = CompletableDeferred()
        c.start("find", "ko")
        runCurrent()
        c.cancel()
        assertEquals(CallState.Idle, c.state.value)
        api.createGate!!.complete(CreateResult.Ok("late", currentTime + 45_000))
        runCurrent()
        assertEquals(CallState.Idle, c.state.value)
        assertTrue(api.log.contains("cancel:late"))
    }

    @Test fun joiningLongerThan20SecondsFallsToE3AndEnds() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = rig()
        room.gate = CompletableDeferred()
        api.polls += PollStatus.Accepted("tok", "wss://x")
        c.start("face", "en")
        advanceTimeBy(1_600)
        runCurrent()
        assertTrue(c.state.value is CallState.Joining)
        advanceTimeBy(20_100)
        runCurrent()
        assertEquals(CallState.Failed(FailKind.Unavailable, "face", "en"), c.state.value)
        assertEquals(1, room.disconnects)
        assertTrue(api.log.contains("end:c1"))
    }

    @Test fun roomConnectErrorFallsToE3() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = rig()
        room.fail = true
        api.polls += PollStatus.Accepted("tok", "wss://x")
        c.start("face", "en")
        advanceTimeBy(1_600)
        runCurrent()
        assertEquals(CallState.Failed(FailKind.Unavailable, "face", "en"), c.state.value)
    }

    @Test fun pollNetworkOutageEndsAsNoAnswerAfterDeadlinePlusGrace() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = rig()
        repeat(100) { api.polls += null }
        c.start("passport", "en")
        advanceTimeBy(45_000 + 7_000)
        runCurrent()
        assertTrue(c.state.value is CallState.Ringing)
        advanceTimeBy(3_000)
        runCurrent()
        assertEquals(CallState.Failed(FailKind.NoAnswer, "passport", "en"), c.state.value)
        assertTrue(api.log.contains("cancel:c1"))
    }

    @Test fun rejectedCreateShowsE3() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = rig()
        api.create = CreateResult.Rejected("disabled")
        c.start("welcome", "ja")
        runCurrent()
        assertEquals(CallState.Failed(FailKind.Unavailable, "welcome", "ja"), c.state.value)
    }

    @Test fun deniedPermissionGoesStraightToE3WithoutCallingServer() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = rig()
        c.start("welcome", "ja", permitted = false)
        runCurrent()
        assertEquals(CallState.Failed(FailKind.Unavailable, "welcome", "ja"), c.state.value)
        assertTrue(api.log.isEmpty())
    }

    @Test fun retryFromE3CallsAgainAndDismissGoesIdle() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = rig()
        api.polls += PollStatus.NoAnswer
        c.start("welcome", "ja")
        advanceTimeBy(2_000)
        runCurrent()
        c.retry()
        runCurrent()
        assertEquals(2, api.log.count { it.startsWith("create") })
        assertTrue(c.state.value is CallState.Ringing)
        c.cancel()
        assertEquals(CallState.Idle, c.state.value)
    }

    @Test fun teardownWhileConnectedDisconnectsAndEnds() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = rig()
        api.polls += PollStatus.Accepted("tok", "wss://x")
        c.start("welcome", "ja")
        advanceTimeBy(1_600)
        runCurrent()
        c.cancel()
        runCurrent()
        assertEquals(CallState.Idle, c.state.value)
        assertEquals(1, room.disconnects)
        assertTrue(api.log.contains("end:c1"))
    }

    @Test fun sessionIdIsSentAndKeptForRetry() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = rig()
        api.polls += PollStatus.NoAnswer
        c.start("face", "en", sessionId = "s1")
        advanceTimeBy(2_000)
        runCurrent()
        c.retry()
        runCurrent()
        assertEquals(listOf("create:face:en:s1", "create:face:en:s1"), api.log.filter { it.startsWith("create") })
    }

    private fun TestScope.connectedRig(staffInRoom: Boolean): Triple<CallController, FakeApi, FakeRoom> {
        val r = rig()
        r.third.hasStaff = staffInRoom
        r.second.polls += PollStatus.Accepted("tok", "wss://x")
        r.first.start("passport", "en")
        return r
    }

    @Test fun staffNeverJoining20SecondsAfterEntryFallsToE3AndEnds() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = connectedRig(false)
        advanceTimeBy(1_600)
        runCurrent()
        assertTrue(c.state.value is CallState.Connected)
        advanceTimeBy(19_000)
        runCurrent()
        assertTrue(c.state.value is CallState.Connected)
        advanceTimeBy(1_500)
        runCurrent()
        assertEquals(CallState.Failed(FailKind.Unavailable, "passport", "en"), c.state.value)
        assertEquals(1, room.disconnects)
        assertTrue(api.log.contains("end:c1"))
    }

    @Test fun staffJoiningInTimeKeepsTheCall() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = connectedRig(false)
        advanceTimeBy(1_600)
        runCurrent()
        advanceTimeBy(10_000)
        room.onStaffJoined!!.invoke()
        advanceTimeBy(60_000)
        runCurrent()
        assertTrue(c.state.value is CallState.Connected)
        assertTrue(api.log.none { it.startsWith("end") })
    }

    @Test fun staffAlreadyInRoomOnEntryNeedsNoWait() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = connectedRig(true)
        advanceTimeBy(1_600)
        runCurrent()
        advanceTimeBy(120_000)
        runCurrent()
        assertTrue(c.state.value is CallState.Connected)
        assertTrue(api.log.none { it.startsWith("end") })
    }

    @Test fun staffLeavingAndNotReturningIn15SecondsEndsTheCall() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = connectedRig(true)
        advanceTimeBy(1_600)
        runCurrent()
        room.onStaffLeft!!.invoke()
        advanceTimeBy(14_000)
        runCurrent()
        assertTrue(c.state.value is CallState.Connected)
        advanceTimeBy(1_500)
        runCurrent()
        assertEquals(CallState.Idle, c.state.value)
        assertEquals(1, room.disconnects)
        assertTrue(api.log.contains("end:c1"))
    }

    @Test fun staffReturningWithin15SecondsKeepsTheCall() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = connectedRig(true)
        advanceTimeBy(1_600)
        runCurrent()
        room.onStaffLeft!!.invoke()
        advanceTimeBy(10_000)
        room.onStaffJoined!!.invoke()
        advanceTimeBy(60_000)
        runCurrent()
        assertTrue(c.state.value is CallState.Connected)
        assertTrue(api.log.none { it.startsWith("end") })
    }

    @Test fun connectedCallIsCheckedEvery30SecondsAndEndsWhenServerClosedIt() = runTest(StandardTestDispatcher()) {
        val (c, api, room) = connectedRig(true)
        advanceTimeBy(1_600)
        runCurrent()
        api.statusCalls = 0
        api.polls += PollStatus.Accepted("t", "u")
        advanceTimeBy(30_100)
        runCurrent()
        assertEquals(1, api.statusCalls)
        assertTrue(c.state.value is CallState.Connected)
        api.polls += PollStatus.Ended
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(CallState.Idle, c.state.value)
        assertEquals(1, room.disconnects)
        assertTrue(api.log.none { it.startsWith("end") })
    }

    @Test fun connectedCheckNotFoundEndsWithoutEnd() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = connectedRig(true)
        advanceTimeBy(1_600)
        runCurrent()
        api.polls += PollStatus.Gone
        advanceTimeBy(30_100)
        runCurrent()
        assertEquals(CallState.Idle, c.state.value)
        assertTrue(api.log.none { it.startsWith("end") })
    }

    @Test fun connectedCheckNetworkFailureDoesNotDropTheCall() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = connectedRig(true)
        advanceTimeBy(1_600)
        runCurrent()
        repeat(5) { api.polls += null }
        advanceTimeBy(150_000)
        runCurrent()
        assertTrue(c.state.value is CallState.Connected)
    }

    @Test fun retryWithoutPermissionKeepsE3AndNeverCallsServer() = runTest(StandardTestDispatcher()) {
        val (c, api, _) = rig()
        c.start("welcome", "ja", permitted = false)
        c.retry(permitted = false)
        runCurrent()
        assertEquals(CallState.Failed(FailKind.Unavailable, "welcome", "ja"), c.state.value)
        assertTrue(api.log.isEmpty())
        c.retry(permitted = true)
        runCurrent()
        assertEquals(1, api.log.count { it.startsWith("create") })
    }
}
