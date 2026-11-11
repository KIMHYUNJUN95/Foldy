import { beforeEach, describe, expect, it, vi } from "vitest";

// 관리자 근태 액션(2026-11-11) — 미래 날짜 수기 입력 거절(M5) · 직접 수정의 검토 상태 제한(M3) · 마감 경합(M1) ·
// 무효 · 복구가 잠금 안 DB 함수로 쓰는지.

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const failing = new Set<string>();

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: ((row: Row) => boolean)[] = [];
  private from = 0;
  private to: number | null = null;
  private isSingle = false;
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
    this.isSingle = true;
    return this;
  }
  insert(values?: unknown) {
    writes.push({ table: this.table, op: "insert", values });
    this.writeError = writeErrors.get(this.table) ?? null;
    return this;
  }
  update(values?: unknown) {
    writes.push({ table: this.table, op: "update", values });
    this.writeError = writeErrors.get(this.table) ?? null;
    return this;
  }
  single() {
    this.isSingle = true;
    return this;
  }
  private writeError: { message: string } | null = null;
  private run() {
    if (this.writeError) return { data: null, error: this.writeError };
    if (failing.has(this.table)) return { data: null, error: { message: `${this.table} read failed` } };
    let rows = (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    rows = rows.slice(this.from, this.to == null ? undefined : this.to + 1);
    if (this.isSingle) return { data: rows[0] ?? null, error: null };
    return { data: rows.map((r) => ({ ...r })), error: null };
  }
  then<T1, T2>(
    ok?: (v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>,
    bad?: (e: unknown) => T2 | PromiseLike<T2>,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const writes: { table: string; op: string; values: unknown }[] = [];
const writeErrors = new Map<string, { message: string }>();
const rpcReplies: Record<string, { data: unknown; error: unknown }> = {};
const fakeClient = {
  from: (t: string) => new FakeQuery(t),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return rpcReplies[fn] ?? { data: null, error: { message: "no reply" } };
  },
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ user: { id: "u-admin", role: "owner" }, organization: { id: "org-1" } }),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/attendance-review", () => ({ attendanceCan: async () => true }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: async () => undefined }));
vi.mock("@/lib/db-write-guard", () => ({ bestEffortWrite: async () => undefined }));

import {
  createManualAttendanceSession,
  finalizeAttendanceMonth,
  invalidateAttendanceSession,
  reopenAttendanceMonth,
  approveCorrectionRequest,
  createAttendanceAllowance,
  updateAttendanceSessionAdmin,
} from "@/app/admin/attendance/actions";
import { tokyoToday } from "@/lib/tokyo-date";
import { isPayrollMonthLocked } from "@/lib/payroll-approval-server";

const ORG = "org-1";
const A = "u-a";
const SESSION = {
  id: "s1",
  organization_id: ORG,
  user_id: A,
  operating_date: "2026-09-02",
  clock_in_at: "2026-09-02T00:00:00.000Z",
  clock_out_at: "2026-09-02T09:00:00.000Z",
  clock_in_site_id: null,
  clock_out_site_id: null,
  status: "completed",
  review_state: "review_required",
  updated_at: "2026-09-02T09:00:00.000000+00:00",
  manual_created: false,
};

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(rpcReplies)) delete rpcReplies[k];
  failing.clear();
  rpcCalls.length = 0;
  writes.length = 0;
  writeErrors.clear();
  tables.memberships = [{ organization_id: ORG, user_id: A, status: "active", id: "m1" }];
  tables.attendance_sessions = [{ ...SESSION }];
  tables.attendance_month_snapshots = [];
  tables.attendance_correction_requests = [];
  tables.attendance_breaks = [];
  tables.attendance_pay_allowances = [];
  tables.hourly_rate_history = [{ organization_id: ORG, user_id: A, hourly_rate: 1200, effective_from: "2026-01-01", effective_to: null }];
  tables.employment_type_history = [{ organization_id: ORG, user_id: A, employment_type: "hourly", effective_from: "2026-01-01", effective_to: null }];
  tables.attendance_sites = [];
});

