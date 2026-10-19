/** Effective-date row resolution: the row whose [effective_from, effective_to] covers `date`, latest. */
export function resolveEffective<T extends { effective_from: string; effective_to: string | null }>(
  rows: readonly T[],
  date: string,
): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.effective_from <= date && (r.effective_to == null || r.effective_to >= date)) {
      if (!best || r.effective_from > best.effective_from) best = r;
    }
  }
  return best;
}

export type BreakInterval = { session_id: string; started_at: string; ended_at: string | null };
export type SessionWindow = { id: string; clock_in_at: string | null; clock_out_at: string | null };

/**
 * 세션별 휴게 초 — **급여에서 빼는 휴게는 근무 시간 안의 것만** (2026-10-05).
 *
 * - 휴게를 세션의 [출근, 퇴근] 안으로 자른다. 관리자가 출퇴근 시각을 옮겨 휴게가 근무 밖으로 나가면 그 부분은 빼지 않는다
 *   (전에는 근무 밖 휴게도 그대로 차감했다).
 * - **닫힌 세션에 열린 휴게**가 남아 있으면 퇴근 시각에 끝난 것으로 본다. 모바일은 휴게 중 퇴근을 막지만 관리자 수정 ·
 *   정정 승인으로 닫으면 휴게가 열린 채 남는다 — 전에는 이 휴게를 아예 빼지 않아 과지급이 됐다. 휴게 종료도 퇴근도
 *   찍지 않고 떠난 경우라 그 뒤는 일하지 않은 시간으로 본다.
 * - 아직 열린 세션의 열린 휴게는 세지 않는다(끝나지 않았다).
 */
export function breakSecondsBySession(
  breaks: readonly BreakInterval[],
  sessions: readonly SessionWindow[],
): Map<string, number> {
  const windows = new Map(sessions.map((s) => [s.id, s]));
  const totals = new Map<string, number>();
  for (const b of breaks) {
    const session = windows.get(b.session_id);
    if (!session) continue;
    const endIso = b.ended_at ?? session.clock_out_at;
    if (!endIso) continue;
    let start = new Date(b.started_at).getTime();
    let end = new Date(endIso).getTime();
    if (session.clock_in_at) start = Math.max(start, new Date(session.clock_in_at).getTime());
    if (session.clock_out_at) end = Math.min(end, new Date(session.clock_out_at).getTime());
    const secs = Math.floor((end - start) / 1000);
    if (secs > 0) totals.set(b.session_id, (totals.get(b.session_id) ?? 0) + secs);
  }
  return totals;
}

