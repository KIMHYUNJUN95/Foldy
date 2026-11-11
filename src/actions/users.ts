"use server";

import { revalidatePath } from "next/cache";
import type { OrganizationRole, Role } from "@/config/roles";
import { officeAdminAssignableRoles, organizationRoles } from "@/config/roles";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  grantMemberOverride,
  revokeMemberOverride,
  type MemberOverride,
} from "@/lib/permission-overrides-server";
import {
  capabilityPolicy,
  isCapability,
  type CapabilityEffect,
} from "@/config/capabilities";
import { actorCanManageUsersInOrg, isDeveloper } from "@/lib/user-management-access";
import {
  authBanAction,
  canChangeTarget,
  deleteScope,
  removesLastOwner,
  targetLock,
} from "@/lib/user-management-guard";
import { logUserAudit } from "@/lib/user-audit";
import type { Database } from "@/types/database";

type MembershipRow = Database["public"]["Tables"]["memberships"]["Row"];
type MembershipStatus = Database["public"]["Enums"]["membership_status"];

type ActionResult = { ok: boolean; error?: string };

// 'invited' 는 수동으로 고를 수 없다(2026-11-11) — 활성이 아닌 상태라 로그인 잠금이 걸리는데, 잠긴 사람은 초대 코드 가입(활성화)
// 화면에 들어올 수 없어 관리자가 다시 「활성」으로 바꾸기 전까지 영영 잠긴다. 화면도 활성 · 정지만 고른다.
const membershipStatuses = ["active", "removed", "suspended"] as const satisfies readonly MembershipStatus[];

