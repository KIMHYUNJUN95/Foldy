import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/kiosk/guests — 대표자의 일본 거주 여부가 바뀌면 옛 글을 그대로 쓰던 동행자 주소도 먼저 비운다. DB 는 가짜.
const state = vi.hoisted(() => ({ stay: null as unknown, calls: [] as { values: Record<string, unknown>; ids: string[] | null }[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createCheckinServiceClient: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => {
        const call = { values, ids: null as string[] | null };
        state.calls.push(call);
        const query = {
          eq: () => query,
          in: (_c: string, ids: string[]) => {
            call.ids = ids;
            return query;
          },
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ error: null })),
        };
        return query;
      },
    }),
  }),
}));
vi.mock("@/lib/device/auth", () => ({ authenticateDevice: async () => ({ device: { id: "d", organization_id: "o", property_key: "p", name: "x" } }) }));
vi.mock("@/lib/kiosk/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/kiosk/store")>();
  return { ...original, openProvenKioskStay: async () => ({ stay: state.stay }), reloadKioskStay: async () => state.stay };
});

import { POST } from "@/app/api/kiosk/guests/route";

const SID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const REP = "11111111-1111-4111-8111-111111111111";
const C1 = "33333333-3333-4333-8333-333333333333";
const C2 = "44444444-4444-4444-8444-444444444444";
const guest = (id: string, address: string | null, flag: boolean) => ({
  id, is_representative: id === REP, has_japan_address: flag, address, guest_type: "adult", name_roman: "A B", contact: null,
  hasPassportPhoto: false, hasFaceVideo: false, missing: [], prev_stay: null, next_dest: null,
});
const save = (hasJapanAddress: boolean, over: Record<string, unknown> = {}) =>
  POST(
    new Request("https://x/api/kiosk/guests", {
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ sessionId: SID, guest: { id: REP, lastName: "A", firstName: "B", guestType: "adult", hasJapanAddress, ...over } }),
    }),
  );

beforeEach(() => {
  state.calls = [];
  state.stay = {
    id: "s", organizationId: "o", editable: true, partySize: 3, checkInDate: "2026-11-06", checkOutDate: "2026-11-08", guestCountExpected: 3,
    consented: false, rooms: [], guests: [guest(REP, "東京A", true), guest(C1, "東京A", false), guest(C2, "Canada, Toronto, 5 King St", false)],
  };
});

describe("태블릿 대표자 저장 — 일본 거주 여부 바뀜", () => {
  it("같은 옛 글의 동행자만 먼저 비우고 대표자도 비운다, 다르게 적은 동행자는 그대로", async () => {
    expect((await save(false)).status).toBe(200);
    const clears = state.calls.filter((call) => "address" in call.values);
    expect(clears.map((call) => [call.values.address, call.ids])).toEqual([[null, [C1]], [null, null]]);
  });
  it("여부가 안 바뀌면 아무도 비우지 않는다", async () => {
    await save(true);
    expect(state.calls.filter((call) => "address" in call.values)).toEqual([]);
  });
});
