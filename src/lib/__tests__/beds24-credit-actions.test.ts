import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  auth: { ok: true, session: { capabilities: ["ops_admin.access", "admin_web.access"], organization: { id: "org-1" }, user: { id: "u" } } } as unknown,
  canAccess: true,
  summary: vi.fn(async () => ({ snapshot: {}, windowUsed: 0, actors: [] })),
  detail: vi.fn(async () => ({ total: 0 })),
  calls: vi.fn(async () => ({ calls: [], hasMore: false, since: 0 })),
}));

vi.mock("@/lib/admin-session", () => ({ getAdminSessionForApi: async () => state.auth }));
vi.mock("@/lib/ops-admin", () => ({ canAccessOpsAdmin: () => state.canAccess }));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
}));
vi.mock("@/lib/beds24/credit-usage-read", () => ({
  getBeds24CreditSummary: state.summary,
  getBeds24CreditDetail: state.detail,
  getBeds24CreditCalls: state.calls,
}));

import { loadBeds24CreditCalls, loadBeds24CreditDetail, loadBeds24CreditSummary } from "@/actions/beds24-credit";

beforeEach(() => {
  state.auth = { ok: true, session: { capabilities: ["ops_admin.access", "admin_web.access"], organization: { id: "org-1" }, user: { id: "u" } } };
  state.canAccess = true;
  state.summary.mockClear();
  state.detail.mockClear();
  state.calls.mockClear();
});

describe("beds24-credit 액션", () => {
  it("로그인 안 됨 · 관리 웹 없음 → forbidden(redirect 없음), 읽지 않는다", async () => {
    state.auth = { ok: false, status: 401 };
    expect(await loadBeds24CreditSummary()).toEqual({ ok: false, error: "forbidden" });
    expect(await loadBeds24CreditDetail("today")).toEqual({ ok: false, error: "forbidden" });
    expect(state.summary).not.toHaveBeenCalled();
    expect(state.detail).not.toHaveBeenCalled();
  });

  it("ops_admin.access 없음 → forbidden", async () => {
    state.canAccess = false;
    expect(await loadBeds24CreditSummary()).toEqual({ ok: false, error: "forbidden" });
  });

  it("플랫폼 계정(조직 없음) → forbidden(failed 아님), 읽지 않는다", async () => {
    state.auth = { ok: true, session: { capabilities: ["ops_admin.access", "admin_web.access"], organization: { id: "platform" }, user: { id: "u" } } };
    expect(await loadBeds24CreditSummary()).toEqual({ ok: false, error: "forbidden" });
    expect(await loadBeds24CreditDetail("today")).toEqual({ ok: false, error: "forbidden" });
    expect(state.summary).not.toHaveBeenCalled();
  });

  it("조직은 세션에서 — 읽기에 그대로 넘긴다", async () => {
    expect(await loadBeds24CreditSummary()).toMatchObject({ ok: true });
    expect(state.summary).toHaveBeenCalledWith("org-1");
    await loadBeds24CreditDetail("7d");
    expect(state.detail).toHaveBeenCalledWith("org-1", "7d");
  });

  it("모르는 기간 → invalid", async () => {
    expect(await loadBeds24CreditDetail("30d" as never)).toEqual({ ok: false, error: "invalid" });
  });

  it("읽기 실패 → failed(던지지 않는다)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.detail.mockRejectedValueOnce(new Error("db"));
    expect(await loadBeds24CreditDetail("1h")).toEqual({ ok: false, error: "failed" });
    spy.mockRestore();
  });
});

describe("loadBeds24CreditCalls — 최근 호출 거르기 · 더 보기", () => {
  const none = { actor: null, feature: null };
  const uid = "11111111-2222-3333-4444-555555555555";

  it("권한 없음 → forbidden, 읽지 않는다", async () => {
    state.canAccess = false;
    expect(await loadBeds24CreditCalls("today", none, null)).toEqual({ ok: false, error: "forbidden" });
    expect(state.calls).not.toHaveBeenCalled();
  });

  it("조직은 세션에서, 거르기 · 커서는 그대로 넘긴다", async () => {
    const cursor = { calledAt: "2026-11-18T08:02:08.049+00:00", id: "462" };
    expect(await loadBeds24CreditCalls("7d", { actor: `user:${uid}`, feature: "guest_messages" }, cursor)).toMatchObject({ ok: true });
    expect(state.calls).toHaveBeenCalledWith("org-1", { range: "7d", filter: { actor: `user:${uid}`, feature: "guest_messages" }, cursor });
  });

  it.each([
    ["기간", "30d", none, null],
    ["사람 키", "today", { actor: "user:abc", feature: null }, null],
    ["Foldy 밖", "today", { actor: "outside", feature: null }, null],
    ["기능", "today", { actor: null, feature: "nope" }, null],
    ["커서 시각", "today", none, { calledAt: "2026-11-18),id.gt.(0", id: "1" }],
    ["커서 id", "today", none, { calledAt: "2026-11-18T08:02:08Z", id: "1 or 1=1" }],
  ])("모양이 틀린 %s → invalid, 읽지 않는다", async (_label, range, filter, cursor) => {
    expect(await loadBeds24CreditCalls(range as never, filter as never, cursor as never)).toEqual({ ok: false, error: "invalid" });
    expect(state.calls).not.toHaveBeenCalled();
  });

  it("읽기 실패 → failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.calls.mockRejectedValueOnce(new Error("db"));
    expect(await loadBeds24CreditCalls("today", none, null)).toEqual({ ok: false, error: "failed" });
    spy.mockRestore();
  });
});
