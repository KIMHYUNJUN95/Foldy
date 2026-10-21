export const platformRoles = ["developer_super_admin"] as const;

export const organizationRoles = [
  "owner",
  "senior_managing_director",
  "office_admin",
  "cs_staff",
  "field_manager",
  "staff",
  "part_time_staff",
] as const;

export const roles = [...platformRoles, ...organizationRoles] as const;

export type PlatformRole = (typeof platformRoles)[number];
export type OrganizationRole = (typeof organizationRoles)[number];
export type Role = (typeof roles)[number];

// Admin-web access = everyone except part_time_staff (confirmed 2026-07-13). field_manager/staff can
// reach /admin/* too; sensitive pages (users, settings, payroll) apply their own stricter per-page gate.
export const adminWebRoles = [
  "developer_super_admin",
  "owner",
  "senior_managing_director",
  "office_admin",
  "cs_staff",
  "field_manager",
  "staff",
] as const satisfies readonly Role[];

/**
 * Top org admins — `owner` and `senior_managing_director`(전무) are treated as fully equivalent
 * (every permission). Single source of truth so app-code owner-gates can include 전무 the same way the
 * DB does via `has_org_role` (see migration 202607130003). Platform developers are handled separately.
 */
export function isOrgTopAdmin(role: Role): boolean {
  return role === "owner" || role === "senior_managing_director";
}

/**
 * 조직 최상위 관리자 **또는** 플랫폼 개발자.
 *
 * 세션 역할은 `platformAdmin?.role ?? membership?.role` 순서로 정해진다(`src/lib/session.ts`).
 * 그래서 플랫폼 관리자는 같은 조직의 `owner` 멤버십을 갖고 있어도 세션 role 이
 * `developer_super_admin` 으로 덮여 `isOrgTopAdmin` 에서 탈락한다 — 가장 권한이 높은 계정이
 * 오히려 막히는 상황이 된다(2026-07-31 근태 QR 설정 화면에서 실제로 발생).
 *
 * `isOrgTopAdmin` 은 "조직 상위 관리자"라는 의미를 그대로 유지하고(사용처가 여러 곳이라 의미를
 * 바꾸면 다른 화면 권한까지 함께 움직인다), 플랫폼 개발자까지 허용해야 하는 게이트는 이 헬퍼를 쓴다.
 * 사용자 관리 화면들이 이미 같은 조합을 인라인으로 쓰고 있었다.
 */
export function isOrgTopAdminOrPlatform(role: Role): boolean {
  return role === "developer_super_admin" || isOrgTopAdmin(role);
}

/**
 * 시급제(알바) 역할 — 아르바이트 · 아르바이트 리더(2026-10-21 사용자 「리더는 정직원이 아니라 시급제 알바생」).
 * 급여 · 연차 · 청소 배정처럼 「알바냐 직원이냐」를 가르는 곳은 이것 하나만 쓴다. 권한(무엇을 할 수 있나) 판단에는 쓰지 않는다.
 */
export const hourlyRoles = ["part_time_staff", "staff"] as const satisfies readonly Role[];

export function isHourlyRole(role: string): boolean {
  return (hourlyRoles as readonly string[]).includes(role);
}

export const fieldModeRoles = [
  "field_manager",
  "staff",
  "part_time_staff",
] as const satisfies readonly Role[];

export const fieldOperationRoles = [
  "owner",
  "senior_managing_director",
  ...fieldModeRoles,
] as const satisfies readonly Role[];

// 관리자 웹 진입 · 모드 전환은 권한 키 `admin_web.access` 로 옮겼다(2026-10-21, `hasAdminWebAccess`). `adminWebRoles` 는
// 그 키의 역할 기본값과 같은 목록이고, 공지 대상 필터처럼 「역할 묶음」이 필요한 곳만 쓴다.

/**
 * The surface a role LANDS on by default — separate from what it can *access*. Field roles
 * (field_manager/staff/part_time) default to mobile even though field_manager/staff can also open the
 * admin web; office/dev roles default to admin. Used for default routing / preferred mode, so granting
 * field roles admin access does not change where they land by default.
 */
export function defaultsToAdminSurface(role: Role) {
  return !(fieldModeRoles as readonly Role[]).includes(role);
}

export function canAccessFieldOperations(role: Role) {
  return (fieldOperationRoles as readonly Role[]).includes(role);
}

// 남의 청소 기록 보기(예전 `cleaningRecordViewerRoles` · `canViewOthersCleaning`)는 권한 키 `cleaning.read_all` 로 옮겼다(2026-10-20).

/**
 * All org members may view the attendance roster (who is at work today).
 * Separate from `cleaning.read_all` — roster is not a privileged view.
 */
export const rosterViewerRoles = roles as readonly Role[];

export function canViewRoster(): boolean {
  return true;
}

// 일일 업무일지 생성은 권한 키 `can_generate_report` 로만 판정한다(2026-10-21) — 예전 `profiles.can_generate_report` 표시는
// 마이그레이션에서 개인 부여로 옮겼다.

/**
 * The 5 user-facing invite categories shown during onboarding.
 * Each maps to a single DB organization_role slug.
 * cs_staff is not exposed as a direct invite category (admin-assigned only).
 */
export const INVITE_CATEGORIES = [
  "part_time_staff",
  "office_staff",
  "field_staff",
  "part_time_manager",
  "owner",
] as const;

export type InviteCategory = (typeof INVITE_CATEGORIES)[number];

export const inviteCategoryToRole: Record<InviteCategory, OrganizationRole> = {
  part_time_staff: "part_time_staff",
  office_staff: "office_admin",
  field_staff: "staff",
  part_time_manager: "field_manager",
  owner: "owner",
};

export const roleToInviteCategory: Partial<Record<OrganizationRole, InviteCategory>> = {
  part_time_staff: "part_time_staff",
  office_admin: "office_staff",
  staff: "field_staff",
  field_manager: "part_time_manager",
  owner: "owner",
};

/**
 * Roles an `office_admin` (non-owner) may hand to someone else — via manual role change
 * (`src/app/admin/users/actions.ts`) or invite-code creation (`src/app/admin/settings/actions.ts`).
 * Deliberately excludes `owner` and `office_admin` itself: only `owner`/`developer_super_admin` may
 * grant office_admin-or-above access, in either flow. Single source of truth so the two enforcement
 * points can't drift apart.
 */
export const officeAdminAssignableRoles = [
  "cs_staff",
  "field_manager",
  "staff",
  "part_time_staff",
] as const satisfies readonly OrganizationRole[];
