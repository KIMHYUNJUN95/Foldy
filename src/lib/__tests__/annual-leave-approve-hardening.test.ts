// 연차 승인 점검 수정(2026-11-11) — 자기 승인 금지(M6) · 잔여 초과는 사유 필수(M7) · 한 거래 승인 함수(M8) ·
// 승인 때 자격 다시 확인(LOW) · 플랫폼 관리자 도장 칸(LOW).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tokyo-date", () => ({ tokyoToday: () => "2026-11-11" }));
vi.mock("@/lib/platform-developers", () => ({
  displayRoleKey: (role: string) => role,
  fetchPlatformDeveloperIds: async () => new Set<string>(),
}));
const caps = vi.hoisted(() => ({ value: ["leave.approve"] as string[] }));
vi.mock("@/lib/capabilities-server", () => ({ memberCapabilities: async () => caps.value }));

let fake: ReturnType<typeof createFakeSupabase>;
let rpcResults: string[];
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => client() }));

function client() {
  return {
    ...fake.client,
    rpc: async (name: string, args: unknown) => {
      fake.rpcCalls.push({ name, args });
      return { data: rpcResults.shift() ?? "ok", error: null };
    },
  };
}

const ORG = "org-1";
const APPLICANT = "user-1";
const APPROVER = "approver-1";
const session = (userId: string) =>
  ({ organization: { id: ORG }, user: { id: userId } }) as unknown as import("@/lib/session").AppSession;

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    organization_id: ORG,
    user_id: APPLICANT,
    applicant_name: "Kim",
    leave_type: "paid",
    start_date: "2026-11-20",
    end_date: "2026-11-22",
    duration_unit: "full",
    days_count: 3,
    status: "requested",
    ...overrides,
  };
}

beforeEach(() => {
  caps.value = ["leave.approve"];
  rpcResults = [];
  fake = createFakeSupabase({
    platform_admins: [],
    memberships: [
      { organization_id: ORG, user_id: APPLICANT, status: "active", role: "manager" },
      { organization_id: ORG, user_id: APPROVER, status: "active", role: "senior_managing_director" },
    ],
    profiles: [{ id: APPLICANT, hire_date: "2020-01-15" }],
    // 기준일 2026-11-01 잔여 5일(2026-07-15 부여분 소멸일 2028-07-15).
    annual_leave_baselines: [
      { organization_id: ORG, user_id: APPLICANT, base_amount: 5, bonus_amount: 0, baseline_date: "2026-11-01", confirmed_at: "x" },
    ],
    annual_leave_requests: [request()],
  });
});

describe("approveLeaveRequestForApprover", () => {
  it("M6 — 자기 신청은 승인할 수 없다", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    fake.tables.annual_leave_requests = [request({ user_id: APPROVER })];
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: false, error: "self_approval" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("잔여 안이면 사유 없이 한 거래 승인 함수를 부른다(사용 합 · 도장 칸 같이)", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: true });
    expect(fake.rpcCalls).toEqual([
      {
        name: "approve_annual_leave_request_atomic",
        args: {
          p_organization_id: ORG,
          p_request_id: "req-1",
          p_actor_user_id: APPROVER,
          p_approved_role: "senior_managing_director",
          p_override_reason: null,
          p_expected_used_days: 0,
        },
      },
    ]);
  });

  it("M7 — 잔여를 넘으면 사유 없이는 over_balance, 사유가 있으면 그 사유로 승인", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    fake.tables.annual_leave_requests = [
      request({ id: "old", status: "approved", days_count: 4, start_date: "2026-11-05", end_date: "2026-11-08" }),
      request(),
    ];
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: false, error: "over_balance" });
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1", { overrideReason: "   " })).toEqual({
      ok: false,
      error: "over_balance",
    });
    expect(fake.rpcCalls).toHaveLength(0);

    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1", { overrideReason: " 대표 승인 " })).toEqual({
      ok: true,
    });
    expect(fake.rpcCalls[0].args).toMatchObject({ p_override_reason: "대표 승인", p_expected_used_days: 4 });
  });

  it("M8 — 그 사이 다른 승인이 먼저 들어가면(stale) 다시 계산해 한 번 더 부른다", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    rpcResults = ["stale", "ok"];
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: true });
    expect(fake.rpcCalls).toHaveLength(2);
  });

  it("겹침은 함수가 거절한 그대로 돌려준다", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    rpcResults = ["overlap"];
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: false, error: "overlap" });
  });

  it("LOW — 승인 때 자격을 다시 본다(기준 잔여 없음 · 시급직)", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    fake.tables.annual_leave_baselines = [];
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: false, error: "baseline_required" });
    fake.tables.memberships[0].role = "part_time_staff";
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: false, error: "hourly_excluded" });
  });

  it("LOW — 플랫폼 관리자가 승인해도 도장 칸이 비지 않는다", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    caps.value = [];
    fake.tables.platform_admins = [{ id: "pa", user_id: "dev-1", is_active: true }];
    expect(await approveLeaveRequestForApprover(session("dev-1"), "req-1")).toEqual({ ok: true });
    expect(fake.rpcCalls[0].args).toMatchObject({ p_approved_role: "senior_managing_director" });
  });
});

