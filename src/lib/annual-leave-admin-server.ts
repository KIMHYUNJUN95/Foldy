// 연차 — 관리자 쪽 신청 생성(Phase 2, 1b 단계). 관리자 콘솔에서 승인권자가
// 다른 직원 대신(대리) 또는 본인 휴가 신청을 올린다. 모든 조회/쓰기는
// service-role 클라이언트로 하고 현재 조직 id 로 거른다. 실제 insert 는 createLeaveRequest
// (본인 범위 제출)를 재사용한다. 일수 정규화는 모바일 휴가 폼
// (src/components/attendance/leave-form.tsx)과 똑같다. docs/product/26-annual-leave-workflow.md 참고.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AppSession } from "@/lib/session";
import {
  isSessionLeaveApprover,
  type LeaveType,
  type LeaveDurationUnit,
  type LeaveStatus,
} from "@/lib/annual-leave-approvals-server";
import { createLeaveRequest } from "@/lib/annual-leave-requests-server";
import {
  getAnnualLeaveBaseline,
  isLeaveHourlyRole,
  MAX_LEAVE_BONUS,
  MAX_LEAVE_GRANT,
  setAnnualLeaveBaselineForUser,
  sumApprovedLeaveUsage,
} from "@/lib/annual-leave-server";
import { computeAnnualLeaveSummary, getScheduledGrants, normalizeLeaveDays, tokyoToday } from "@/lib/annual-leave";

// 시급제 역할(아르바이트 · 아르바이트 리더)은 연차 대상이 아니다(확정 정책). 판정은 `annual-leave-server.ts` 의
// `isLeaveHourlyRole` 하나만 쓴다(유일한 baseline 쓰기 지점이 거기라 검증도 거기 있다) — 복사하면 두 정의가 갈라진다.

// 곧 소멸하는 묶음을 잔여 표의 소멸 예정 열에 보여 주는 남은 일수 기준.
const EXPIRING_SOON_DAYS = 180;

// 결정적 아바타 배경 팔레트(핸드오프의 사람별 색과 같다). 사용자 id 의 안정적인
// 해시로 인덱싱해 같은 사람이 렌더/세션이 바뀌어도 항상 같은 색을 갖는다.
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

// 플랫폼 슈퍼 관리자(developer_super_admin)는 어떤 조직 역할보다 높다. 관리자 표에서는
// 그들을 우연한 멤버십 역할이 아니라 플랫폼 역할("개발자")로 보여 준다
// (예: owner/"대표"). 세션이 역할을 정하는 다른 모든 곳과 같다.
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

/** 신청 예정자의 잔여 스냅샷 — 신청 모달의 실시간 "잔여 영향" 미리 보기에 쓴다.
 * `ineligible` = 아직 입사일/기준선이 없음(아직 발생하지 않음으로 취급 / 미도래). */
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
  // 남의 입사일 · 잔여는 결재자만 본다(2026-10-28 보안 점검). 본인 것은 누구나.
  if (session.organization.id === "platform") return null;
  if (userId !== session.user.id && !(await isSessionLeaveApprover(session))) return null;

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

/** 신청 대상이 될 수 있는 활성 조직 멤버(활성만 — 초대된 멤버는 아직
 * 요청을 받을 수 없고, createAdminLeaveRequest 가 어차피 활성 멤버십을 검증한다). */
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

/** 직원 잔여·부여 표의 활성 정규직 직원 한 명당 한 행(시급/파트타임 제외). */
export type AdminLeaveBalanceRow = {
  userId: string;
  name: string;
  initial: string;
  bg: string;
  role: string | null;
  hireDate: string | null;
  grant: number; // 유급 풀 부여 합계 (= baseRemaining + usedBase)
  usedBase: number;
  bonus: number; // 특별 풀 부여 합계 (= bonusRemaining + usedBonus)
  usedBonus: number;
  nextGrantDate: string | null;
  nextGrantAmount: number | null;
  expiringDate: string | null;
  expiringAmount: number | null;
  ineligible: boolean; // 미도래 — 아직 기준선이 없거나 지금까지 발생한 것이 없음
};