/** Paid seconds for one resolved session = worked - closed breaks (never negative). */
export function paidSecondsForSession(
  clockInAt: string,
  clockOutAt: string,
  closedBreakSec: number,
): number {
  const gross = (new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 1000;
  return Math.max(0, Math.floor(gross) - closedBreakSec);
}

/**
 * 엔 금액을 소수점 아래 6자리에서 맞춘다 — 분 단위 금액(시급 × 분 ÷ 60)을 부동소수로 더하면 100 이
 * 100.00000000000001 이 되고, 그대로 10엔 올림하면 110 이 된다(2026-10-19 재현: 시급 1,000엔 · 1분 × 6일).
 * 실제 금액은 1/60엔 단위(소수 둘째 자리 시급이어도 1/6000엔)라 6자리에서 맞춰도 값이 바뀌지 않는다.
 */
export function settleYen(yen: number): number {
  return Math.round(yen * 1e6) / 1e6;
}

/** Round a yen amount up to the nearest 10-yen ceiling. e.g. 93 -> 100, 100 -> 100. Float noise is settled first. */
export function roundToNearest10(yen: number): number {
  return Math.ceil(settleYen(yen) / 10) * 10;
}

/** Daily gross (exact yen, unrounded) for paid minutes at a rate. 1-minute units. */
export function dailyGrossExact(paidMinutes: number, hourlyRate: number): number {
  return (hourlyRate * paidMinutes) / 60;
}

/**
 * Exact (unrounded) applied yen for one attendance allowance on a date that has recognized paid work.
 *   daily_fixed  → the flat amount once for the day (paid minutes irrelevant beyond "has paid work")
 *   hourly_extra → amount is an extra yen-per-hour, multiplied by the date's recognized paid minutes
 * Never rounds; the monthly gross layer applies the single 10-yen ceiling.
 */
export function allowanceCalculatedExact(
  type: "daily_fixed" | "hourly_extra",
  amountYen: number,
  paidMinutes: number,
): number {
  return type === "hourly_extra" ? (amountYen * paidMinutes) / 60 : amountYen;
}

export function reconcileDailyPaysToTotal<T extends { workMinutes: number; dailyPay: number }>(
  rows: T[],
  targetPayrollTotal: number,
): T[] {
  const displayedTotal = rows.reduce((sum, row) => sum + row.dailyPay, 0);
  const delta = targetPayrollTotal - displayedTotal;
  if (delta === 0) return rows;

  const lastPaidIndex = rows.findLastIndex((row) => row.workMinutes > 0);
  if (lastPaidIndex < 0) return rows;

  return rows.map((row, index) =>
    index === lastPaidIndex ? { ...row, dailyPay: row.dailyPay + delta } : row,
  );
}

// ── 한 사람의 한 달 급여 — 자기 급여 화면(`getMonthlyPayView`)과 관리자 급여(`computePayrollMonth`)가 같이 쓴다 ──
// DB 를 읽지 않는 순수 계산이다. 두 화면은 이 결과에 라벨 · 마감 정보만 덧붙인다(2026-10-19).

/** null 이면 급여에 넣는다. */
export type PayExcludeReason =
  | "open"
  /** 퇴근을 찍지 않은 채 운영일이 넘어간 세션(2026-08-04). 급여에서 빠지고 월 마감을 막는다. */
  | "abandoned"
  | "invalid"
  | "review_required"
  | "pending_correction"
  | null;

export type PayCalcSession = {
  id: string;
  operating_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: string;
  review_state: string;
};

type EffectiveRow = { effective_from: string; effective_to: string | null };
export type PayCalcRate = EffectiveRow & { hourly_rate: number };
export type PayCalcEmployment = EffectiveRow & { employment_type: string };
export type PayCalcAllowance = {
  id: string;
  target_date: string;
  target_user_id: string | null;
  allowance_type: string;
  amount_yen: number;
  category: string;
  memo: string | null;
};

export type PayCalcAllowanceResult = {
  allowanceId: string;
  date: string;
  type: "daily_fixed" | "hourly_extra";
  category: "regular" | "special";
  memo: string | null;
  amountYen: number;
  paidMinutes: number;
  /** Exact (unrounded) yen applied for the day. */
  calculatedAmount: number;
};

export type PayCalcSessionResult<S extends PayCalcSession> = {
  session: S;
  breakTotalSec: number;
  paidMinutes: number;
  grossExact: number;
  included: boolean;
  excludeReason: PayExcludeReason;
};

export type PayCalcDay<S extends PayCalcSession> = {
  date: string;
  employmentType: string | null;
  hourlyRate: number | null;
  paidMinutes: number;
  grossExact: number;
  allowanceExact: number;
  allowanceRegularExact: number;
  allowanceSpecialExact: number;
  allowances: PayCalcAllowanceResult[];
  sessions: PayCalcSessionResult<S>[];
};

export type PayCalcMonth<S extends PayCalcSession> = {
  hourlyEligible: boolean;
  salariedOnly: boolean;
  totalPaidMinutes: number;
  expectedGross: number;
  baseGross: number;
  allowanceTotal: number;
  allowanceRegularTotal: number;
  allowanceSpecialTotal: number;
  /** 세션 있는 날(날짜 ↑) → 출근 없는 날 순서 — 마감 스냅샷 `allowance_breakdown` 이 이 순서다. */
  allowances: PayCalcAllowanceResult[];
  excludedCount: number;
  rateSegments: { rate: number; paidMinutes: number; gross: number }[];
  /** 날짜 ↑. 세션 있는 날 + 출근 없는 날의 정액 수당. */
  days: PayCalcDay<S>[];
};

export function payExcludeReason(s: PayCalcSession, correctionStatus: string | null): PayExcludeReason {
  if (s.status === "invalid") return "invalid";
  // `abandoned` 는 퇴근 시각이 비어 있어 아래 조건에도 걸리지만, 사유를 따로 돌려줘야 화면에서
  // "아직 근무 중"과 "퇴근을 안 찍고 넘어감"을 구분해 보여줄 수 있다.
  if (s.status === "abandoned") return "abandoned";
  if (s.status === "open" || s.status === "reopened") return "open";
  if (!s.clock_in_at || !s.clock_out_at) return "open";
  if (correctionStatus === "requested" || correctionStatus === "in_review") return "pending_correction";
  if (s.review_state !== "normal" && s.review_state !== "approved_correction") return "review_required";
  return null;
}

function appliedAllowances(
  date: string,
  rows: readonly PayCalcAllowance[],
  paidMinutes: number,
): PayCalcAllowanceResult[] {
  const out: PayCalcAllowanceResult[] = [];
  for (const a of rows) {
    const type = a.allowance_type as "daily_fixed" | "hourly_extra";
    const calculated = allowanceCalculatedExact(type, a.amount_yen, paidMinutes);
    if (calculated <= 0) continue;
    out.push({
      allowanceId: a.id,
      date,
      type,
      category: a.category === "special" ? "special" : "regular",
      memo: a.memo,
      amountYen: a.amount_yen,
      paidMinutes,
      calculatedAmount: calculated,
    });
  }
  return out;
}

/**
 * 한 사람의 한 달 시급 예상 급여(확정 규칙은 `attendance-pay.ts` 머리말 · 결정 기록 2026-06-17).
 * `sessions` 는 그 사람의 그 달 세션(operating_date ↑, clock_in_at ↑), `allowances` 는 그 달 active 수당
 * (조직 전체 + 다른 사람 대상이 섞여 있어도 된다 — 여기서 거른다).
 */
export function calculateMonthlyPay<S extends PayCalcSession>(input: {
  userId: string;
  firstDay: string;
  lastDay: string;
  sessions: readonly S[];
  rates: readonly PayCalcRate[];
  employment: readonly PayCalcEmployment[];
  allowances: readonly PayCalcAllowance[];
  breakSecondsBySession: ReadonlyMap<string, number>;
  correctionStatusOf: (sessionId: string) => string | null;
}): PayCalcMonth<S> {
  const { rates, employment } = input;
  const allowancesByDate = new Map<string, PayCalcAllowance[]>();
  for (const a of input.allowances) {
    if (a.target_user_id !== null && a.target_user_id !== input.userId) continue;
    const list = allowancesByDate.get(a.target_date) ?? [];
    list.push(a);
    allowancesByDate.set(a.target_date, list);
  }
  const byDate = new Map<string, S[]>();
  for (const s of input.sessions) {
    const list = byDate.get(s.operating_date) ?? [];
    list.push(s);
    byDate.set(s.operating_date, list);
  }

  const days: PayCalcDay<S>[] = [];
  let excludedCount = 0;
  let hourlyEligible = false;
  const segments = new Map<number, { paidMinutes: number; gross: number }>();

  const pushDay = (
    date: string,
    employmentType: string | null,
    hourlyRate: number | null,
    sessions: PayCalcSessionResult<S>[],
    allowances: PayCalcAllowanceResult[],
  ) => {
    let paidMinutes = 0;
    let grossExact = 0;
    for (const s of sessions) {
      paidMinutes += s.paidMinutes;
      grossExact += s.grossExact;
    }
    let allowanceExact = 0;
    let allowanceRegularExact = 0;
    let allowanceSpecialExact = 0;
    for (const a of allowances) {
      allowanceExact += a.calculatedAmount;
      if (a.category === "special") allowanceSpecialExact += a.calculatedAmount;
      else allowanceRegularExact += a.calculatedAmount;
    }
    days.push({
      date,
      employmentType,
      hourlyRate,
      paidMinutes,
      grossExact,
      allowanceExact,
      allowanceRegularExact,
      allowanceSpecialExact,
      allowances,
      sessions,
    });
  };

  for (const date of Array.from(byDate.keys()).sort()) {
    const dayRate = resolveEffective(rates, date)?.hourly_rate ?? null;
    const empType = resolveEffective(employment, date)?.employment_type ?? null;
    const isHourly = empType === "hourly";
    if (isHourly) hourlyEligible = true;

    let dayPaidMinutes = 0;
    const sessionResults: PayCalcSessionResult<S>[] = [];
    for (const s of byDate.get(date)!) {
      const breakTotalSec = input.breakSecondsBySession.get(s.id) ?? 0;
      const reason = payExcludeReason(s, input.correctionStatusOf(s.id));
      const usable = reason === null;
      let paidMinutes = 0;
      let grossExact = 0;
      // Pay only applies to hourly days with a known rate and a usable session.
      if (isHourly && usable && dayRate != null && s.clock_in_at && s.clock_out_at) {
        paidMinutes = Math.floor(paidSecondsForSession(s.clock_in_at, s.clock_out_at, breakTotalSec) / 60);
        grossExact = dailyGrossExact(paidMinutes, dayRate);
        dayPaidMinutes += paidMinutes;
        const seg = segments.get(dayRate) ?? { paidMinutes: 0, gross: 0 };
        seg.paidMinutes += paidMinutes;
        seg.gross += grossExact;
        segments.set(dayRate, seg);
      } else if (isHourly && !usable) {
        excludedCount += 1;
      }
      sessionResults.push({
        session: s,
        breakTotalSec,
        paidMinutes,
        grossExact,
        included: isHourly && usable && dayRate != null,
        excludeReason: reason,
      });
    }
    // Attendance allowances apply only to hourly days that have recognized paid work. daily_fixed pays
    // its flat amount once for the day (regardless of session count); hourly_extra scales with the day's
    // recognized paid minutes. Base rates in hourly_rate_history are never touched.
    const allowances =
      isHourly && dayPaidMinutes > 0
        ? appliedAllowances(date, allowancesByDate.get(date) ?? [], dayPaidMinutes)
        : [];
    pushDay(date, empType, dayRate, sessionResults, allowances);
  }

  // Allowance-only days: an allowance can target a date the worker didn't clock in. A `daily_fixed`
  // allowance still applies as a flat grant for an hourly worker on that date; `hourly_extra` needs
  // recognized minutes (0 → not applied). These days carry no base wage, only the allowance.
  for (const [date, rows] of allowancesByDate) {
    if (byDate.has(date)) continue;
    const empType = resolveEffective(employment, date)?.employment_type ?? null;
    if (empType !== "hourly") continue;
    const allowances = appliedAllowances(date, rows, 0);
    if (allowances.length === 0) continue;
    hourlyEligible = true;
    pushDay(date, empType, resolveEffective(rates, date)?.hourly_rate ?? null, [], allowances);
  }

  let totalPaidMinutes = 0;
  let totalGrossExact = 0;
  let totalRegularExact = 0;
  let totalSpecialExact = 0;
  for (const d of days) {
    totalPaidMinutes += d.paidMinutes;
    totalGrossExact += d.grossExact;
    totalRegularExact += d.allowanceRegularExact;
    totalSpecialExact += d.allowanceSpecialExact;
  }
  const allowances = days.flatMap((d) => d.allowances);
  days.sort((a, b) => a.date.localeCompare(b.date));

  // Monthly ceiling to 10 yen applies once, AFTER base wage + allowance are summed (design rule).
  const expectedGross = roundToNearest10(totalGrossExact + totalRegularExact + totalSpecialExact);
  // Each bucket rounds to the nearest yen; base absorbs the 10-yen monthly ceiling so
  // base + 추가수당 + 특별수당 always sum back to expectedGross exactly.
  const allowanceRegularTotal = Math.round(settleYen(totalRegularExact));
  const allowanceSpecialTotal = Math.round(settleYen(totalSpecialExact));

  return {
    hourlyEligible,
    // 세션 유무와 관계없이 고용 유형 이력으로만 판단 — 그 달과 겹치는 이력 중 salaried 가 있고 시급 날이 없으면 true.
    // 세션이 0개인 신입 월급제 직원 첫 달도 true 가 된다.
    salariedOnly:
      !hourlyEligible &&
      employment.some(
        (r) =>
          r.employment_type === "salaried" &&
          r.effective_from <= input.lastDay &&
          (r.effective_to == null || r.effective_to >= input.firstDay),
      ),
    totalPaidMinutes,
    expectedGross,
    baseGross: expectedGross - allowanceRegularTotal - allowanceSpecialTotal,
    allowanceTotal: allowanceRegularTotal + allowanceSpecialTotal,
    allowanceRegularTotal,
    allowanceSpecialTotal,
    allowances,
    excludedCount,
    rateSegments: Array.from(segments.entries())
      .map(([rate, v]) => ({ rate, paidMinutes: v.paidMinutes, gross: Math.round(settleYen(v.gross)) }))
      .sort((a, b) => a.rate - b.rate),
    days,
  };
}
