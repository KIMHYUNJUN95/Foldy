import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 관제실 실시간 갱신 액션(`loadAutomationLive`) — 페이지와 같은 문을 다시 보고, 크레딧(· Beds24)은 읽지 않는다(2026-11-18).
 * 도메인 계약: docs/product/36-automation-control.md 「실시간(2026-11-18)」.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  auth: { ok: true } as { ok: boolean; session?: unknown },
  opsAccess: true,
  creditCalls: 0,
  tables: [] as string[],
  fail: false,
}));

const session = (organization: { id: string } | null) => ({
  capabilities: ["ops_admin.access"],
  organization,
  user: { id: "u", preferredLanguage: "ja" },
});

vi.mock("@/lib/admin-session", () => ({ getAdminSessionForApi: async () => state.auth }));
vi.mock("@/lib/ops-admin", () => ({ canAccessOpsAdmin: () => state.opsAccess }));
vi.mock("@/lib/session", () => ({ hasOrganizationContext: (s: { organization: unknown }) => !!s.organization }));
vi.mock("@/lib/beds24/credit-usage-read", () => ({
  getBeds24CreditDetail: async () => {
    state.creditCalls += 1;
    return null;
  },
}));
vi.mock("@/lib/automation/data", () => ({
  AUTOMATION_BUILDING_ORDER: [],
  checkReservationGate: async () => ({ ageMinutes: 1, lastSyncAt: null, ok: true }),
  loadAssignees: vi.fn(),
  loadAssigneesForModel: vi.fn(),
  loadCleaningListModel: vi.fn(),
  loadCleaningRoomOptions: vi.fn(),
  loadDestinations: async () => {
    if (state.fail) throw new Error("db down");
    return new Proxy({}, { get: () => [] });
  },
  loadJobs: async () =>
    new Proxy(
      {},
      {
        get: () => ({ enabled: false, lastDoneOn: null, nextWakeAt: null, retryUntil: "10:00", sendTime: "08:00", settings: {}, weekdays: [] }),
      },
    ),
  loadPropertyLabeler: async () => (name: string) => name,
  withLocalizedCodes: vi.fn(),
}));
vi.mock("@/lib/automation/runner", () => ({ buildPreview: vi.fn(), sendJobNow: vi.fn() }));
vi.mock("@/lib/cleaning-assign/extra-room", () => ({ checkAddExtraRoom: vi.fn(), removeExtraRoom: vi.fn() }));
vi.mock("@/actions/cleaning-assign-guards", () => ({ changed: vi.fn() }));
vi.mock("@/lib/supabase/service", () => {
  const chain = (table: string): Record<string, unknown> => {
    state.tables.push(table);
    const node: Record<string, unknown> = {};
    for (const method of ["eq", "in", "select", "order", "limit"]) node[method] = () => node;
    node.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
    return node;
  };
  return { getSupabaseServiceClient: () => ({ from: chain }) };
});

import { loadAutomationLive } from "@/actions/ops-automation";

beforeEach(() => {
  state.auth = { ok: true, session: session({ id: "org" }) };
  state.opsAccess = true;
  state.creditCalls = 0;
  state.tables = [];
  state.fail = false;
});

describe("loadAutomationLive", () => {
  it("관리 웹 세션이 아니면 forbidden(redirect 없음)", async () => {
    state.auth = { ok: false };
    expect(await loadAutomationLive()).toEqual({ error: "forbidden", ok: false });
  });
  it("ops_admin.access 가 없으면 forbidden", async () => {
    state.opsAccess = false;
    expect(await loadAutomationLive()).toEqual({ error: "forbidden", ok: false });
  });
  it("조직이 없는 계정(플랫폼)은 forbidden", async () => {
    state.auth = { ok: true, session: session(null) };
    expect(await loadAutomationLive()).toEqual({ error: "forbidden", ok: false });
  });
  it("크레딧(Beds24 호출 기록)은 읽지 않고, 응답에도 credit · renderedAt 이 없다", async () => {
    const result = await loadAutomationLive();
    expect(result.ok).toBe(true);
    expect(state.creditCalls).toBe(0);
    if (result.ok) {
      expect("credit" in result.data).toBe(false);
      expect("renderedAt" in result.data).toBe(false);
    }
    expect(state.tables.sort()).toEqual(["automation_runs", "automation_setting_logs"]);
  });
  it("읽기 실패는 failed(오류 내용은 넘기지 않음)", async () => {
    state.fail = true;
    expect(await loadAutomationLive()).toEqual({ error: "failed", ok: false });
  });
});
