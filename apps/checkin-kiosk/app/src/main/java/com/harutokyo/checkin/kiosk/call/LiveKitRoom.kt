package com.harutokyo.checkin.kiosk.call

import android.content.Context
import com.twilio.audioswitch.AudioDevice
import io.livekit.android.AudioOptions
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.audio.AudioSwitchHandler
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import livekit.org.webrtc.RendererCommon

/**
 * LiveKit 방(46 §1 · §5). 손님 카메라(전면) + 마이크를 올리고 직원 음성을 받는다.
 * 직원 쪽 영상은 서버 토큰이 막고, 오더라도 어느 화면에도 붙이지 않는다 — 소리만 쓴다.
 * 통화는 저장하지 않는다(녹화 기능을 쓰지 않는다). 로그에 토큰 · 주소를 남기지 않는다.
 */
class LiveKitRoom(private val appContext: Context, private val scope: CoroutineScope) : RoomGateway {
    override var onRemoteLeft: (() -> Unit)? = null
    override var onStaffJoined: (() -> Unit)? = null
    override var onStaffLeft: (() -> Unit)? = null
    override val hasStaff: Boolean get() = room?.remoteParticipants?.isNotEmpty() == true

    private var room: Room? = null
    private var local: LocalVideoTrack? = null
    private var events: Job? = null
    private var pendingView: TextureViewRenderer? = null

    override suspend fun connect(url: String, token: String) {
        disconnect()
        // 소리는 스피커로 — 태블릿 · 전화형 기기 모두(귀에 대는 수화기로 가지 않게).
        val handler = AudioSwitchHandler(appContext).apply {
            preferredDeviceList = listOf(AudioDevice.Speakerphone::class.java)
        }
        val created = LiveKit.create(appContext, overrides = LiveKitOverrides(audioOptions = AudioOptions(audioHandler = handler)))
        room = created
        // 직원이 들어오고 나감은 컨트롤러가 시간을 잰다(20초 · 15초, 46 §6). 방 자체가 끊기면(30분 한도 · 서버 끝냄 · 재접속 실패) 바로 끝.
        events = scope.launch {
            created.events.collect { event ->
                when (event) {
                    is RoomEvent.ParticipantConnected -> onStaffJoined?.invoke()
                    is RoomEvent.ParticipantDisconnected -> if (created.remoteParticipants.isEmpty()) onStaffLeft?.invoke()
                    is RoomEvent.Disconnected -> onRemoteLeft?.invoke()
                    else -> Unit
                }
            }
        }
        created.connect(url, token)
        val me = created.localParticipant
        me.setMicrophoneEnabled(true)
        me.setCameraEnabled(true)
        local = me.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack
        pendingView?.let { attach(it) }
    }

    override fun disconnect() {
        events?.cancel()
        events = null
        val r = room ?: return
        room = null
        local = null
        runCatching { r.disconnect() }
        runCatching { r.release() }
    }

    /** E2 의 손님 카메라 화면. 연결 전에 만들어졌으면 연결된 뒤에 붙는다. */
    fun attach(view: TextureViewRenderer) {
        pendingView = view
        val r = room ?: return
        val track = local ?: return
        runCatching {
            r.initVideoRenderer(view)
            view.setMirror(true)
            view.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
            track.addRenderer(view)
        }
    }

    fun detach(view: TextureViewRenderer) {
        if (pendingView === view) pendingView = null
        runCatching { local?.removeRenderer(view) }
    }
}
