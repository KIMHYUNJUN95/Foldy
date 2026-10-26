// Annual-leave accrual calculation, based on hire date.
// Policy confirmed 2026-07-06 (see docs/product/26-annual-leave-workflow.md):
//   - first grant 10d at 6 months, then 11d/12d at each of the next two
//     anniversaries of that grant, then +2d per year, capped at 20d — this is the
//     "유급 휴가"(paid leave) pool, used by the "paid" leave-request type
//   - a separate one-time +4d bonus at the 4-year mark (outside the 20d cap) — this
//     bucket is its own pool, spent only via the "특별휴가"(special) leave-request
//     type, never mixed with the paid-leave pool
//   - unused leave lapses 2 years after its grant date (confirmed up to 2 years;
//     policy beyond 2 years is still pending company confirmation)
//   - bereavement leave ("경조휴가", the "annual" request type) and unpaid leave
//     ("기타") are NOT part of this hire-date accrual at all — see leave-form.tsx
//
// This module is pure (no Supabase/session imports) so it can run on both server and client.
// `hire_date` lives on `profiles`; the self-entered starting balance lives in
// `annual_leave_baselines` (migration 202607060001) — see src/lib/annual-leave-server.ts for the
// DB read/write side and src/app/mobile/attendance/leave/actions.ts for the self-service action.

const BASE_SCHEDULE_MONTHS = [6, 18, 30, 42, 54, 66, 78];
const BASE_SCHEDULE_AMOUNTS = [10, 11, 12, 14, 16, 18, 20];
const BASE_SCHEDULE_STEP_MONTHS = 12;
const BASE_SCHEDULE_CAP = 20;

const BONUS_AT_MONTHS = 48;
const BONUS_AMOUNT = 4;

export const LEAVE_EXPIRY_YEARS = 2;

export type LeaveGrantEvent = {
  kind: "base" | "bonus";
  date: string; // ISO date (YYYY-MM-DD)
  amount: number;
};

export type LeaveBucketKind = "baseline" | "base" | "bonus";

export type LeaveBucket = {
  id: string;
  kind: LeaveBucketKind;
  grantedOn: string;
  amount: number;
  expiresOn: string | null; // null = engine does not manage this bucket's expiry (baseline)
};

export type LeaveBucketState = LeaveBucket & { remaining: number; expired: boolean };

export type AnnualLeaveSummary = {
  /** "유급 휴가" pool remaining — baseline + base-schedule grants only. */
  baseRemaining: number;
  /** "특별휴가" pool remaining — the one-time 4-year bonus, spent separately. */
  bonusRemaining: number;
  /** baseRemaining + bonusRemaining, for callers that just want a single total. */
  remaining: number;
  buckets: LeaveBucketState[];
  /** Earliest upcoming grant across both pools, for a generic "next grant" display. */
  nextGrant: LeaveGrantEvent | null;
  /** Earliest upcoming "유급 휴가" (base-schedule) grant only. */
  nextBaseGrant: LeaveGrantEvent | null;
  /** The 4-year bonus grant, only while it's still upcoming (null once it has landed). */
  nextBonusGrant: LeaveGrantEvent | null;
};

