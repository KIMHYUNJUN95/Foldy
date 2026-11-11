import { beforeEach, describe, expect, it, vi } from "vitest";

// 근태 점검 1차(2026-11-11, H5 · H1) — 읽기 실패를 「0건」으로 보고 계산하지 않는다 · 마감된 달의 대기 정정이 급여에서
// 그 날을 빼지 않는다. 메모리 DB 에 표마다 「읽기 실패」를 끼워 넣는다.

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const failing = new Set<string>();

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: ((row: Row) => boolean)[] = [];
  private from = 0;
  private to: number | null = null;
  private single = false;
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: null) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  gte(c: string, v: string) {
    this.filters.push((r) => r[c] != null && String(r[c]) >= v);
    return this;
  }
  lte(c: string, v: string) {
    this.filters.push((r) => r[c] != null && String(r[c]) <= v);
    return this;
  }
  order() {
    return this;
  }
  range(f: number, t: number) {
    this.from = f;
    this.to = t;
    return this;
  }
  limit(n: number) {
    this.to = this.from + n - 1;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  private run() {
    if (failing.has(this.table)) return { data: null, error: { message: `${this.table} read failed` } };
    let rows = (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    rows = rows.slice(this.from, this.to == null ? undefined : this.to + 1);
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows.map((r) => ({ ...r })), error: null };
  }
  then<T1, T2>(
    ok?: (v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>,
    bad?: (e: unknown) => T2 | PromiseLike<T2>,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

const fakeClient = { from: (t: string) => new FakeQuery(t) };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient }));

const ORG = "org-1";
const A = "u-a";
const YM = "2026-09";

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  failing.clear();
  tables.hourly_rate_history = [
    { organization_id: ORG, user_id: A, hourly_rate: 1200, effective_from: "2026-01-01", effective_to: null },
  ];
  tables.employment_type_history = [
    { organization_id: ORG, user_id: A, employment_type: "hourly", effective_from: "2026-01-01", effective_to: null },
  ];
  tables.attendance_sessions = [
    {
      id: "s1",
      organization_id: ORG,
      user_id: A,
      operating_date: "2026-09-02",
      clock_in_at: "2026-09-02T09:00:00+09:00",
      clock_out_at: "2026-09-02T18:00:00+09:00",
      status: "completed",
      review_state: "normal",
      clock_in_site_id: null,
      clock_out_site_id: null,
      manual_created: false,
    },
  ];
  // 1시간 휴게 — 읽기에 실패하면 빠지지 않아 9시간이 지급된다(과지급).
  tables.attendance_breaks = [
    { session_id: "s1", started_at: "2026-09-02T12:00:00+09:00", ended_at: "2026-09-02T13:00:00+09:00" },
  ];
  tables.attendance_correction_requests = [];
  tables.attendance_pay_allowances = [];
  tables.attendance_month_snapshots = [];
}

beforeEach(seed);

