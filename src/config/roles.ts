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

// 관리자 웹 접근 = part_time_staff 를 제외한 모두 (2026-07-13 확정). field_manager/staff 도
// /admin/* 에 들어갈 수 있으며, 민감한 페이지(사용자, 설정, 급여)는 더 엄격한 페이지별 게이트를 따로 적용한다.
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
 * 최상위 조직 관리자 — `owner` 와 `senior_managing_director`(전무)는 완전히 동등하게 취급한다
 * (모든 권한). 앱 코드의 owner 게이트가 전무도 같은 방식으로 포함할 수 있게 하는 단일 출처이며,
 * DB 가 `has_org_role` 로 하는 것과 동일(마이그레이션 202607130003 참고). 플랫폼 개발자는 별도로 처리한다.
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
  return isPlatformDeveloper(role) || isOrgTopAdmin(role);
}

/**
 * 플랫폼 개발자(설계자) 계정인가. 2026-10-23 사용자 「난 개발자이고 … 전부 가능해야해. 난 이거 설계자야」.
 * 작성자 본인만 · 담당자만 · 다른 검토자가 잡은 건 손대지 않기 같은 「주인만」 게이트에서 개발자는 예외로 통과한다.
 * 조직 격리(session.organization)와 자기 계정 잠금 방지 가드(자기 역할 · 상태 · 권한 · 개발자 플래그 · 계정 삭제,
 * 마지막 대표 보호)는 그대로 둔다. 목록: docs/engineering/05-rls-permissions.md 「개발자 예외(2026-10-23)」.
 */
export function isPlatformDeveloper(role: Role | string | null | undefined): boolean {
  return role === "developer_super_admin";
}

/**
 * 「주인(작성자 · 제보자 · 담당자)만」 게이트 — 주인 본인이거나 플랫폼 개발자면 통과.
 * ownerUserId 가 비어 있으면(주인 없음) 개발자만 통과한다.
 */
export function isOwnerOrPlatformDeveloper(
  viewer: { id: string; role: Role | string | null | undefined },
  ownerUserId: string | null | undefined,
): boolean {
  if (isPlatformDeveloper(viewer.role)) return true;
  return !!ownerUserId && ownerUserId === viewer.id;
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
 * 역할이 기본으로 도착하는 화면 — 접근 *가능한* 곳과는 별개다. 현장 역할
 * (field_manager/staff/part_time)은 field_manager/staff 도 관리자 웹을 열 수 있지만
 * 기본은 모바일이고, 사무/개발 역할은 기본이 관리자다. 기본 라우팅 / 선호 모드에 쓰이므로
 * 현장 역할에 관리자 접근을 줘도 기본 도착 화면은 바뀌지 않는다.
 */
export function defaultsToAdminSurface(role: Role) {
  return !(fieldModeRoles as readonly Role[]).includes(role);
}

export function canAccessFieldOperations(role: Role) {
  return (fieldOperationRoles as readonly Role[]).includes(role);
}

// 남의 청소 기록 보기(예전 `cleaningRecordViewerRoles` · `canViewOthersCleaning`)는 권한 키 `cleaning.read_all` 로 옮겼다(2026-10-20).

/**
 * 모든 조직 멤버는 근태 현황(오늘 근무 중인 사람)을 볼 수 있다.
 * `cleaning.read_all` 과는 별개 — 현황은 권한이 필요한 뷰가 아니다.
 */
export const rosterViewerRoles = roles as readonly Role[];

export function canViewRoster(): boolean {
  return true;
}

// 일일 업무일지 생성은 권한 키 `can_generate_report` 로만 판정한다(2026-10-21) — 예전 `profiles.can_generate_report` 표시는
// 마이그레이션에서 개인 부여로 옮겼다.

/**
 * 온보딩에서 보여주는 사용자용 초대 카테고리 5개.
 * 각각 DB organization_role 슬러그 하나에 대응한다.
 * cs_staff 는 초대 카테고리로 직접 노출하지 않는다 (관리자 지정 전용).
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
 * `office_admin`(소유자 제외)이 다른 사람에게 부여할 수 있는 역할 — 수동 역할 변경
 * (`src/actions/users.ts`) 또는 초대 코드 생성(`src/app/admin/settings/actions.ts`)을 통해서.
 * `owner` 와 `office_admin` 자신은 일부러 제외했다: office_admin 이상의 접근은 두 흐름 모두에서
 * `owner`/`developer_super_admin` 만 부여할 수 있다. 두 집행 지점이
 * 어긋나지 않도록 하는 단일 출처.
 */
export const officeAdminAssignableRoles = [
  "cs_staff",
  "field_manager",
  "staff",
  "part_time_staff",
] as const satisfies readonly OrganizationRole[];