function addMonthsUTC(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

function addYearsUTC(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** All automatic base + bonus grant events from hire date up to just past `asOf`. */
export function getScheduledGrants(hireDate: string, asOf: string): LeaveGrantEvent[] {
  const events: LeaveGrantEvent[] = BASE_SCHEDULE_MONTHS.map((months, i) => ({
    kind: "base" as const,
    date: addMonthsUTC(hireDate, months),
    amount: BASE_SCHEDULE_AMOUNTS[i],
  }));

  let months = BASE_SCHEDULE_MONTHS[BASE_SCHEDULE_MONTHS.length - 1] + BASE_SCHEDULE_STEP_MONTHS;
  for (let guard = 0; guard < 200; guard += 1) {
    const date = addMonthsUTC(hireDate, months);
    events.push({ kind: "base", date, amount: BASE_SCHEDULE_CAP });
    if (compareISO(date, asOf) > 0) break;
    months += BASE_SCHEDULE_STEP_MONTHS;
  }

  events.push({ kind: "bonus", date: addMonthsUTC(hireDate, BONUS_AT_MONTHS), amount: BONUS_AMOUNT });

  return events.sort((a, b) => compareISO(a.date, b.date));
}

/**
 * Baseline bucket (the employee-entered current balance) plus every automatic
 * grant that lands *after* the baseline was recorded — grants on or before that
 * date are assumed to already be reflected in the baseline number.
 */
export function buildLeaveBuckets(params: {
  hireDate: string;
  baselineDate: string;
  baselineAmount: number;
  bonusBaselineAmount?: number;
  asOf: string;
}): LeaveBucket[] {
  const { hireDate, baselineDate, baselineAmount, bonusBaselineAmount = 0, asOf } = params;
  const buckets: LeaveBucket[] = [
    { id: "baseline", kind: "baseline", grantedOn: baselineDate, amount: baselineAmount, expiresOn: null },
  ];
  if (bonusBaselineAmount > 0) {
    // a pre-existing 특별휴가 balance the employee already had — opaque to the engine (no known grant
    // date to expire it against), same reasoning as the base baseline bucket above.
    buckets.push({ id: "baseline-bonus", kind: "bonus", grantedOn: baselineDate, amount: bonusBaselineAmount, expiresOn: null });
  }

  getScheduledGrants(hireDate, asOf)
    .filter((g) => compareISO(g.date, baselineDate) > 0 && compareISO(g.date, asOf) <= 0)
    .forEach((g, i) => {
      buckets.push({
        id: `${g.kind}-${i}-${g.date}`,
        kind: g.kind,
        grantedOn: g.date,
        amount: g.amount,
        expiresOn: addYearsUTC(g.date, LEAVE_EXPIRY_YEARS),
      });
    });

  return buckets.sort((a, b) => compareISO(a.grantedOn, b.grantedOn));
}

/**
 * Applies used days FIFO (oldest bucket first) within each pool, then lapses
 * whatever is left past expiry. `usedDays` only draws from the baseline/base
 * ("유급 휴가") pool; `specialUsedDays` only draws from the bonus ("특별휴가")
 * pool — the two pools are never mixed.
 */
export function computeAnnualLeaveSummary(params: {
  hireDate: string;
  baselineDate: string;
  baselineAmount: number;
  bonusBaselineAmount?: number;
  usedDays?: number;
  specialUsedDays?: number;
  asOf: string;
}): AnnualLeaveSummary {
  const { hireDate, baselineDate, baselineAmount, bonusBaselineAmount = 0, usedDays = 0, specialUsedDays = 0, asOf } =
    params;
  const buckets = buildLeaveBuckets({ hireDate, baselineDate, baselineAmount, bonusBaselineAmount, asOf });

  function applyUsage(pool: LeaveBucket[], usage: number): LeaveBucketState[] {
    let unassignedUsage = usage;
    return pool.map((b) => {
      const consumed = Math.min(b.amount, Math.max(0, unassignedUsage));
      unassignedUsage -= consumed;
      const expired = b.expiresOn !== null && compareISO(b.expiresOn, asOf) < 0;
      return { ...b, remaining: expired ? 0 : b.amount - consumed, expired };
    });
  }

  const basePool = buckets.filter((b) => b.kind !== "bonus");
  const bonusPool = buckets.filter((b) => b.kind === "bonus");
  const stated = [...applyUsage(basePool, usedDays), ...applyUsage(bonusPool, specialUsedDays)].sort((a, b) =>
    compareISO(a.grantedOn, b.grantedOn),
  );

  const baseRemaining = stated.filter((b) => b.kind !== "bonus").reduce((sum, b) => sum + b.remaining, 0);
  const bonusRemaining = stated.filter((b) => b.kind === "bonus").reduce((sum, b) => sum + b.remaining, 0);
  const upcoming = getScheduledGrants(hireDate, asOf)
    .filter((g) => compareISO(g.date, asOf) > 0)
    .sort((a, b) => compareISO(a.date, b.date));
  const nextGrant = upcoming[0] ?? null;
  const nextBaseGrant = upcoming.find((g) => g.kind === "base") ?? null;
  const nextBonusGrant = upcoming.find((g) => g.kind === "bonus") ?? null;

  return {
    baseRemaining,
    bonusRemaining,
    remaining: baseRemaining + bonusRemaining,
    buckets: stated,
    nextGrant,
    nextBaseGrant,
    nextBonusGrant,
  };
}

/**
 * Tokyo 오늘 — 정본은 순수 모듈 `@/lib/tokyo-date` 다. 연차 모듈이 이 이름으로 8곳에 퍼져 있어
 * 호출부를 건드리지 않으려고 여기서 재수출한다(투두 `@/lib/tasks` 와 같은 처리, 2026-09-08).
 */
export { tokyoToday } from "@/lib/tokyo-date";

// ── 신청 일수 정규화 (2026-10-01) ─────────────────────────────────────────────
// 일수는 **서버가 날짜·유형에서 다시 계산한다.** 예전에는 직원 신청이 화면이 보낸 `daysCount` 를 그대로
// 저장해서, 10일짜리 기간을 0.5일로 내도 그대로 들어갔다(관리자 대리 신청만 서버에서 계산했다).
// 두 경로가 이 함수 하나를 쓴다.

/** 경조휴가(`annual` 유형) — 회사 부여 고정 일수. */
export const LEAVE_BEREAVEMENT_DAYS = 3;

const LEAVE_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function leaveAddDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function leaveRangeDaysInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
}

/**
 * 신청 기간·단위·일수를 규칙대로 맞춘다. 틀린 날짜면 null.
 *  - 경조(`annual`): 시작일부터 고정 3일, 종일
 *  - 반차(`am`/`pm`): 시작일 하루, 0.5일
 *  - 종일: 양끝 포함 일수
 */
export function normalizeLeaveDays(input: {
  leaveType: "annual" | "paid" | "special" | "other";
  startDate: string;
  endDate: string;
  durationUnit: "full" | "am" | "pm";
}): { startDate: string; endDate: string; durationUnit: "full" | "am" | "pm"; daysCount: number } | null {
  const { leaveType, startDate } = input;
  if (!LEAVE_ISO_DATE.test(startDate)) return null;

  if (leaveType === "annual") {
    return {
      startDate,
      endDate: leaveAddDaysISO(startDate, LEAVE_BEREAVEMENT_DAYS - 1),
      durationUnit: "full",
      daysCount: LEAVE_BEREAVEMENT_DAYS,
    };
  }

  if (input.durationUnit === "am" || input.durationUnit === "pm") {
    return { startDate, endDate: startDate, durationUnit: input.durationUnit, daysCount: 0.5 };
  }

  const { endDate } = input;
  if (!LEAVE_ISO_DATE.test(endDate)) return null;
  const rangeDays = leaveRangeDaysInclusive(startDate, endDate);
  if (rangeDays < 1) return null;
  return { startDate, endDate, durationUnit: "full", daysCount: rangeDays };
}

// ── 같은 사람 휴가 겹침 (2026-10-26) ──────────────────────────────────────────
// 같은 사람의 승인된 휴가가 날짜가 겹치면 잔여가 두 번 빠진다. 승인 직전에 이 규칙으로 막는다.
// 반차는 하루짜리라 오전 · 오후가 서로 다르면 겹치지 않는다(같은 날 오전 + 오후 = 하루).

export type LeaveSpan = { startDate: string; endDate: string; durationUnit: "full" | "am" | "pm" };

export function leaveSpansOverlap(a: LeaveSpan, b: LeaveSpan): boolean {
  if (a.startDate > b.endDate || b.startDate > a.endDate) return false;
  const aHalf = a.durationUnit === "am" || a.durationUnit === "pm";
  const bHalf = b.durationUnit === "am" || b.durationUnit === "pm";
  if (aHalf && bHalf && a.durationUnit !== b.durationUnit) return false;
  return true;
}

// ── 이력(ledger) 거르기 (2026-10-26) ──────────────────────────────────────────
// 화면과 내보내기가 같은 규칙을 쓴다. 내보내기는 화면이 보낸 줄을 믿지 않고, 이 조건만 받아 서버에서 다시 읽은
// 이력을 거른다(`exportLeaveLedger*`). 처리 시각(`processedAt`)은 도쿄 "YYYY/MM/DD HH:mm".

export type LeaveLedgerFilter = {
  status: "requested" | "approved" | "rejected" | "cancelled" | null;
  query: string;
  /** 도쿄 YYYY-MM-DD, 양끝 포함. */
  from: string;
  to: string;
};

export type LeaveLedgerFilterable = {
  status: string;
  processedAt: string;
  applicantName: string;
  reason: string;
  documentNumber: string | null;
  processorName: string | null;
};

export function leaveLedgerProcessedKey(entry: { processedAt: string }): string {
  return entry.processedAt.slice(0, 10).replace(/\//g, "-");
}

export function filterLeaveLedger<T extends LeaveLedgerFilterable>(entries: readonly T[], f: LeaveLedgerFilter): T[] {
  const q = f.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.status && e.status !== f.status) return false;
    const key = leaveLedgerProcessedKey(e);
    if (key && (key < f.from || key > f.to)) return false;
    if (q) {
      const hay = `${e.applicantName} ${e.reason} ${e.documentNumber ?? ""} ${e.processorName ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
