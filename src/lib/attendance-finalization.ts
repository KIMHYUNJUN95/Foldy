// Attendance — monthly finalization eligibility + snapshot reads (Step 11).
//
// Per-person per-month finalization is MANUAL and privileged (owner / attendance_payroll_admin). This
// module holds the server-side eligibility checks (the documented blocking rules) and the snapshot
// reads; the privileged finalize/reopen ACTIONS live in src/app/admin/attendance/actions.ts. The admin
// review/finalize UI is in the deferred web dashboard — there is no admin app UI here.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AttendanceMonthSnapshotRow } from "@/lib/attendance";

type Service = ReturnType<typeof getSupabaseServiceClient>;

/** First day (YYYY-MM-01) the snapshot's target_month is keyed on. */
export function monthFirstDay(ym: string): string {
  return `${ym}-01`;
}

/** Inclusive last day (YYYY-MM-DD) of a Tokyo YYYY-MM. */
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
};

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
    if (s.review_state === "review_required") reviewRequired += 1;
    // `abandoned`(퇴근 미기록 후 운영일 경과)도 미해소로 센다 — 출근은 막지 않되 **마감은 막아야**
    // 누군가 반드시 정리하게 된다. 정리 경로는 정정 요청 승인 / 관리자 직접 수정 / 무효 처리.
    if (s.status === "open" || s.status === "reopened" || s.status === "abandoned" || !s.clock_out_at) {
      openSessions += 1;
    }
  }
  return { reviewRequired, openSessions };
}

/**
 * The current FINALIZED snapshot for a user-month, or null. After a reopen the row becomes `reopened`
 * (no `finalized` row), so this returns null and expected-pay resumes.
 */
export async function getCurrentFinalizedSnapshot(
  service: Service,
  organizationId: string,
  userId: string,
  ym: string,
): Promise<AttendanceMonthSnapshotRow | null> {
  const res = await service
    .from("attendance_month_snapshots")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("target_month", monthFirstDay(ym))
    .eq("status", "finalized")
    .maybeSingle();
  return (res.data as AttendanceMonthSnapshotRow | null) ?? null;
}

/**
 * Can this user-month be finalized? Blocked while any unresolved item remains: review-required
 * sessions, pending correction requests (on month sessions), open/incomplete sessions, or an
 * already-finalized snapshot (must reopen first). Server-side; never rely on UI disabling.
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
    .select("id, status, review_state, clock_out_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .gte("operating_date", firstDay)
    .lte("operating_date", lastDay);
  const sessions = (sessRes.data ?? []) as {
    id: string;
    status: string;
    review_state: string;
    clock_out_at: string | null;
  }[];

  const { reviewRequired, openSessions } = countBlockingSessions(sessions);

  const sessionIds = sessions.map((s) => s.id);
  let pendingCorrections = 0;
  // Session-linked corrections: any pending request tied to a session in this month.
  if (sessionIds.length > 0) {
    const cr = await service
      .from("attendance_correction_requests")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("requested_by_user_id", userId)
      .in("status", ["requested", "in_review"])
      .in("session_id", sessionIds);
    pendingCorrections += (cr.data ?? []).length;
  }
  // Session-less corrections: exception requests not tied to any session, targeting this month.
  const crNull = await service
    .from("attendance_correction_requests")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("requested_by_user_id", userId)
    .in("status", ["requested", "in_review"])
    .is("session_id", null)
    .eq("target_month", firstDay);
  pendingCorrections += (crNull.data ?? []).length;

  const alreadyFinalized =
    (await getCurrentFinalizedSnapshot(service, organizationId, userId, ym)) != null;

  const blockers: FinalizationBlockers = {
    reviewRequired,
    pendingCorrections,
    openSessions,
    missingPayInfo: unpricedCount,
    alreadyFinalized,
  };
  const eligible =
    reviewRequired === 0 &&
    pendingCorrections === 0 &&
    openSessions === 0 &&
    unpricedCount === 0 &&
    !alreadyFinalized;

  return { eligible, blockers };
}
