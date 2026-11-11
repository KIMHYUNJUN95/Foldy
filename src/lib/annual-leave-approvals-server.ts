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
import {
  computeAnnualLeaveSummary,
  leaveSpansOverlap,
  tokyoToday,
  type LeaveSpan,
  type LeaveUsage,
  leaveUsagesFromRows,
} from "@/lib/annual-leave";
import {
  getAnnualLeaveBaseline,
  isLeaveHourlyRole,
  isMissingFunctionError,
  selectAllPages,
  sumApprovedLeaveUsage,
  getAnnualLeaveBaselinesForUsers,
  listApprovedLeaveRowsForUsers,
} from "@/lib/annual-leave-server";

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
  /** 이 신청을 뺀, 같은 사람의 다른 승인된 휴가만 반영한 잔여(2026-11-11 — 승인된 신청은 두 번 빠지지 않는다). */
  balanceBefore: number | null;
  /** 이 신청까지 반영한 잔여. 사용일 기준이라 `balanceBefore - daysCount` 와 다를 수 있다(그날 소멸 · 새 부여). */
  balanceAfter: number | null;
  /** 승인하면 잔여를 넘는다(사용일에 쓸 수 있는 묶음이 모자람). 이때 승인에는 사유가 필요하다(M7). */
  overBalance: boolean;
  /** 승인하면 잔여를 넘는 일수(0 = 안 넘침). 화면 경고는 이 값만 그린다(2026-11-11). */
  overflowDays: number;
  /** 같은 풀에서 아직 대기 중인 이 사람의 다른 신청 일수 — 잔여에서 빼지 않고 따로 보여 준다. */
  otherPendingDays: number;
  /** 기준 잔여가 아직 결재자 확인 전(M11). */
  baselineProvisional: boolean;
  /** 승인 때 남긴 잔여 초과 사유(승인된 신청만). */
  balanceOverrideReason: string | null;
  /** 원래 휴무라 뺀 날짜(안 A, 2026-11-11). 결재자가 확인한다 — 화면 표시는 2차. */
  excludedDates: string[];
  overlaps: LeaveOverlap[];
  /** 'mobile' | 'admin' | 'admin_proxy' — 이 칸이 생기기 전 신청은 null. */
  submittedVia: string | null;
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
  // 플랫폼 관리자도 휴가계 도장 칸을 채운다(2026-11-11) — 예전에는 null 이라 승인된 휴가계 도장이 비었다.
  if (pa.data) return { isApprover: true, approverRole: LEAVE_STAMP_ROLE };

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
 * 한 신청의 잔여 영향 — **모바일 잔여 화면과 같은 계산**(`getMyAnnualLeaveSummary` 와 같은 기준 · 사용 읽기 +
 * `computeAnnualLeaveSummary`)으로, 이 신청을 뺀 잔여(before)와
 * 넣은 잔여(after), 그리고 넘는지(over)를 낸다(2026-11-11, M7). 넘는지는 사용일 기준이다 — 그날 이미 소멸한 묶음은
 * 못 쓰고, 그날 들어온 새 부여는 쓴다. 기준 잔여가 없으면 null(입사 6개월 미도달 / 미설정).
 *
 * 계산을 여기에 다시 인라인하지 말 것: 승인 화면 · 승인 판정 · 신청자 화면이 같은 숫자를 보여 주려면
 * 하나의 코드 경로를 공유해야 한다(2026-08-03 에 승인 화면만 총 부여량을 보여 잔여 초과가 조용히 승인됐다).
 */
async function poolImpactFor(
  service: Service,
  organizationId: string,
  userId: string,
  pool: "paid" | "special",
  request: { id: string; startDate: string; daysCount: number },
  /** 이미 읽은 기준 잔여(승인 경로) — 주면 다시 읽지 않는다. 빼면 여기서 읽는다. */
  preloadedBaseline?: Awaited<ReturnType<typeof getAnnualLeaveBaseline>>,
): Promise<{
  before: number;
  after: number;
  over: boolean;
  overflowDays: number;
  provisional: boolean;
  approvedUsedDays: number;
} | null> {
  const [baseline, approved] = await Promise.all([
    preloadedBaseline !== undefined ? preloadedBaseline : getAnnualLeaveBaseline(service, organizationId, userId),
    sumApprovedLeaveUsage(service, organizationId, userId, { excludeRequestId: request.id }),
  ]);
  return impactFromData(baseline, approved, pool, request);
}

