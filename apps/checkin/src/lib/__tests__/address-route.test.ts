import { beforeEach, describe, expect, it, vi } from "vitest";

// 집 주소 라우트 둘의 관문(증명 전 거절 · 잠금 · 검사 · 저장 호출)과 태블릿 stay 모양. DB 는 가짜.
const state = vi.hoisted(() => ({
  proven: { stay: null as unknown },
  opened: null as unknown,
  updates: [] as { values: Record<string, unknown>; ids: string[] }[],
  webStay: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createCheckinServiceClient: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          in: async (_c: string, ids: string[]) => {
            state.updates.push({ values, ids });
            return { error: null };
          },
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/device/auth", () => ({
  authenticateDevice: async (_db: unknown, request: Request) =>
    request.headers.get("authorization") ? { device: { id: "d1", organization_id: "o", property_key: "p", name: "x" } } : { error: "unauthorized" },
}));
vi.mock("@/lib/kiosk/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/kiosk/store")>();
  return {
    ...original,
    openProvenKioskStay: async () => state.opened,
    reloadKioskStay: async () => state.proven.stay,
  };
});
vi.mock("@/lib/guest/store", () => ({
  loadStayByToken: async () => state.webStay,
  refreshPreRegStatus: async () => state.webStay,
}));

import { PUT as webPut } from "@/app/api/guest/[token]/address/route";
import { POST as kioskPost } from "@/app/api/kiosk/address/route";
import { kioskStayOf } from "@/lib/kiosk/store";

const SID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const REP = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const guest = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  is_representative: id === REP,
  guest_type: "adult",
  name_roman: "A B",
  has_japan_address: false,
  address: null,
  contact: null,
  hasPassportPhoto: false,
  hasFaceVideo: false,
  missing: [],
  ...over,
});
const stayOf = (editable = true) => ({
  id: "s1", organizationId: "o", propertyKey: "p", checkInDate: "2026-11-06", checkOutDate: "2026-11-08", guestCountExpected: 3, partySize: 3,
  consented: false, rooms: ["101"], editable, guests: [guest(REP), guest(B, { address: "Canada, Toronto, 5 King St" }), guest(C)],
});
const ADDRESS = "USA, Boston, 12 Main St";
const kiosk = (body: unknown, auth = true) =>
  kioskPost(new Request("https://x/api/kiosk/address", { method: "POST", headers: auth ? { authorization: "Bearer t" } : {}, body: JSON.stringify(body) }));
const web = (body: unknown) =>
  webPut(new Request("https://x/api/guest/t/address", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ token: "t" }) });

beforeEach(() => {
  state.updates = [];
  state.opened = { stay: stayOf() };
  state.proven.stay = stayOf();
  state.webStay = stayOf();
});

describe("POST /api/kiosk/address 관문", () => {
  it("기기 토큰이 없으면 401, 증명 전이면 403 verify_required, 세션이 없으면 409 — 아무것도 쓰지 않는다", async () => {
    expect((await kiosk({ sessionId: SID, representativeAddress: ADDRESS, others: [] }, false)).status).toBe(401);
    state.opened = { error: "verify_required" };
    const proofless = await kiosk({ sessionId: SID, representativeAddress: ADDRESS, others: [] });
    expect([proofless.status, (await proofless.json()).error]).toEqual([403, "verify_required"]);
    state.opened = { error: "session_gone" };
    expect((await kiosk({ sessionId: SID, representativeAddress: ADDRESS, others: [] })).status).toBe(409);
    expect(state.updates).toEqual([]);
  });
  it("체크인 뒤(editable = false)는 409 locked", async () => {
    state.opened = { stay: stayOf(false) };
    const response = await kiosk({ sessionId: SID, representativeAddress: ADDRESS, others: [] });
    expect([response.status, (await response.json()).error]).toEqual([409, "locked"]);
    expect(state.updates).toEqual([]);
  });
  it("본문이 틀리면 400, 글자 규칙 · 모르는 guestId 는 fields 와 함께 400", async () => {
    expect((await kiosk({ sessionId: "x" })).status).toBe(400);
    const bad = await kiosk({ sessionId: SID, representativeAddress: "한국 서울시 강남구 1번지", others: [{ guestId: "99999999-9999-4999-8999-999999999999", address: ADDRESS }] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, error: "invalid", fields: ["address", "address.99999999-9999-4999-8999-999999999999"] });
    expect(state.updates).toEqual([]);
  });
  it("저장: others 에 되돌려 보낸 동행자 주소는 지켜지고 나머지는 대표자 글", async () => {
    const response = await kiosk({ sessionId: SID, representativeAddress: ADDRESS, others: [{ guestId: B, address: "Canada, Toronto, 5 King St" }] });
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(state.updates.map((u) => [u.values.address, u.ids])).toEqual([[ADDRESS, [REP, C]], ["Canada, Toronto, 5 King St", [B]]]);
  });
});

describe("PUT /api/guest/[token]/address 관문", () => {
  it("없는 링크 404 · 체크인 뒤 409 · 틀린 본문 400", async () => {
    state.webStay = null;
    expect((await web({ representativeAddress: ADDRESS, others: [] })).status).toBe(404);
    state.webStay = stayOf(false);
    expect((await web({ representativeAddress: ADDRESS, others: [] })).status).toBe(409);
    state.webStay = stayOf();
    expect((await web({ nope: 1 })).status).toBe(400);
    expect(state.updates).toEqual([]);
  });
  it("글자 규칙 오류는 fields, 통과하면 같은 분배", async () => {
    const bad = await web({ representativeAddress: "USA", others: [] });
    expect(await bad.json()).toMatchObject({ ok: false, error: "invalid", fields: ["address"] });
    expect((await web({ representativeAddress: ADDRESS, others: [] })).status).toBe(200);
    expect(state.updates.map((u) => u.ids)).toEqual([[REP, B, C]]);
  });
});

describe("kioskStayOf — 사람마다 주소", () => {
  it("모든 사람의 현재 주소(없으면 null)를 싣고, 연락처는 대표자만", () => {
    const view = kioskStayOf({ ...stayOf(), guests: stayOf().guests.map((g) => ({ ...g, contact: "+1-415-555-0142" })) } as never);
    expect(view.guests.map((g) => [g.id, g.address])).toEqual([[REP, null], [B, "Canada, Toronto, 5 King St"], [C, null]]);
    expect(view.guests.map((g) => "contact" in g)).toEqual([true, false, false]);
  });
});
