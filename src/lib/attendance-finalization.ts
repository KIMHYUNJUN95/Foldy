// 근태 — 월 확정 자격 + 스냅샷 읽기 (11단계).
//
// 사람별 월 확정은 수동이며 권한이 필요하다 (owner / attendance_payroll_admin). 이
// 모듈은 서버 측 자격 확인(문서화된 차단 규칙)과 스냅샷
// 읽기를 담당하고, 권한 필요한 확정/재개 액션은 src/app/admin/attendance/actions.ts 에 있다. 관리자
// 검토/확정 UI 는 보류된 웹 대시보드에 있으며 여기에는 관리자 앱 UI 가 없다.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPayableReviewState, type AttendanceMonthSnapshotRow } from "@/lib/attendance";
import { requireRead } from "@/lib/attendance-read";

type Service = ReturnType<typeof getSupabaseServiceClient>;

/** 스냅샷의 target_month 가 기준으로 삼는 첫날 (YYYY-MM-01). */
export function monthFirstDay(ym: string): string {
  return `${ym}-01`;
}

/** 도쿄 YYYY-MM 의 마지막 날 (YYYY-MM-DD, 포함). */
export function monthLastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

export type FinalizationBlockers = {
  reviewRequired: number;
  pendingCorrections: number;
  openSessions: number;
  /** 고용형태 · 시급이 없어 0원이 된 근무 수(`PayCalcMonth.unpricedCount`, 2026-10-21). 0원이 마감 금액으로 굳지 않게 막는다. */
  missingPayInfo: number;
  alreadyFinalized: boolean;
  /**
   * 마감을 막는 근무 하나하나(2026-11-11) — 날짜 · 이유 코드. `rejected_correction` · `pending_correction` 근무는 「검토 필요」 탭에
   * 보이지 않아, 숫자만으로는 어느 날을 고쳐야 하는지 알 수 없었다. 화면은 이 코드를 ko/ja/en 문구로 바꿔 보여 준다.
   */
  sessions?: BlockingSession[];
};

export type BlockingSessionReason = "review_required" | "pending_correction" | "rejected_correction" | "open";

export type BlockingSession = {
  sessionId: string;
  userId: string;
  /** 운영일 YYYY-MM-DD(도쿄). */
  date: string;
  reason: BlockingSessionReason;
};

/**
 * 마감을 막는 근무 목록 — `countBlockingSessions` 와 같은 판정(무효 제외 · 지급 안 되는 검토 상태 · 열린 근무), 근무마다 이유 하나,
 * 날짜 순. 검토 상태가 이유면 그것을, 아니면 `open`.
 */
