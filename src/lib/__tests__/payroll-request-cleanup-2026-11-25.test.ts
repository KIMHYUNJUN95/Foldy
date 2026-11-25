import { beforeEach, describe, expect, it, vi } from "vitest";

// 급여 결재 요청 — 지난 지급 체크 청소는 상태를 넘기기 **전에** 한다(2026-11-25).
// 청소가 실패해도 회차는 준비 중으로 남아 다시 누를 수 있고, 로그 · 새로고침이 건너뛰어지지 않는다.

const ORG = "org1";
let approvalStatus: string;
let failChecksDelete = false;
let order: string[] = [];
let events: string[] = [];

function client() {
  return {
    from(table: string) {
      let op = "select";
      const chain: Record<string, unknown> = {};
      for (const n of ["select", "eq", "limit", "maybeSingle", "single"]) chain[n] = () => chain;
      for (const o of ["insert", "update", "delete"]) chain[o] = () => ((op = o), chain);
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === "payroll_payment_checks" && op === "delete") {
          order.push("delete-checks");
          return Promise.resolve({ data: [], error: failChecksDelete ? { message: "boom" } : null }).then(resolve);
        }
        if (table === "payroll_month_approvals" && op === "update") {
          order.push("transition");
          approvalStatus = "approval_senmu";
          return Promise.resolve({ data: [{ status: approvalStatus }], error: null }).then(resolve);
        }
        if (table === "payroll_month_approval_events") events.push("request");
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return chain;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => client() }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ organization: { id: ORG }, user: { id: "u1" } }),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/attendance-review", () => ({ attendanceCan: async () => true }));
vi.mock("@/lib/payroll-prep", () => ({ payrollPrepAvailable: () => true }));
vi.mock("@/lib/payroll-prep-server", () => ({ loadPrepRows: async () => ({ rows: [{ finalized: true }], totals: { needsCheck: 0, uncalculated: 0 } }) }));
vi.mock("@/lib/payroll-settings-server", () => ({
  loadOrgPayrollSettings: async () => ({ presidentApproverId: "pres", senmuApproverId: null, payDay: 10, companyName: "C", employmentInsuranceRates: {} }),
}));
vi.mock("@/lib/payroll-settings-rules", () => ({ paydayFor: () => "2026-11-10" }));
vi.mock("@/lib/payroll-approval-server", () => ({
  readApprovalRow: async () => ({ status: "preparing" }),
  readPaymentCheckRows: async () => [],
  checksById: () => new Map(),
}));

const { requestPayrollApproval } = await import("@/actions/payroll-approval");

beforeEach(() => {
  approvalStatus = "preparing";
  failChecksDelete = false;
  order = [];
  events = [];
});

describe("requestPayrollApproval — 지급 체크 청소 순서", () => {
  it("청소가 실패하면 상태를 넘기지 않고 error — 회차는 준비 중 그대로", async () => {
    failChecksDelete = true;
    expect(await requestPayrollApproval("2026-10")).toEqual({ ok: false, reason: "error" });
    expect(order).toEqual(["delete-checks"]);
    expect(approvalStatus).toBe("preparing");
    expect(events).toHaveLength(0);
  });

  it("청소가 성공한 뒤에 상태를 넘기고 기록한다", async () => {
    const r = await requestPayrollApproval("2026-10");
    expect(r.ok).toBe(true);
    expect(order).toEqual(["delete-checks", "transition"]);
    expect(events).toEqual(["request"]);
  });
});
