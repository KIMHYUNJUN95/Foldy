// Annual leave — approval review queue (Phase 2, stage 2). Admin/approver-scoped: every query/write
// runs on the service-role client and is filtered by the CURRENT organization id. Approver rights are
// verified server-side here (platform admin, or an active org membership with a non-null
// `leave_approver_role`) — the SQL `is_leave_approver()` helper needs an auth context and is NOT used
// on this service-role path. Self-scope request submission lives in annual-leave-requests-server.ts.
// See migration 202607060002 and docs/product/26-annual-leave-workflow.md.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { memberCapabilities } from "@/lib/capabilities-server";
import { displayRoleKey, fetchPlatformDeveloperIds } from "@/lib/platform-developers";
import type { AppSession } from "@/lib/session";
import { tokyoToday } from "@/lib/annual-leave";
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

/** Public approver check (platform admin, or `leave.approve`).
 *  Used to gate management writes (balance edit, approver toggle) that live behind the approver-only
 *  console but must still be re-verified server-side. */
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

/** Tokyo week (Mon–Sun) containing `today` (YYYY-MM-DD), returned as inclusive date strings. */
function tokyoWeekRange(today: string): { weekStart: string; weekEnd: string } {
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const dow = base.getUTCDay(); // 0=Sun..6=Sat
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
 * Remaining days in one balance pool for `userId`, **with already-approved usage deducted**.
 *
 * Delegates to `getMyAnnualLeaveSummary` — the same function the mobile 잔여 screen
 * (`/mobile/attendance/leave`) and the admin 잔여 table read from. This used to call
 * `computeAnnualLeaveSummary` directly *without* `usedDays`/`specialUsedDays`, so the approval
 * screen reported the gross grant (e.g. "12일") while the applicant's own screen showed the net
 * balance ("2일"). The 잔여 초과 warning is derived from this number, so it effectively never fired
 * and over-balance requests approved silently. Do not re-inline the computation here: two screens
 * showing the same number must share one code path.
 *
 * Returns null when the employee has no leave baseline yet (hire+6mo not reached / not set up).
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
      // no baseline: hire+6mo not yet reached / not set up — best-effort "미도래" flag
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
 * Best-effort assignment of the 休暇届 document number (AL-YYYY-MM-NNN) after approval.
 * Never fails the approval: if the column isn't migrated yet or any non-conflict error occurs it just
 * returns. On a unique-violation race with a concurrent approval it recomputes and retries.
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
    // Only a unique-violation race is worth retrying; anything else (e.g. column not migrated) → give up.
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
    .select("status")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = existing as { status: string } | null;
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "requested") return { ok: false, error: "not_requested" };

  const { error } = await service
    .from("annual_leave_requests")
    .update({
      status: "approved",
      approved_by_user_id: session.user.id,
      approved_role: approverRole,
      approved_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "requested");
  if (error) return { ok: false, error: "approve_failed" };

  // Assign the 休暇届 document number (best-effort — never blocks the approval).
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

  const { error } = await service
    .from("annual_leave_requests")
    .update({
      status: "rejected",
      rejected_by_user_id: session.user.id,
      rejected_reason: reason ?? "",
      rejected_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "requested");
  if (error) return { ok: false, error: "reject_failed" };

  return { ok: true };
}

/**
 * Revokes an already-approved leave (대시보드 "승인 취소"). Sets the request to `cancelled` and records
 * who/why. Approved usage is keyed off `status = 'approved'`, so cancelling automatically restores the
 * applicant's balance and drops the request from the calendar/documents. Approver-gated, org-isolated,
 * only from `approved`. The 休暇届 document number is kept (audit trail) but no longer surfaces.
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

  const { error } = await service
    .from("annual_leave_requests")
    .update({
      status: "cancelled",
      cancelled_by_user_id: session.user.id,
      cancelled_reason: reason ?? "",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "approved");
  if (error) return { ok: false, error: "cancel_failed" };

  return { ok: true };
}
