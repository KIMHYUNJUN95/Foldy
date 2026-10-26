// 연차 — 승인 검토 대기열(Phase 2, 2단계). 관리자/승인자 범위: 모든 쿼리/쓰기가
// service-role 클라이언트로 실행되며 현재 조직 id 로 필터링된다. 승인 권한은
// 여기서 서버 측으로 검증한다(플랫폼 관리자, 또는 null 이 아닌
// `leave_approver_role` 이 있는 활성 조직 멤버십) — SQL `is_leave_approver()` 헬퍼는 인증 컨텍스트가 필요해 쓰지
// 않는다(이 service-role 경로에서는). 본인 범위 신청 제출은 annual-leave-requests-server.ts 에 있다.
// 참고: 마이그레이션 202607060002 와 docs/product/26-annual-leave-workflow.md.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { memberCapabilities } from "@/lib/capabilities-server";
import { displayRoleKey, fetchPlatformDeveloperIds } from "@/lib/platform-developers";
import type { AppSession } from "@/lib/session";
import { leaveSpansOverlap, tokyoToday, type LeaveSpan } from "@/lib/annual-leave";
import { getMyAnnualLeaveSummary } from "@/lib/annual-leave-server";

type Service = ReturnType<typeof getSupabaseServiceClient>;

export type LeaveType = "annual" | "paid" | "special" | "other";
export type LeaveDurationUnit = "full" | "am" | "pm";
export type LeaveStatus = "requested" | "approved" | "rejected" | "cancelled";
export type LeaveStatusGroup = "pending" | "approved" | "rejectedCancelled" | "all";

export type LeaveQueueItem = {
  id: string;
  applicantName: string;
  applicantRole: string | null;
  avatarInitial: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  durationUnit: LeaveDurationUnit;
  daysCount: number;
  reason: string;
  submittedAt: string | null;
  status: LeaveStatus;
};

export type LeaveQueueSummary = {
  pendingCount: number;
  pendingDays: number;
  approvedThisWeekCount: number;
  balanceWarningName: string | null;
};

export type LeaveOverlap = {
  applicantName: string;
  avatarInitial: string;
  startDate: string;
  endDate: string;
  durationUnit: LeaveDurationUnit;
  status: LeaveStatus;
};

export type LeaveApprovalDetail = LeaveQueueItem & {
  emergencyContact: string;
  imageUrls: string[];
  balancePool: "paid" | "special" | "none";
  balanceBefore: number | null;
  balanceAfter: number | null;
  overlaps: LeaveOverlap[];
  submittedVia: string;
};

type RequestRow = {
  id: string;
  user_id: string;
  applicant_name: string;
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
};

const QUEUE_COLUMNS =
  "id, user_id, applicant_name, leave_type, start_date, end_date, duration_unit, days_count, reason, emergency_contact, image_urls, status, submitted_at, created_at";

function avatarInitialOf(name: string): string {
  return Array.from(name)[0] ?? "?";
}

function statusesForGroup(group: LeaveStatusGroup): LeaveStatus[] {
  switch (group) {
    case "pending":
      return ["requested"];
    case "approved":
      return ["approved"];
    case "rejectedCancelled":
      return ["rejected", "cancelled"];
    case "all":
      return ["requested", "approved", "rejected", "cancelled"];
  }
}

async function getLeaveApproverRole(
  service: Service,
  organizationId: string,
  userId: string,
): Promise<{ isApprover: boolean; approverRole: string | null }> {
  const pa = await service
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (pa.data) return { isApprover: true, approverRole: null };

  // 결재 권한은 권한 키 `leave.approve` 로 판정한다(2026-10-21 — 역할 기본 대표 · 전무, 사람마다 켜고 끔). 예전 표시
  // `memberships.leave_approver_role` 은 더 이상 권한을 주지 않는다. 휴가계 도장 칸은 예전 기본값(전무)을 그대로 쓴다.
  if (!(await memberCapabilities(organizationId, userId)).includes("leave.approve")) {
    return { isApprover: false, approverRole: null };
  }
  return { isApprover: true, approverRole: LEAVE_STAMP_ROLE };
}

/** 휴가계 문서의 결재 도장 칸 — 2026-07-13 「연차 결재는 전무가 담당」 결정 때부터의 기본값. */
const LEAVE_STAMP_ROLE = "senior_managing_director";

/** 공개 승인자 확인(플랫폼 관리자, 또는 `leave.approve`).
 *  승인자 전용 콘솔 뒤에 있는 관리 쓰기(잔여 수정, 승인자 토글)를 막는 데 쓰지만
 *  서버에서 다시 검증해야 한다. */
export async function isSessionLeaveApprover(session: AppSession): Promise<boolean> {
  const service = getSupabaseServiceClient();
  const { isApprover } = await getLeaveApproverRole(service, session.organization.id, session.user.id);
  return isApprover;
}

