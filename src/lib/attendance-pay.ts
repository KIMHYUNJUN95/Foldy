// Attendance — hourly EXPECTED-PAY calculation + self monthly pay view (Step 10).
//
// Gross PRINCIPAL only, expected (not finalized). Confirmed rules (decision-log 2026-06-17):
//   - hourly users only (salaried users get no pay here)
//   - only RESOLVED/usable sessions count: completed + (review_state normal|approved_correction) +
//     both clock ends + NO pending correction; excluded = open/reopened/invalid, review_required,
//     pending correction (requested|in_review)
//   - paid minutes in 1-minute units; recorded breaks excluded; NO auto break deduction
//   - NO overtime/holiday/night premiums
//   - effective-date rate: the rate active on a Tokyo operating date applies to that whole day; the
//     past is never recalculated with a newer rate
//   - final monthly gross rounds UP to the nearest 10 yen (ceiling; at the monthly layer only)
//
// Self-only: callers pass the authenticated user's id; no client-supplied target. The pure helpers are
// reusable by the later finalization/snapshot/export steps. No finalization/locking here.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveLocale, type Locale } from "@/lib/i18n";
import {
  breakSecondsBySession,
  calculateMonthlyPay,
  dailyGrossExact,
  paidSecondsForSession,
  resolveEffective,
  roundToNearest10,
  type BreakInterval,
  type PayExcludeReason,
  type SessionWindow,
} from "@/lib/attendance-pay-calculation";
import type {
  AttendanceSessionRow,
  AttendanceCorrectionStatus,
  EmploymentType,
} from "@/lib/attendance";

const TZ = "Asia/Tokyo";
// 문자열 리터럴이어야 타입 수준 파싱이 된다(배열 join 은 GenericStringError 로 떨어진다).
const PAY_SESSION_SELECT = "id, operating_date, clock_in_at, clock_out_at, status, review_state" as const;

// ── Pure calculation helpers (reusable for finalization) ─────────────────────────

export { dailyGrossExact, paidSecondsForSession, resolveEffective, roundToNearest10 };

// ── View types ───────────────────────────────────────────────────────────────

export type { PayExcludeReason };

export type PayDaySessionView = {
  sessionId: string;
  clockInLabel: string | null;
  clockOutLabel: string | null;
  breakTotalSec: number;
  paidMinutes: number; // 0 when excluded
  dailyGrossExact: number; // 0 when excluded
  included: boolean;
  excludeReason: PayExcludeReason;
};

// ── Attendance allowance (추가수당) ─────────────────────────────────────────────
// Busy-day / short-staffed-day extra pay applied to specific Tokyo operating dates WITHOUT changing the
// contractual base rate in `hourly_rate_history`. NOT a bonus/incentive.

export type AllowanceType = "daily_fixed" | "hourly_extra";
/** Payroll bucket the amount lands in: regular (추가수당) or special (특별수당). */
export type AllowanceCategory = "regular" | "special";

/** One attendance allowance applied to a specific day in the pay view (and preserved in the snapshot). */
export type AppliedAllowanceView = {
  allowanceId: string;
  date: string; // Tokyo YYYY-MM-DD
  type: AllowanceType;
  category: AllowanceCategory;
  memo: string | null;
  /** Configured amount: flat yen (daily_fixed) or extra yen-per-hour (hourly_extra). */
  amountYen: number;
  /** Paid minutes on the date (0 for daily_fixed display purposes; drives hourly_extra). */
  paidMinutes: number;
  /** Actual applied yen for this day (exact, unrounded). */
  calculatedAmount: number;
};

export type PayDayView = {
  date: string; // YYYY-MM-DD (Tokyo)
  dateLabel: string;
  employmentType: EmploymentType | null;
  hourlyRate: number | null;
  paidMinutes: number;
  grossExact: number; // base wage only (allowance excluded)
  allowanceExact: number; // day's applied allowance total, both buckets (unrounded)
  allowanceRegularExact: number; // 추가수당 bucket for the day (unrounded)
  allowanceSpecialExact: number; // 특별수당 bucket for the day (unrounded)
  allowances: AppliedAllowanceView[];
  sessions: PayDaySessionView[];
};

export type RateSegmentView = { rate: number; paidMinutes: number; gross: number };

/** Finalized snapshot reflected into the self pay view (Step 11). */
export type PayFinalizationView = {
  finalized: true;
  gross: number; // locked finalized gross (yen)
  paidMinutes: number;
  finalizedAtLabel: string | null;
};

