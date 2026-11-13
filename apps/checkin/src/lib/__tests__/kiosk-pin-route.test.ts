import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashPin } from "../device/pin";
import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

// POST /api/kiosk/pin — 온라인일 때 직원 PIN 을 서버가 확인한다(FR-K18 · K24). 틀림은 기기마다 10분 안 5번 → 10분 잠금.
const state = vi.hoisted(() => ({ db: null as unknown, authError: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));
vi.mock("@/lib/device/auth", () => ({
  authenticateDevice: async () =>
    state.authError ? { error: state.authError } : { device: { id: "dev-1", organization_id: "org-1", property_key: "stay_ari", name: "로비" } },
}));

import { POST } from "@/app/api/kiosk/pin/route";

let db: FakeDb;
const NOW = new Date("2026-11-13T06:00:00Z");
const check = (pin: unknown) => POST(new Request("https://x/api/kiosk/pin", { method: "POST", body: JSON.stringify({ pin }) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("CHECKIN_HASH_SECRET", "test-secret");
  state.authError = null;
  db = fakeCheckinDb({
    property_settings: [{ organization_id: "org-1", property_key: "stay_ari", staff_pin_hash: hashPin("2468"), staff_call_enabled: false }],
  });
  state.db = db;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("직원 PIN 서버 확인", () => {
  it("맞으면 ok, 틀리면 403 wrong + 남은 횟수", async () => {
    expect((await check("2468")).status).toBe(200);
    const wrong = await check("1111");
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ ok: false, error: "wrong", remaining: 4 });
  });

  it("기기마다 10분 안 5번 틀리면 잠기고 맞는 PIN 도 거절, 10분 뒤 풀림", async () => {
    for (let i = 0; i < 4; i++) expect((await check("1111")).status).toBe(403);
    const fifth = await check("1111");
    expect(fifth.status).toBe(429);
    expect((await fifth.json()).error).toBe("locked");
    expect((await check("2468")).status).toBe(429);
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000));
    expect((await check("2468")).status).toBe(200);
  });

  it("동시에 한꺼번에 보내도 판정까지 가는 것은 5번 이하", async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => check(String(1000 + i))));
    expect(responses.filter((response) => response.status === 403 || response.status === 200).length).toBeLessThanOrEqual(5);
  });

  it("기록에 PIN 원문이 없다", async () => {
    await check("1111");
    expect(JSON.stringify(db.tables.claim_attempts)).not.toContain("1111");
  });

  it("PIN 이 없는 건물은 409 unset, 모양이 틀리면 400, 기기 토큰이 없으면 401", async () => {
    expect((await check("12")).status).toBe(400);
    db.tables.property_settings[0].staff_pin_hash = null;
    expect((await check("2468")).status).toBe(409);
    state.authError = "unauthorized";
    expect((await check("2468")).status).toBe(401);
  });
});
