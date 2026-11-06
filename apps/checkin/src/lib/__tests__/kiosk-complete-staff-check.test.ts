import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

// 체크인 완료 — 직원 확인이 필요한 분이 있으면 `checkin_staff_check` 알림. 실패해도 완료는 막지 않는다. DB 는 가짜.
const state = vi.hoisted(() => ({ db: null as unknown, stay: null as Record<string, unknown> | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));
vi.mock("@/lib/device/auth", () => ({
  authenticateDevice: async () => ({ device: { id: "dev-1", organization_id: "org-1", property_key: "stay_ari", name: "로비" } }),
}));
vi.mock("@/lib/kiosk/store", () => ({
  openKioskStayForComplete: async () => ({ stay: state.stay, proof: { found_by: "code" } }),
}));

import { POST } from "@/app/api/kiosk/complete/route";

const SESSION = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const STAY = "22222222-2222-4222-8222-222222222222";
const GUEST = "33333333-3333-4333-8333-333333333333";

let db: FakeDb;

function setup(over: { hasFaceVideo: boolean; status?: string }) {
  state.stay = {
    id: STAY,
    organizationId: "org-1",
    propertyKey: "stay_ari",
    status: over.status ?? "pending",
    consented: true,
    partySize: 1,
    checkInDate: "2026-11-06",
    checkOutDate: "2026-11-08",
    guests: [{ id: GUEST, name_roman: "Guest Secret", missing: [], hasFaceVideo: over.hasFaceVideo, no_passport_reason: null, is_representative: true }],
  };
  db = fakeCheckinDb({
    guests: [{ id: GUEST, organization_id: "org-1", stay_id: STAY, mrz_valid: true }],
    stay_rooms: [],
    stays: [{ id: STAY, organization_id: "org-1", status: over.status ?? "pending" }],
    sessions: [{ id: SESSION, organization_id: "org-1" }],
  });
  state.db = db;
}
const complete = () => POST(new Request("https://x/api/kiosk/complete", { method: "POST", body: JSON.stringify({ session_id: SESSION }) }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("체크인 완료 — 직원 확인 알림", () => {
  it("얼굴 영상이 없는 분이 있으면 checkin.view 에게 알림(손님 정보 없음)", async () => {
    setup({ hasFaceVideo: false });
    const body = await (await complete()).json();
    expect(body).toMatchObject({ ok: true, already: false, staff_check_count: 1 });
    expect(db.rpcCalls).toEqual([
      {
        name: "notify_staff",
        args: {
          p_organization_id: "org-1",
          p_capability: "checkin.view",
          p_type: "checkin_staff_check",
          p_dedupe_key: `checkin_staff_check:${STAY}`,
          p_href: "/admin/checkin",
          p_payload: { stayId: STAY, propertyKey: "stay_ari" },
        },
      },
    ]);
    expect(JSON.stringify(db.rpcCalls)).not.toContain("Guest Secret");
  });

  it("모두 괜찮으면 알림 없음", async () => {
    setup({ hasFaceVideo: true });
    expect(await (await complete()).json()).toMatchObject({ ok: true, staff_check_count: 0 });
    expect(db.rpcCalls).toEqual([]);
  });

  it("이미 체크인된 예약을 다시 불러도 또 보내지 않는다", async () => {
    setup({ hasFaceVideo: false, status: "checked_in" });
    expect(await (await complete()).json()).toMatchObject({ ok: true, already: true });
    expect(db.rpcCalls).toEqual([]);
  });

  it.each([
    ["오류 응답", () => ({ data: null, error: { message: "boom" } })],
    ["예외", () => { throw new Error("rpc down"); }],
  ])("알림 %s 이어도 완료는 성공한다", async (_name, rpc) => {
    setup({ hasFaceVideo: false });
    db.hooks.rpc = rpc;
    const response = await complete();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, staff_check_count: 1 });
    expect((db.tables.stays as Record<string, unknown>[])[0].status).toBe("checked_in");
  });
});
