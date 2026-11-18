import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  auth: { ok: true, session: { capabilities: ["ops_admin.access", "admin_web.access"], organization: { id: "org-1" }, user: { id: "u" } } } as unknown,
  canAccess: true,
  summary: vi.fn(async () => ({ snapshot: {}, windowUsed: 0, actors: [] })),
  detail: vi.fn(async () => ({ total: 0 })),
}));

vi.mock("@/lib/admin-session", () => ({ getAdminSessionForApi: async () => state.auth }));
vi.mock("@/lib/ops-admin", () => ({ canAccessOpsAdmin: () => state.canAccess }));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
}));
vi.mock("@/lib/beds24/credit-usage-read", () => ({
  getBeds24CreditSummary: state.summary,
  getBeds24CreditDetail: state.detail,
}));

import { loadBeds24CreditDetail, loadBeds24CreditSummary } from "@/actions/beds24-credit";

beforeEach(() => {
  state.auth = { ok: true, session: { capabilities: ["ops_admin.access", "admin_web.access"], organization: { id: "org-1" }, user: { id: "u" } } };
  state.canAccess = true;
  state.summary.mockClear();
  state.detail.mockClear();
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