export function listBlockingSessions(
  sessions: readonly {
    id: string;
    user_id: string;
    operating_date: string;
    status: string;
    review_state: string;
    clock_out_at: string | null;
  }[],
): BlockingSession[] {
  const out: BlockingSession[] = [];
  for (const s of sessions) {
    if (s.status === "invalid") continue;
    let reason: BlockingSessionReason | null = null;
    if (!isPayableReviewState(s.review_state)) {
      reason =
        s.review_state === "pending_correction" || s.review_state === "rejected_correction"
          ? s.review_state
          : "review_required";
    } else if (s.status === "open" || s.status === "reopened" || s.status === "abandoned" || !s.clock_out_at) {
      reason = "open";
    }
    if (reason) out.push({ sessionId: s.id, userId: s.user_id, date: s.operating_date, reason });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type FinalizationEligibility = {
  eligible: boolean;
  blockers: FinalizationBlockers;
};

/**
 * 마감을 막는 세션 수 — 자기 마감(`getFinalizationEligibility`)과 관리자 급여(`computePayrollMonth`)가 같이 쓴다.
 * **무효(`invalid`) 세션은 어느 쪽에도 세지 않는다** — 무효 처리 자체가 관리자의 해소 결정이다. 전에는 「검토 필요」로
 * 표시된 채 무효 처리된 세션이 검토 수에 계속 잡혀, 복구(=다시 유효로) 말고는 마감을 풀 방법이 없었다(2026-10-19).
 */
export function countBlockingSessions(
  sessions: readonly { status: string; review_state: string; clock_out_at: string | null }[],
): { reviewRequired: number; openSessions: number } {
  let reviewRequired = 0;
  let openSessions = 0;
  for (const s of sessions) {
    if (s.status === "invalid") continue;
    // 급여에서 빠지는 검토 상태는 전부 막는다 — 급여 제외(`payExcludeReason`)와 같은 판정 하나(2026-11-11).
    if (!isPayableReviewState(s.review_state)) reviewRequired += 1;
    // `abandoned`(퇴근 미기록 후 운영일 경과)도 미해소로 센다 — 출근은 막지 않되 **마감은 막아야**
    // 누군가 반드시 정리하게 된다. 정리 경로는 정정 요청 승인 / 관리자 직접 수정 / 무효 처리.
    if (s.status === "open" || s.status === "reopened" || s.status === "abandoned" || !s.clock_out_at) {
      openSessions += 1;
    }
  }
  return { reviewRequired, openSessions };
}

/**
 * 사용자-월의 현재 확정된 스냅샷, 없으면 null. 재개하면 행이 `reopened` 가 되어
 * (`finalized` 행 없음) null 을 반환하고 예상 급여 계산이 재개된다.
 */
export async function getCurrentFinalizedSnapshot(
  service: Service,
  organizationId: string,
  userId: string,
  ym: string,
  /** `strict` = 읽기 실패면 던진다 — 마감 여부를 「안 됨」으로 잘못 보고 쓰기를 허락하지 않게(2026-11-11). */
  options: { strict?: boolean } = {},
): Promise<AttendanceMonthSnapshotRow | null> {
  const res = await service
    .from("attendance_month_snapshots")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("target_month", monthFirstDay(ym))
    .eq("status", "finalized")
    .maybeSingle();
  if (options.strict) return requireRead("attendance_month_snapshots", res, null) as AttendanceMonthSnapshotRow | null;
  return (res.data as AttendanceMonthSnapshotRow | null) ?? null;
}

/**
 * 이 사용자-월을 확정할 수 있는가? 미해결 항목이 남아 있으면 막힌다: 검토 필요
 * 세션, 대기 중인 정정 요청(해당 월 세션), 열려 있거나 미완료인 세션, 또는
 * 이미 확정된 스냅샷(먼저 재개해야 함). 서버 측 검사이며 UI 비활성화에 의존하지 않는다.
 * `unpricedCount` 는 호출자가 계산한 급여(`getMonthlyPayView`)에서 넘긴다 — 고용형태 · 시급이 없는 근무.
 */
export async function getFinalizationEligibility(
  organizationId: string,
  userId: string,
  ym: string,
  unpricedCount: number,
): Promise<FinalizationEligibility> {
  const service = getSupabaseServiceClient();
  const firstDay = monthFirstDay(ym);
  const lastDay = monthLastDay(ym);

  const sessRes = await service
    .from("attendance_sessions")
    .select("id, user_id, operating_date, status, review_state, clock_out_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .gte("operating_date", firstDay)
    .lte("operating_date", lastDay);
  // 읽기 실패는 던진다(2026-11-11) — 「막는 것 0건」으로 보고 마감을 통과시키지 않는다.
  const sessions = requireRead("attendance_sessions", sessRes, []) as {
    id: string;
    user_id: string;
    operating_date: string;
    status: string;
    review_state: string;
    clock_out_at: string | null;
  }[];

  const { reviewRequired, openSessions } = countBlockingSessions(sessions);

  const sessionIds = sessions.map((s) => s.id);
  let pendingCorrections = 0;
  // 세션에 연결된 정정: 이 달의 세션에 걸린 대기 중 요청.
  if (sessionIds.length > 0) {
    const cr = await service
      .from("attendance_correction_requests")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("requested_by_user_id", userId)
      .in("status", ["requested", "in_review"])
      .in("session_id", sessionIds);
    pendingCorrections += requireRead("attendance_correction_requests", cr, []).length;
  }
  // 세션 없는 정정: 어느 세션에도 걸리지 않고 이 달을 대상으로 한 예외 요청.
  const crNull = await service
    .from("attendance_correction_requests")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("requested_by_user_id", userId)
    .in("status", ["requested", "in_review"])
    .is("session_id", null)
    .eq("target_month", firstDay);
  pendingCorrections += requireRead("attendance_correction_requests", crNull, []).length;

  const alreadyFinalized =
    (await getCurrentFinalizedSnapshot(service, organizationId, userId, ym, { strict: true })) != null;

  const blockers: FinalizationBlockers = {
    reviewRequired,
    pendingCorrections,
    openSessions,
    missingPayInfo: unpricedCount,
    alreadyFinalized,
    sessions: listBlockingSessions(sessions),
  };
  const eligible =
    reviewRequired === 0 &&
    pendingCorrections === 0 &&
    openSessions === 0 &&
    unpricedCount === 0 &&
    !alreadyFinalized;

  return { eligible, blockers };
}