/** `poolImpactFor` 의 계산 부분(읽기 없음) — 결재 큐 요약이 한 번에 읽은 값으로 같은 계산을 한다. */
function impactFromData(
  baseline: Awaited<ReturnType<typeof getAnnualLeaveBaseline>>,
  approved: { base: number; bonus: number; usages: LeaveUsage[] },
  pool: "paid" | "special",
  request: { id: string; startDate: string; daysCount: number },
): {
  before: number;
  after: number;
  over: boolean;
  overflowDays: number;
  provisional: boolean;
  approvedUsedDays: number;
} | null {
  if (!baseline) return null;
  const common = {
    hireDate: baseline.hireDate,
    baselineDate: baseline.baselineDate,
    baselineAmount: baseline.baseAmount,
    bonusBaselineAmount: baseline.bonusAmount,
    asOf: tokyoToday(),
  };
  const usage: LeaveUsage = { date: request.startDate, days: request.daysCount, pool: pool === "paid" ? "base" : "bonus" };
  const before = computeAnnualLeaveSummary({ ...common, usages: approved.usages });
  const after = computeAnnualLeaveSummary({ ...common, usages: [...approved.usages, usage] });
  const isPaid = pool === "paid";
  // 이 신청 때문에 새로 넘치는 일수 — 승인 판정(over)과 결재 화면 경고가 같은 값을 쓴다.
  const overflowDays = isPaid ? after.baseOverflow - before.baseOverflow : after.bonusOverflow - before.bonusOverflow;
  return {
    before: isPaid ? before.baseRemaining : before.bonusRemaining,
    after: isPaid ? after.baseRemaining : after.bonusRemaining,
    over: overflowDays > 0,
    overflowDays: Math.max(0, overflowDays),
    provisional: baseline.provisional,
    approvedUsedDays: approved.base + approved.bonus,
  };
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

  const [pending, approvedData] = await Promise.all([
    selectAllPages<{
      id: string;
      user_id: string;
      applicant_name: string;
      leave_type: string;
      days_count: number;
      start_date: string;
    }>("annual_leave_requests.pending", (from, to) =>
      service
        .from("annual_leave_requests")
        .select("id, user_id, applicant_name, leave_type, days_count, start_date")
        .eq("organization_id", organizationId)
        .eq("status", "requested")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    selectAllPages<{ user_id: string }>("annual_leave_requests.week", (from, to) =>
      service
        .from("annual_leave_requests")
        .select("id, user_id")
        .eq("organization_id", organizationId)
        .eq("status", "approved")
        .lte("start_date", weekEnd)
        .gte("end_date", weekStart)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  const pendingCount = pending.length;
  const pendingDays = pending.reduce((sum, r) => sum + Number(r.days_count), 0);

  const approvedThisWeekCount = new Set(approvedData.map((r) => r.user_id)).size;

  // 잔여가 걸린 대기 건의 사람들 기준 잔여 · 승인 기록을 한 번에 읽고 메모리에서 계산한다(2026-11-11 — 예전엔 건마다 두 번씩 읽었다).
  const poolRows = pending.filter((r) => poolForType(r.leave_type as LeaveType) !== "none");
  const poolUserIds = poolRows.map((r) => r.user_id);
  const [baselines, approvedRows] = await Promise.all([
    getAnnualLeaveBaselinesForUsers(service, organizationId, poolUserIds),
    listApprovedLeaveRowsForUsers(service, organizationId, poolUserIds),
  ]);
  let balanceWarningName: string | null = null;
  for (const r of poolRows) {
    const pool = poolForType(r.leave_type as LeaveType) as "paid" | "special";
    const usages = leaveUsagesFromRows(approvedRows.filter((a) => a.user_id === r.user_id && a.id !== r.id));
    const approved = {
      base: usages.filter((u) => u.pool === "base").reduce((sum, u) => sum + u.days, 0),
      bonus: usages.filter((u) => u.pool === "bonus").reduce((sum, u) => sum + u.days, 0),
      usages,
    };
    const impact = impactFromData(baselines.get(r.user_id) ?? null, approved, pool, {
      id: r.id,
      startDate: r.start_date,
      daysCount: Number(r.days_count),
    });
    // 기준 없음(입사 6개월 미도달 / 미설정) 또는 승인하면 잔여를 넘는 신청.
    if (!impact || impact.over) {
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

  // 1,000행 상한을 넘겨 끝까지 읽는다(2026-11-11, M14) — 정렬 끝에 id 를 붙여 쪽이 흔들리지 않게.
  const rows = await selectAllPages<RequestRow>("annual_leave_requests.queue", (from, to) => {
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
    return query
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });
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

  const { data, error: rowError } = await service
    .from("annual_leave_requests")
    // `*` — 새 칸(submitted_via · excluded_dates)이 아직 없는 DB 에서도 읽힌다(코드 먼저 배포).
    .select("*")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .not("status", "eq", "draft")
    .maybeSingle();
  if (rowError) throw new Error(`annual leave detail read failed: ${rowError.message}`);
  const row = data as unknown as
    | (RequestRow & {
        submitted_via?: string | null;
        balance_override_reason?: string | null;
        excluded_dates?: string[] | null;
      })
    | null;
  if (!row) return null;

  const roleByUser = await rolesByUser(service, organizationId, [row.user_id]);
  const item = toQueueItem(row, roleByUser);

  const balancePool = poolForType(item.leaveType);
  let balanceBefore: number | null = null;
  let balanceAfter: number | null = null;
  let overBalance = false;
  let overflowDays = 0;
  let baselineProvisional = false;
  let otherPendingDays = 0;
  if (balancePool !== "none") {
    // 이 신청을 빼고 계산한다 — 이미 승인된 신청을 열면 예전에는 잔여에서 두 번 빠졌다(2026-11-11).
    const impact = await poolImpactFor(service, organizationId, row.user_id, balancePool, {
      id: row.id,
      startDate: row.start_date,
      daysCount: item.daysCount,
    });
    if (impact) {
      balanceBefore = impact.before;
      balanceAfter = impact.after;
      overBalance = impact.over;
      overflowDays = impact.overflowDays;
      baselineProvisional = impact.provisional;
    }
    const pendingRows = await selectAllPages<{ id: string; days_count: number }>(
      "annual_leave_requests.pending_same_user",
      (from, to) =>
        service
          .from("annual_leave_requests")
          .select("id, days_count")
          .eq("organization_id", organizationId)
          .eq("user_id", row.user_id)
          .eq("status", "requested")
          .eq("leave_type", item.leaveType)
          .order("id", { ascending: true })
          .range(from, to),
    );
    otherPendingDays = pendingRows.filter((r) => r.id !== row.id).reduce((sum, r) => sum + Number(r.days_count), 0);
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
    overBalance,
    overflowDays,
    otherPendingDays,
    baselineProvisional,
    balanceOverrideReason: row.balance_override_reason ?? null,
    excludedDates: row.excluded_dates ?? [],
    overlaps,
    submittedVia: row.submitted_via ?? null,
  };
}

/**
 * 승인 함수(`approve_annual_leave_request_atomic`)가 아직 없는 DB 용 예전 승인 경로 — 코드가 마이그레이션보다 먼저
 * 배포돼도 승인이 멈추지 않게(2026-11-11 배포 순서). 같은 사람 잠금이 없어 동시 승인 경합은 막지 못한다
 * (마이그레이션 뒤에는 이 경로를 타지 않는다). 겹침 · 상태 조건 · 문서 번호(숫자 기준 최대 + 1)는 지킨다.
 */
async function legacyApproveWithoutRpc(
  service: Service,
  organizationId: string,
  requestId: string,
  row: { user_id: string; start_date: string; end_date: string; duration_unit: string },
  actor: { userId: string; approverRole: string | null },
  overrideReason: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const span: LeaveSpan = {
    startDate: row.start_date,
    endDate: row.end_date,
    durationUnit: row.duration_unit as LeaveSpan["durationUnit"],
  };
  const { data: sameUserApproved, error: overlapError } = await service
    .from("annual_leave_requests")
    .select("id, start_date, end_date, duration_unit")
    .eq("organization_id", organizationId)
    .eq("user_id", row.user_id)
    .eq("status", "approved")
    .lte("start_date", row.end_date)
    .gte("end_date", row.start_date);
  if (overlapError) return { ok: false, error: "approve_failed" };
  const clash = ((sameUserApproved ?? []) as { id: string; start_date: string; end_date: string; duration_unit: string }[])
    .filter((o) => o.id !== requestId)
    .some((o) =>
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
      approved_by_user_id: actor.userId,
      approved_role: actor.approverRole,
      approved_at: new Date().toISOString(),
      balance_override_reason: overrideReason,
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: "approve_failed" };
  if (!updated || updated.length === 0) return { ok: false, error: "not_requested" };

  const ym = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(
    new Date(),
  );
  const prefix = `AL-${ym}-`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: numbered } = await service
      .from("annual_leave_requests")
      .select("document_number")
      .eq("organization_id", organizationId)
      .like("document_number", `${prefix}%`);
    // 숫자로 최대값 — 글자 정렬은 999 다음 1000 을 못 찾는다.
    const maxNo = ((numbered ?? []) as { document_number: string | null }[]).reduce((max, r) => {
      const n = parseInt((r.document_number ?? "").slice(prefix.length), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    const next = maxNo + 1;
    const candidate = `${prefix}${next < 1000 ? String(next).padStart(3, "0") : String(next)}`;
    const { error: numError } = await service
      .from("annual_leave_requests")
      .update({ document_number: candidate })
      .eq("id", requestId)
      .eq("organization_id", organizationId)
      .is("document_number", null);
    if (!numError || (numError as { code?: string }).code !== "23505") break;
  }
  return { ok: true };
}

/** 잔여 초과 사유 최대 글자 수. */
const MAX_OVERRIDE_REASON = 500;

/**
 * 휴가 승인(2026-11-11 점검 수정).
 *
 *  - 자기 신청은 승인하지 않는다(`self_approval`, M6).
 *  - 유급 · 특별휴가는 승인 때 자격을 다시 본다 — 시급직(`hourly_excluded`) · 기준 잔여 없음(`baseline_required`).
 *  - 승인하면 잔여를 넘으면(사용일 기준) 사유가 있어야 한다 — 없으면 `over_balance`, 있으면
 *    `balance_override_reason` 에 남긴다(M7).
 *  - 상태 바꾸기 · 같은 사람 겹침 · 잔여 경합 · 문서 번호는 DB 함수 `approve_annual_leave_request_atomic` 이
 *    같은 사람 잠금 안에서 한 번에 한다(M8). 서버가 잔여를 계산한 뒤 다른 승인이 먼저 들어가면 `stale` →
 *    한 번 다시 계산한다.
 */
export async function approveLeaveRequestForApprover(
  session: AppSession,
  requestId: string,
  opts: { overrideReason?: string } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  const { isApprover, approverRole } = await getLeaveApproverRole(
    service,
    organizationId,
    session.user.id,
  );
  if (!isApprover) return { ok: false, error: "forbidden" };

  const { data: existing, error: readError } = await service
    .from("annual_leave_requests")
    .select("id, status, user_id, leave_type, start_date, end_date, duration_unit, days_count")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (readError) return { ok: false, error: "approve_failed" };
  const row = existing as
    | {
        id: string;
        status: string;
        user_id: string;
        leave_type: string;
        start_date: string;
        end_date: string;
        duration_unit: string;
        days_count: number;
      }
    | null;
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "requested") return { ok: false, error: "not_requested" };
  if (row.user_id === session.user.id) return { ok: false, error: "self_approval" };

  const pool = poolForType(row.leave_type as LeaveType);
  const overrideReason = (opts.overrideReason ?? "").trim().slice(0, MAX_OVERRIDE_REASON);

  try {
    // 기준 잔여는 한 번만 읽어 자격 확인 · 잔여 계산에 같이 쓴다(2026-11-11).
    let baseline: Awaited<ReturnType<typeof getAnnualLeaveBaseline>> = null;
    if (pool !== "none") {
      const { data: memData, error: memError } = await service
        .from("memberships")
        .select("status, role")
        .eq("organization_id", organizationId)
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (memError) return { ok: false, error: "approve_failed" };
      const membership = memData as { status: string; role: string } | null;
      if (!membership || membership.status !== "active") return { ok: false, error: "not_found" };
      if (isLeaveHourlyRole(membership.role)) return { ok: false, error: "hourly_excluded" };
      baseline = await getAnnualLeaveBaseline(service, organizationId, row.user_id);
      if (!baseline) return { ok: false, error: "baseline_required" };
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let over = false;
      // 잔여와 무관한 종류(경조 · 기타)는 null — 함수가 「그 사이 다른 승인」 확인을 건너뛴다. 예전엔 같은 사람 유급 승인과
      // 동시에 들어오면 stale 이 두 번 나서 승인이 실패했다(2026-11-11).
      let expectedUsed: number | null = null;
      if (pool !== "none") {
        const impact = await poolImpactFor(
          service,
          organizationId,
          row.user_id,
          pool,
          { id: row.id, startDate: row.start_date, daysCount: Number(row.days_count) },
          baseline,
        );
        if (!impact) return { ok: false, error: "baseline_required" };
        over = impact.over;
        expectedUsed = impact.approvedUsedDays;
        if (over && !overrideReason) return { ok: false, error: "over_balance" };
      }

      const { data: result, error } = await service.rpc("approve_annual_leave_request_atomic", {
        p_organization_id: organizationId,
        p_request_id: requestId,
        p_actor_user_id: session.user.id,
        p_approved_role: approverRole,
        p_override_reason: over ? overrideReason : null,
        p_expected_used_days: expectedUsed,
      });
      if (error && isMissingFunctionError(error)) {
        return legacyApproveWithoutRpc(
          service,
          organizationId,
          requestId,
          row,
          { userId: session.user.id, approverRole },
          over ? overrideReason : null,
        );
      }
      if (error) return { ok: false, error: "approve_failed" };
      if (result === "ok") return { ok: true };
      if (result === "stale" && attempt === 0) continue;
      if (result === "stale") return { ok: false, error: "approve_failed" };
      return { ok: false, error: String(result) };
    }
  } catch {
    // 잔여 읽기 실패 — 0 으로 보고 승인하지 않는다(H5).
    return { ok: false, error: "approve_failed" };
  }
  return { ok: false, error: "approve_failed" };
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
