// 연차 서버 읽기 · 쓰기 점검 수정(2026-11-11) — 읽기 실패는 숨기지 않는다(H5) · 1,000행 넘게 읽는다(M14) ·
// 미래 입사일 거절 · 본인 입력은 「확인 전」(M11).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => null }));
vi.mock("@/lib/tokyo-date", () => ({ tokyoToday: () => "2026-11-11" }));

const ORG = "org-1";
const USER = "user-1";

type Fake = ReturnType<typeof createFakeSupabase>;
let fake: Fake;

/** 한 표의 읽기를 실패로 바꾼 클라이언트. */
function failing(table: string) {
  return {
    ...fake.client,
    from: (t: string) => {
      if (t !== table) return fake.client.from(t);
      const err = { data: null, error: { message: "boom", code: "XX000" } };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "range", "maybeSingle", "single", "limit", "is", "gte", "lte"]) {
        chain[m] = () => chain;
      }
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(err));
      return chain;
    },
  };
}

beforeEach(() => {
  fake = createFakeSupabase({
    profiles: [{ id: USER, hire_date: "2020-01-01" }],
    memberships: [{ organization_id: ORG, user_id: USER, status: "active", role: "manager" }],
    annual_leave_baselines: [
      { organization_id: ORG, user_id: USER, base_amount: 10, bonus_amount: 0, baseline_date: "2026-01-01", confirmed_at: null },
    ],
    annual_leave_requests: [],
  });
});

describe("sumApprovedLeaveUsage", () => {
  it("1,000행이 넘어도 전부 읽는다", async () => {
    const { sumApprovedLeaveUsage } = await import("../annual-leave-server");
    fake.tables.annual_leave_requests = Array.from({ length: 1205 }, (_, i) => ({
      id: `r-${String(i).padStart(5, "0")}`,
      organization_id: ORG,
      user_id: USER,
      status: "approved",
      leave_type: "paid",
      days_count: 0.5,
      start_date: "2026-02-01",
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = await sumApprovedLeaveUsage(fake.client as any, ORG, USER);
    expect(usage.base).toBe(602.5);
    expect(usage.usages).toHaveLength(1205);
  });

  it("읽기가 실패하면 0 으로 숨기지 않고 던진다(잔여가 부풀지 않게)", async () => {
    const { sumApprovedLeaveUsage } = await import("../annual-leave-server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(sumApprovedLeaveUsage(failing("annual_leave_requests") as any, ORG, USER)).rejects.toThrow();
  });
});

describe("getAnnualLeaveBaseline", () => {
  it("읽기가 실패하면 「설정 안 됨」으로 숨기지 않고 던진다", async () => {
    const { getAnnualLeaveBaseline } = await import("../annual-leave-server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(getAnnualLeaveBaseline(failing("annual_leave_baselines") as any, ORG, USER)).rejects.toThrow();
  });

  it("관리자가 확인하기 전 기준 잔여는 provisional", async () => {
    const { getAnnualLeaveBaseline } = await import("../annual-leave-server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await getAnnualLeaveBaseline(fake.client as any, ORG, USER);
    expect(row?.provisional).toBe(true);
    fake.tables.annual_leave_baselines[0].confirmed_at = "2026-11-10T00:00:00Z";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await getAnnualLeaveBaseline(fake.client as any, ORG, USER))?.provisional).toBe(false);
  });
});

describe("setAnnualLeaveBaselineForUser", () => {
  it("미래 입사일은 거절한다", async () => {
    const { setAnnualLeaveBaselineForUser } = await import("../annual-leave-server");
    fake.tables.annual_leave_baselines = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await setAnnualLeaveBaselineForUser(fake.client as any, ORG, USER, { hireDate: "2026-11-12", baseAmount: 5 }, "self_once");
    expect(res).toEqual({ ok: false, error: "future_hire_date" });
  });

  it("없는 날짜(2026-02-30)는 거절한다", async () => {
    const { setAnnualLeaveBaselineForUser } = await import("../annual-leave-server");
    fake.tables.annual_leave_baselines = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await setAnnualLeaveBaselineForUser(fake.client as any, ORG, USER, { hireDate: "2026-02-30", baseAmount: 5 }, "self_once");
    expect(res).toEqual({ ok: false, error: "invalid_dates" });
  });

  it("본인 입력은 확인 전(confirmed_at null)으로, 다른 결재자의 저장은 확인됨으로 남는다", async () => {
    const { setAnnualLeaveBaselineForUser } = await import("../annual-leave-server");
    fake.tables.annual_leave_baselines = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = await setAnnualLeaveBaselineForUser(fake.client as any, ORG, USER, { hireDate: "2020-01-01", baseAmount: 5 }, "self_once");
    expect(self.ok).toBe(true);
    expect(fake.tables.annual_leave_baselines[0].confirmed_at ?? null).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = await setAnnualLeaveBaselineForUser(fake.client as any, ORG, USER, { hireDate: "2020-01-01", baseAmount: 7 }, "admin_upsert", "approver-1");
    expect(admin.ok).toBe(true);
    const upserted = fake.writes.filter((w) => w.table === "annual_leave_baselines" && w.op === "upsert").at(-1);
    const payload = (upserted?.payload as Record<string, unknown>[])[0];
    expect(payload.confirmed_by_user_id).toBe("approver-1");
    expect(typeof payload.confirmed_at).toBe("string");
  });

  it("결재자가 자기 잔여를 저장하면 확인됨이 되지 않는다", async () => {
    const { setAnnualLeaveBaselineForUser } = await import("../annual-leave-server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setAnnualLeaveBaselineForUser(fake.client as any, ORG, USER, { hireDate: "2020-01-01", baseAmount: 7 }, "admin_upsert", USER);
    const upserted = fake.writes.filter((w) => w.table === "annual_leave_baselines" && w.op === "upsert").at(-1);
    const payload = (upserted?.payload as Record<string, unknown>[])[0];
    expect(payload.confirmed_at).toBeNull();
    expect(payload.confirmed_by_user_id).toBeNull();
  });

  it("이미 있는지 읽기가 실패하면 던지지 않고 read_failed 를 돌려준다", async () => {
    const { setAnnualLeaveBaselineForUser } = await import("../annual-leave-server");
    const res = await setAnnualLeaveBaselineForUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      failing("annual_leave_baselines") as any,
      ORG,
      USER,
      { hireDate: "2020-01-01", baseAmount: 5 },
      "self_once",
    );
    expect(res).toEqual({ ok: false, error: "read_failed" });
  });
});
