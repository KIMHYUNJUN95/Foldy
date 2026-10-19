import { beforeEach, describe, expect, it, vi } from "vitest";

// 관리자 급여 · 근태 개요 · 직원 상세가 조직 단위로 한 번에 읽어 계산한 값이, 예전처럼 직원마다
// `getMonthlyPayView` · `getFinalizationEligibility` · `getCurrentFinalizedSnapshot` 를 부른 값과
// **1엔 · 1분까지 같은지** 같은 메모리 DB 로 비교한다(2026-10-19). 급여 규칙을 한쪽만 바꾸면 여기서 깨진다.

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const counter = { queries: 0 };

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown; count: number | null }> {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private head = false;
  private wantCount = false;
  private single: "maybe" | "one" | null = null;

  constructor(private readonly table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    this.head = options?.head ?? false;
    this.wantCount = Boolean(options?.count);
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((r) => r[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  gte(column: string, value: string) {
    this.filters.push((r) => r[column] != null && String(r[column]) >= value);
    return this;
  }
  lte(column: string, value: string) {
    this.filters.push((r) => r[column] != null && String(r[column]) <= value);
    return this;
  }
  ilike(column: string, pattern: string) {
    const needle = pattern.replace(/%/g, "").toLowerCase();
    this.filters.push((r) => String(r[column] ?? "").toLowerCase().includes(needle));
    return this;
  }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    const ascending = options?.ascending ?? true;
    // Postgres 기본: ASC 는 NULL 마지막, DESC 는 NULL 먼저.
    this.orders.push({ column, ascending, nullsFirst: options?.nullsFirst ?? !ascending });
    return this;
  }
  limit(n: number) {
    this.rangeTo = this.rangeFrom + n - 1;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  maybeSingle() {
    this.single = "maybe";
    return this;
  }

  private run() {
    counter.queries += 1;
    let rows = (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          const av = a[o.column] ?? null;
          const bv = b[o.column] ?? null;
          if (av === bv) continue;
          if (av === null) return o.nullsFirst ? -1 : 1;
          if (bv === null) return o.nullsFirst ? 1 : -1;
          const cmp = String(av) < String(bv) ? -1 : 1;
          return o.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    const count = rows.length;
    rows = rows.slice(this.rangeFrom, this.rangeTo == null ? undefined : this.rangeTo + 1);
    if (this.single) {
      if (rows.length > 1) return { data: null, error: { message: "multiple rows" }, count };
      return { data: rows[0] ?? null, error: null, count };
    }
    return { data: this.head ? null : rows.map((r) => ({ ...r })), error: null, count: this.wantCount ? count : null };
  }

  then<T1, T2>(
    onFulfilled?: (value: { data: unknown; error: unknown; count: number | null }) => T1 | PromiseLike<T1>,
    onRejected?: (reason: unknown) => T2 | PromiseLike<T2>,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

const fakeClient = { from: (table: string) => new FakeQuery(table) };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient }));

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ADMIN = "u-admin";
const A = "u-a"; // 시급, 달 중간 시급 인상, 휴게 · 정정 · 수당 · 예외 정정
const B = "u-b"; // 월급제
const C = "u-c"; // 시급 → 월급 전환(mixed) + 마감 스냅샷
const D = "u-d"; // 근무 기록은 있는데 고용형태 없음
const E = "u-e"; // 퇴사(inactive) + 지난 마감 스냅샷만
const YM = "2026-09";

let seq = 0;
const id = (p: string) => `${p}-${String(++seq).padStart(4, "0")}`;

function session(
  user: string,
  date: string,
  inAt: string | null,
  outAt: string | null,
  extra: Partial<Row> = {},
): Row {
  return {
    id: id("s"),
    organization_id: ORG,
    user_id: user,
    operating_date: date,
    clock_in_at: inAt ? `${date}T${inAt}:00+09:00` : null,
    clock_out_at: outAt ? `${date}T${outAt}:00+09:00` : null,
    status: outAt ? "completed" : "open",
    review_state: "normal",
    clock_in_site_id: null,
    clock_out_site_id: null,
    manual_created: false,
    clock_in_method: null,
    clock_out_method: null,
    ...extra,
  };
}

function seed() {
  seq = 0;
  for (const key of Object.keys(tables)) delete tables[key];
  tables.platform_admins = [{ id: "pa-1", user_id: ADMIN, is_active: true }];
  tables.memberships = [
    { organization_id: ORG, user_id: ADMIN, role: "owner", status: "active", attendance_payroll_admin: false },
    { organization_id: ORG, user_id: A, role: "part_time", status: "active", attendance_payroll_admin: false },
    { organization_id: ORG, user_id: B, role: "office", status: "active", attendance_payroll_admin: false },
    { organization_id: ORG, user_id: C, role: "field", status: "active", attendance_payroll_admin: false },
    { organization_id: ORG, user_id: D, role: "field", status: "active", attendance_payroll_admin: false },
    { organization_id: ORG, user_id: E, role: "field", status: "inactive", attendance_payroll_admin: false },
  ];
  tables.profiles = [
    { id: ADMIN, name: "관리자" },
    { id: A, name: "가나" },
    { id: B, name: "다라" },
    { id: C, name: "마바" },
    { id: D, name: "사아" },
    { id: E, name: "자차" },
  ];
  tables.hourly_rate_history = [
    { id: "r1", organization_id: ORG, user_id: A, hourly_rate: 1111, effective_from: "2026-01-01", effective_to: "2026-09-14" },
    { id: "r2", organization_id: ORG, user_id: A, hourly_rate: 1237, effective_from: "2026-09-15", effective_to: null },
    { id: "r3", organization_id: ORG, user_id: C, hourly_rate: 1053, effective_from: "2026-01-01", effective_to: null },
    { id: "r4", organization_id: OTHER_ORG, user_id: A, hourly_rate: 9999, effective_from: "2026-01-01", effective_to: null },
  ];
  tables.employment_type_history = [
    { id: "e1", organization_id: ORG, user_id: A, employment_type: "hourly", effective_from: "2026-01-01", effective_to: null },
    { id: "e2", organization_id: ORG, user_id: B, employment_type: "salaried", effective_from: "2025-04-01", effective_to: null },
    { id: "e3", organization_id: ORG, user_id: C, employment_type: "hourly", effective_from: "2026-01-01", effective_to: "2026-09-10" },
    { id: "e4", organization_id: ORG, user_id: C, employment_type: "salaried", effective_from: "2026-09-11", effective_to: null },
  ];

  const a1 = session(A, "2026-09-02", "09:00", "17:37");
  const a2 = session(A, "2026-09-02", "18:00", "20:13");
  const a3 = session(A, "2026-09-10", "09:00", "18:00", { review_state: "review_required" });
  const a4 = session(A, "2026-09-15", "08:58", "15:01", { review_state: "approved_correction" });
  const a5 = session(A, "2026-09-16", "10:00", "14:19");
  const a6 = session(A, "2026-09-17", "10:00", "13:07");
  const a7 = session(A, "2026-09-20", "09:00", null, { status: "abandoned" });
  const a8 = session(A, "2026-09-21", "09:00", "12:00", { status: "invalid" });
  const a9 = session(A, "2026-09-30", "23:10", null);
  const aPrev = session(A, "2026-08-31", "09:00", "17:00");
  const aOther = session(A, "2026-09-03", "09:00", "17:00", { organization_id: OTHER_ORG });
  const b1 = session(B, "2026-09-04", "09:00", "18:00");
  const b2 = session(B, "2026-09-05", "09:00", "18:00");
  const c1 = session(C, "2026-09-05", "07:41", "16:29");
  const c2 = session(C, "2026-09-12", "09:00", "17:00");
  const d1 = session(D, "2026-09-08", "09:00", "15:33");
  tables.attendance_sessions = [a1, a2, a3, a4, a5, a6, a7, a8, a9, aPrev, aOther, b1, b2, c1, c2, d1];

  tables.attendance_breaks = [
    { id: "b1", organization_id: ORG, session_id: a1.id, started_at: "2026-09-02T12:00:00+09:00", ended_at: "2026-09-02T12:47:13+09:00" },
    { id: "b2", organization_id: ORG, session_id: a4.id, started_at: "2026-09-15T14:30:00+09:00", ended_at: null },
    { id: "b3", organization_id: ORG, session_id: c1.id, started_at: "2026-09-05T07:30:00+09:00", ended_at: "2026-09-05T08:02:00+09:00" },
    { id: "b4", organization_id: ORG, session_id: a9.id, started_at: "2026-09-30T23:40:00+09:00", ended_at: null },
  ];

  tables.attendance_correction_requests = [
    // A 본인의 처리 대기 정정 → 급여 제외 + 마감 차단.
    { id: "c1", organization_id: ORG, session_id: a5.id, requested_by_user_id: A, status: "requested", created_at: "2026-09-16T10:00:00.000+00:00", target_month: null },
    // 같은 세션의 옛 요청(반려) — 최근 것이 이긴다.
    { id: "c2", organization_id: ORG, session_id: a5.id, requested_by_user_id: A, status: "rejected", created_at: "2026-09-16T09:00:00.000+00:00", target_month: null },
    // 다른 사람이 A 세션에 낸 요청 — 급여 · 마감엔 안 잡히고 직원 상세 원장 표시에만 잡힌다.
    { id: "c3", organization_id: ORG, session_id: a6.id, requested_by_user_id: ADMIN, status: "in_review", created_at: "2026-09-17T10:00:00.000+00:00", target_month: null },
    // A 세션 없는 예외 정정(그 달).
    { id: "c4", organization_id: ORG, session_id: null, requested_by_user_id: A, status: "requested", created_at: "2026-09-18T10:00:00.000+00:00", target_month: "2026-09-01" },
    // 지난달 예외 정정 — 이번 달엔 안 잡힌다.
    { id: "c5", organization_id: ORG, session_id: null, requested_by_user_id: A, status: "requested", created_at: "2026-08-18T10:00:00.000+00:00", target_month: "2026-08-01" },
    // C 승인 끝난 정정.
    { id: "c6", organization_id: ORG, session_id: c1.id, requested_by_user_id: C, status: "approved", created_at: "2026-09-06T10:00:00.000+00:00", target_month: null },
  ];

  tables.attendance_pay_allowances = [
    { id: "al1", organization_id: ORG, status: "active", target_date: "2026-09-02", target_user_id: null, allowance_type: "daily_fixed", amount_yen: 1500, category: "regular", memo: null },
    { id: "al2", organization_id: ORG, status: "active", target_date: "2026-09-15", target_user_id: A, allowance_type: "hourly_extra", amount_yen: 113, category: "special", memo: "바쁜 날" },
    { id: "al3", organization_id: ORG, status: "active", target_date: "2026-09-25", target_user_id: null, allowance_type: "daily_fixed", amount_yen: 2000, category: "regular", memo: null },
    { id: "al4", organization_id: ORG, status: "active", target_date: "2026-09-26", target_user_id: null, allowance_type: "hourly_extra", amount_yen: 300, category: "regular", memo: null },
    { id: "al5", organization_id: ORG, status: "active", target_date: "2026-09-05", target_user_id: C, allowance_type: "hourly_extra", amount_yen: 77, category: "regular", memo: null },
    { id: "al6", organization_id: ORG, status: "cancelled", target_date: "2026-09-02", target_user_id: null, allowance_type: "daily_fixed", amount_yen: 9000, category: "regular", memo: null },
    { id: "al7", organization_id: ORG, status: "active", target_date: "2026-09-02", target_user_id: B, allowance_type: "daily_fixed", amount_yen: 700, category: "special", memo: null },
  ];

  tables.attendance_month_snapshots = [
    { id: "m1", organization_id: ORG, user_id: C, target_month: "2026-09-01", status: "finalized", gross_amount: 9120, total_paid_minutes: 497, finalized_at: "2026-10-02T03:04:05+00:00" },
    { id: "m2", organization_id: ORG, user_id: A, target_month: "2026-09-01", status: "reopened", gross_amount: 1000, total_paid_minutes: 60, finalized_at: "2026-10-01T00:00:00+00:00" },
    { id: "m3", organization_id: ORG, user_id: E, target_month: "2026-09-01", status: "finalized", gross_amount: 4321, total_paid_minutes: 240, finalized_at: null },
  ];

  tables.transport_reimbursement_reports = [
    { id: "t1", organization_id: ORG, user_id: A, target_month: "2026-09-01", status: "approved", total_amount_cached: 1320, submitted_at: "2026-09-30T01:00:00+00:00" },
    { id: "t2", organization_id: ORG, user_id: C, target_month: "2026-09-01", status: "submitted", total_amount_cached: 880, submitted_at: "2026-09-29T01:00:00+00:00" },
    { id: "t3", organization_id: ORG, user_id: D, target_month: "2026-09-01", status: "draft", total_amount_cached: 400, submitted_at: null },
  ];
  tables.transport_reimbursement_items = [
    { id: "ti1", organization_id: ORG, report_id: "t1", user_id: A, usage_date: "2026-09-02", sort_order: 0, amount_yen: 1320, entry_mode: "linked" },
    { id: "ti2", organization_id: ORG, report_id: "t2", user_id: C, usage_date: "2026-09-05", sort_order: 0, amount_yen: 880, entry_mode: "manual" },
    { id: "ti3", organization_id: ORG, report_id: "t3", user_id: D, usage_date: "2026-09-08", sort_order: 0, amount_yen: 400, entry_mode: "manual" },
  ];
  tables.transport_reimbursement_item_images = [
    { id: "ii1", organization_id: ORG, report_id: "t1", item_id: "ti1", user_id: A, storage_path: "x", sort_order: 0, created_at: "2026-09-02T00:00:00+00:00" },
  ];
  tables.attendance_sites = [];
}

const adminSession = {
  user: { id: ADMIN, preferredLanguage: "ko" },
  organization: { id: ORG },
} as unknown as import("@/lib/session").AppSession;

async function legacyPayrollRows(userIds: string[], localeTag: string) {
  const { getMonthlyPayView } = await import("@/lib/attendance-pay");
  const { getFinalizationEligibility, getCurrentFinalizedSnapshot } = await import(
    "@/lib/attendance-finalization"
  );
  const sessionUserIds = new Set(
    tables.attendance_sessions
      .filter((s) => s.organization_id === ORG && String(s.operating_date).startsWith(YM))
      .map((s) => s.user_id as string),
  );
  const transportByUser = new Map<string, number>();
  for (const r of tables.transport_reimbursement_reports) {
    if (r.organization_id === ORG && r.target_month === `${YM}-01` && r.status === "approved") {
      transportByUser.set(r.user_id as string, (transportByUser.get(r.user_id as string) ?? 0) + Number(r.total_amount_cached));
    }
  }
  const rows = [];
  for (const userId of userIds) {
    const [pay, elig, snapshot] = await Promise.all([
      getMonthlyPayView(ORG, userId, YM, localeTag),
      getFinalizationEligibility(ORG, userId, YM),
      getCurrentFinalizedSnapshot(fakeClient as never, ORG, userId, YM),
    ]);
    // 예전 `getAdminAttendancePayroll` 의 행 매핑 그대로.
    const employment = pay.salariedOnly
      ? "salaried"
      : pay.hourlyEligible
        ? pay.days.some((d) => d.employmentType === "salaried")
          ? "mixed"
          : "hourly"
        : "none";
    const primaryRate = pay.rateSegments.length > 0 ? pay.rateSegments[0].rate : 0;
    const finalized = Boolean(snapshot);
    const effectivePaidMinutes = pay.finalization?.paidMinutes ?? pay.totalPaidMinutes;
    const effectiveGross = pay.finalization?.gross ?? pay.expectedGross;
    const membership = tables.memberships.find((m) => m.user_id === userId);
    const h = Math.floor(effectivePaidMinutes / 60);
    rows.push({
      userId,
      userName: (tables.profiles.find((p) => p.id === userId)?.name as string) ?? "—",
      role: (membership?.role as string | undefined) ?? null,
      employment,
      employmentMissing: employment === "none" && sessionUserIds.has(userId),
      totalPaidMinutes: effectivePaidMinutes,
      recognizedLabel: `${h}:${String(effectivePaidMinutes % 60).padStart(2, "0")}`,
      workDays: pay.days.filter((d) => d.paidMinutes > 0).length,
      primaryRate,
      expectedGross: effectiveGross,
      allowanceTotal: pay.allowanceTotal,
      allowanceRegularTotal: pay.allowanceRegularTotal,
      allowanceSpecialTotal: pay.allowanceSpecialTotal,
      baseGross: effectiveGross - pay.allowanceTotal,
      transportApproved: transportByUser.get(userId) ?? 0,
      excludedCount: pay.excludedCount,
      finalized,
      finalizedAtLabel: pay.finalization?.finalizedAtLabel ?? null,
      finalizationEligible: elig.eligible,
      blockers: elig.blockers,
    });
  }
  return rows.sort((a, b) => a.userName.localeCompare(b.userName));
}

describe("admin payroll batch = per-user pay view", () => {
  beforeEach(() => {
    seed();
  });

  for (const localeTag of ["ko-KR", "ja-JP", "en-US"]) {
    it(`payroll rows and KPI match the per-user path exactly (${localeTag})`, async () => {
      const { getAdminAttendancePayroll } = await import("@/lib/admin-attendance");
      const result = await getAdminAttendancePayroll(adminSession, YM, localeTag);
      expect(result.isPrivileged).toBe(true);

      const userIds = result.rows.map((r) => r.userId);
      expect(new Set(userIds)).toEqual(new Set([ADMIN, A, B, C, D, E]));
      const legacy = await legacyPayrollRows(userIds, localeTag);
      expect(result.rows).toEqual(legacy);

      const hourly = legacy.filter((r) => r.employment === "hourly" || r.employment === "mixed");
      expect(result.kpi).toEqual({
        hourlyTarget: hourly.length,
        expectedTotal: hourly.reduce((s, r) => s + r.expectedGross, 0),
        excludedTotal: legacy.reduce((s, r) => s + r.excludedCount, 0),
        finalizedCount: legacy.filter((r) => r.finalized).length,
      });
    });
  }

  it("covers the edge cases the fixture is built for", async () => {
    const { getAdminAttendancePayroll } = await import("@/lib/admin-attendance");
    const { rows } = await getAdminAttendancePayroll(adminSession, YM, "ko-KR");
    const byId = new Map(rows.map((r) => [r.userId, r]));
    const a = byId.get(A)!;
    expect(a.employment).toBe("hourly");
    expect(a.finalized).toBe(false); // reopened 스냅샷은 마감 아님
    expect(a.blockers.pendingCorrections).toBe(2); // 세션 정정 1 + 예외 정정 1(다른 사람이 낸 것은 제외)
    expect(a.blockers.reviewRequired).toBe(1);
    expect(a.blockers.openSessions).toBe(2); // abandoned + 열린 세션
    expect(a.allowanceRegularTotal).toBe(3500); // 9/2 정액 + 9/25 출근 없는 날 정액
    expect(a.primaryRate).toBe(1111);
    expect(a.expectedGross).toBe(25980); // 손 계산: 기본 21,847.08 + 수당 4,125.27 → 10엔 올림
    expect(a.allowanceSpecialTotal).toBe(625); // 113엔 × 332분 ÷ 60 = 625.27
    expect(byId.get(B)!.employment).toBe("salaried");
    expect(byId.get(C)!.employment).toBe("mixed");
    expect(byId.get(C)!.expectedGross).toBe(9120); // 마감 스냅샷 금액
    expect(byId.get(D)!.employmentMissing).toBe(true);
    expect(byId.get(E)!.finalized).toBe(true);
  });

  it("reads the month in a constant number of queries", async () => {
    const { getAdminAttendancePayroll } = await import("@/lib/admin-attendance");
    counter.queries = 0;
    await getAdminAttendancePayroll(adminSession, YM, "ko-KR");
    const batch = counter.queries;
    counter.queries = 0;
    await legacyPayrollRows([ADMIN, A, B, C, D, E], "ko-KR");
    expect(batch).toBeLessThan(15);
    expect(batch).toBeLessThan(counter.queries);
  });

  it("staff detail pay block matches the per-user pay view", async () => {
    const { getAdminStaffDetail } = await import("@/lib/admin-attendance");
    const legacy = await legacyPayrollRows([A, B, C, D], "ko-KR");
    for (const row of legacy) {
      const detail = await getAdminStaffDetail(adminSession, row.userId, YM, "ko-KR");
      expect(detail.pay).toEqual({
        employment: row.employment,
        recognizedLabel: row.recognizedLabel,
        expectedGross: row.expectedGross,
        excludedCount: row.excludedCount,
        primaryRate: row.primaryRate,
        finalized: row.finalized,
      });
    }
  });

  it("staff detail ledger keeps newest-first order, breaks and any-requester correction flags", async () => {
    const { getAdminStaffDetail } = await import("@/lib/admin-attendance");
    const detail = await getAdminStaffDetail(adminSession, A, YM, "ko-KR");
    expect(detail.days.map((d) => d.date)).toEqual([
      "2026-09-30",
      "2026-09-21",
      "2026-09-20",
      "2026-09-17",
      "2026-09-16",
      "2026-09-15",
      "2026-09-10",
      "2026-09-02",
    ]);
    const sep2 = detail.days.find((d) => d.date === "2026-09-02")!;
    expect(sep2.sessions.map((s) => s.clockInLabel)).toEqual(["18:00", "09:00"]);
    expect(sep2.sessions[1].breakLabel).toBe("00:47");
    const sep17 = detail.days.find((d) => d.date === "2026-09-17")!;
    expect(sep17.sessions[0].correctionPending).toBe(true);
    expect(detail.transport).toEqual({
      status: "approved",
      itemCount: 1,
      linkedCount: 1,
      missingCount: 0,
      totalAmount: 1320,
    });
    expect(detail.stats.totalDays).toBe(8);
  });

  it("non-admin gets nothing", async () => {
    const { getAdminAttendancePayroll, getAdminStaffDetail } = await import("@/lib/admin-attendance");
    const staff = { ...adminSession, user: { id: A, preferredLanguage: "ko" } } as typeof adminSession;
    expect((await getAdminAttendancePayroll(staff, YM, "ko-KR")).isPrivileged).toBe(false);
    expect((await getAdminStaffDetail(staff, B, YM, "ko-KR")).isPrivileged).toBe(false);
  });
});

describe("admin attendance overview KPI = detail pages", () => {
  beforeEach(() => {
    seed();
  });

  it("matches the queue, corrections, payroll and transport pages", async () => {
    const {
      getAdminAttendanceOverview,
      getAdminAttendanceCorrections,
      getAdminAttendancePayroll,
      getAdminAttendanceTransport,
    } = await import("@/lib/admin-attendance");
    const { getAttendanceReviewQueue } = await import("@/lib/attendance-review");
    const overview = await getAdminAttendanceOverview(adminSession, "ko-KR", YM);

    // 예전 개요의 계산 그대로.
    const review = await getAttendanceReviewQueue(ORG, { limit: 5000, from: `${YM}-01`, to: `${YM}-30` }, "ko-KR");
    const reviewRows = review.filter(
      (r) =>
        r.reviewState === "review_required" &&
        !(r.correctionStatus === "requested" || r.correctionStatus === "in_review"),
    );
    const corrections = (await getAdminAttendanceCorrections(adminSession, "ko-KR")).items.filter(
      (r) => r.status === "requested" || r.status === "in_review",
    );
    const payroll = await getAdminAttendancePayroll(adminSession, YM, "ko-KR");
    const transport = await getAdminAttendanceTransport(adminSession, YM, "ko-KR");

    expect(overview.kpi).toEqual({
      reviewSessions: reviewRows.length,
      urgent: reviewRows.filter((r) => r.isAbnormal || !r.clockOutLabel).length,
      corrOpen: corrections.length,
      payEstimated: payroll.kpi.hourlyTarget,
      payTotal: payroll.kpi.expectedTotal,
      payExcluded: payroll.kpi.excludedTotal,
      trPending: transport.kpi.pendingReview,
      trTotal: transport.kpi.submittedTotal,
      trMissing: transport.kpi.missingEvidence,
    });
    expect(overview.reviewSample).toEqual(reviewRows.slice(0, 5));
    expect(overview.correctionSample).toEqual(corrections.slice(0, 5));
    expect(overview.kpi.corrOpen).toBe(4);
    expect(overview.kpi.trMissing).toBe(2);
  });
});
