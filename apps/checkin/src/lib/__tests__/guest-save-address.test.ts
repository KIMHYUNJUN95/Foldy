import { beforeEach, describe, expect, it, vi } from "vitest";

// PUT /api/guest/[token]/guests — 일본 거주 여부가 바뀌면 옛 주소를 비우고, 안 바뀌면 건드리지 않는다. DB 는 가짜.
const state = vi.hoisted(() => ({ stay: null as unknown, updates: [] as Record<string, unknown>[], calls: [] as { values: Record<string, unknown>; ids: string[] | null }[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createCheckinServiceClient: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => {
        state.updates.push(values);
        const call = { values, ids: null as string[] | null };
        state.calls.push(call);
        const query = {
          eq: () => query,
          in: (_c: string, ids: string[]) => {
            call.ids = ids;
            return query;
          }, then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ error: null })) };
        return query;
      },
    }),
  }),
}));
vi.mock("@/lib/guest/store", () => ({
  loadStayByToken: async () => state.stay,
  refreshPreRegStatus: async () => state.stay,
  PASSPORT_BUCKET: "b",
}));

import { PUT } from "@/app/api/guest/[token]/guests/route";

const ID = "22222222-2222-4222-8222-222222222222";
const existing = (flag: boolean | null) => ({
  id: ID, is_representative: false, has_japan_address: flag, address: "USA, Boston, 12 Main St", prev_stay: null, next_dest: null, missing: [],
});
const save = (over: Record<string, unknown>) =>
  PUT(
    new Request("https://x/api/guest/t/guests", {
      method: "PUT",
      body: JSON.stringify({ id: ID, lastName: "A", firstName: "B", guestType: "adult", hasJapanAddress: false, ...over }),
    }),
    { params: Promise.resolve({ token: "t" }) },
  );

beforeEach(() => {
  state.updates = [];
  state.calls = [];
});

describe("명부 저장 — 일본 거주 여부 바뀜", () => {
  it("바뀌면 address 를 null 로, 안 바뀌면 칸을 건드리지 않는다, 새 주소를 같이 보내면 그것을 저장", async () => {
    state.stay = { id: "s", organizationId: "o", editable: true, partySize: 2, guests: [existing(false)] };
    await save({ hasJapanAddress: true });
    expect(state.updates[0]).toHaveProperty("address", null);

    state.updates = [];
    await save({ hasJapanAddress: false });
    expect(state.updates[0]).not.toHaveProperty("address");

    state.updates = [];
    await save({ hasJapanAddress: true, address: "東京都新宿区1-2-3" });
    expect(state.updates[0]).toHaveProperty("address", "東京都新宿区1-2-3");
  });

  it("대표자의 여부가 바뀌면 옛 글을 그대로 쓰던 동행자도 먼저 비우고, 다르게 적은 동행자는 건드리지 않는다", async () => {
    const REP = "11111111-1111-4111-8111-111111111111";
    const C1 = "33333333-3333-4333-8333-333333333333";
    const C2 = "44444444-4444-4444-8444-444444444444";
    const row = (id: string, address: string | null, rep = false) => ({ ...existing(id === REP), id, is_representative: rep, address, has_japan_address: rep });
    state.stay = {
      id: "s", organizationId: "o", editable: true, partySize: 3,
      guests: [row(REP, "東京A", true), row(C1, "東京A"), row(C2, "Canada, Toronto, 5 King St")],
    };
    const response = await PUT(
      new Request("https://x/api/guest/t/guests", {
        method: "PUT",
        body: JSON.stringify({ id: REP, lastName: "A", firstName: "B", guestType: "adult", hasJapanAddress: false }),
      }),
      { params: Promise.resolve({ token: "t" }) },
    );
    expect(response.status).toBe(200);
    const addressCalls = state.calls.filter((call) => "address" in call.values);
    expect(addressCalls.map((call) => [call.values.address, call.ids])).toEqual([[null, [C1]], [null, null]]);
  });

  it("여부가 안 바뀌면 동행자는 건드리지 않는다", async () => {
    const REP = "11111111-1111-4111-8111-111111111111";
    const C1 = "33333333-3333-4333-8333-333333333333";
    state.stay = {
      id: "s", organizationId: "o", editable: true, partySize: 2,
      guests: [{ ...existing(false), id: REP, is_representative: true, address: "東京A" }, { ...existing(false), id: C1, address: "東京A" }],
    };
    await PUT(
      new Request("https://x/api/guest/t/guests", {
        method: "PUT",
        body: JSON.stringify({ id: REP, lastName: "A", firstName: "B", guestType: "adult", hasJapanAddress: false }),
      }),
      { params: Promise.resolve({ token: "t" }) },
    );
    expect(state.calls.filter((call) => "address" in call.values)).toEqual([]);
  });
});
