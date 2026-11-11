// 연차 — 신청 제출 (Phase 2, stage 1). 본인 전용: 모든 조회/쓰기는
// 현재 사용자의 id(호출자가 인증된 세션에서 넘김)와 조직 id 로 거른다.
// 승인(stage 2)과 문서 출력(stage 3)은 여기서 구현하지 않는다 — 마이그레이션
// 202607060002 와 docs/product/26-annual-leave-workflow.md 참고.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isMissingColumnError } from "@/lib/annual-leave-server";

type Service = ReturnType<typeof getSupabaseServiceClient>;

export type LeaveRequestType = "annual" | "paid" | "special" | "other";
export type LeaveDurationUnit = "full" | "am" | "pm";
export type LeaveRequestStatus = "draft" | "requested" | "approved" | "rejected" | "cancelled";

export type LeaveRequestView = {
  id: string;
  leaveType: LeaveRequestType;
  startDate: string;
  endDate: string;
  durationUnit: LeaveDurationUnit;
  daysCount: number;
  reason: string;
  emergencyContact: string;
  imageUrls: string[];
  status: LeaveRequestStatus;
  submittedAt: string | null;
  createdAt: string;
  /** 원래 휴무라 뺀 날짜(안 A, 2026-11-11). 칸이 없던 DB 의 신청은 []. */
  excludedDates: string[];
};

type LeaveRequestRow = {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  duration_unit: string;
  days_count: number;
  reason: string;
  emergency_contact: string;
  image_urls: string[];
  status: string;
  submitted_at: string | null;
  created_at: string;
  excluded_dates?: string[] | null;
};

function toView(row: LeaveRequestRow): LeaveRequestView {
  return {
    id: row.id,
    leaveType: row.leave_type as LeaveRequestType,
    startDate: row.start_date,
    endDate: row.end_date,
    durationUnit: row.duration_unit as LeaveDurationUnit,
    daysCount: Number(row.days_count),
    reason: row.reason,
    emergencyContact: row.emergency_contact,
    imageUrls: row.image_urls,
    status: row.status as LeaveRequestStatus,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    excludedDates: row.excluded_dates ?? [],
  };
}

// `*` — 뺀 날짜 칸(excluded_dates)이 아직 없는 DB 에서도 읽힌다(코드 먼저 배포, 2026-11-11).
const SELECT_COLUMNS = "*";

export type CreateLeaveRequestInput = {
  applicantName: string;
  leaveType: LeaveRequestType;
  startDate: string;
  endDate: string;
  durationUnit: LeaveDurationUnit;
  daysCount: number;
  reason: string;
  emergencyContact: string;
  imageUrls?: string[];
  asDraft?: boolean;
  /** 원래 휴무라 뺀 날짜 — `normalizeLeaveRequest` 를 거친 값만 넘긴다. 일수(daysCount)는 이미 뺀 값. */
  excludedDates?: string[];
  /** 'mobile' | 'admin'(본인) | 'admin_proxy'(대신 신청). */
  submittedVia?: "mobile" | "admin" | "admin_proxy";
};

/**
 * 새 칸(excluded_dates · submitted_via)을 붙여 쓰고, 칸이 아직 없는 DB 면 빼고 다시 쓴다(코드 먼저 배포).
 * 다만 뺀 날짜가 있는데 칸이 없으면 다시 쓰지 않는다 — 날짜 기록 없이 줄어든 일수만 남으면 확인할 수 없다.
 */
async function writeWithOptionalColumns<T>(
  base: Record<string, unknown>,
  input: CreateLeaveRequestInput,
  write: (row: Record<string, unknown>) => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  const excluded = input.excludedDates ?? [];
  const extra: Record<string, unknown> = { excluded_dates: excluded };
  if (input.submittedVia) extra.submitted_via = input.submittedVia;
  const first = await write({ ...base, ...extra });
  if (first.error && isMissingColumnError(first.error) && excluded.length === 0) {
    return write(base);
  }
  return first;
}

export async function createLeaveRequest(
  service: Service,
  organizationId: string,
  userId: string,
  input: CreateLeaveRequestInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const status: LeaveRequestStatus = input.asDraft ? "draft" : "requested";
  const { data, error } = await writeWithOptionalColumns<{ id: string }>(
    {
      organization_id: organizationId,
      user_id: userId,
      applicant_name: input.applicantName,
      leave_type: input.leaveType,
      start_date: input.startDate,
      end_date: input.endDate,
      duration_unit: input.durationUnit,
      days_count: input.daysCount,
      reason: input.reason,
      emergency_contact: input.emergencyContact,
      image_urls: input.imageUrls ?? [],
      status,
      submitted_at: input.asDraft ? null : new Date().toISOString(),
    },
    input,
    (row) =>
      service
        .from("annual_leave_requests")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(row as any)
        .select("id")
        .single(),
  );

  if (error || !data) return { ok: false, error: "insert_failed" };
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * 초안을 이어서 작성한다: 필드를 덮어쓰고, 다시 초안으로 저장하는 게 아니면
 * `requested` 로 전이한다. 행이 아직 `draft` 일 때만 호출할 수 있다 — 제출/결정된 뒤의 수정은
 * 이 경로가 아니라 취소(본인, `requested` 동안)를 거친다.
 */
export async function updateDraftLeaveRequest(
  service: Service,
  organizationId: string,
  userId: string,
  requestId: string,
  input: CreateLeaveRequestInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: existing } = await service
    .from("annual_leave_requests")
    .select("status")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if ((existing as { status: string } | null)?.status !== "draft") {
    return { ok: false, error: "not_editable" };
  }

  const status: LeaveRequestStatus = input.asDraft ? "draft" : "requested";
  const { data, error } = await writeWithOptionalColumns<{ id: string }[]>(
    {
      applicant_name: input.applicantName,
      leave_type: input.leaveType,
      start_date: input.startDate,
      end_date: input.endDate,
      duration_unit: input.durationUnit,
      days_count: input.daysCount,
      reason: input.reason,
      emergency_contact: input.emergencyContact,
      image_urls: input.imageUrls ?? [],
      status,
      submitted_at: input.asDraft ? null : new Date().toISOString(),
    },
    input,
    (row) =>
      service
        .from("annual_leave_requests")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(row as any)
        .eq("id", requestId)
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        // 읽은 뒤 쓰기 사이에 다른 탭이 제출했으면(이미 requested) 덮어쓰지 않는다 — 0행이면 not_editable.
        .eq("status", "draft")
        .select("id"),
  );

  if (error) return { ok: false, error: "update_failed" };
  if (!data || data.length === 0) return { ok: false, error: "not_editable" };
  return { ok: true, id: requestId };
}

