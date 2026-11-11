import { beforeEach, describe, expect, it, vi } from "vitest";

// 「지난달 값 가져오기」 — 급여 준비 읽기가 실패하면(requireRead 가 던짐) 화면이 멈추지 않게 오류 결과로 돌려준다(2026-11-11).

const prepFails = { on: false };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db-write-guard", () => ({ bestEffortWrite: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: vi.fn(async () => ({ user: { id: "u-admin" }, organization: { id: "org-1" } })),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/attendance-review", () => ({ attendanceCan: vi.fn(async () => true) }));
vi.mock("@/lib/payroll-approval-server", () => ({
  payrollMonthLockState: vi.fn(async () => "open"),
  readApprovalRow: vi.fn(async () => null),
}));
vi.mock("@/lib/payroll-settings-server", () => ({
  loadOrgPayrollSettings: vi.fn(async () => ({ payDay: 10, employmentInsuranceRates: null })),
}));
vi.mock("@/lib/payroll-prep-server", () => ({
  PAYROLL_MONTH_INPUT_SELECT: "*",
  rowToPrepManual: (r: unknown) => r,
  loadPrepRows: vi.fn(async () => {
    if (prepFails.on) throw new Error("attendance_sessions read failed");
    return { rows: [], totals: {} };
  }),
}));
vi.mock("@/lib/payroll-prep", () => ({ payrollPrepAvailable: () => true }));
vi.mock("@/lib/supabase/service", () => {
  const q = {
    select: () => q,
    eq: () => q,
    then: (res: (v: { data: unknown[]; error: null }) => unknown) => res({ data: [], error: null }),
  };
  return { getSupabaseServiceClient: () => ({ from: () => q }) };
});

import { previewPayrollCarryOver, runPayrollCarryOver } from "@/actions/payroll-carry-over";

describe("payroll carry-over — prep read failure", () => {
  beforeEach(() => {
    prepFails.on = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("preview returns an error result instead of throwing", async () => {
    prepFails.on = true;
    await expect(previewPayrollCarryOver({ ym: "2026-10" })).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("run returns an error result instead of throwing", async () => {
    prepFails.on = true;
    await expect(runPayrollCarryOver({ ym: "2026-10", fields: ["special"] })).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("preview still works when reads succeed", async () => {
    const res = await previewPayrollCarryOver({ ym: "2026-10" });
    expect(res.ok).toBe(true);
  });
});
