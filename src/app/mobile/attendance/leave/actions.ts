"use server";

// Annual leave — self-service server action for the Phase 1 backend (hire_date + starting balance
// only). Self-only: acts on the authenticated user's own profile/baseline row, never another user's.
// All writes use the service-role client (RLS denies direct authenticated writes).

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  hasAnnualLeaveBaselineRow,
  isLeaveHourlyRole,
  setAnnualLeaveBaselineForUser,
} from "@/lib/annual-leave-server";
import { normalizeLeaveDays } from "@/lib/annual-leave";
import { getDictionary } from "@/lib/i18n";
import {
  cancelLeaveRequest,
  createLeaveRequest,
  deleteLeaveRequestDraft,
  updateDraftLeaveRequest,
  type LeaveDurationUnit,
  type LeaveRequestType,
} from "@/lib/annual-leave-requests-server";

const LEAVE_PATH = "/mobile/attendance/leave";
const LEAVE_HISTORY_PATH = "/mobile/attendance/leave/history";
const LEAVE_TYPES: LeaveRequestType[] = ["annual", "paid", "special", "other"];
const DURATION_UNITS: LeaveDurationUnit[] = ["full", "am", "pm"];

export type SetAnnualLeaveBaselineResult = { ok: true } | { ok: false; error: string };

export async function setAnnualLeaveBaselineAction(input: {
  hireDate: string;
  baseAmount: number;
}): Promise<SetAnnualLeaveBaselineResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.hireDate)) return { ok: false, error: "invalid_hire_date" };
  if (!Number.isFinite(input.baseAmount) || input.baseAmount < 0) {
    return { ok: false, error: "invalid_base_amount" };
  }

  const service = getSupabaseServiceClient();
  // 본인 자가 설정은 처음 한 번뿐(2026-10-26). 예전에는 매번 덮어써서 직원이 잔여를 언제든 다시 채우고
  // 입사일을 바꿀 수 있었고, 이 화면이 특별휴가 값을 안 보내 관리자가 넣은 특별휴가가 0 이 됐다.
  // 이후 수정은 관리자 화면에서만. 특별휴가는 여기서 받지 않는다(관리자 값).
  const result = await setAnnualLeaveBaselineForUser(
    service,
    session.organization.id,
    session.user.id,
    { hireDate: input.hireDate, baseAmount: input.baseAmount },
    "self_once",
  );
  if (!result.ok) return result;

  revalidatePath(LEAVE_PATH);
  return { ok: true };
}

// ── Request submission (Phase 2, stage 1 — approval action is not implemented yet) ──

export type SubmitLeaveRequestResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * 신청자 이름과 일수는 **화면이 보내지 않는다**(2026-10-01). 예전에는 둘 다 화면 값을 그대로 저장해서
 * 남의 이름으로 신청하거나(관리자 큐 · 팀 캘린더에 그 이름으로 뜬다) 10일 기간을 0.5일로 낼 수 있었다.
 * 이름은 세션 프로필, 일수는 `normalizeLeaveDays` 로 서버가 정한다 — 관리자 대리 신청과 같은 규칙이다.
 */
export async function submitLeaveRequestAction(input: {
  /** Set when continuing an existing draft — updates that row instead of creating a new one. */
  requestId?: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  durationUnit: string;
  reason: string;
  emergencyContact: string;
  asDraft?: boolean;
}): Promise<SubmitLeaveRequestResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };

  if (!LEAVE_TYPES.includes(input.leaveType as LeaveRequestType)) return { ok: false, error: "invalid_leave_type" };
  if (!DURATION_UNITS.includes(input.durationUnit as LeaveDurationUnit)) {
    return { ok: false, error: "invalid_duration_unit" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    return { ok: false, error: "invalid_dates" };
  }
  if (input.endDate < input.startDate) return { ok: false, error: "invalid_date_range" };
  const normalized = normalizeLeaveDays({
    leaveType: input.leaveType as LeaveRequestType,
    startDate: input.startDate,
    endDate: input.endDate,
    durationUnit: input.durationUnit as LeaveDurationUnit,
  });
  if (!normalized) return { ok: false, error: "invalid_dates" };
  if (!input.asDraft && !input.reason.trim()) return { ok: false, error: "missing_reason" };
  if (!input.asDraft && !input.emergencyContact.trim()) return { ok: false, error: "missing_emergency_contact" };

  const service = getSupabaseServiceClient();
  // 유급 · 특별휴가는 잔여에서 빠지는 종류 — 시급직(연차 대상 아님, 확정 정책)은 낼 수 없고,
  // 기준 잔여가 없는 사람도 낼 수 없다(빠질 잔여가 없다). 경조 · 기타는 잔여와 무관해 그대로 둔다.
  if (input.leaveType === "paid" || input.leaveType === "special") {
    if (isLeaveHourlyRole(session.user.role)) return { ok: false, error: "hourly_excluded" };
    if (!(await hasAnnualLeaveBaselineRow(service, session.organization.id, session.user.id))) {
      return { ok: false, error: "baseline_required" };
    }
  }

  const requestInput = {
    applicantName: session.user.name?.trim() || getDictionary(session.user.preferredLanguage).attendance.userFallback,
    leaveType: input.leaveType as LeaveRequestType,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    durationUnit: normalized.durationUnit,
    daysCount: normalized.daysCount,
    reason: input.reason,
    emergencyContact: input.emergencyContact,
    asDraft: input.asDraft,
  };
  const result = input.requestId
    ? await updateDraftLeaveRequest(service, session.organization.id, session.user.id, input.requestId, requestInput)
    : await createLeaveRequest(service, session.organization.id, session.user.id, requestInput);
  if (!result.ok) return result;

  revalidatePath(LEAVE_PATH);
  revalidatePath(LEAVE_HISTORY_PATH);
  return result;
}

export type CancelLeaveRequestResult =
  | { ok: true; startDate: string; endDate: string; daysCount: number }
  | { ok: false; error: string };

export async function cancelLeaveRequestAction(requestId: string): Promise<CancelLeaveRequestResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };

  const service = getSupabaseServiceClient();
  const result = await cancelLeaveRequest(service, session.organization.id, session.user.id, requestId);
  if (!result.ok) return result;

  revalidatePath(LEAVE_PATH);
  revalidatePath(LEAVE_HISTORY_PATH);
  return result;
}

export type DeleteLeaveRequestDraftResult = { ok: true } | { ok: false; error: string };

export async function deleteLeaveRequestDraftAction(requestId: string): Promise<DeleteLeaveRequestDraftResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };

  const service = getSupabaseServiceClient();
  const result = await deleteLeaveRequestDraft(service, session.organization.id, session.user.id, requestId);
  if (!result.ok) return result;

  revalidatePath(LEAVE_PATH);
  revalidatePath(LEAVE_HISTORY_PATH);
  return result;
}