describe("getAdminLeaveApprovalDetail — 넘침 일수", () => {
  it("화면이 따로 계산하지 않게 서버가 승인 판정과 같은 넘침 일수를 내려준다", async () => {
    const { getAdminLeaveApprovalDetail } = await import("../annual-leave-approvals-server");
    fake.tables.annual_leave_requests = [
      request({ id: "old", status: "approved", days_count: 4, start_date: "2026-11-05", end_date: "2026-11-08" }),
      request(),
    ];
    const detail = await getAdminLeaveApprovalDetail(session(APPROVER), "req-1");
    expect(detail?.overBalance).toBe(true);
    expect(detail?.overflowDays).toBe(2);
  });
});

describe("잔여와 무관한 종류(경조 · 기타)", () => {
  it("p_expected_used_days 를 보내지 않아(null) 동시 유급 승인에 걸려 stale 로 실패하지 않는다", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    fake.tables.annual_leave_requests = [request({ leave_type: "other" })];
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: true });
    expect(fake.rpcCalls[0].args).toMatchObject({ p_expected_used_days: null });
  });
});

describe("기준 잔여는 승인 한 번에 한 번만 읽는다(성능)", () => {
  it("annual_leave_baselines 읽기 1번", async () => {
    const { approveLeaveRequestForApprover } = await import("../annual-leave-approvals-server");
    const origFrom = fake.client.from;
    let baselineReads = 0;
    fake.client.from = ((t: string) => {
      if (t === "annual_leave_baselines") baselineReads += 1;
      return origFrom(t);
    }) as typeof fake.client.from;
    expect(await approveLeaveRequestForApprover(session(APPROVER), "req-1")).toEqual({ ok: true });
    expect(baselineReads).toBe(1);
  });
});

describe("결재 큐 요약 — 대기 건마다 따로 읽지 않는다(성능)", () => {
  it("대기 3건이어도 기준 잔여 읽기 1번, 넘는 신청자 이름은 그대로 찾는다", async () => {
    const { getAdminLeaveQueue } = await import("../annual-leave-approvals-server");
    fake.tables.profiles.push({ id: "user-2", hire_date: "2020-01-15" });
    fake.tables.memberships.push({ organization_id: ORG, user_id: "user-2", status: "active", role: "manager" });
    fake.tables.annual_leave_baselines.push({
      organization_id: ORG, user_id: "user-2", base_amount: 1, bonus_amount: 0, baseline_date: "2026-11-01", confirmed_at: "x",
    });
    fake.tables.annual_leave_requests = [
      request({ id: "a", days_count: 1, start_date: "2026-11-20", end_date: "2026-11-20" }),
      request({ id: "b", days_count: 1, start_date: "2026-11-21", end_date: "2026-11-21" }),
      request({ id: "c", user_id: "user-2", applicant_name: "Lee", days_count: 3 }),
    ];
    const origFrom = fake.client.from;
    let baselineReads = 0;
    fake.client.from = ((t: string) => {
      if (t === "annual_leave_baselines") baselineReads += 1;
      return origFrom(t);
    }) as typeof fake.client.from;
    const res = await getAdminLeaveQueue(session(APPROVER), { statusGroup: "pending" });
    expect(res.summary.balanceWarningName).toBe("Lee");
    expect(baselineReads).toBe(1);
  });
});
