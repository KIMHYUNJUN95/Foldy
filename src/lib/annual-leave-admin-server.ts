// Annual leave — admin-side request creation (Phase 2, stage 1b). The admin console lets an approver
// file a leave request on behalf of another employee (proxy) or for themselves. Every query/write runs
// on the service-role client and is filtered by the CURRENT organization id. Reuses createLeaveRequest
// (self-scope submission) for the actual insert. Day-count normalization mirrors the mobile leave-form
// (src/components/attendance/leave-form.tsx) exactly. See docs/product/26-annual-leave-workflow.md.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AppSession } from "@/lib/session";
import type { LeaveType, LeaveDurationUnit, LeaveStatus } from "@/lib/annual-leave-approvals-server";
import { createLeaveRequest } from "@/lib/annual-leave-requests-server";
import {
  getAnnualLeaveBaseline,
  LEAVE_HOURLY_ROLE,
  MAX_LEAVE_BONUS,
  MAX_LEAVE_GRANT,
  setAnnualLeaveBaselineForUser,
  sumApprovedLeaveUsage,
} from "@/lib/annual-leave-server";
import { computeAnnualLeaveSummary, getScheduledGrants, normalizeLeaveDays, tokyoToday } from "@/lib/annual-leave";

// Hourly / part-time staff are excluded from annual leave (confirmed policy). Every other org role is a
// salary-based regular employee for leave purposes.
// 값 정의는 `annual-leave-server.ts` 에 있다(유일한 baseline 쓰기 지점이 거기라 검증도 거기 있다).
// 여기서는 목록 필터링에만 쓰므로 재수출본을 그대로 참조한다 — 복사하면 두 정의가 갈라진다.
const HOURLY_ROLE = LEAVE_HOURLY_ROLE;

// Days-out window used to surface a bucket that lapses "soon" in the balance table's 소멸 예정 column.
const EXPIRING_SOON_DAYS = 180;

// Deterministic avatar background palette (mirrors the handoff's per-person colors). Index by a stable
// hash of the user id so the same person always keeps the same color across renders/sessions.
const AVATAR_BG = ["#9a4d6d", "#557a8a", "#7a5ea8", "#4d6db5", "#3f7d5a", "#b5683f", "#9c5a2c", "#4d7a6d"];

function avatarBgFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_BG[hash % AVATAR_BG.length];
}

function daysBetweenISO(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// Platform super-admins (developer_super_admin) outrank any org role. In the admin tables we surface
// them by their platform role ("개발자") instead of their incidental membership role
// (e.g. owner/"대표"), matching how the session resolves role everywhere else.
const PLATFORM_ADMIN_ROLE = "developer_super_admin";

async function platformAdminIdSet(
  service: ReturnType<typeof getSupabaseServiceClient>,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data } = await service
    .from("platform_admins")
    .select("user_id")
    .eq("is_active", true)
    .in("user_id", userIds);
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
}

export type LeaveApplicantOption = { id: string; name: string };

/** Balance snapshot for a prospective applicant — powers the request modal's live "잔여 영향" preview.
 *  `ineligible` = no hire-date/baseline set yet (treated as not-yet-accrued / 미도래). */
export type ApplicantLeaveSummary = {
  userId: string;
  name: string;
  role: string | null;
  hireDate: string | null;
  baseRemaining: number;
  bonusRemaining: number;
  ineligible: boolean;
  nextGrantDate: string | null;
};

export async function getApplicantLeaveSummary(
  session: AppSession,
  userId: string,
): Promise<ApplicantLeaveSummary | null> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { data: memData } = await service
    .from("memberships")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  const membership = memData as { role: string; status: string } | null;
  if (!membership || membership.status !== "active") return null;

  const { data: profData } = await service
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  const name = (profData as { name: string } | null)?.name ?? "";

  const baseline = await getAnnualLeaveBaseline(service, organizationId, userId);
  if (!baseline) {
    return {
      userId,
      name,
      role: membership.role,
      hireDate: null,
      baseRemaining: 0,
      bonusRemaining: 0,
      ineligible: true,
      nextGrantDate: null,
    };
  }

  const usage = await sumApprovedLeaveUsage(service, organizationId, userId);
  const summary = computeAnnualLeaveSummary({
    hireDate: baseline.hireDate,
    baselineDate: baseline.baselineDate,
    baselineAmount: baseline.baseAmount,
    bonusBaselineAmount: baseline.bonusAmount,
    usedDays: usage.base,
    specialUsedDays: usage.bonus,
    asOf: tokyoToday(),
  });

  return {
    userId,
    name,
    role: membership.role,
    hireDate: baseline.hireDate,
    baseRemaining: summary.baseRemaining,
    bonusRemaining: summary.bonusRemaining,
    ineligible: false,
    nextGrantDate: summary.nextBaseGrant?.date ?? null,
  };
}

