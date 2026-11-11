// 연차 신청 액션 — 기준 잔여 읽기 실패가 액션 밖으로 던져지지 않고 read_failed 결과가 된다(2026-11-11).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({
    organization: { id: "org-1" },
    user: { id: "user-1", role: "manager", name: "Kim", preferredLanguage: "ko" },
  }),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/annual-leave-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/annual-leave-server")>("@/lib/annual-leave-server");
  return {
    ...actual,
    hasAnnualLeaveBaselineRow: async () => {
      throw new actual.LeaveReadError("annual_leave_baselines.exists", { message: "boom" });
    },
  };
});

describe("submitLeaveRequestAction", () => {
  it("기준 잔여 읽기가 실패하면 read_failed", async () => {
    const { submitLeaveRequestAction } = await import("@/app/mobile/attendance/leave/actions");
    const res = await submitLeaveRequestAction({
      leaveType: "paid",
      startDate: "2026-11-20",
      endDate: "2026-11-20",
      durationUnit: "full",
      reason: "r",
      emergencyContact: "e",
    });
    expect(res).toEqual({ ok: false, error: "read_failed" });
  });
});