/**
 * 모든 활성 정규직 직원의 잔여. 승인된 유급/특별 휴가는 computeAnnualLeaveSummary 로
 * 각 풀에서 차감하며, 시급 역할(part_time_staff · staff)은 제외한다.
 * 조직 격리(service-role, 세션 조직으로 거름).
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
    (m) => !isLeaveHourlyRole(m.role),
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

  // 사용자별 승인된 사용량을 풀로 나눈다: 유급(paid) → base, 특별(special) → bonus.
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
      // 부여는 잔여 + 사용으로 맞추므로 UI 의 "잔여 / 부여"가 항상 맞아떨어진다.
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

    // 아직 기준선이 없으면 → 미도래. 입사일이 있으면 곧 올 첫 부여는 그래도 보여 준다.
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
 * 직원의 입사일 + 부여 잔여 관리자 수정(직원 잔여·부여 drawer 편집기).
 * 조직 격리 + 활성 멤버 + 시급 제외 가드. 승인권자 확인은 호출자/액션이 한다.
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
  if (isLeaveHourlyRole(membership.role)) return { ok: false, error: "hourly_excluded" };

  return setAnnualLeaveBaselineForUser(service, organizationId, input.userId, {
    hireDate: input.hireDate,
    baseAmount: input.grant,
    bonusAmount: input.bonus,
  });
}

// 결재자 관리(예전 `leave_approver_role` 표시 + 승인자 목록 · 토글)는 권한 키 `leave.approve` 로 옮겨 지웠다(2026-10-21).
// 사용자 화면의 개인 부여 · 차단으로 켜고 끈다. 판정: `annual-leave-approvals-server.ts` `getLeaveApproverRole`.

/** 休暇届 문서로 그려지는 승인된 휴가 신청 하나(문서 하위 탭용). */
export type LeaveDocument = {
  id: string;
  documentNumber: string;
  userId: string;
  applicantName: string;
  applicantInitial: string;
  applicantBg: string;
  applicantRole: string | null; // 원본 조직 역할. 라벨은 클라이언트에서 붙인다
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  durationUnit: LeaveDurationUnit;
  daysCount: number;
  reason: string;
  emergencyContact: string;
  appliedOn: string; // YYYY/MM/DD (申請日, 도쿄)
  approverName: string | null;
  approverInitial: string | null;
  approverRole: string | null; // 'department_head' | 'senior_managing_director'
  decidedAt: string; // "MM/DD HH:mm" (도쿄) — 기록이 없으면 빈 문자열
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
 * 休暇届 문서 번호가 있는 승인된 휴가 신청(문서 하위 탭용). 조직 격리.
 * 복원력: `document_number` 컬럼이 아직 마이그레이션되지 않았으면 []를 돌려준다.
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

/** 휴가 신청 하나당 한 행(초안 제외 모든 상태), 이력(승인 장부) 하위 탭용. */
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
  processedAt: string; // 결정 시각(도쿄, "YYYY/MM/DD HH:mm"). 대기 중이면 제출 시각.
  submittedAt: string; // 신청일 (Tokyo, "YYYY/MM/DD")
};

/**
 * 전체 승인 장부 — 모든 휴가 신청(초안 제외), 최신순, 누가 처리했는지
 * 와 언제인지 포함. 조직 격리. 복원력: 마이그레이션 이전에 승인된 행은 `document_number` 가 null 일 수 있다.
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
 * 관리자 콘솔에서 (본인 또는 대리) 휴가 신청을 올린다. 승인 대기열에 `requested` 로 들어간다.
 * `targetUserId` 는 세션 조직의 활성 멤버여야 한다(조직 격리). 남의 이름으로 내는
 * 대리 신청은 휴가 승인권자만 할 수 있다(액션 `createAdminLeaveRequestAction` 이 검사, 2026-10-26).
 * 시급직의 유급 · 특별휴가는 모바일과 같이 막는다(`hourly_excluded`).
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
    .select("status, role")
    .eq("organization_id", organizationId)
    .eq("user_id", input.targetUserId)
    .maybeSingle();
  const member = membership.data as { status: string; role: string } | null;
  if (member?.status !== "active") {
    return { ok: false, error: "target_not_found" };
  }
  // 유급 · 특별휴가는 잔여에서 빠지는 종류 — 시급직은 낼 수 없다(모바일 신청과 같은 규칙, 2026-10-26).
  if ((input.leaveType === "paid" || input.leaveType === "special") && isLeaveHourlyRole(member.role)) {
    return { ok: false, error: "hourly_excluded" };
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