function toQueueItem(row: RequestRow, roleByUser: Map<string, string>): LeaveQueueItem {
  return {
    id: row.id,
    applicantName: row.applicant_name,
    applicantRole: roleByUser.get(row.user_id) ?? null,
    avatarInitial: avatarInitialOf(row.applicant_name),
    leaveType: row.leave_type as LeaveType,
    startDate: row.start_date,
    endDate: row.end_date,
    durationUnit: row.duration_unit as LeaveDurationUnit,
    daysCount: Number(row.days_count),
    reason: row.reason,
    submittedAt: row.submitted_at,
    status: row.status as LeaveStatus,
  };
}

async function rolesByUser(
  service: Service,
  organizationId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data } = await service
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .in("user_id", Array.from(new Set(userIds)));
  const rows = (data ?? []) as { user_id: string; role: string }[];
  // 화면 표시용(연차 큐의 역할 글자) — 플랫폼 개발자는 「개발자」.
  const devIds = await fetchPlatformDeveloperIds(rows.map((r) => r.user_id));
  rows.forEach((r) => map.set(r.user_id, displayRoleKey(r.role, r.user_id, devIds)));
  return map;
}

/** `today`(YYYY-MM-DD)가 속한 도쿄 주(월–일), 양끝 포함 날짜 문자열로 반환. */
function tokyoWeekRange(today: string): { weekStart: string; weekEnd: string } {
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const dow = base.getUTCDay(); // 0=일..6=토
  const daysSinceMonday = (dow + 6) % 7;
  const start = new Date(base);
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10),
  };
}

/**
 * `userId` 의 한 잔여 풀에서 남은 일수, **이미 승인된 사용 분을 차감한** 값.
 *
 * `getMyAnnualLeaveSummary` 에 위임한다 — 모바일 잔여 화면
 * (`/mobile/attendance/leave`)과 admin 잔여 표가 읽는 것과 같은 함수. 예전에는
 * `computeAnnualLeaveSummary` 를 `usedDays`/`specialUsedDays` 없이 직접 호출해서 승인
 * 화면은 총 부여량(예: "12일")을 보고했고 신청자 본인 화면은 순
 * 잔여("2일")를 보여줬다. 잔여 초과 경고는 이 숫자에서 도출되므로 사실상 한 번도 발동하지 않았고
 * 잔여를 넘는 신청이 조용히 승인됐다. 계산을 여기에 다시 인라인하지 말 것: 두 화면이
 * 같은 숫자를 보여주려면 하나의 코드 경로를 공유해야 한다.
 *
 * 직원에게 아직 연차 기준이 없으면 null(입사 6개월 미도달 / 미설정).
 */
async function poolRemainingFor(
  service: Service,
  organizationId: string,
  userId: string,
  pool: "paid" | "special",
): Promise<number | null> {
  const summary = await getMyAnnualLeaveSummary(service, organizationId, userId);
  if (!summary) return null;
  return pool === "paid" ? summary.baseRemaining : summary.bonusRemaining;
}

function poolForType(leaveType: LeaveType): "paid" | "special" | "none" {
  if (leaveType === "paid") return "paid";
  if (leaveType === "special") return "special";
  return "none";
}

async function buildSummary(
  service: Service,
  organizationId: string,
): Promise<LeaveQueueSummary> {
  const today = tokyoToday();
  const { weekStart, weekEnd } = tokyoWeekRange(today);

  const [{ data: pendingData }, { data: approvedData }] = await Promise.all([
    service
      .from("annual_leave_requests")
      .select("id, user_id, applicant_name, leave_type, days_count")
      .eq("organization_id", organizationId)
      .eq("status", "requested"),
    service
      .from("annual_leave_requests")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("status", "approved")
      .lte("start_date", weekEnd)
      .gte("end_date", weekStart),
  ]);

  const pending = (pendingData ?? []) as {
    id: string;
    user_id: string;
    applicant_name: string;
    leave_type: string;
    days_count: number;
  }[];
  const pendingCount = pending.length;
  const pendingDays = pending.reduce((sum, r) => sum + Number(r.days_count), 0);

  const approvedThisWeekCount = new Set(
    ((approvedData ?? []) as { user_id: string }[]).map((r) => r.user_id),
  ).size;

  let balanceWarningName: string | null = null;
  for (const r of pending) {
    const pool = poolForType(r.leave_type as LeaveType);
    if (pool === "none") continue;
    const remaining = await poolRemainingFor(service, organizationId, r.user_id, pool);
    if (remaining === null) {
      // 기준 없음: 입사 6개월 미도달 / 미설정 — 최선 노력으로 "미도래" 표시
      balanceWarningName = r.applicant_name;
      break;
    }
    if (remaining - Number(r.days_count) < 0) {
      balanceWarningName = r.applicant_name;
      break;
    }
  }

  return { pendingCount, pendingDays, approvedThisWeekCount, balanceWarningName };
}

