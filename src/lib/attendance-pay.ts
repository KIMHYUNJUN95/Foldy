// 근태 — 시급제 예상 급여 계산 + 본인 월 급여 보기 (10단계).
//
// 총액 원금만, 예상치 (확정 아님). 확정된 규칙 (decision-log 2026-06-17):
//   - 시급제 사용자만 (월급제는 여기서 급여 없음)
//   - 해결됨/사용 가능한 세션만 센다: 완료 + (review_state normal|approved_correction) +
//     출퇴근 양쪽 있음 + 대기 중 정정 없음; 제외 = open/reopened/invalid, review_required,
//     대기 중 정정 (requested|in_review)
//   - 유급 분은 1분 단위; 기록된 휴게는 제외; 자동 휴게 차감 없음
//   - 연장/휴일/야간 할증 없음
//   - 유효일 시급: 도쿄 운영 날짜에 유효한 시급이 그날 전체에 적용되며
//     과거는 더 새로운 시급으로 다시 계산하지 않는다
//   - 최종 월 총액은 10엔 단위로 올림 (월 단계에서만)
//
// 본인 전용: 호출자가 인증된 사용자 id 를 넘기며 클라이언트가 보낸 대상은 없다. 순수 헬퍼는
// 이후 확정/스냅샷/내보내기 단계에서 재사용할 수 있다. 여기에는 확정/잠금 없음.

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

// ── 순수 계산 헬퍼 (확정 단계에서 재사용 가능) ─────────────────────────

export { dailyGrossExact, paidSecondsForSession, resolveEffective, roundToNearest10 };

// ── 뷰 타입 ───────────────────────────────────────────────────────────────

export type { PayExcludeReason };

export type PayDaySessionView = {
  sessionId: string;
  clockInLabel: string | null;
  clockOutLabel: string | null;
  breakTotalSec: number;
  paidMinutes: number; // 제외되면 0
  dailyGrossExact: number; // 제외되면 0
  included: boolean;
  excludeReason: PayExcludeReason;
};

// ── Attendance allowance (추가수당) ─────────────────────────────────────────────
// 바쁜 날 / 인력 부족 날 특정 도쿄 운영 날짜에 적용하는 추가 급여로, `hourly_rate_history` 의
// 계약 기본 시급은 바꾸지 않는다. 보너스/인센티브 아님.

export type AllowanceType = "daily_fixed" | "hourly_extra";
/** 금액이 들어가는 급여 항목: 일반(추가수당) 또는 특별(특별수당). */
export type AllowanceCategory = "regular" | "special";

/** 급여 보기에서 특정 날에 적용된 근태 수당 하나 (스냅샷에도 보존된다). */
export type AppliedAllowanceView = {
  allowanceId: string;
  date: string; // 도쿄 YYYY-MM-DD
  type: AllowanceType;
  category: AllowanceCategory;
  memo: string | null;
  /** 설정된 금액: 정액 엔 (daily_fixed) 또는 시간당 추가 엔 (hourly_extra). */
  amountYen: number;
  /** 그날의 유급 분 (daily_fixed 는 표시용으로 0, hourly_extra 에 쓰임). */
  paidMinutes: number;
  /** 이 날 실제 적용된 엔 (정확한 값, 반올림 안 함). */
  calculatedAmount: number;
};

export type PayDayView = {
  date: string; // YYYY-MM-DD (도쿄)
  dateLabel: string;
  employmentType: EmploymentType | null;
  hourlyRate: number | null;
  paidMinutes: number;
  grossExact: number; // 기본 급여만 (수당 제외)
  allowanceExact: number; // 그날 적용된 수당 합계, 두 항목 모두 (반올림 안 함)
  allowanceRegularExact: number; // 그날의 추가수당 항목 (반올림 안 함)
  allowanceSpecialExact: number; // 그날의 특별수당 항목 (반올림 안 함)
  allowances: AppliedAllowanceView[];
  sessions: PayDaySessionView[];
};

export type RateSegmentView = { rate: number; paidMinutes: number; gross: number };

/** 본인 급여 보기에 반영되는 확정 스냅샷 (11단계). */
export type PayFinalizationView = {
  finalized: true;
  gross: number; // 잠긴 확정 총액 (엔)
  paidMinutes: number;
  finalizedAtLabel: string | null;
};

export type MonthlyPayView = {
  ym: string; // YYYY-MM
  monthLabel: string;
  /** 그 달에 시급제로 고용된 날이 하루라도 있으면 true. */
  hourlyEligible: boolean;
  /** 그 달 내내 월급제였다면(시급제인 날 없음) true → 급여 합계 없음. */
  salariedOnly: boolean;
  totalPaidMinutes: number;
  /** 예상 월 총액 = 기본 급여 + 근태 수당, 10엔 단위로 반올림. */
  expectedGross: number;
  /** `expectedGross` 의 기본 급여 부분 (= expectedGross − allowanceTotal), 내보내기/내역용. */
  baseGross: number;
  /** 그 달 적용된 근태 수당 합계, 두 항목 모두 (엔, 가까운 엔으로 반올림). */
  allowanceTotal: number;
  /** 그 달의 추가수당 항목 합계 (엔, 가까운 엔으로 반올림). */
  allowanceRegularTotal: number;
  /** 그 달의 특별수당 항목 합계 (엔, 가까운 엔으로 반올림). */
  allowanceSpecialTotal: number;
  /** 그 달에 적용된 모든 수당 (급여 패널 / 본인 보기 / 스냅샷용). */
  allowances: AppliedAllowanceView[];
  /** 급여에서 제외된 시급제 날의 세션 수 (미해결 / 대기 / 열림 / 무효). */
  excludedCount: number;
  /** 고용형태 · 시급이 없어 0원이 된 근무 수 — 마감을 막는다(`PayCalcMonth.unpricedCount`). */
  unpricedCount: number;
  rateSegments: RateSegmentView[];
  days: PayDayView[];
  /** 사용자-월이 확정되면 있음 — 화면에 확정(잠긴) 급여를 보여준다 (11단계). */
  finalization: PayFinalizationView | null;
};

// ── 도쿄 헬퍼 ────────────────────────────────────────────────────────────

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

/** 도쿄 YYYY-MM 의 마지막 날 (YYYY-MM-DD, 포함). */
function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 다음 달 0일 = 이번 달 마지막 날
  return `${ym}-${String(last).padStart(2, "0")}`;
}

// ── 월 본인 급여 보기 ────────────────────────────────────────────────────

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
 * 도쿄 `ym` (YYYY-MM)의 본인 월 시급제 예상 급여 보기. 본인 범위. 월급제
 * 월은 급여 합계 없이 `salariedOnly` 를 반환한다. 현재 사용 가능한 근태(완료된
 * 세션, 휴게, 승인된 정정, 시급/고용 이력)를 반영한다 — 예상치이며 확정 아님.
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
    // 그 달의 유효한 근태 수당. 조직 전체(target_user_id IS NULL) + 이 사용자 본인
    // 대상 행을 남기고, 사용자 필터는 PostgREST .or() 문자열
    // 보간을 피하려고 아래 JS 에서 적용한다. 취소된 행은 무시한다.
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

  // 확정 스냅샷 반영 (11단계): 있으면 화면에 잠긴 확정 급여를 보여준다.
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
