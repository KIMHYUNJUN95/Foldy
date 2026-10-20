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

export function canAccessAdminWeb(role: Role) {
  return (adminWebRoles as readonly Role[]).includes(role);
}

// Every role except part_time_staff can switch between admin and field modes. (field_manager/staff can
// now reach the admin web, so they must also be able to switch back to field mode.)
export function canSwitchToFieldMode(role: Role) {
  return role !== "part_time_staff";
}

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

/**
 * Whether a user may generate the daily work-report (Todo 완료/기록 tab).
 *
 * Staff-only feature: every regular staff member qualifies (any role except `part_time_staff`),
 * and individual part-timers can be granted access via the per-user `can_generate_report` flag
 * (toggled by owner/office_admin in admin user management). This keeps the few part-timers who work
 * in a management capacity covered without promoting their role.
 */
export function canGenerateDailyReport(role: Role, reportFlag: boolean): boolean {
  return role !== "part_time_staff" || reportFlag;
}

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