export async function getAdminLeaveQueue(
  session: AppSession,
  opts: { statusGroup: LeaveStatusGroup; type?: LeaveType | "all"; search?: string },
): Promise<{ isApprover: boolean; items: LeaveQueueItem[]; summary: LeaveQueueSummary }> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { isApprover } = await getLeaveApproverRole(service, organizationId, session.user.id);
  if (!isApprover) {
    return {
      isApprover: false,
      items: [],
      summary: { pendingCount: 0, pendingDays: 0, approvedThisWeekCount: 0, balanceWarningName: null },
    };
  }

  let query = service
    .from("annual_leave_requests")
    .select(QUEUE_COLUMNS)
    .eq("organization_id", organizationId)
    .in("status", statusesForGroup(opts.statusGroup));

  if (opts.type && opts.type !== "all") {
    query = query.eq("leave_type", opts.type);
  }
  if (opts.search && opts.search.trim().length > 0) {
    const term = `%${opts.search.trim()}%`;
    query = query.or(`applicant_name.ilike.${term},reason.ilike.${term}`);
  }

  const { data } = await query
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as RequestRow[];
  const roleByUser = await rolesByUser(service, organizationId, rows.map((r) => r.user_id));
  const items = rows.map((r) => toQueueItem(r, roleByUser));

  const summary = await buildSummary(service, organizationId);

  return { isApprover: true, items, summary };
}

export async function getAdminLeaveApprovalDetail(
  session: AppSession,
  requestId: string,
): Promise<LeaveApprovalDetail | null> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { isApprover } = await getLeaveApproverRole(service, organizationId, session.user.id);
  if (!isApprover) return null;

  const { data } = await service
    .from("annual_leave_requests")
    .select(QUEUE_COLUMNS)
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .not("status", "eq", "draft")
    .maybeSingle();
  const row = data as unknown as RequestRow | null;
  if (!row) return null;

  const roleByUser = await rolesByUser(service, organizationId, [row.user_id]);
  const item = toQueueItem(row, roleByUser);

  const balancePool = poolForType(item.leaveType);
  let balanceBefore: number | null = null;
  let balanceAfter: number | null = null;
  if (balancePool !== "none") {
    balanceBefore = await poolRemainingFor(service, organizationId, row.user_id, balancePool);
    balanceAfter = balanceBefore === null ? null : balanceBefore - item.daysCount;
  }

  const { data: overlapData } = await service
    .from("annual_leave_requests")
    .select("applicant_name, start_date, end_date, duration_unit, status")
    .eq("organization_id", organizationId)
    .neq("id", requestId)
    .in("status", ["requested", "approved"])
    .lte("start_date", row.end_date)
    .gte("end_date", row.start_date)
    .order("start_date", { ascending: true })
    .limit(10);

  const overlaps: LeaveOverlap[] = (
    (overlapData ?? []) as {
      applicant_name: string;
      start_date: string;
      end_date: string;
      duration_unit: string;
      status: string;
    }[]
  ).map((o) => ({
    applicantName: o.applicant_name,
    avatarInitial: avatarInitialOf(o.applicant_name),
    startDate: o.start_date,
    endDate: o.end_date,
    durationUnit: o.duration_unit as LeaveDurationUnit,
    status: o.status as LeaveStatus,
  }));

  return {
    ...item,
    emergencyContact: row.emergency_contact,
    imageUrls: row.image_urls,
    balancePool,
    balanceBefore,
    balanceAfter,
    overlaps,
    submittedVia: "mobile",
  };
}

/**
 * 승인 후 休暇届 문서 번호(AL-YYYY-MM-NNN)를 최선 노력으로 부여한다.
 * 승인을 절대 실패시키지 않는다: 컬럼이 아직 마이그레이션되지 않았거나 충돌 외 오류가 나면
 * 그냥 반환한다. 동시 승인과 unique 위반 경합이 나면 다시 계산해 재시도한다.
 */
async function assignLeaveDocumentNumber(
  service: Service,
  organizationId: string,
  requestId: string,
): Promise<void> {
  const ym = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const prefix = `AL-${ym}-`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: last } = await service
      .from("annual_leave_requests")
      .select("document_number")
      .eq("organization_id", organizationId)
      .like("document_number", `${prefix}%`)
      .order("document_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastNo = (last as { document_number: string | null } | null)?.document_number ?? null;
    const lastNnn = lastNo ? parseInt(lastNo.slice(prefix.length), 10) || 0 : 0;
    const candidate = `${prefix}${String(lastNnn + 1).padStart(3, "0")}`;
    const { error } = await service
      .from("annual_leave_requests")
      .update({ document_number: candidate })
      .eq("id", requestId)
      .eq("organization_id", organizationId)
      .is("document_number", null);
    if (!error) return;
    // unique 위반 경합만 재시도할 가치가 있다. 그 밖의 것(예: 컬럼 미마이그레이션)은 → 포기.
    if ((error as { code?: string }).code !== "23505") return;
  }
}