export type AdminLeaveRequestInput = {
  targetUserId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  durationUnit: LeaveDurationUnit;
  reason: string;
  emergencyContact: string;
};

/** Active org members eligible as proxy-request targets (active-only — invited members can't yet
 *  receive requests, and createAdminLeaveRequest validates active membership anyway). */
export async function listLeaveApplicants(session: AppSession): Promise<LeaveApplicantOption[]> {
  const service = getSupabaseServiceClient();
  const { data: memberships } = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", session.organization.id)
    .eq("status", "active");

  const userIds = [...new Set(((memberships ?? []) as { user_id: string }[]).map((m) => m.user_id))];
  if (userIds.length === 0) return [];

  const { data: profiles } = await service.from("profiles").select("id, name").in("id", userIds);

  return ((profiles ?? []) as { id: string; name: string }[])
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** One row per active salary-based employee for the 직원 잔여·부여 table (hourly/part-time excluded). */
export type AdminLeaveBalanceRow = {
  userId: string;
  name: string;
  initial: string;
  bg: string;
  role: string | null;
  hireDate: string | null;
  grant: number; // 유급 pool granted total (= baseRemaining + usedBase)
  usedBase: number;
  bonus: number; // 특별 pool granted total (= bonusRemaining + usedBonus)
  usedBonus: number;
  nextGrantDate: string | null;
  nextGrantAmount: number | null;
  expiringDate: string | null;
  expiringAmount: number | null;
  ineligible: boolean; // 미도래 — no baseline yet, or nothing accrued so far
};

/**
 * Balances for every active salary-based employee. Approved 유급/특별 leave is deducted from the
 * respective pool via computeAnnualLeaveSummary; hourly (part_time_staff) members are excluded.
 * Org-isolated (service-role, filtered by session org).
 */
export async function listAdminLeaveBalances(session: AppSession): Promise<AdminLeaveBalanceRow[]> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const today = tokyoToday();

  const { data: memData } = await service
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  const members = ((memData ?? []) as { user_id: string; role: string }[]).filter(
    (m) => m.role !== HOURLY_ROLE,
  );
  const userIds = [...new Set(members.map((m) => m.user_id))];
  if (userIds.length === 0) return [];
  const roleByUser = new Map(members.map((m) => [m.user_id, m.role]));
  const devIds = await platformAdminIdSet(service, userIds);

  const [{ data: profData }, { data: baseData }, { data: reqData }] = await Promise.all([
    service.from("profiles").select("id, name, hire_date").in("id", userIds),
    service
      .from("annual_leave_baselines")
      .select("user_id, base_amount, bonus_amount, baseline_date")
      .eq("organization_id", organizationId)
      .in("user_id", userIds),
    service
      .from("annual_leave_requests")
      .select("user_id, leave_type, days_count")
      .eq("organization_id", organizationId)
      .eq("status", "approved")
      .in("user_id", userIds),
  ]);

  const profiles = new Map(
    ((profData ?? []) as { id: string; name: string; hire_date: string | null }[]).map((p) => [p.id, p]),
  );
  const baselines = new Map(
    (
      (baseData ?? []) as {
        user_id: string;
        base_amount: number;
        bonus_amount: number;
        baseline_date: string;
      }[]
    ).map((b) => [b.user_id, b]),
  );

  // Approved usage per user, split by pool: 유급(paid) → base, 특별(special) → bonus.
  const usage = new Map<string, { base: number; bonus: number }>();
  for (const r of (reqData ?? []) as { user_id: string; leave_type: string; days_count: number }[]) {
    const u = usage.get(r.user_id) ?? { base: 0, bonus: 0 };
    if (r.leave_type === "paid") u.base += Number(r.days_count);
    else if (r.leave_type === "special") u.bonus += Number(r.days_count);
    usage.set(r.user_id, u);
  }

  const rows: AdminLeaveBalanceRow[] = userIds.map((userId) => {
    const profile = profiles.get(userId);
    const name = profile?.name ?? "";
    const hireDate = profile?.hire_date ?? null;
    const baseline = baselines.get(userId);
    const used = usage.get(userId) ?? { base: 0, bonus: 0 };
    const common = {
      userId,
      name,
      initial: Array.from(name)[0] ?? "?",
      bg: avatarBgFor(userId),
      role: devIds.has(userId) ? PLATFORM_ADMIN_ROLE : roleByUser.get(userId) ?? null,
      hireDate,
      usedBase: used.base,
      usedBonus: used.bonus,
    };

    if (hireDate && baseline) {
      const summary = computeAnnualLeaveSummary({
        hireDate,
        baselineDate: baseline.baseline_date,
        baselineAmount: Number(baseline.base_amount),
        bonusBaselineAmount: Number(baseline.bonus_amount),
        usedDays: used.base,
        specialUsedDays: used.bonus,
        asOf: today,
      });
      // grant reconciles as remaining + used, so "remaining / grant" always adds up in the UI.
      const grant = summary.baseRemaining + used.base;
      const bonus = summary.bonusRemaining + used.bonus;
      const expiring = summary.buckets
        .filter(
          (b) =>
            b.expiresOn !== null &&
            !b.expired &&
            b.remaining > 0 &&
            b.expiresOn > today &&
            daysBetweenISO(today, b.expiresOn) <= EXPIRING_SOON_DAYS,
        )
        .sort((a, b) => (a.expiresOn! < b.expiresOn! ? -1 : 1))[0];
      return {
        ...common,
        grant,
        bonus,
        nextGrantDate: summary.nextGrant?.date ?? null,
        nextGrantAmount: summary.nextGrant?.amount ?? null,
        expiringDate: expiring?.expiresOn ?? null,
        expiringAmount: expiring ? expiring.remaining : null,
        ineligible: grant === 0 && bonus === 0,
      };
    }

    // No baseline yet → 미도래. If a hire date is on file, still surface the first upcoming grant.
    const nextGrant = hireDate
      ? getScheduledGrants(hireDate, today).find((g) => g.date > today) ?? null
      : null;
    return {
      ...common,
      grant: 0,
      bonus: 0,
      nextGrantDate: nextGrant?.date ?? null,
      nextGrantAmount: nextGrant?.amount ?? null,
      expiringDate: null,
      expiringAmount: null,
      ineligible: true,
    };
  });

  return rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/**
 * Admin edit of an employee's hire date + granted balance (직원 잔여·부여 drawer editor).
 * Org-isolated + active-member + not-hourly guarded; approver-gating is enforced by the caller/action.
 */
export async function saveEmployeeLeaveBaseline(
  session: AppSession,
  input: { userId: string; hireDate: string; grant: number; bonus: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  if (!ISO_DATE.test(input.hireDate)) return { ok: false, error: "invalid_dates" };
  if (!Number.isFinite(input.grant) || input.grant < 0 || input.grant > MAX_LEAVE_GRANT) {
    return { ok: false, error: "invalid_grant" };
  }
  if (!Number.isFinite(input.bonus) || input.bonus < 0 || input.bonus > MAX_LEAVE_BONUS) {
    return { ok: false, error: "invalid_bonus" };
  }

  const { data: memData } = await service
    .from("memberships")
    .select("status, role")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const membership = memData as { status: string; role: string } | null;
  if (!membership || membership.status !== "active") return { ok: false, error: "target_not_found" };
  if (membership.role === HOURLY_ROLE) return { ok: false, error: "hourly_excluded" };

  return setAnnualLeaveBaselineForUser(service, organizationId, input.userId, {
    hireDate: input.hireDate,
    baseAmount: input.grant,
    bonusAmount: input.bonus,
  });
}

// Default approver role assigned when a member is toggled on. `is_leave_approver()` only checks for a
// non-null value, so any value grants approval; the value only drives the 休暇届 document stamp box.
// Confirmed 2026-07-13: 연차 결재는 전무(senior_managing_director)가 담당 → default new approvers to 전무.
const DEFAULT_APPROVER_ROLE = "senior_managing_director";

// NOTE: The 승인자 관리 sub-tab was removed (2026-07-13). Approver granting now lives on the unified
// Users detail screen (`/admin/users/[id]`). These helpers remain the shared leave-approver backend;
// do not delete them without checking that user-management flow.

/** One row per active salary-based member for the 승인자 관리 table. */
export type AdminApproverMember = {
  userId: string;
  name: string;
  initial: string;
  bg: string;
  role: string | null;
  isApprover: boolean;
  approverRole: string | null;
  self: boolean; // the current admin
  locked: boolean; // can't be toggled off (self)
};

/** Members eligible to be leave approvers (active, hourly excluded), current approvers first. */
export async function listAdminApprovers(session: AppSession): Promise<AdminApproverMember[]> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { data: memData } = await service
    .from("memberships")
    .select("user_id, role, leave_approver_role")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  const members = (
    (memData ?? []) as { user_id: string; role: string; leave_approver_role: string | null }[]
  ).filter((m) => m.role !== HOURLY_ROLE);
  const userIds = [...new Set(members.map((m) => m.user_id))];
  if (userIds.length === 0) return [];

  const [{ data: profData }, devIds] = await Promise.all([
    service.from("profiles").select("id, name").in("id", userIds),
    platformAdminIdSet(service, userIds),
  ]);
  const nameById = new Map(((profData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  return members
    .map((m) => {
      const name = nameById.get(m.user_id) ?? "";
      const self = m.user_id === session.user.id;
      return {
        userId: m.user_id,
        name,
        initial: Array.from(name)[0] ?? "?",
        bg: avatarBgFor(m.user_id),
        role: devIds.has(m.user_id) ? PLATFORM_ADMIN_ROLE : m.role,
        isApprover: m.leave_approver_role !== null,
        approverRole: m.leave_approver_role,
        self,
        locked: self, // the current admin can't remove their own approver right
      };
    })
    .sort(
      (a, b) =>
        Number(b.isApprover) - Number(a.isApprover) || a.name.localeCompare(b.name, "ko"),
    );
}

/**
 * Grants/revokes a member's leave-approval right. Authorization is enforced by the caller; this
 * function takes an explicit `organizationId` (the TARGET member's org) so it stays correct when the
 * actor is a platform admin acting across orgs. Guards: target must be an active non-hourly member;
 * an approver can't remove their own right; the org must always keep at least one approver.
 */
export async function setLeaveApprover(input: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  isApprover: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getSupabaseServiceClient();
  const { organizationId, actorUserId } = input;

  const { data: memData } = await service
    .from("memberships")
    .select("status, role, leave_approver_role")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const membership = memData as { status: string; role: string; leave_approver_role: string | null } | null;
  if (!membership || membership.status !== "active") return { ok: false, error: "target_not_found" };
  if (membership.role === HOURLY_ROLE) return { ok: false, error: "hourly_excluded" };

  if (!input.isApprover) {
    if (input.userId === actorUserId) return { ok: false, error: "cannot_remove_self" };
    const { count } = await service
      .from("memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .not("leave_approver_role", "is", null);
    if ((count ?? 0) <= 1) return { ok: false, error: "min_one_approver" };
  }

  const { error } = await service
    .from("memberships")
    .update({ leave_approver_role: input.isApprover ? DEFAULT_APPROVER_ROLE : null })
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId);
  if (error) return { ok: false, error: "update_failed" };
  return { ok: true };
}

/** One approved leave request rendered as a 休暇届 document (for the 문서 sub-tab). */
export type LeaveDocument = {
  id: string;
  documentNumber: string;
  userId: string;
  applicantName: string;
  applicantInitial: string;
  applicantBg: string;
  applicantRole: string | null; // raw org role, labeled in the client
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  durationUnit: LeaveDurationUnit;
  daysCount: number;
  reason: string;
  emergencyContact: string;
  appliedOn: string; // YYYY/MM/DD (申請日, Tokyo)
  approverName: string | null;
  approverInitial: string | null;
  approverRole: string | null; // 'department_head' | 'senior_managing_director'
  decidedAt: string; // "MM/DD HH:mm" (Tokyo) — empty string if not recorded
};

function tokyoYmdSlash(iso: string | null): string {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return p.replace(/-/g, "/");
}

function tokyoMdHm(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`;
}

/**
 * Approved leave requests that have a 休暇届 document number, for the 문서 sub-tab. Org-isolated.
 * Resilient: returns [] if the `document_number` column isn't migrated yet.
 */
export async function listLeaveDocuments(session: AppSession): Promise<LeaveDocument[]> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { data, error } = await service
    .from("annual_leave_requests")
    .select(
      "id, user_id, applicant_name, leave_type, start_date, end_date, duration_unit, days_count, reason, emergency_contact, submitted_at, created_at, document_number, approved_by_user_id, approved_role, approved_at",
    )
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .not("document_number", "is", null)
    .order("start_date", { ascending: true });
  if (error) return [];

  type Row = {
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
    submitted_at: string | null;
    created_at: string;
    document_number: string;
    approved_by_user_id: string | null;
    approved_role: string | null;
    approved_at: string | null;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const applicantIds = [...new Set(rows.map((r) => r.user_id))];
  const approverIds = [...new Set(rows.map((r) => r.approved_by_user_id).filter((v): v is string => Boolean(v)))];
  const [memRes, profRes] = await Promise.all([
    service.from("memberships").select("user_id, role").eq("organization_id", organizationId).in("user_id", applicantIds),
    approverIds.length > 0
      ? service.from("profiles").select("id, name").in("id", approverIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const roleByUser = new Map(((memRes.data ?? []) as { user_id: string; role: string }[]).map((m) => [m.user_id, m.role]));
  const nameById = new Map(((profRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  return rows.map((r) => {
    const approverName = r.approved_by_user_id ? nameById.get(r.approved_by_user_id) ?? null : null;
    return {
      id: r.id,
      documentNumber: r.document_number,
      userId: r.user_id,
      applicantName: r.applicant_name,
      applicantInitial: Array.from(r.applicant_name)[0] ?? "?",
      applicantBg: avatarBgFor(r.user_id),
      applicantRole: roleByUser.get(r.user_id) ?? null,
      leaveType: r.leave_type as LeaveType,
      startDate: r.start_date,
      endDate: r.end_date,
      durationUnit: r.duration_unit as LeaveDurationUnit,
      daysCount: Number(r.days_count),
      reason: r.reason,
      emergencyContact: r.emergency_contact,
      appliedOn: tokyoYmdSlash(r.submitted_at ?? r.created_at),
      approverName,
      approverInitial: approverName ? Array.from(approverName)[0] ?? null : null,
      approverRole: r.approved_role,
      decidedAt: tokyoMdHm(r.approved_at),
    };
  });
}

function tokyoYmdHm(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}/${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`;
}

/** One row per leave request (all statuses except draft) for the 이력(승인 장부) sub-tab. */
export type LeaveLedgerEntry = {
  id: string;
  documentNumber: string | null;
  applicantName: string;
  applicantInitial: string;
  applicantBg: string;
  applicantRole: string | null;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  durationUnit: LeaveDurationUnit;
  daysCount: number;
  status: LeaveStatus;
  reason: string; // 신청 사유
  decisionReason: string | null; // 반려/취소 사유 (해당 시)
  processorName: string | null; // 승인/반려/취소 처리자
  processedAt: string; // decision time (Tokyo, "YYYY/MM/DD HH:mm"); submitted time for pending
  submittedAt: string; // 신청일 (Tokyo, "YYYY/MM/DD")
};

/**
 * The full approval ledger — every leave request (draft excluded), newest first, with who processed it
 * and when. Org-isolated. Resilient: `document_number` may be null for pre-migration approved rows.
 */
export async function listLeaveLedger(session: AppSession): Promise<LeaveLedgerEntry[]> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { data } = await service
    .from("annual_leave_requests")
    .select(
      "id, user_id, applicant_name, leave_type, start_date, end_date, duration_unit, days_count, reason, rejected_reason, status, submitted_at, created_at, document_number, approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, cancelled_at, cancelled_by_user_id, cancelled_reason",
    )
    .eq("organization_id", organizationId)
    .in("status", ["requested", "approved", "rejected", "cancelled"])
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    user_id: string;
    applicant_name: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    duration_unit: string;
    days_count: number;
    reason: string;
    rejected_reason: string | null;
    status: string;
    submitted_at: string | null;
    created_at: string;
    document_number: string | null;
    approved_by_user_id: string | null;
    approved_at: string | null;
    rejected_by_user_id: string | null;
    rejected_at: string | null;
    cancelled_at: string | null;
    cancelled_by_user_id: string | null;
    cancelled_reason: string | null;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const applicantIds = [...new Set(rows.map((r) => r.user_id))];
  const processorIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.approved_by_user_id, r.rejected_by_user_id, r.cancelled_by_user_id])
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const [memRes, profRes] = await Promise.all([
    service.from("memberships").select("user_id, role").eq("organization_id", organizationId).in("user_id", applicantIds),
    processorIds.length > 0
      ? service.from("profiles").select("id, name").in("id", processorIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const roleByUser = new Map(((memRes.data ?? []) as { user_id: string; role: string }[]).map((m) => [m.user_id, m.role]));
  const nameById = new Map(((profRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  return rows.map((r) => {
    const processorId =
      r.status === "approved"
        ? r.approved_by_user_id
        : r.status === "rejected"
          ? r.rejected_by_user_id
          : r.status === "cancelled"
            ? r.cancelled_by_user_id
            : null;
    const decisionReason =
      r.status === "rejected"
        ? r.rejected_reason
        : r.status === "cancelled"
          ? r.cancelled_reason
          : null;
    const decisionIso =
      r.status === "approved"
        ? r.approved_at
        : r.status === "rejected"
          ? r.rejected_at
          : r.status === "cancelled"
            ? r.cancelled_at
            : r.submitted_at;
    return {
      id: r.id,
      documentNumber: r.document_number,
      applicantName: r.applicant_name,
      applicantInitial: Array.from(r.applicant_name)[0] ?? "?",
      applicantBg: avatarBgFor(r.user_id),
      applicantRole: roleByUser.get(r.user_id) ?? null,
      leaveType: r.leave_type as LeaveType,
      startDate: r.start_date,
      endDate: r.end_date,
      durationUnit: r.duration_unit as LeaveDurationUnit,
      daysCount: Number(r.days_count),
      status: r.status as LeaveStatus,
      reason: r.reason,
      decisionReason: decisionReason && decisionReason.trim() ? decisionReason.trim() : null,
      processorName: processorId ? nameById.get(processorId) ?? null : null,
      processedAt: tokyoYmdHm(decisionIso ?? r.created_at),
      submittedAt: tokyoYmdHm(r.submitted_at ?? r.created_at).slice(0, 10),
    };
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Files a leave request (self or proxy) from the admin console. Lands as `requested` in the approval
 * queue. `targetUserId` must be an active member of the session org (org isolation). Any admin-web
 * accessor may file — this console is a management surface, so no separate approver right is required.
 */
export async function createAdminLeaveRequest(
  session: AppSession,
  input: AdminLeaveRequestInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  if (!input.targetUserId) return { ok: false, error: "target_not_found" };
  if (input.reason.trim().length === 0) return { ok: false, error: "invalid_reason" };

  const membership = await service
    .from("memberships")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("user_id", input.targetUserId)
    .maybeSingle();
  if ((membership.data as { status: string } | null)?.status !== "active") {
    return { ok: false, error: "target_not_found" };
  }

  const profile = await service
    .from("profiles")
    .select("name")
    .eq("id", input.targetUserId)
    .maybeSingle();
  const applicantName = (profile.data as { name: string } | null)?.name;
  if (!applicantName) return { ok: false, error: "target_not_found" };

  const normalized = normalizeLeaveDays(input);
  if (!normalized) return { ok: false, error: "invalid_dates" };

  const result = await createLeaveRequest(service, organizationId, input.targetUserId, {
    applicantName,
    leaveType: input.leaveType,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    durationUnit: normalized.durationUnit,
    daysCount: normalized.daysCount,
    reason: input.reason,
    emergencyContact: input.emergencyContact,
    asDraft: false,
  });
  if (!result.ok) return { ok: false, error: "create_failed" };
  return { ok: true, id: result.id };
}