export type MonthlyPayView = {
  ym: string; // YYYY-MM
  monthLabel: string;
  /** True when at least one day in the month is hourly-employed. */
  hourlyEligible: boolean;
  /** True when the user was salaried for the whole month (no hourly day) → no pay totals. */
  salariedOnly: boolean;
  totalPaidMinutes: number;
  /** Expected monthly gross = base wage + attendance allowance, rounded to the nearest 10 yen. */
  expectedGross: number;
  /** Base wage portion of `expectedGross` (= expectedGross − allowanceTotal), for export/breakdown. */
  baseGross: number;
  /** Applied attendance allowance total for the month, both buckets (yen, nearest-yen rounded). */
  allowanceTotal: number;
  /** 추가수당 bucket total for the month (yen, nearest-yen rounded). */
  allowanceRegularTotal: number;
  /** 특별수당 bucket total for the month (yen, nearest-yen rounded). */
  allowanceSpecialTotal: number;
  /** Every allowance applied across the month (for the payroll panel / self view / snapshot). */
  allowances: AppliedAllowanceView[];
  /** Count of hourly-day sessions excluded from pay (unresolved / pending / open / invalid). */
  excludedCount: number;
  /** 고용형태 · 시급이 없어 0원이 된 근무 수 — 마감을 막는다(`PayCalcMonth.unpricedCount`). */
  unpricedCount: number;
  rateSegments: RateSegmentView[];
  days: PayDayView[];
  /** Present when the user-month is finalized — the screen shows finalized (locked) pay (Step 11). */
  finalization: PayFinalizationView | null;
};

// ── Tokyo helpers ────────────────────────────────────────────────────────────

function localeTag(locale: Locale | string): string {
  const resolved = resolveLocale(locale);
  if (resolved === "ko") return "ko-KR";
  if (resolved === "ja") return "ja-JP";
  return "en-US";
}

function tokyoTimeLabel(iso: string | null, locale: Locale | string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function dayLabelOf(date: string, locale: Locale | string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

function monthLabelOf(ym: string, locale: Locale | string): string {
  const d = new Date(`${ym}-01T00:00:00+09:00`);
  return new Intl.DateTimeFormat(localeTag(locale), { timeZone: TZ, year: "numeric", month: "long" }).format(d);
}

/** Inclusive last day (YYYY-MM-DD) of a Tokyo YYYY-MM. */
function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
  return `${ym}-${String(last).padStart(2, "0")}`;
}

// ── Monthly self-pay view ────────────────────────────────────────────────────

type Service = ReturnType<typeof getSupabaseServiceClient>;

/** 세션별 급여 차감 휴게 초 — 근무 시간 안으로 자르고, 닫힌 세션의 열린 휴게는 퇴근까지(`breakSecondsBySession`). */
async function loadClosedBreakSeconds(
  service: Service,
  sessions: readonly SessionWindow[],
): Promise<Map<string, number>> {
  if (sessions.length === 0) return new Map();
  const res = await service
    .from("attendance_breaks")
    .select("session_id, started_at, ended_at")
    .in(
      "session_id",
      sessions.map((s) => s.id),
    );
  return breakSecondsBySession((res.data ?? []) as BreakInterval[], sessions);
}

async function loadCorrectionStatuses(
  service: Service,
  organizationId: string,
  userId: string,
  sessionIds: string[],
): Promise<Map<string, AttendanceCorrectionStatus>> {
  const map = new Map<string, AttendanceCorrectionStatus>();
  if (sessionIds.length === 0) return map;
  const res = await service
    .from("attendance_correction_requests")
    .select("session_id, status, created_at")
    .eq("organization_id", organizationId)
    .eq("requested_by_user_id", userId)
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });
  for (const r of (res.data ?? []) as {
    session_id: string | null;
    status: string;
    created_at: string;
  }[]) {
    if (r.session_id && !map.has(r.session_id)) {
      map.set(r.session_id, r.status as AttendanceCorrectionStatus);
    }
  }
  return map;
}

/**
 * The user's own monthly hourly expected-pay view for a Tokyo `ym` (YYYY-MM). Self-scoped. Salaried
 * months return `salariedOnly` with no pay totals. Reflects current usable attendance (completed
 * sessions, breaks, approved corrections, rate/employment history) — expected, not finalized.
 */