export async function approveLeaveRequestForApprover(
  session: AppSession,
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { isApprover, approverRole } = await getLeaveApproverRole(
    service,
    organizationId,
    session.user.id,
  );
  if (!isApprover) return { ok: false, error: "forbidden" };

  const { data: existing } = await service
    .from("annual_leave_requests")
    .select("status, user_id, start_date, end_date, duration_unit")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = existing as
    | { status: string; user_id: string; start_date: string; end_date: string; duration_unit: string }
    | null;
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "requested") return { ok: false, error: "not_requested" };

  // 같은 사람의 이미 승인된 휴가와 겹치면 승인하지 않는다 — 잔여가 두 번 빠진다(2026-10-26).
  // 잔여 초과 승인은 막지 않는다(경고만 — 정책 결정 대기).
  const span: LeaveSpan = {
    startDate: row.start_date,
    endDate: row.end_date,
    durationUnit: row.duration_unit as LeaveSpan["durationUnit"],
  };
  const { data: sameUserApproved, error: overlapError } = await service
    .from("annual_leave_requests")
    .select("start_date, end_date, duration_unit")
    .eq("organization_id", organizationId)
    .eq("user_id", row.user_id)
    .eq("status", "approved")
    .neq("id", requestId)
    .lte("start_date", row.end_date)
    .gte("end_date", row.start_date);
  if (overlapError) return { ok: false, error: "approve_failed" };
  const clash = ((sameUserApproved ?? []) as { start_date: string; end_date: string; duration_unit: string }[]).some(
    (o) =>
      leaveSpansOverlap(span, {
        startDate: o.start_date,
        endDate: o.end_date,
        durationUnit: o.duration_unit as LeaveSpan["durationUnit"],
      }),
  );
  if (clash) return { ok: false, error: "overlap" };

  const { data: updated, error } = await service
    .from("annual_leave_requests")
    .update({
      status: "approved",
      approved_by_user_id: session.user.id,
      approved_role: approverRole,
      approved_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: "approve_failed" };
  // 0행 = 그 사이 다른 사람이 먼저 처리했다(승인 · 반려 · 취소). 성공으로 보이면 안 된다.
  if (!updated || updated.length === 0) return { ok: false, error: "not_requested" };

  // 休暇届 문서 번호를 부여한다(최선 노력 — 승인을 막지 않음).
  await assignLeaveDocumentNumber(service, organizationId, requestId);

  return { ok: true };
}

export async function rejectLeaveRequestForApprover(
  session: AppSession,
  requestId: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { isApprover } = await getLeaveApproverRole(service, organizationId, session.user.id);
  if (!isApprover) return { ok: false, error: "forbidden" };

  const { data: existing } = await service
    .from("annual_leave_requests")
    .select("status")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = existing as { status: string } | null;
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "requested") return { ok: false, error: "not_requested" };

  const { data: updated, error } = await service
    .from("annual_leave_requests")
    .update({
      status: "rejected",
      rejected_by_user_id: session.user.id,
      rejected_reason: reason ?? "",
      rejected_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: "reject_failed" };
  if (!updated || updated.length === 0) return { ok: false, error: "not_requested" };

  return { ok: true };
}

/**
 * 이미 승인된 휴가를 철회한다(대시보드 "승인 취소"). 요청을 `cancelled` 로 바꾸고 다음을 기록한다:
 * 누가/왜. 승인된 사용 분은 `status = 'approved'` 로 판정하므로 취소하면 자동으로
 * 신청자의 잔여가 복원되고 캘린더/문서에서 신청이 빠진다. 승인자 전용, 조직 격리,
 * `approved` 에서만 가능. 休暇届 문서 번호는 유지되지만(감사 기록) 더 이상 노출되지 않는다.
 */
export async function cancelApprovedLeaveForApprover(
  session: AppSession,
  requestId: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { isApprover } = await getLeaveApproverRole(service, organizationId, session.user.id);
  if (!isApprover) return { ok: false, error: "forbidden" };

  const { data: existing } = await service
    .from("annual_leave_requests")
    .select("status")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = existing as { status: string } | null;
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "approved") return { ok: false, error: "not_approved" };

  const { data: updated, error } = await service
    .from("annual_leave_requests")
    .update({
      status: "cancelled",
      cancelled_by_user_id: session.user.id,
      cancelled_reason: reason ?? "",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .select("id");
  if (error) return { ok: false, error: "cancel_failed" };
  if (!updated || updated.length === 0) return { ok: false, error: "not_approved" };

  return { ok: true };
}