/** 초안을 하드 삭제한다 (본인, 자기 행만) — 초안은 제출된 적이 없으니 취소할 것이 없다. */
export async function deleteLeaveRequestDraft(
  service: Service,
  organizationId: string,
  userId: string,
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing } = await service
    .from("annual_leave_requests")
    .select("status")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if ((existing as { status: string } | null)?.status !== "draft") {
    return { ok: false, error: "not_deletable" };
  }

  const { error } = await service
    .from("annual_leave_requests")
    .delete()
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "draft");
  if (error) return { ok: false, error: "delete_failed" };
  return { ok: true };
}

const CANCELLABLE_STATUSES = new Set<LeaveRequestStatus>(["requested"]);

export async function cancelLeaveRequest(
  service: Service,
  organizationId: string,
  userId: string,
  requestId: string,
): Promise<{ ok: true; startDate: string; endDate: string; daysCount: number } | { ok: false; error: string }> {
  const { data: existing } = await service
    .from("annual_leave_requests")
    .select("status, start_date, end_date, days_count")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  const row = existing as { status: string; start_date: string; end_date: string; days_count: number } | null;
  if (!row) return { ok: false, error: "not_found" };
  if (!CANCELLABLE_STATUSES.has(row.status as LeaveRequestStatus)) {
    return { ok: false, error: "not_cancellable" };
  }

  // 상태 조건을 쓰기에도 건다 — 읽은 뒤 관리자가 승인하면 승인된 휴가를 취소로 덮어쓰던 경쟁 상태(2026-10-26).
  const { data: updated, error } = await service
    .from("annual_leave_requests")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by_user_id: userId,
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", row.status)
    .select("id");
  if (error) return { ok: false, error: "cancel_failed" };
  if (!updated || updated.length === 0) return { ok: false, error: "not_cancellable" };

  return { ok: true, startDate: row.start_date, endDate: row.end_date, daysCount: Number(row.days_count) };
}

export async function listMyLeaveRequests(
  service: Service,
  organizationId: string,
  userId: string,
  limit?: number,
): Promise<LeaveRequestView[]> {
  let query = service
    .from("annual_leave_requests")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (limit) query = query.limit(limit);

  const { data } = await query;
  return ((data ?? []) as unknown as LeaveRequestRow[]).map(toView);
}

export async function getMyLeaveRequest(
  service: Service,
  organizationId: string,
  userId: string,
  requestId: string,
): Promise<LeaveRequestView | null> {
  const { data } = await service
    .from("annual_leave_requests")
    .select(SELECT_COLUMNS)
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? toView(data as unknown as LeaveRequestRow) : null;
}

export type ApprovedLeaveEntry = {
  id: string;
  applicantName: string;
  leaveType: LeaveRequestType;
  startDate: string;
  endDate: string;
  daysCount: number;
};

/**
 * 조직 전체에서, 주어진 도쿄 월과 겹치는 승인된 휴가만 — 모바일 팀 캘린더 (L5).
 * 2026-07-06 확정: 모든 직원이 (본인 것을 포함해) 모두의 승인된 휴가를 본다.
 * 대기/반려/초안/취소는 비공개로 남는다. service-role 로 **이름 · 종류 · 기간 · 일수만** 읽는다 —
 * 예전 뒷받침이던 `annual_leave_requests_org_approved_select` 정책은 승인된 행의 모든 칸(비상 연락처 · 사유 ·
 * 사진)을 조직 전원에게 열어서 2026-11-11 에 지웠다(마이그레이션 202611110002).
 */
export async function listApprovedLeaveForMonth(
  service: Service,
  organizationId: string,
  ym: string,
): Promise<ApprovedLeaveEntry[]> {
  const monthStart = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const { data } = await service
    .from("annual_leave_requests")
    .select("id, applicant_name, leave_type, start_date, end_date, days_count")
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .lte("start_date", monthEnd)
    .gte("end_date", monthStart)
    .order("start_date", { ascending: true });

  return ((data ?? []) as unknown as {
    id: string;
    applicant_name: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    days_count: number;
  }[]).map((r) => ({
    id: r.id,
    applicantName: r.applicant_name,
    leaveType: r.leave_type as LeaveRequestType,
    startDate: r.start_date,
    endDate: r.end_date,
    daysCount: Number(r.days_count),
  }));
}

/** 아직 승인 대기 중인 신청 — 휴가 홈 화면의 "대기" 미니 통계에 쓴다. */
export async function countMyPendingLeaveRequests(
  service: Service,
  organizationId: string,
  userId: string,
): Promise<number> {
  const { count } = await service
    .from("annual_leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "requested");
  return count ?? 0;
}
