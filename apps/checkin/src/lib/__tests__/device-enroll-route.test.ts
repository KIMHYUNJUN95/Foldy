import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENROLL_GLOBAL_MAX_FAILURES, scopeKey } from "@/lib/guest/limits";
import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

// POST /api/device/enroll — 코드를 만든 직원을 기기에 옮기고 기록을 남기는지 · 시도 상한. DB 는 가짜.
const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));

import { POST } from "@/app/api/device/enroll/route";

const CODE = "48291735";
const NOW = new Date("2026-11-13T06:00:00Z");
const GLOBAL = scopeKey("device-enroll", "test-secret");
let db: FakeDb;
let ip = 0;

function enroll(code = CODE, from = `203.0.113.${++ip}`) {
  return POST(
    new Request("https://checkin.example/api/device/enroll", { method: "POST", headers: { "x-forwarded-for": from }, body: JSON.stringify({ code }) }),
  );
}
const codeRow = (over: Record<string, unknown> = {}) => ({
  code: CODE, organization_id: "org-1", property_key: "arakicho_a", device_name: "로비", created_by: "user-1", used_at: null,
  expires_at: "2026-11-13T06:10:00Z", ...over,
});
const globalRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: 10_000 + i, key_hash: GLOBAL, ip_hash: "-", succeeded: false, attempted_at: new Date(NOW.getTime() - 60_000).toISOString() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("CHECKIN_HASH_SECRET", "test-secret");
  db = fakeCheckinDb({ enrollment_codes: [codeRow()] });
  state.db = db;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("기기 등록", () => {
  it("코드의 created_by 를 registered_by 로 옮기고 device_enrolled 기록을 남긴다", async () => {
    const response = await enroll();
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    expect(db.tables.devices[0]).toMatchObject({ organization_id: "org-1", registered_by: "user-1", name: "로비" });
    expect(db.tables.audit_log).toEqual([
      expect.objectContaining({ organization_id: "org-1", actor_user_id: "user-1", action: "device_enrolled", meta: { property_key: "arakicho_a" } }),
    ]);
  });

  it("기록에 등록 코드 · 기기 토큰이 없다", async () => {
    const body = await (await enroll()).json();
    const audit = JSON.stringify(db.tables.audit_log);
    expect(audit).not.toContain(CODE);
    expect(audit).not.toContain(body.token);
    expect(audit).not.toContain(String(db.tables.devices[0].token_hash));
  });

  it("발급자를 모르는 코드도 기기로 기록된다(check: 사람 또는 기기)", async () => {
    db.tables.enrollment_codes = [codeRow({ created_by: null })];
    expect((await enroll()).status).toBe(200);
    expect(db.tables.audit_log[0]).toMatchObject({ actor_user_id: null });
  });

  it("기록이 실패해도 기기는 이미 등록됐으니 토큰을 돌려준다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.hooks.insertError = (table) => (table === "audit_log" ? { code: "XX", message: "boom" } : null);
    const response = await enroll();
    expect(response.status).toBe(200);
    expect((await response.json()).token).toBeTruthy();
    spy.mockRestore();
  });

  it("없는 코드는 기기도 기록도 만들지 않고, 실패 줄(IP · 전체)을 남긴다", async () => {
    expect((await enroll("11111111")).status).toBe(404);
    expect(db.tables.devices ?? []).toEqual([]);
    const rows = db.tables.claim_attempts as { key_hash: string; ip_hash: string; succeeded: boolean }[];
    expect(rows.filter((row) => row.key_hash === GLOBAL)).toEqual([expect.objectContaining({ ip_hash: "-", succeeded: false })]);
    expect(rows.every((row) => !row.succeeded)).toBe(true);
  });

  it("맞은 코드는 IP 줄을 성공으로, 전체 줄은 지운다", async () => {
    await enroll();
    const rows = db.tables.claim_attempts as { key_hash: string; succeeded: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].succeeded).toBe(true);
  });

  it("IP 와 무관하게 10분 안 전체 실패가 상한이면 맞는 코드도 잠시 거절(자기 줄은 지움)", async () => {
    db.tables.claim_attempts = globalRows(ENROLL_GLOBAL_MAX_FAILURES);
    const response = await enroll();
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("rate_limited");
    expect(db.tables.devices ?? []).toEqual([]);
    expect(db.tables.claim_attempts).toHaveLength(ENROLL_GLOBAL_MAX_FAILURES);
  });

  it("상한 바로 아래면 등록된다", async () => {
    db.tables.claim_attempts = globalRows(ENROLL_GLOBAL_MAX_FAILURES - 1);
    expect((await enroll()).status).toBe(200);
  });

  it("같은 IP 동시 요청은 분당 5번 이하만 판정된다", async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => enroll(String(20_000_000 + i), "198.51.100.9")));
    expect(responses.filter((response) => response.status !== 429).length).toBeLessThanOrEqual(5);
  });

  it("시도 기록을 못 남기면 코드를 쓰지 않는다(500)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.hooks.insertError = (table) => (table === "claim_attempts" ? { code: "XX", message: "down" } : null);
    expect((await enroll()).status).toBe(500);
    expect(db.tables.enrollment_codes[0].used_at).toBeNull();
    spy.mockRestore();
  });
});
