import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUILDING_HOUR_ALERT_FAILURES, MAX_FAILURES } from "../guest/limits";
import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

// POST /api/guest/claim — IP 를 바꿔 가며 전화 뒤 4자리를 넣어 보는 것을 막는지. DB 는 가짜.
const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));
vi.mock("@/lib/guest/store", () => ({
  readClaimCandidates: async () => [
    { stayId: "stay-1", checkInDate: "2026-11-13", rows: [{ guestName: "Yuki Tanaka", apiReference: "HMABC123", phone: "+81-90-1234-5678" }] },
  ],
}));

import { POST } from "@/app/api/guest/claim/route";

const NOW = new Date("2026-11-13T03:00:00Z");
let db: FakeDb;
let ipCounter = 0;

function claim(body: Record<string, unknown>, ip = `203.0.113.${++ipCounter}`) {
  return POST(
    new Request("https://checkin.example/api/guest/claim", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ building: "stay_ari", lastName: "Tanaka", firstName: "Yuki", checkInDate: "2026-11-13", ...body }),
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("CHECKIN_HASH_SECRET", "test-secret");
  db = fakeCheckinDb({ stays: [{ id: "stay-1", organization_id: "org-1" }] });
  state.db = db;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("예약 찾기 — IP 와 무관한 잠금", () => {
  it("맞으면 토큰을 준다", async () => {
    const response = await claim({ phoneLast4: "5678" });
    expect(response.status).toBe(200);
    expect((await response.json()).token).toBeTruthy();
  });

  it("IP 를 매번 바꿔도 같은 이름 · 날짜로 5번 틀리면 잠기고, 맞는 번호도 거절", async () => {
    for (let i = 0; i < 4; i++) expect((await claim({ phoneLast4: String(1000 + i) })).status).toBe(404);
    const fifth = await claim({ phoneLast4: "1004" });
    expect(fifth.status).toBe(429);
    const locked = await claim({ phoneLast4: "5678" });
    expect(locked.status).toBe(429);
    const body = await locked.json();
    expect(body).toMatchObject({ ok: false, error: "locked" });
    expect(Object.keys(body).sort()).toEqual(["contract_version", "error", "locked_until", "ok"]);
    expect(db.tables.stay_tokens ?? []).toHaveLength(0);
  });

  it("이름 순서 · 띄어쓰기를 바꿔도 같은 잠금", async () => {
    for (let i = 0; i < 5; i++) await claim({ phoneLast4: String(2000 + i) });
    expect((await claim({ lastName: "YUKI", firstName: "TANAKA", phoneLast4: "5678" })).status).toBe(429);
  });

  it("10분 잠금이 풀린 뒤에는 다시 넣을 수 있다(정상 손님)", async () => {
    for (let i = 0; i < 5; i++) await claim({ phoneLast4: String(3000 + i) });
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000));
    expect((await claim({ phoneLast4: "5678" })).status).toBe(200);
  });

  it("건물 전체 실패가 많아도 막지 않고 경고 로그만 — 누구나 건물을 잠그지 못하게", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < BUILDING_HOUR_ALERT_FAILURES; i++) {
      await claim({ lastName: `Name${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, phoneLast4: "0000" });
    }
    expect((await claim({ phoneLast4: "5678" })).status).toBe(200);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/tanaka|yuki|5678/i);
    warn.mockRestore();
  });

  it("동시에 한꺼번에 보내도 판정까지 가는 것은 상한(5) 이하", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => claim({ phoneLast4: i === 19 ? "5678" : String(4000 + i) })),
    );
    const judged = responses.filter((response) => response.status === 404 || response.status === 200);
    expect(judged.length, responses.map((r) => r.status).join(",")).toBeLessThanOrEqual(MAX_FAILURES);
    expect(responses.every((response) => [200, 404, 429].includes(response.status))).toBe(true);
  });

  it("두 번 눌러 동시에 간 정상 요청은 둘 다 판정된다", async () => {
    const responses = await Promise.all([claim({ phoneLast4: "5678" }), claim({ phoneLast4: "5678" })]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
  });

  it("맞으면 자기 줄을 성공으로 바꾸고 건물 줄은 지운다", async () => {
    await claim({ phoneLast4: "5678" });
    const rows = (db.tables.claim_attempts ?? []) as { ip_hash: string; succeeded: boolean }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.succeeded)).toBe(true);
  });

  it("기록을 못 남기면 판정하지 않는다(500)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.hooks.insertError = (table) => (table === "claim_attempts" ? { code: "XX", message: "down" } : null);
    expect((await claim({ phoneLast4: "5678" })).status).toBe(500);
    expect(db.tables.stay_tokens ?? []).toHaveLength(0);
    spy.mockRestore();
  });

  it("이름 · 건물 줄은 IP 자리를 비워 IP 분당 횟수에 섞이지 않는다", async () => {
    await claim({ phoneLast4: "0000" }, "198.51.100.7");
    const rows = (db.tables.claim_attempts ?? []) as { ip_hash: string; succeeded: boolean }[];
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.ip_hash !== "-")).toHaveLength(1);
    expect(rows.every((row) => row.succeeded === false)).toBe(true);
  });
});
