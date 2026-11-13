import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

// POST /api/kiosk/prove — 먼저 적고 판정 · 번호 어긋남은 staff_needed(틀림으로 셈). DB 는 가짜.
const state = vi.hoisted(() => ({
  db: null as unknown,
  roster: [] as { name_roman: string | null; passport_number: string | null }[],
  lockTaken: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));
vi.mock("@/lib/device/auth", () => ({
  authenticateDevice: async () => ({ device: { id: "dev-1", organization_id: "org-1", property_key: "stay_ari", name: "로비" } }),
}));
vi.mock("@/lib/kiosk/store", () => ({
  openKioskStayWithProof: async () => ({
    stay: { id: "stay-1", organizationId: "org-1", status: "pending", checkedInAt: null, guests: state.roster },
    payload: { found_by: "name" },
  }),
  readReservationNames: async () => ["Anna Eriksson"],
  takeSessionLock: async () => state.lockTaken,
  markPassportProof: async () => undefined,
  readStayLanguage: async () => null,
  kioskStayOf: () => ({ stayId: "stay-1" }),
}));

import { POST } from "@/app/api/kiosk/prove/route";

const SID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const L1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const L2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
const GOOD = `${L1}\n${L2}`;
const OTHER = `${"P<UTOSMITH<<JOHN".padEnd(44, "<")}\n${L2}`;
let db: FakeDb;
const prove = (mrz: string) => POST(new Request("https://x/api/kiosk/prove", { method: "POST", body: JSON.stringify({ session_id: SID, mrz_raw: mrz }) }));
const rows = () => (db.tables.claim_attempts ?? []) as { succeeded: boolean }[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T06:00:00Z"));
  vi.stubEnv("CHECKIN_HASH_SECRET", "test-secret");
  db = fakeCheckinDb();
  state.db = db;
  state.roster = [];
  state.lockTaken = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("태블릿 본인 확인", () => {
  it("맞으면 found, 자기 줄은 성공으로", async () => {
    const response = await prove(GOOD);
    expect(response.status).toBe(200);
    expect(rows().map((row) => row.succeeded)).toEqual([true]);
  });

  it("명부 번호와 다르면 staff_needed(403)이고 틀림으로 센다", async () => {
    state.roster = [{ name_roman: "ERIKSSON ANNA", passport_number: "X1234567" }];
    const response = await prove(GOOD);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("staff_needed");
    expect(rows().map((row) => row.succeeded)).toEqual([false]);
  });

  it("읽지 못한 띠 · 사용 중은 세지 않는다", async () => {
    expect((await prove("P<garbage")).status).toBe(400);
    state.lockTaken = false;
    expect((await prove(GOOD)).status).toBe(409);
    expect(rows()).toEqual([]);
  });

  it("한꺼번에 보내도 판정까지 가는 것은 5번 이하", async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => prove(OTHER)));
    const judged = responses.filter((response) => response.status === 403);
    expect(judged.length).toBeLessThanOrEqual(5);
    expect(rows()).toHaveLength(judged.length);
  });
});
