import "server-only";

import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";

// LiveKit — 토큰은 서버에서만 발급한다. 태블릿은 카메라 + 마이크, 방 하나, 30분(46 §5). 녹화 권한은 주지 않는다.

export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };

const TOKEN_TTL = "30m";
const ROOM_DELETE_TIMEOUT_SECONDS = 3;

export function liveKitConfig(env: Record<string, string | undefined> = process.env): LiveKitConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

export async function kioskCallToken(config: LiveKitConfig, call: { deviceId: string; roomName: string }): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, { identity: `kiosk-${call.deviceId}`, ttl: TOKEN_TTL });
  token.addGrant({
    roomJoin: true,
    room: call.roomName,
    canPublish: true,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: false,
  });
  return token.toJwt();
}

/** 최선 시도 — 실패해도 통화는 이미 끝났다. 빈 방은 LiveKit 이 스스로 닫는다. */
export async function deleteCallRoom(config: LiveKitConfig, roomName: string): Promise<void> {
  try {
    await new RoomServiceClient(config.url, config.apiKey, config.apiSecret, { requestTimeout: ROOM_DELETE_TIMEOUT_SECONDS }).deleteRoom(roomName);
  } catch {
    console.error("[staff-call] 방 삭제 실패");
  }
}