export async function getMonthlyPayView(
  organizationId: string,
  userId: string,
  ym: string,
  locale: Locale | string = "ko",
): Promise<MonthlyPayView> {
  const service = getSupabaseServiceClient();
  const firstDay = `${ym}-01`;
  const lastDay = lastDayOfMonth(ym);

  const [sessRes, rateRes, empRes, allowRes, finalizedRow] = await Promise.all([
    service
      .from("attendance_sessions")
      .select(PAY_SESSION_SELECT)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .gte("operating_date", firstDay)
      .lte("operating_date", lastDay)
      .order("operating_date", { ascending: true })
      .order("clock_in_at", { ascending: true }),
    service
      .from("hourly_rate_history")
      .select("hourly_rate, effective_from, effective_to")
      .eq("organization_id", organizationId)
      .eq("user_id", userId),
    service
      .from("employment_type_history")
      .select("employment_type, effective_from, effective_to")
      .eq("organization_id", organizationId)
      .eq("user_id", userId),
    // Active attendance allowances for the month. Org-wide (target_user_id IS NULL) + this user's own
    // targeted rows are kept; the user filter is applied in JS below to avoid PostgREST .or() string
    // interpolation. Cancelled rows are ignored.
    service
      .from("attendance_pay_allowances")
      .select("id, target_date, target_user_id, allowance_type, amount_yen, category, memo")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .gte("target_date", firstDay)
      .lte("target_date", lastDay),
    service
      .from("attendance_month_snapshots")
      .select("gross_amount, total_paid_minutes, finalized_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("target_month", `${ym}-01`)
      .eq("status", "finalized")
      .maybeSingle(),
  ]);

  const sessions = (sessRes.data ?? []) as AttendanceSessionRow[];
  const rateRows = (rateRes.data ?? []) as {
    hourly_rate: number;
    effective_from: string;
    effective_to: string | null;
  }[];
  const empRows = (empRes.data ?? []) as {
    employment_type: string;
    effective_from: string;
    effective_to: string | null;
  }[];
  const allowanceRows = (allowRes.data ?? []) as {
    id: string;
    target_date: string;
    target_user_id: string | null;
    allowance_type: string;
    amount_yen: number;
    category: string;
    memo: string | null;
  }[];
  const sessionIds = sessions.map((s) => s.id);
  const [breakSecs, correctionStatuses] = await Promise.all([
    loadClosedBreakSeconds(service, sessions),
    loadCorrectionStatuses(service, organizationId, userId, sessionIds),
  ]);

  // 계산 규칙은 `calculateMonthlyPay` 한 곳 — 관리자 급여(`computePayrollMonth`)도 같은 함수를 쓴다.
  const calc = calculateMonthlyPay({
    userId,
    firstDay,
    lastDay,
    sessions,
    rates: rateRows,
    employment: empRows,
    allowances: allowanceRows,
    breakSecondsBySession: breakSecs,
    correctionStatusOf: (sessionId) => correctionStatuses.get(sessionId) ?? null,
  });
  const days: PayDayView[] = calc.days.map((d) => ({
    date: d.date,
    dateLabel: dayLabelOf(d.date, locale),
    employmentType: d.employmentType as EmploymentType | null,
    hourlyRate: d.hourlyRate,
    paidMinutes: d.paidMinutes,
    grossExact: d.grossExact,
    allowanceExact: d.allowanceExact,
    allowanceRegularExact: d.allowanceRegularExact,
    allowanceSpecialExact: d.allowanceSpecialExact,
    allowances: d.allowances,
    sessions: d.sessions.map((r) => ({
      sessionId: r.session.id,
      clockInLabel: tokyoTimeLabel(r.session.clock_in_at, locale),
      clockOutLabel: tokyoTimeLabel(r.session.clock_out_at, locale),
      breakTotalSec: r.breakTotalSec,
      paidMinutes: r.paidMinutes,
      dailyGrossExact: r.grossExact,
      included: r.included,
      excludeReason: r.excludeReason,
    })),
  }));

  // Reflect a finalized snapshot (Step 11): when present, the screen shows the locked finalized pay.
  const snap = finalizedRow.data as {
    gross_amount: number;
    total_paid_minutes: number;
    finalized_at: string | null;
  } | null;

  return {
    ym,
    monthLabel: monthLabelOf(ym, locale),
    hourlyEligible: calc.hourlyEligible,
    salariedOnly: calc.salariedOnly,
    totalPaidMinutes: calc.totalPaidMinutes,
    expectedGross: calc.expectedGross,
    allowanceRegularTotal: calc.allowanceRegularTotal,
    allowanceSpecialTotal: calc.allowanceSpecialTotal,
    allowanceTotal: calc.allowanceTotal,
    baseGross: calc.baseGross,
    allowances: calc.allowances,
    excludedCount: calc.excludedCount,
    unpricedCount: calc.unpricedCount,
    rateSegments: calc.rateSegments,
    days,
    finalization: snap
      ? {
          finalized: true,
          gross: snap.gross_amount,
          paidMinutes: snap.total_paid_minutes,
          finalizedAtLabel: snap.finalized_at
            ? new Intl.DateTimeFormat(localeTag(locale), {
                timeZone: TZ,
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(snap.finalized_at))
            : null,
        }
      : null,
  };
}
