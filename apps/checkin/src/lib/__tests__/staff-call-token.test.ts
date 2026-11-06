import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { kioskCallToken, liveKitConfig } from "@/lib/kiosk/livekit";

const CONFIG = { url: "wss://lk.example", apiKey: "key-for-test", apiSecret: "secret-for-test-secret-for-test-000" };
const DEVICE = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const ROOM = "call-11111111-1111-4111-8111-111111111111";

describe("LiveKit 설정", () => {
  it("셋 다 있어야 켜진다", () => {
    const env = { LIVEKIT_URL: "wss://x", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" };
    expect(liveKitConfig(env)).toEqual({ url: "wss://x", apiKey: "k", apiSecret: "s" });
    for (const key of Object.keys(env)) {
      expect(liveKitConfig({ ...env, [key]: undefined })).toBeNull();
      expect(liveKitConfig({ ...env, [key]: " " })).toBeNull();
    }
  });
});

describe("태블릿 토큰", () => {
  const decode = async () => new TokenVerifier(CONFIG.apiKey, CONFIG.apiSecret).verify(await kioskCallToken(CONFIG, { deviceId: DEVICE, roomName: ROOM }));

  it("이 방 하나 · 카메라와 마이크만 · 받기 가능", async () => {
    const claims = await decode();
    expect(claims.sub).toBe(`kiosk-${DEVICE}`);
    expect(claims.video?.room).toBe(ROOM);
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublishData).toBe(false);
    expect(claims.video?.canPublishSources).toEqual(["camera", "microphone"]);
  });
  it("녹화 · 관리 권한이 없다", async () => {
    const { video } = await decode();
    for (const grant of ["roomRecord", "roomAdmin", "roomCreate", "roomList", "ingressAdmin"] as const) {
      expect(video?.[grant] ?? false).toBe(false);
    }
  });
  it("30분 뒤 만료", async () => {
    const claims = await decode();
    expect((claims.exp as number) - (claims.nbf as number)).toBe(30 * 60);
  });
});