/** DB 마지막 대표 막기 트리거(202611110003 `enforce_last_active_owner`)가 내는 오류 — 앱 확인과 같은 키로 돌려준다. */
function isLastOwnerDbError(error: { message?: string } | null | undefined): boolean {
  return Boolean(error?.message && error.message.includes("last_owner"));
}

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function getCurrentRole(userId: string): Promise<Role | null> {
  const service = getSupabaseServiceClient();
  const { data: platformAdminResult } = await service
    .from("platform_admins")
    .select("role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  const platformAdmin = platformAdminResult as { role: Role } | null;
  if (platformAdmin) return platformAdmin.role;

  const { data: membershipResult } = await service
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return (membershipResult as { role: Role } | null)?.role ?? null;
}

type TargetMembership = Pick<MembershipRow, "id" | "organization_id" | "user_id" | "role" | "status">;

async function getMembership(membershipId: string): Promise<TargetMembership | null> {
  const { data } = await getSupabaseServiceClient()
    .from("memberships")
    .select("id, organization_id, user_id, role, status")
    .eq("id", membershipId)
    .maybeSingle();
  return (data as TargetMembership | null) ?? null;
}

/**
 * 이 조직의 활성 owner/전무인가? **그 조직의 멤버십 역할만** 본다(2026-11-11) — 세션 · 첫 멤버십 역할(`actorRole`)은 다른
 * 조직 것일 수 있다. 전에는 첫 멤버십이 staff 면 대상 조직에서 대표여도 「대표 아님」으로 막혔다.
 */
async function isTopAdminInOrg(actorUserId: string, _actorRole: Role, organizationId: string) {
  const { data } = await getSupabaseServiceClient()
    .from("memberships")
    .select("id")
    .eq("user_id", actorUserId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", ["owner", "senior_managing_director"])
    .maybeSingle();
  return Boolean(data);
}

/** 대상 조직의 최상위 관리자(owner/전무) 또는 플랫폼 관리자. 급여 · 승인권자 · 예외 처리를 막는 관문. */
async function canManagePermissions(actorUserId: string, actorRole: Role, membership: TargetMembership) {
  if (isDeveloper(actorRole)) return true;
  return isTopAdminInOrg(actorUserId, actorRole, membership.organization_id);
}

function canAssignRole(actorIsTopOrDeveloper: boolean, nextRole: OrganizationRole) {
  if (actorIsTopOrDeveloper) return true;
  return (officeAdminAssignableRoles as readonly OrganizationRole[]).includes(nextRole);
}

type ResolvedActor = { actorUserId: string; actorRole: Role; membership: TargetMembership };

/**
 * 보호 대상(대표급 · 개발자) 변경 게이트 — 사용자 콘솔의 모든 변경 액션이 부른다. `user.manage` 위임만으로는
 * 대표급 · 개발자 계정을 바꿀 수 없다(판정: `canChangeTarget`).
 */
async function guardProtectedTarget(ctx: ResolvedActor): Promise<"protected_member" | null> {
  const { data } = await getSupabaseServiceClient()
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", ctx.membership.user_id)
    .eq("is_active", true)
    .maybeSingle();
  const lock = targetLock({ role: ctx.membership.role, isDeveloper: Boolean(data) });
  if (!lock) return null;
  const actor = {
    isDeveloper: isDeveloper(ctx.actorRole),
    topAdminInOrg: await isTopAdminInOrg(ctx.actorUserId, ctx.actorRole, ctx.membership.organization_id),
  };
  return canChangeTarget(actor, lock) ? null : "protected_member";
}

async function countActiveOwners(organizationId: string): Promise<number> {
  const { count } = await getSupabaseServiceClient()
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .eq("status", "active");
  return count ?? 0;
}

async function guardLastOwner(
  membership: TargetMembership,
  change: { role?: string; status?: string; delete?: boolean },
): Promise<"last_owner" | null> {
  if (membership.role !== "owner" || membership.status !== "active") return null;
  const activeOwnerCount = await countActiveOwners(membership.organization_id);
  return removesLastOwner({ target: membership, change, activeOwnerCount }) ? "last_owner" : null;
}

/** 다른 조직에서의 이 사용자의 멤버십 — 인증 차단 판단에는 `activeOnly`, 삭제에는 모든 상태. */
async function countOtherOrgMemberships(membership: TargetMembership, activeOnly: boolean): Promise<number | null> {
  let query = getSupabaseServiceClient()
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", membership.user_id)
    .neq("organization_id", membership.organization_id);
  if (activeOnly) query = query.eq("status", "active");
  const { count, error } = await query;
  if (error) return null;
  return count ?? 0;
}

const LIST_PATH = "/admin/users";

/** 행위자 + 대상 멤버십을 확인하고 재검증한다. 모든 액션이 공유한다. */
async function resolveActor(
  membershipId: string,
): Promise<ResolvedActor | { error: "unauthenticated" | "forbidden" | "invalid_member" }> {
  const actorUserId = await getCurrentUserId();
  if (!actorUserId) return { error: "unauthenticated" as const };
  const actorRole = await getCurrentRole(actorUserId);
  if (!actorRole) return { error: "forbidden" as const };
  const membership = await getMembership(membershipId);
  if (!membership) return { error: "invalid_member" as const };
  return { actorUserId, actorRole, membership };
}

/** 모바일 사용자 관리(2026-10-20)도 같은 액션을 쓴다 — 두 화면을 같이 새로 그린다. */
const MOBILE_LIST_PATH = "/mobile/users";

function revalidateMember(membershipId: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${membershipId}`);
  revalidatePath(MOBILE_LIST_PATH);
  revalidatePath(`${MOBILE_LIST_PATH}/${membershipId}`);
}

// 202611110003 의 한 거래 함수들. database.ts 에 Relationships 가 없어 service.rpc() 에 타입이 붙지 않는다 — 필요한 만큼만 준다.
type MembershipTxResult = { result: "ok" | "stale" | "not_found" | "last_owner"; revoked?: string[]; profile_deleted?: boolean };
type MembershipRpcClient = {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: MembershipTxResult | null; error: { message: string } | null }>;
};

/**
 * 멤버십 변경 + 이 조직의 개인 부여 · 차단 회수를 **한 거래로** 한다(`apply_membership_change`, 2026-11-11).
 * 앱에서 둘을 따로 쓰면 회수 뒤 다음 단계(저장 · 경합 · 마지막 대표)가 실패할 때 그 사람은 활성인데 차단(deny)만 사라져 역할
 * 기본 권한이 다시 열렸다. 거래 안에서 멤버십 줄을 잠그고 읽은 역할(`expectedRole`)과 같은지 본다 — 다르면 `stale`.
 */
async function applyMembershipChange(input: {
  membershipId: string;
  actorUserId: string;
  expectedRole: string;
  role?: OrganizationRole;
  status?: MembershipStatus;
}): Promise<{ ok: true; revoked: string[] } | { ok: false; error: "stale" | "last_owner" | "invalid_member" | "save_failed" }> {
  const { data, error } = await (getSupabaseServiceClient() as unknown as MembershipRpcClient).rpc("apply_membership_change", {
    p_membership_id: input.membershipId,
    p_actor_user_id: input.actorUserId,
    p_expected_role: input.expectedRole,
    p_role: input.role ?? null,
    p_status: input.status ?? null,
  });
  if (error || !data) {
    if (error) console.error("[users] apply_membership_change failed", error.message);
    return { ok: false, error: isLastOwnerDbError(error) ? "last_owner" : "save_failed" };
  }
  if (data.result === "ok") return { ok: true, revoked: data.revoked ?? [] };
  if (data.result === "not_found") return { ok: false, error: "invalid_member" };
  return { ok: false, error: data.result === "stale" || data.result === "last_owner" ? data.result : "save_failed" };
}

/**
 * 역할 바꾸기. `expectedRole` 을 주면 지금 역할이 그것일 때만 바꾼다 — 두 관리자가 같은 사람을 동시에 고칠 때 나중 것이 먼저 것을
 * 조용히 덮지 않게(2026-11-11). 다르면 `stale`. 거래 안에서도 「읽은 역할 그대로일 때만」 바꿔 읽기 ~ 쓰기 사이 경합도 `stale`.
 */
export async function setMemberRole(membershipId: string, role: string, expectedRole?: string): Promise<ActionResult> {
  const ctx = await resolveActor(membershipId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!(organizationRoles as readonly string[]).includes(role)) return { ok: false, error: "invalid_member" };
  if (ctx.membership.user_id === ctx.actorUserId) return { ok: false, error: "self_update_blocked" };
  if (!(await actorCanManageUsersInOrg(ctx.actorUserId, ctx.actorRole, ctx.membership.organization_id))) {
    return { ok: false, error: "forbidden" };
  }
  if (expectedRole !== undefined && expectedRole !== ctx.membership.role) return { ok: false, error: "stale" };
  const actorIsTopOrDeveloper =
    isDeveloper(ctx.actorRole) ||
    (await isTopAdminInOrg(ctx.actorUserId, ctx.actorRole, ctx.membership.organization_id));
  if (!canAssignRole(actorIsTopOrDeveloper, role as OrganizationRole)) return { ok: false, error: "forbidden" };
  const blocked = (await guardProtectedTarget(ctx)) ?? (await guardLastOwner(ctx.membership, { role }));
  if (blocked) return { ok: false, error: blocked };
  // 역할이 바뀌면 그 역할의 기본 권한만 남긴다(2026-10-21 사용자 「역할에 맞는 기본기능만, 그 이외는 대표 · 전무 · 개발자만」) —
  // 급여 담당 · 연차 결재자 · 개인 부여/차단은 예전 역할 때 받은 것이라 새 역할에 조용히 따라가면 안 된다. 역할 저장 · 두 표시 끄기 ·
  // 회수가 한 거래다(applyMembershipChange).
  const changed = await applyMembershipChange({
    membershipId,
    actorUserId: ctx.actorUserId,
    expectedRole: ctx.membership.role,
    role: role as OrganizationRole,
  });
  if (!changed.ok) return { ok: false, error: changed.error };
  const audit = { organizationId: ctx.membership.organization_id, actorUserId: ctx.actorUserId, targetId: membershipId };
  await logUserAudit({ ...audit, action: "member.role", metadata: { from: ctx.membership.role, to: role } });
  if (changed.revoked.length > 0) {
    await logUserAudit({ ...audit, action: "member.permissions_auto_revoke", metadata: { keys: changed.revoked } });
  }
  revalidateMember(membershipId);
  return { ok: true };
}

/**
 * 상태 바꾸기. 순서(2026-11-11) — **어떤 실패에서도 「활성인데 차단(deny)이 사라진」 상태가 남지 않게**:
 * - 정지 · 제외: ① DB 거래(상태 + 개인 부여 · 차단 회수, `apply_membership_change`) → ② 로그인 잠금. ① 이 실패하면 아무것도 바뀌지
 *   않는다. ② 가 실패하면 `save_failed` 를 돌려주지만 DB 는 「정지 + 회수」로 맞게 남는다 — 로그인은 되더라도 세션 문
 *   (`getCurrentAppSession` 은 활성 멤버십이 없으면 세션 없음, 온보딩은 `suspended` 화면)이 막는다. 다시 누르면 잠금만 다시 한다.
 * - 활성화: ① 로그인 잠금 풀기 → ② DB 거래(회수 없음). ② 가 실패하면 잠금을 되돌린다. 풀린 채 남아도 정지 멤버라 세션 문이 막는다.
 * 인증 로그인은 조직끼리 공유된다 — 바뀐 뒤 어느 조직에도 활성 멤버십이 없을 때만 잠근다(`authBanAction`). 본인 상태 변경은 위에서
 * 막혀 있어 행위자가 자기 자신을 잠글 수 없다.
 */
export async function setMemberStatus(membershipId: string, status: string): Promise<ActionResult> {
  const ctx = await resolveActor(membershipId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!(membershipStatuses as readonly string[]).includes(status)) return { ok: false, error: "invalid_member" };
  if (ctx.membership.user_id === ctx.actorUserId) return { ok: false, error: "self_update_blocked" };
  if (!(await actorCanManageUsersInOrg(ctx.actorUserId, ctx.actorRole, ctx.membership.organization_id))) {
    return { ok: false, error: "forbidden" };
  }
  const blocked = (await guardProtectedTarget(ctx)) ?? (await guardLastOwner(ctx.membership, { status }));
  if (blocked) return { ok: false, error: blocked };
  const otherActive = await countOtherOrgMemberships(ctx.membership, true);
  if (otherActive === null) return { ok: false, error: "save_failed" };

  const service = getSupabaseServiceClient();
  const audit = { organizationId: ctx.membership.organization_id, actorUserId: ctx.actorUserId, targetId: membershipId };
  const ban = authBanAction(status, otherActive);
  const setBan = async (locked: boolean) =>
    (await service.auth.admin.updateUserById(ctx.membership.user_id, { ban_duration: locked ? "876000h" : "none" })).error;
  const tx = () =>
    applyMembershipChange({
      membershipId,
      actorUserId: ctx.actorUserId,
      expectedRole: ctx.membership.role,
      status: status as MembershipStatus,
    });
  const logged = async (revoked: string[]) => {
    await logUserAudit({ ...audit, action: "member.status", metadata: { from: ctx.membership.status, to: status } });
    if (revoked.length > 0) {
      await logUserAudit({ ...audit, action: "member.permissions_auto_revoke", metadata: { keys: revoked } });
    }
    revalidateMember(membershipId);
  };

  if (status === "active") {
    if (ban === "unban") {
      const banError = await setBan(false);
      if (banError) return { ok: false, error: "save_failed" };
    }
    const changed = await tx();
    if (!changed.ok) {
      // 바꾸기 전에 잠겨 있던 사람만 다시 잠근다.
      if (ban === "unban" && authBanAction(ctx.membership.status, otherActive) === "ban") {
        const revertError = await setBan(true);
        if (revertError) console.error("[users] ban revert failed after status save error", revertError);
      }
      return { ok: false, error: changed.error };
    }
    await logged(changed.revoked);
    return { ok: true };
  }

  const changed = await tx();
  if (!changed.ok) return { ok: false, error: changed.error };
  await logged(changed.revoked);
  if (ban === "ban") {
    const banError = await setBan(true);
    if (banError) {
      console.error("[users] login lock failed after status change — membership is already inactive", banError);
      return { ok: false, error: "save_failed" };
    }
  }
  return { ok: true };
}

// 소속 팀 바꾸기(`setMemberTeam`)는 2026-10-28 지웠다 — 소속(현장 · 사무실)은 역할로 이미 정해져 화면에서 뺐다.
// `memberships.team_id` 값과 지난 이력(`member.team`)은 그대로 남는다.

// 급여 담당 · 연차 결재자 · 일일 보고서 표시 토글은 권한 키(`payroll.*` · `attendance.manage` · `leave.approve` ·
// `can_generate_report`)로 옮겨 지웠다(2026-10-21) — 개인 부여 · 차단(grantPermissionOverrideAction)으로 켜고 끈다.

export async function grantPermissionOverrideAction(input: {
  membershipId: string;
  permissionKey: string;
  /** 생략하면 부여. 차단은 명시해야 한다. */
  effect?: CapabilityEffect;
  /** 비우면 무기한 — 키가 기한을 요구하면 서버가 거부한다. */
  expiresAt?: string | null;
  reason: string;
}): Promise<{ ok: boolean; error?: string; override?: MemberOverride }> {
  const ctx = await resolveActor(input.membershipId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!(await canManagePermissions(ctx.actorUserId, ctx.actorRole, ctx.membership))) {
    return { ok: false, error: "forbidden" };
  }
  const blocked = await guardProtectedTarget(ctx);
  if (blocked) return { ok: false, error: blocked };
  if (ctx.membership.user_id === ctx.actorUserId) return { ok: false, error: "self_grant_blocked" };
  // 개발자만 줄 수 있는 키가 있다 — 사용자 관리 위임이 그렇다. 위임받은 사람이 다시 위임하면
  // 권한이 무한히 번진다(2026-07-13 결정). 화면도 그 키를 숨기지만, 막는 것은 여기다.
  if (
    isCapability(input.permissionKey) &&
    capabilityPolicy(input.permissionKey).developerOnly &&
    !isDeveloper(ctx.actorRole)
  ) {
    return { ok: false, error: "forbidden" };
  }
  const result = await grantMemberOverride({
    organizationId: ctx.membership.organization_id,
    userId: ctx.membership.user_id,
    permissionKey: input.permissionKey,
    effect: input.effect === "deny" ? "deny" : "grant",
    grantedByUserId: ctx.actorUserId,
    reason: input.reason,
    expiresAt: input.expiresAt ?? null,
    // 차단 면역 판정에 대상자의 역할이 필요하다(owner·전무는 잠글 수 없다).
    targetRole: ctx.membership.role as Role,
    // 대표 · 전무 · 개발자는 키 정책과 무관하게 켜고 끈다(2026-10-21). 이 액션은 이미 canManagePermissions(같은 셋)로 막혀 있다.
    actorBypassesKeyPolicy: true,
  });
  if (!result.ok) return { ok: false, error: result.error };
  await logUserAudit({
    organizationId: ctx.membership.organization_id,
    actorUserId: ctx.actorUserId,
    action: "member.permission_grant",
    targetId: input.membershipId,
    metadata: { key: input.permissionKey, effect: input.effect === "deny" ? "deny" : "grant", expires: input.expiresAt ?? null },
  });
  revalidateMember(input.membershipId);
  return { ok: true, override: result.override };
}

export async function revokePermissionOverrideAction(input: {
  membershipId: string;
  overrideId: string;
}): Promise<ActionResult> {
  const ctx = await resolveActor(input.membershipId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!(await canManagePermissions(ctx.actorUserId, ctx.actorRole, ctx.membership))) {
    return { ok: false, error: "forbidden" };
  }
  const blocked = await guardProtectedTarget(ctx);
  if (blocked) return { ok: false, error: blocked };
  let revokedKey: string | null = null;
  // 줄 수 있는 사람만 뺄 수 있다. 부여만 개발자 전용으로 막고 회수를 열어 두면, 대표가 개발자의
  // 위임을 되돌린 뒤 자기가 다시 줄 수는 없는 어긋난 상태가 된다.
  {
    const service = getSupabaseServiceClient();
    // 그 사람(대상 멤버십의 사용자)의 지정인지 확인한다(2026-11-11) — 전에는 조직만 봐서, A 의 화면에서 B 의 지정 id 로 회수 ·
    // 기록이 됐다(기록은 A 앞으로 남았다).
    const { data } = await service
      .from("membership_permission_overrides")
      .select("permission_key")
      .eq("id", input.overrideId)
      .eq("organization_id", ctx.membership.organization_id)
      .eq("user_id", ctx.membership.user_id)
      .is("revoked_at", null)
      .maybeSingle();
    const key = (data as { permission_key: string } | null)?.permission_key;
    if (!key) return { ok: false, error: "invalid_override" };
    revokedKey = key;
    if (isCapability(key) && capabilityPolicy(key).developerOnly && !isDeveloper(ctx.actorRole)) {
      return { ok: false, error: "forbidden" };
    }
  }
  const result = await revokeMemberOverride({
    overrideId: input.overrideId,
    organizationId: ctx.membership.organization_id,
    userId: ctx.membership.user_id,
    revokedByUserId: ctx.actorUserId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  // 그 사이 다른 사람이 먼저 회수했으면 바뀐 줄이 없다 — 기록을 남기지 않는다.
  if (!result.changed) return { ok: false, error: "invalid_override" };
  await logUserAudit({
    organizationId: ctx.membership.organization_id,
    actorUserId: ctx.actorUserId,
    action: "member.permission_revoke",
    targetId: input.membershipId,
    metadata: { key: revokedKey },
  });
  revalidateMember(input.membershipId);
  return { ok: true };
}

/**
 * 멤버 사용자의 플랫폼 개발자(`developer_super_admin`) 권한을 부여/회수한다. 개발자 전용
 * — 가장 높은 권한이라 조직 역할 드롭다운에는 노출하지 않는다. 자기 자신의
 * 개발자 권한은 회수할 수 없다(잠금 방지). `platform_admins` 에 쓴다.
 */
export async function assignDeveloper(membershipId: string, grant: boolean): Promise<ActionResult> {
  const ctx = await resolveActor(membershipId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!isDeveloper(ctx.actorRole)) return { ok: false, error: "forbidden" };
  if (!grant && ctx.membership.user_id === ctx.actorUserId) {
    return { ok: false, error: "cannot_remove_self" };
  }

  const service = getSupabaseServiceClient();
  const { data: existing } = await service
    .from("platform_admins")
    .select("id")
    .eq("user_id", ctx.membership.user_id)
    .maybeSingle();

  if (existing) {
    const { error } = await service
      .from("platform_admins")
      .update({ is_active: grant })
      .eq("user_id", ctx.membership.user_id);
    if (error) return { ok: false, error: "save_failed" };
  } else if (grant) {
    const { error } = await service
      .from("platform_admins")
      .insert({ user_id: ctx.membership.user_id, role: "developer_super_admin", is_active: true });
    if (error) return { ok: false, error: "save_failed" };
  }
  await logUserAudit({
    organizationId: ctx.membership.organization_id,
    actorUserId: ctx.actorUserId,
    action: "member.developer",
    targetId: membershipId,
    metadata: { to: grant },
  });
  revalidateMember(membershipId);
  return { ok: true };
}

/**
 * 멤버 하드 삭제 가드(2026-07-13 모델 개편). 기본은 비활성화이고, 하드 삭제는
 * 잘못 만들었거나 한 번도 활성화되지 않은 계정에만 쓴다. 운영 또는
 * 재무 이력(근태 / 청소 / 연차)이 있으면 삭제를 막는다 — 삭제하면 그 기록이 연쇄 삭제되기 때문이다.
 * 허용되면 이 조직의 멤버십을 지우고, 다른 조직에 멤버십이 전혀 없을 때만 프로필 + 인증 로그인도 지운다.
 * 개발자 / manage_users 권한 필요. 보호 대상(owner/전무 ·
 * 개발자)과 마지막 활성 owner 는 지킨다. 자기 자신은 삭제할 수 없다.
 */
export async function deleteMember(membershipId: string): Promise<ActionResult> {
  const ctx = await resolveActor(membershipId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!(await actorCanManageUsersInOrg(ctx.actorUserId, ctx.actorRole, ctx.membership.organization_id))) {
    return { ok: false, error: "forbidden" };
  }
  if (ctx.membership.user_id === ctx.actorUserId) return { ok: false, error: "cannot_delete_self" };
  const blocked = (await guardProtectedTarget(ctx)) ?? (await guardLastOwner(ctx.membership, { delete: true }));
  if (blocked) return { ok: false, error: blocked };

  const service = getSupabaseServiceClient();
  const userId = ctx.membership.user_id;

  // 활동 가드(넓게): 근태 / 청소 / 휴가 이력이 하나라도 있으면 하드 삭제를 막고 기록을 그대로
  // 둔다. 그런 멤버는 비활성화한다.
  const [att, clean, leave] = await Promise.all([
    service.from("attendance_sessions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    service.from("cleaning_sessions").select("id", { count: "exact", head: true }).eq("staff_user_id", userId),
    service.from("annual_leave_requests").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  // 개수 조회가 실패하면 0 으로 보지 않는다(2026-11-11) — 「이력 없음」으로 흘리면 이력이 있는 사람이 지워지고 기록이 연쇄 삭제된다.
  if (att.error || clean.error || leave.error) return { ok: false, error: "delete_failed" };
  if ((att.count ?? 0) > 0 || (clean.count ?? 0) > 0 || (leave.count ?? 0) > 0) {
    return { ok: false, error: "has_activity" };
  }
  // 신분 서류(재류카드 · 마이넘버 카드 앞면)가 있으면 완전 삭제 대신 정지 — 퇴사 후 3년 보관 규칙(docs/product/41 §6, 2026-10-23 사용자).
  // 완전 삭제하면 프로필과 함께 서류 행이 바로 지워지고 사진만 저장소에 남았다. 정지하면 떠난 시각이 남아 3년 뒤 자동 정리된다.
  const { count: idDocs, error: idDocsError } = await service
    .from("staff_id_documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.membership.organization_id)
    .eq("user_id", userId);
  if (idDocsError) return { ok: false, error: "delete_failed" };
  if ((idDocs ?? 0) > 0) return { ok: false, error: "has_id_documents" };

  // 프로필 + 인증 로그인은 조직끼리 공유된다: 사용자가 다른 조직(어떤 상태든)에 속해 있으면
  // 이 조직의 멤버십만 지운다. 아니면 계정 전체를 지운다.
  const otherOrgs = await countOtherOrgMemberships(ctx.membership, false);
  if (otherOrgs === null) return { ok: false, error: "delete_failed" };
  const wholeAccount = deleteScope(otherOrgs) !== "membership";

  // 순서(2026-11-11): ① DB 거래(개인 부여 · 차단 회수 → 멤버십 삭제 → 계정 전체면 프로필 삭제, `delete_membership_atomic`) →
  // ② 로그인 계정(auth) 삭제. auth 삭제는 거래에 넣을 수 없다. 전에는 auth 를 먼저 지워, 뒤의 멤버십 · 프로필 삭제가 실패하면
  // 로그인 없는 멤버십 · 프로필이 명단에 남았다. 이제 ① 이 실패하면 아무것도 안 지운다. ② 가 실패하면 프로필 · 멤버십 없는 빈 로그인만
  // 남는다 — 그 로그인을 잠가(쓸 수 없게) 두고 성공으로 돌려준다(이 조직에서 할 일은 끝났다). 잠금도 실패하면 로그만 남긴다.
  const { data: tx, error: txError } = await (service as unknown as MembershipRpcClient).rpc("delete_membership_atomic", {
    p_membership_id: membershipId,
    p_actor_user_id: ctx.actorUserId,
    p_delete_profile: wholeAccount,
  });
  if (txError || !tx) {
    if (txError) console.error("[users] delete_membership_atomic failed", txError.message);
    return { ok: false, error: isLastOwnerDbError(txError) ? "last_owner" : "delete_failed" };
  }
  if (tx.result === "last_owner") return { ok: false, error: "last_owner" };
  if (tx.result !== "ok") return { ok: false, error: "delete_failed" };

  if (wholeAccount && tx.profile_deleted) {
    const { error: authError } = await service.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("[users] auth delete failed after membership/profile delete — locking the empty login", authError);
      const { error: banError } = await service.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (banError) console.error("[users] lock of the empty login also failed", banError);
    }
  }
  if ((tx.revoked ?? []).length > 0) {
    await logUserAudit({
      organizationId: ctx.membership.organization_id,
      actorUserId: ctx.actorUserId,
      action: "member.permissions_auto_revoke",
      targetId: membershipId,
      metadata: { keys: tx.revoked ?? [] },
    });
  }
  await logUserAudit({
    organizationId: ctx.membership.organization_id,
    actorUserId: ctx.actorUserId,
    action: "member.delete",
    targetId: membershipId,
    metadata: { user_id: userId, role: ctx.membership.role },
  });

  revalidatePath(LIST_PATH);
  revalidatePath(MOBILE_LIST_PATH);
  return { ok: true };
}