describe("읽기 실패는 계산을 멈춘다 (H5)", () => {
  it("관리자 급여 한 달치 — 세션 읽기 실패면 던진다(잘린 세션으로 계산하지 않는다)", async () => {
    const { loadPayrollMonthBase } = await import("@/lib/admin-attendance");
    failing.add("attendance_sessions");
    await expect(loadPayrollMonthBase(fakeClient as never, ORG, YM)).rejects.toThrow(/attendance_sessions/);
  });

  it("관리자 급여 한 달치 — 수당 · 시급 · 스냅샷 읽기 실패도 던진다", async () => {
    const { loadPayrollMonthBase } = await import("@/lib/admin-attendance");
    for (const t of ["hourly_rate_history", "attendance_pay_allowances", "attendance_month_snapshots", "attendance_correction_requests"]) {
      seed();
      failing.add(t);
      await expect(loadPayrollMonthBase(fakeClient as never, ORG, YM)).rejects.toThrow(t);
    }
  });

  it("휴게 읽기 실패면 던진다 — 휴게를 0 으로 보고 과지급하지 않는다", async () => {
    const { loadPayrollMonthLinks } = await import("@/lib/admin-attendance");
    failing.add("attendance_breaks");
    await expect(loadPayrollMonthLinks(fakeClient as never, ORG, [{ id: "s1" }])).rejects.toThrow(/attendance_breaks/);
  });

  it("직원 월 급여(마감 스냅샷의 원천) — strict 면 휴게 읽기 실패에 던진다", async () => {
    const { getMonthlyPayView } = await import("@/lib/attendance-pay");
    const ok = await getMonthlyPayView(ORG, A, YM, "ko", { strict: true });
    expect(ok.totalPaidMinutes).toBe(8 * 60);
    failing.add("attendance_breaks");
    await expect(getMonthlyPayView(ORG, A, YM, "ko", { strict: true })).rejects.toThrow(/attendance_breaks/);
  });

  it("마감 판정 — 정정 요청 읽기 실패를 「막는 것 0건」으로 보지 않는다", async () => {
    const { getFinalizationEligibility } = await import("@/lib/attendance-finalization");
    failing.add("attendance_correction_requests");
    await expect(getFinalizationEligibility(ORG, A, YM, 0)).rejects.toThrow(/attendance_correction_requests/);
  });

  it("마감 판정 — 세션 · 스냅샷 읽기 실패도 던진다", async () => {
    const { getFinalizationEligibility } = await import("@/lib/attendance-finalization");
    failing.add("attendance_sessions");
    await expect(getFinalizationEligibility(ORG, A, YM, 0)).rejects.toThrow(/attendance_sessions/);
    seed();
    failing.add("attendance_month_snapshots");
    await expect(getFinalizationEligibility(ORG, A, YM, 0)).rejects.toThrow(/attendance_month_snapshots/);
  });
});

describe("마감된 달의 대기 정정은 급여에서 그 날을 빼지 않는다 (H1)", () => {
  function addPendingCorrection() {
    tables.attendance_correction_requests.push({
      id: "c1",
      organization_id: ORG,
      session_id: "s1",
      requested_by_user_id: A,
      status: "requested",
      created_at: "2026-10-03T00:00:00+00:00",
      target_month: "2026-09-01",
    });
  }

  it("마감 전: 대기 정정 근무는 빠진다(지금 규칙 그대로)", async () => {
    addPendingCorrection();
    const { getMonthlyPayView } = await import("@/lib/attendance-pay");
    const view = await getMonthlyPayView(ORG, A, YM);
    expect(view.totalPaidMinutes).toBe(0);
  });

  it("마감 뒤 들어온 대기 정정: 직원 급여 · 관리자 급여 · 급여 준비 모두 그 날을 그대로 센다", async () => {
    tables.attendance_month_snapshots.push({
      id: "m1",
      organization_id: ORG,
      user_id: A,
      target_month: "2026-09-01",
      status: "finalized",
      gross_amount: 9600,
      total_paid_minutes: 480,
      finalized_at: "2026-10-02T00:00:00+00:00",
    });
    addPendingCorrection();
    const { getMonthlyPayView } = await import("@/lib/attendance-pay");
    const view = await getMonthlyPayView(ORG, A, YM);
    expect(view.totalPaidMinutes).toBe(480);
    expect(view.expectedGross).toBe(9600);

    const { loadPayrollMonthBase, loadPayrollMonthLinks, computePayrollMonth } = await import("@/lib/admin-attendance");
    const base = await loadPayrollMonthBase(fakeClient as never, ORG, YM);
    const links = await loadPayrollMonthLinks(fakeClient as never, ORG, base.sessions);
    const month = computePayrollMonth({ ...base, ...links }, YM, "ko", [A]).get(A)!;
    expect(month.pay.totalPaidMinutes).toBe(480);
    expect(month.prep.dailyTaxable).toEqual([9600]);
    expect(month.finalized).toBe(true);
  });
});
