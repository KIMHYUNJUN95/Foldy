"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteTrack, RemoteVideoTrack, Room } from "livekit-client";
import { guestAbsentTooLong } from "@/lib/checkin/staff-call-flow";

// LiveKit 방 하나의 수명 — 통화 화면 컴포넌트가 사라지면 같이 끝난다. livekit-client 는 받을 때만 불러온다.
// 직원 카메라는 어디서도 켜지 않는다: 마이크만 켜고, 토큰도 마이크만 허용한다(docs/product/46 §1 · §5).

const CONNECT_TIMEOUT_MS = 20_000;
const GUEST_CHECK_MS = 2_000;

export type CallRoomCredentials = { url: string; token: string };

export type CallRoomHandlers = {
  onConnected: () => void;
  /** 상대가 끊었거나 방이 지워졌다. */
  onRemoteEnded: () => void;
  /** 연결 실패 · 끊김. */
  onLost: () => void;
  /** 손님이 오래 방에 없다 — 태블릿이 꺼졌을 수 있다. */
  onGuestGone: () => void;
};

export function useCallRoom(credentials: CallRoomCredentials | null, handlers: CallRoomHandlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const roomRef = useRef<Room | null>(null);
  const [videoTrack, setVideoTrack] = useState<RemoteVideoTrack | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    if (!credentials) return;
    let dead = false;
    let room: Room | null = null;
    let guestTimer: number | undefined;
    const audioElements = new Set<HTMLMediaElement>();

    void (async () => {
      try {
        const { Room: LiveKitRoom, RoomEvent, Track, DisconnectReason } = await import("livekit-client");
        if (dead) return;
        const next = new LiveKitRoom({ adaptiveStream: true });
        room = next;
        roomRef.current = next;

        const syncPlayback = () => setPlaybackBlocked(!next.canPlaybackAudio || !next.canPlaybackVideo);
        next.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video) {
            setVideoTrack(track as RemoteVideoTrack);
          } else if (track.kind === Track.Kind.Audio) {
            const element = track.attach();
            element.hidden = true;
            document.body.append(element);
            audioElements.add(element);
            syncPlayback();
          }
        });
        next.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video) {
            setVideoTrack((current) => (current === track ? null : current));
          } else {
            for (const element of track.detach()) {
              audioElements.delete(element);
              element.remove();
            }
          }
        });
        // 손님 카메라가 멈춘 동안은 트랙이 있어도 빈 화면 + 안내다.
        next.on(RoomEvent.TrackMuted, (publication, participant) => {
          if (publication.kind === Track.Kind.Video && participant !== next.localParticipant) setVideoTrack(null);
        });
        next.on(RoomEvent.TrackUnmuted, (publication, participant) => {
          if (publication.kind === Track.Kind.Video && participant !== next.localParticipant && publication.track) {
            setVideoTrack(publication.track as RemoteVideoTrack);
          }
        });
        next.on(RoomEvent.AudioPlaybackStatusChanged, syncPlayback);
        next.on(RoomEvent.VideoPlaybackStatusChanged, syncPlayback);
        next.on(RoomEvent.Disconnected, (reason) => {
          if (dead) return;
          if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.PARTICIPANT_REMOVED) {
            handlersRef.current.onRemoteEnded();
          } else {
            handlersRef.current.onLost();
          }
        });

        await Promise.race([
          next.connect(credentials.url, credentials.token, { autoSubscribe: true }),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("connect-timeout")), CONNECT_TIMEOUT_MS)),
        ]);
        if (dead) return;
        handlersRef.current.onConnected();

        let lastGuestSeen = Date.now();
        guestTimer = window.setInterval(() => {
          const now = Date.now();
          if (next.remoteParticipants.size > 0) {
            lastGuestSeen = now;
          } else if (guestAbsentTooLong(lastGuestSeen, now)) {
            window.clearInterval(guestTimer);
            handlersRef.current.onGuestGone();
          }
        }, GUEST_CHECK_MS);

        try {
          await next.localParticipant.setMicrophoneEnabled(true);
        } catch {
          // 마이크를 못 써도 끊지 않는다 — 듣기만 하고 안내를 띄운다.
          if (!dead) setMicDenied(true);
        }
      } catch {
        if (!dead) handlersRef.current.onLost();
      }
    })();

    return () => {
      dead = true;
      if (guestTimer) window.clearInterval(guestTimer);
      void room?.disconnect();
      roomRef.current = null;
      for (const element of audioElements) element.remove();
    };
  }, [credentials]);

  useEffect(() => {
    if (!videoTrack || !videoElement) return;
    videoTrack.attach(videoElement);
    return () => {
      videoTrack.detach(videoElement);
    };
  }, [videoTrack, videoElement]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !muted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!nextMuted);
      setMuted(nextMuted);
    } catch {
      setMicDenied(true);
    }
  }, [muted]);

  /** WKWebView · 자동 재생 차단 — 사용자가 눌렀을 때만 풀린다. */
  const retryPlayback = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      await room.startVideo();
    } catch {
      // 다음 탭에서 다시 시도한다 — 안내는 상태 이벤트가 그대로 둔다.
    }
    setPlaybackBlocked(!room.canPlaybackAudio || !room.canPlaybackVideo);
  }, []);

  return { videoTrack, setVideoElement, muted, micDenied, playbackBlocked, toggleMute, retryPlayback };
}
