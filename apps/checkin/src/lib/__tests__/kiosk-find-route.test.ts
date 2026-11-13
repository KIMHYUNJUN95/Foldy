import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

// POST /api/kiosk/find — 다른 건물 코드가 「없는 코드」와 구별되지 않는지. DB 는 가짜.
const state = vi.hoisted(() => ({
  db: null as unknown,
  byCode: [] as { id: string; property_key: string; status: string; checkInDate: string; checkOutDate: string }[],
  byName: { stays: [] as unknown[], candidates: [] as unknown[] },
  roster: [] as { name_roman: string | null; passport_number: string | null }[],
  held: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));
vi.mock("@/lib/device/auth", () => ({
  authenticateDevice: async () => ({ device: { id: "dev-1", organization_id: "org-1", property_key: "stay_ari", name: "로비" } }),
}));
vi.mock("@/lib/kiosk/store", () => ({
  readStaysByCode: async () => state.byCode,
  readNameCandidates: async () => state.byName,
  holdSession: async (_db: unknown, _stay: unknown, _device: string, _now: Date, foundBy: string) => {
    state.held.push(foundBy);
    return "session-1";
  },
  readStayLanguage: async () => null,
  kioskStayOf: () => ({ stayId: "stay-1" }),
}));
vi.mock("@/lib/guest/store", () => ({
  loadStayById: async () => ({ id: "stay-1", status: "pending", checkedInAt: null, guests: state.roster }),
}));

import { POST } from "@/app/api/kiosk/find/route";

let db: FakeDb;
const find = (code: string) =>
  POST(new Request("https://checkin.example/api/kiosk/find", { method: "POST", body: JSON.stringify({ mode: "code", code }) }));
const row = (propertyKey: string) => ({ id: "stay-1", property_key: propertyKey, status: "pending", checkInDate: "2026-11-13", checkOutDate: "2026-11-15" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T06:00:00Z"));
  vi.stubEnv("CHECKIN_HASH_SECRET", "test-secret");
  db = fakeCheckinDb();
  state.db = db;
  state.byName = { stays: [row("stay_ari")], candidates: [{ stayId: "stay-1", guestNames: ["Anna Eriksson"] }] };
  state.roster = [];
  state.held = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("태블릿 찾기 — 다른 건물 코드", () => {
  it("이 건물 코드는 찾는다", async () => {
    state.byCode = [row("stay_ari")];
    const response = await find("123456");
    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("found");
  });

  it("다른 건물 코드는 없는 코드와 같은 응답(404 not_found)이고 틀림으로 센다", async () => {
    state.byCode = [];
    const missing = await (await find("111111")).json();
    state.byCode = [row("okubo_a")];
    const response = await find("222222");
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(Object.keys(missing).sort());
    expect(body).toMatchObject({ ok: false, error: "not_found" });
    expect(JSON.stringify(body)).not.toContain("other_building");
    const attempts = (db.tables.claim_attempts ?? []) as { succeeded: boolean }[];
    expect(attempts.map((attempt) => attempt.succeeded)).toEqual([false, false]);
  });
});

// 여권 찾기(빠른 체크인 F1) — 서버가 띠를 직접 읽는다. 2026-11-13 보안 점검.
const L1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const L2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
const GOOD = `${L1}\n${L2}`;
const BAD = `${L1}\n${L2.slice(0, 13)}740813${L2.slice(19)}`;
const byPassport = (body: Record<string, unknown>) =>
  POST(new Request("https://checkin.example/api/kiosk/find", { method: "POST", body: JSON.stringify({ mode: "passport", ...body }) }));
const failures = () => ((db.tables.claim_attempts ?? []) as { succeeded: boolean }[]).filter((attempt) => !attempt.succeeded).length;

describe("태블릿 찾기 — 여권 띠(MRZ)", () => {
  it("띠가 없으면 기본은 거절(400 mrz_required) — 성만으로는 열지 않는다", async () => {
    const response = await byPassport({ lastName: "ERIKSSON", firstName: "ANNA" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("mrz_required");
  });

  it("CHECKIN_KIOSK_REQUIRE_MRZ=false 면 옛 앱처럼 이름만으로 찾는다", async () => {
    vi.stubEnv("CHECKIN_KIOSK_REQUIRE_MRZ", "false");
    expect((await byPassport({ lastName: "ERIKSSON", firstName: "ANNA" })).status).toBe(200);
  });

  it("검사 숫자가 맞는 띠면 띠의 이름으로 찾는다(보낸 이름은 쓰지 않음)", async () => {
    const response = await byPassport({ lastName: "SOMEONE", firstName: "ELSE", mrz_raw: GOOD });
    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("found");
  });

  it("검사 숫자가 틀린 띠는 못 찾음으로 답하고 틀림으로 센다", async () => {
    const response = await byPassport({ lastName: "ERIKSSON", firstName: "ANNA", mrz_raw: BAD });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("not_found");
    expect(failures()).toBe(1);
  });

  it("명부에 같은 이름의 여권 번호가 띠와 다르면 열지 않고 staff_needed, 틀림으로 센다", async () => {
    state.roster = [{ name_roman: "ERIKSSON ANNA", passport_number: "X1234567" }];
    const response = await byPassport({ lastName: "ERIKSSON", firstName: "ANNA", mrz_raw: GOOD });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("staff_needed");
    expect(body.stay).toBeUndefined();
    expect(body.session_id).toBeUndefined();
    expect(state.held).toEqual([]);
    expect(failures()).toBe(1);
    state.roster = [{ name_roman: "ERIKSSON ANNA", passport_number: "l898902c3" }];
    expect((await byPassport({ lastName: "ERIKSSON", firstName: "ANNA", mrz_raw: GOOD })).status).toBe(200);
  });
});

describe("태블릿 찾기 — 동시 요청", () => {
  it("한꺼번에 보내도 판정까지 가는 것은 5번 이하(먼저 적고 판정)", async () => {
    state.byCode = [];
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => find(String(100000 + i))));
    expect(responses.filter((response) => response.status === 404).length).toBeLessThanOrEqual(5);
    // 잠금으로 거절된 요청은 자기 줄을 지운다.
    expect(failures()).toBe(responses.filter((response) => response.status === 404).length);
  });

  it("맞으면 자기 줄을 성공으로", async () => {
    state.byCode = [row("stay_ari")];
    expect((await find("123456")).status).toBe(200);
    expect(((db.tables.claim_attempts ?? []) as { succeeded: boolean }[]).map((attempt) => attempt.succeeded)).toEqual([true]);
  });
});