describe("수기 입력 — 오늘 이후 날짜는 거절 (M5)", () => {
  it("내일 날짜는 future_date, 쓰기 없음", async () => {
    const t = new Date(`${tokyoToday()}T12:00:00+09:00`);
    t.setUTCDate(t.getUTCDate() + 1);
    const tomorrow = t.toISOString().slice(0, 10);
    const res = await createManualAttendanceSession({
      userId: A,
      operatingDate: tomorrow,
      clockInTime: "09:00",
      clockOutTime: "18:00",
      manualLocation: "사무실",
      reason: "테스트",
    });
    expect(res).toEqual({ ok: false, reason: "future_date" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("16시간 넘는 근무는 too_long", async () => {
    const res = await createManualAttendanceSession({
      userId: A,
      operatingDate: "2026-09-03",
      clockInTime: "06:00",
      clockOutTime: "22:30",
      manualLocation: "사무실",
      reason: "테스트",
    });
    expect(res).toEqual({ ok: false, reason: "too_long" });
  });

  it("넣기는 잠금 안 DB 함수로 — 겹침이면 overlap", async () => {
    rpcReplies.attendance_insert_session_checked = { data: { result: "overlap" }, error: null };
    const res = await createManualAttendanceSession({
      userId: A,
      operatingDate: "2026-09-02",
      clockInTime: "10:00",
      clockOutTime: "12:00",
      manualLocation: "사무실",
      reason: "테스트",
    });
    expect(res).toEqual({ ok: false, reason: "overlap" });
    expect(rpcCalls[0]?.fn).toBe("attendance_insert_session_checked");
  });
});

describe("직접 수정 — 검토 상태는 normal · review_required 만 (M3)", () => {
  it("approved_correction 은 거절", async () => {
    const res = await updateAttendanceSessionAdmin({ sessionId: "s1", reason: "x", reviewState: "approved_correction" });
    expect(res).toEqual({ ok: false, reason: "invalid" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("normal 은 DB 함수로, 읽은 updated_at 을 넘긴다", async () => {
    rpcReplies.attendance_update_session_checked = { data: { result: "ok", updated_at: "2026-09-03T00:00:00+00:00" }, error: null };
    const res = await updateAttendanceSessionAdmin({ sessionId: "s1", reason: "x", reviewState: "normal" });
    expect(res).toMatchObject({ ok: true, updatedAt: "2026-09-03T00:00:00+00:00" });
    expect(rpcCalls[0]?.args).toMatchObject({ p_session_id: "s1", p_expected_updated_at: SESSION.updated_at });
  });
});

describe("무효 처리 — 읽은 행 그대로일 때만 (M1)", () => {
  it("그 사이 바뀌었으면 stale", async () => {
    rpcReplies.attendance_update_session_checked = { data: { result: "stale" }, error: null };
    await expect(invalidateAttendanceSession("s1", "중복")).resolves.toEqual({ ok: false, reason: "stale" });
    expect(rpcCalls[0]?.args).toMatchObject({ p_expected_updated_at: SESSION.updated_at, p_changes: { status: "invalid" } });
  });
});

describe("마감 — 지문 비교 (M1) · 읽기 실패 (H5)", () => {
  beforeEach(() => {
    tables.attendance_sessions = [{ ...SESSION, review_state: "normal" }];
    rpcReplies.attendance_month_fingerprint = { data: "fp-1", error: null };
  });

  it("계산 사이 기록이 바뀌면 stale", async () => {
    rpcReplies.finalize_attendance_month_checked = { data: { result: "stale" }, error: null };
    await expect(finalizeAttendanceMonth({ userId: A, ym: "2026-09" })).resolves.toEqual({ ok: false, reason: "stale" });
    const call = rpcCalls.find((c) => c.fn === "finalize_attendance_month_checked");
    expect(call?.args).toMatchObject({ p_expected_fingerprint: "fp-1", p_total_paid_minutes: 540, p_gross_amount: 10800 });
  });

  it("지문이 같으면 ok", async () => {
    rpcReplies.finalize_attendance_month_checked = { data: { result: "ok", id: "snap-1" }, error: null };
    await expect(finalizeAttendanceMonth({ userId: A, ym: "2026-09" })).resolves.toEqual({ ok: true, id: "snap-1" });
  });

  it("휴게 읽기 실패면 저장하지 않고 error", async () => {
    failing.add("attendance_breaks");
    await expect(finalizeAttendanceMonth({ userId: A, ym: "2026-09" })).resolves.toEqual({ ok: false, reason: "error" });
    expect(rpcCalls.some((c) => c.fn === "finalize_attendance_month_checked")).toBe(false);
  });

  it("「반려된 정정」 상태 근무는 마감을 막는다", async () => {
    tables.attendance_sessions = [{ ...SESSION, review_state: "rejected_correction" }];
    const res = await finalizeAttendanceMonth({ userId: A, ym: "2026-09" });
    expect(res).toMatchObject({ ok: false, reason: "blocked", blockers: { reviewRequired: 1 } });
    // 「검토 필요」 탭에 안 보이는 근무라 어느 날 · 왜 막는지 같이 돌려준다.
    expect(res.ok ? null : res.blockers?.sessions).toEqual([
      { sessionId: "s1", userId: A, date: "2026-09-02", reason: "rejected_correction" },
    ]);
  });
});

describe("급여 결재 잠금 읽기 실패는 잠금으로 본다 (fail-closed)", () => {
  it("isPayrollMonthLocked — 읽기 실패면 던진다", async () => {
    failing.add("payroll_month_approvals");
    await expect(isPayrollMonthLocked(fakeClient as never, ORG, "2026-09")).rejects.toThrow(/payroll_month_approvals/);
  });

  it("isPayrollMonthLocked — 행이 없으면 잠기지 않음, 요청 뒤면 잠김", async () => {
    tables.payroll_month_approvals = [];
    await expect(isPayrollMonthLocked(fakeClient as never, ORG, "2026-09")).resolves.toBe(false);
    tables.payroll_month_approvals = [{ organization_id: ORG, target_month: "2026-09-01", status: "approval_senmu" }];
    await expect(isPayrollMonthLocked(fakeClient as never, ORG, "2026-09")).resolves.toBe(true);
  });

  it("마감 풀기 — 결재 행 읽기 실패면 error, 스냅샷을 건드리지 않는다", async () => {
    failing.add("payroll_month_approvals");
    await expect(reopenAttendanceMonth({ userId: A, ym: "2026-09", reason: "x" })).resolves.toEqual({ ok: false, reason: "error" });
  });
});

describe("관리자 교통비 — 읽기 실패를 빈 목록으로 숨기지 않는다 (H5)", () => {
  const session = { user: { id: "u-admin" }, organization: { id: ORG } } as never;

  it("평소엔 loadError 없음", async () => {
    tables.transport_reimbursement_reports = [];
    tables.profiles = [{ id: A, name: "가나" }];
    const { getAdminAttendanceTransport } = await import("@/lib/admin-attendance");
    const res = await getAdminAttendanceTransport(session, "2026-09", "ko-KR");
    expect(res.loadError).toBe(false);
    expect(res.rows.map((r) => r.userId)).toEqual([A]);
  });

  it("신청서 읽기 실패면 loadError, 「미제출」 줄을 만들지 않는다", async () => {
    failing.add("transport_reimbursement_reports");
    const { getAdminAttendanceTransport } = await import("@/lib/admin-attendance");
    const res = await getAdminAttendanceTransport(session, "2026-09", "ko-KR");
    expect(res.loadError).toBe(true);
    expect(res.rows).toEqual([]);
  });

  it("구성원 읽기 실패도 loadError", async () => {
    tables.transport_reimbursement_reports = [];
    failing.add("memberships");
    const { getAdminAttendanceTransport } = await import("@/lib/admin-attendance");
    const res = await getAdminAttendanceTransport(session, "2026-09", "ko-KR");
    expect(res.loadError).toBe(true);
  });
});

describe("정정 승인 — 요청 상태와 근무 반영을 한 DB 함수에서 (리뷰 6)", () => {
  beforeEach(() => {
    tables.attendance_sessions = [{ ...SESSION, review_state: "pending_correction" }];
    tables.attendance_correction_requests = [
      {
        id: "r1",
        organization_id: ORG,
        session_id: "s1",
        requested_by_user_id: A,
        status: "in_review",
        reviewed_by_user_id: "u-admin",
        desired_clock_in_at: null,
        desired_clock_out_at: "2026-09-02T08:00:00.000Z",
        desired_clock_in_site_id: null,
        desired_clock_out_site_id: null,
      },
    ];
    tables.profiles = [{ id: A, name: "가나" }];
  });

  it("요청을 따로 approved 로 바꾸지 않고, 근무 함수에 승인 정보를 같이 넘긴다", async () => {
    rpcReplies.attendance_update_session_checked = { data: { result: "ok", updated_at: "2026-09-03T00:00:00+00:00" }, error: null };
    await expect(approveCorrectionRequest({ requestId: "r1", comment: "확인" })).resolves.toEqual({ ok: true });
    expect(writes.filter((w) => w.table === "attendance_correction_requests")).toEqual([]);
    expect(rpcCalls[0]?.args.p_approve_request).toMatchObject({ id: "r1", actor_user_id: "u-admin", comment: "확인" });
  });

  it("그 사이 요청이 바뀌었으면 invalid, 되돌리기 쓰기도 없다", async () => {
    rpcReplies.attendance_update_session_checked = { data: { result: "request_changed" }, error: null };
    await expect(approveCorrectionRequest({ requestId: "r1" })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(writes.filter((w) => w.table === "attendance_correction_requests")).toEqual([]);
  });
});

describe("수당 — 잠금 안 마감 확인(트리거) 결과를 finalized 로 (리뷰 7)", () => {
  it("트리거가 마감으로 거절하면 finalized", async () => {
    writeErrors.set("attendance_pay_allowances", { message: "attendance_month_finalized" });
    const res = await createAttendanceAllowance({
      targetDate: "2026-09-05",
      targetUserId: A,
      allowanceType: "daily_fixed",
      amountYen: 1000,
      category: "regular",
    });
    expect(res).toEqual({ ok: false, reason: "finalized" });
  });
});
