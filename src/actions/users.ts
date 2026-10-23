"use server";

import { revalidatePath } from "next/cache";
import type { OrganizationRole, Role } from "@/config/roles";
import { isOrgTopAdmin, officeAdminAssignableRoles, organizationRoles } from "@/config/roles";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  grantMemberOverride,
  revokeAllMemberOverrides,
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

const membershipStatuses = ["active", "invited", "removed", "suspended"] as const satisfies readonly MembershipStatus[];

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

/** Is the actor an active owner/전무 of THIS org? (The session role may come from another org.) */
async function isTopAdminInOrg(actorUserId: string, actorRole: Role, organizationId: string) {
  if (!isOrgTopAdmin(actorRole)) return false;
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

/** Top org admin (owner/전무, of the target org) or platform admin. Gates payroll / approver / overrides. */
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

/** The user's memberships in OTHER orgs — `activeOnly` for the auth-ban decision, any status for delete. */
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

/** Resolves the acting user + target membership + revalidates, shared by every action. */
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

export async function setMemberRole(membershipId: string, role: string): Promise<ActionResult> {
  const ctx = await resolveActor(membershipId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!(organizationRoles as readonly string[]).includes(role)) return { ok: false, error: "invalid_member" };
  if (ctx.membership.user_id === ctx.actorUserId) return { ok: false, error: "self_update_blocked" };
  if (!(await actorCanManageUsersInOrg(ctx.actorUserId, ctx.actorRole, ctx.membership.organization_id))) {
    return { ok: false, error: "forbidden" };
  }
  const actorIsTopOrDeveloper =
    isDeveloper(ctx.actorRole) ||
    (await isTopAdminInOrg(ctx.actorUserId, ctx.actorRole, ctx.membership.organization_id));
  if (!canAssignRole(actorIsTopOrDeveloper, role as OrganizationRole)) return { ok: false, error: "forbidden" };
  const blocked = (await guardProtectedTarget(ctx)) ?? (await guardLastOwner(ctx.membership, { role }));
  if (blocked) return { ok: false, error: blocked };
  const roleChanged = ctx.membership.role !== role;
  // 역할이 바뀌면 그 역할의 기본 권한만 남긴다(2026-10-21 사용자 「역할에 맞는 기본기능만, 그 이외는 대표 · 전무 · 개발자만」) —
  // 급여 담당 · 연차 결재자 · 개인 부여/차단은 예전 역할 때 받은 것이라 새 역할에 조용히 따라가면 안 된다.
  const { error } = await getSupabaseServiceClient()
    .from("memberships")
    .update(
      roleChanged
        ? { role: role as OrganizationRole, attendance_payroll_admin: false, leave_approver_role: null }
        : { role: role as OrganizationRole },
    )
    .eq("id", membershipId);
  if (error) return { ok: false, error: "save_failed" };
  const audit = { organizationId: ctx.membership.organization_id, actorUserId: ctx.actorUserId, targetId: membershipId };
  await logUserAudit({ ...audit, action: "member.role", metadata: { from: ctx.membership.role, to: role } });
  if (roleChanged) {
    const revoked = await revokeAllMemberOverrides({
      organizationId: ctx.membership.organization_id,
      userId: ctx.membership.user_id,
      revokedByUserId: ctx.actorUserId,
    });
    if (revoked.ok && revoked.revoked.length > 0) {
      await logUserAudit({ ...audit, action: "member.permissions_auto_revoke", metadata: { keys: revoked.revoked.map((row) => row.key) } });
    }
  }
  revalidateMember(membershipId);
  return { ok: true };
}

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
  const { error } = await service
    .from("memberships")
    .update({ status: status as MembershipStatus })
    .eq("id", membershipId);
  if (error) return { ok: false, error: "save_failed" };

  // The auth login is shared across orgs — ban it only when no org has an active membership left
  // (`authBanAction`). Self-status is already blocked above, so an actor can't ban themselves.
  const ban = authBanAction(status, otherActive);
  if (ban !== "keep") {
    const { error: banError } = await service.auth.admin.updateUserById(ctx.membership.user_id, {
      ban_duration: ban === "unban" ? "none" : "876000h",
    });
    if (banError) return { ok: false, error: "save_failed" };
  }

  // 비활성 · 정지면 이 조직의 개인 부여 · 차단을 전부 회수한다(권한 정리 ④ B) — 다시 활성으로 돌려도 예전 권한이 조용히 살아나지 않게.
  const audit = { organizationId: ctx.membership.organization_id, actorUserId: ctx.actorUserId, targetId: membershipId };
  await logUserAudit({ ...audit, action: "member.status", metadata: { from: ctx.membership.status, to: status } });
  if (status !== "active") {
    const revoked = await revokeAllMemberOverrides({
      organizationId: ctx.membership.organization_id,
      userId: ctx.membership.user_id,
      revokedByUserId: ctx.actorUserId,
    });
    if (revoked.ok && revoked.revoked.length > 0) {
      await logUserAudit({ ...audit, action: "member.permissions_auto_revoke", metadata: { keys: revoked.revoked.map((row) => row.key) } });
    }
  }
  revalidateMember(membershipId);
  return { ok: true };
}

/**
 * Assign a member to a team (현장/사무실 소속, or a sub-team). `teamId` null clears it (미지정). Same
 * gate as role/status (`manage_users`/top admin). The team must belong to the member's org. Takes a
 * team id (not just a kind) so it already supports sub-teams once team CRUD lands.
 */
export async function setMemberTeam(membershipId: string, teamId: string | null): Promise<ActionResult> {
  const ctx = await resolveActor(membershipId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!(await actorCanManageUsersInOrg(ctx.actorUserId, ctx.actorRole, ctx.membership.organization_id))) {
    return { ok: false, error: "forbidden" };
  }
  const blocked = await guardProtectedTarget(ctx);
  if (blocked) return { ok: false, error: blocked };

  const service = getSupabaseServiceClient();
  if (teamId) {
    const { data: team } = await service
      .from("teams")
      .select("id, organization_id")
      .eq("id", teamId)
      .maybeSingle();
    if (!team || (team as { organization_id: string }).organization_id !== ctx.membership.organization_id) {
      return { ok: false, error: "invalid_team" };
    }
  }

  const { data: beforeRow } = await service.from("memberships").select("team_id").eq("id", membershipId).maybeSingle();
  const { error } = await service
    .from("memberships")
    .update({ team_id: teamId })
    .eq("id", membershipId);
  if (error) return { ok: false, error: "save_failed" };
  await logUserAudit({
    organizationId: ctx.membership.organization_id,
    actorUserId: ctx.actorUserId,
    action: "member.team",
    targetId: membershipId,
    metadata: { from: (beforeRow as { team_id: string | null } | null)?.team_id ?? null, to: teamId },
  });
  revalidateMember(membershipId);
  return { ok: true };
}

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
    const { data } = await service
      .from("membership_permission_overrides")
      .select("permission_key")
      .eq("id", input.overrideId)
      .eq("organization_id", ctx.membership.organization_id)
      .maybeSingle();
    const key = (data as { permission_key: string } | null)?.permission_key;
    revokedKey = key ?? null;
    if (key && isCapability(key) && capabilityPolicy(key).developerOnly && !isDeveloper(ctx.actorRole)) {
      return { ok: false, error: "forbidden" };
    }
  }
  const result = await revokeMemberOverride({
    overrideId: input.overrideId,
    organizationId: ctx.membership.organization_id,
    revokedByUserId: ctx.actorUserId,
  });
  if (!result.ok) return { ok: false, error: result.error };
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
 * Grant/revoke platform developer (`developer_super_admin`) status for a member's user. Developer-only
 * — the highest privilege, never exposed as an org-role dropdown option. Can't revoke your own
 * developer status (lockout guard). Writes `platform_admins`.
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
 * Guarded hard delete of a member (2026-07-13 model rework). Deactivation is the default; hard delete
 * is only for erroneous / never-active accounts. BLOCKS deletion when the user has any operational or
 * financial history (attendance / cleaning / annual-leave) — deleting would cascade-destroy those
 * records. When allowed, removes this org's membership — plus profile + auth login only when the user has
 * no membership in any other org. Developer / manage_users gated; protected targets (owner/전무 ·
 * developer) and the last active owner are guarded; can't delete yourself.
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

  // Activity guard (broad): any attendance / cleaning / leave history → block hard delete, keep the
  // records intact. Deactivate such members instead.
  const [att, clean, leave] = await Promise.all([
    service.from("attendance_sessions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    service.from("cleaning_sessions").select("id", { count: "exact", head: true }).eq("staff_user_id", userId),
    service.from("annual_leave_requests").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if ((att.count ?? 0) > 0 || (clean.count ?? 0) > 0 || (leave.count ?? 0) > 0) {
    return { ok: false, error: "has_activity" };
  }
  // 신분 서류(재류카드 · 마이넘버 카드 앞면)가 있으면 완전 삭제 대신 정지 — 퇴사 후 3년 보관 규칙(docs/product/41 §6, 2026-10-23 사용자).
  // 완전 삭제하면 프로필과 함께 서류 행이 바로 지워지고 사진만 저장소에 남았다. 정지하면 떠난 시각이 남아 3년 뒤 자동 정리된다.
  const { count: idDocs } = await service
    .from("staff_id_documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.membership.organization_id)
    .eq("user_id", userId);
  if ((idDocs ?? 0) > 0) return { ok: false, error: "has_id_documents" };

  // Profile + auth login are shared across orgs: if the user belongs to any other org (any status),
  // remove only THIS org's membership. Otherwise remove the whole account explicitly (membership →
  // profile → auth login) so cleanup doesn't depend on a particular FK cascade config.
  // 삭제 전에 이 조직의 개인 부여 · 차단을 회수하고(멤버십만 지우면 행이 남는다) 기록을 남긴다 — 멤버십이 사라져 화면에선 안 보이지만
  // audit_logs 에는 남는다(권한 정리 ④).
  await revokeAllMemberOverrides({
    organizationId: ctx.membership.organization_id,
    userId,
    revokedByUserId: ctx.actorUserId,
  });
  await logUserAudit({
    organizationId: ctx.membership.organization_id,
    actorUserId: ctx.actorUserId,
    action: "member.delete",
    targetId: membershipId,
    metadata: { user_id: userId, role: ctx.membership.role },
  });
  const otherOrgs = await countOtherOrgMemberships(ctx.membership, false);
  if (otherOrgs === null) return { ok: false, error: "delete_failed" };
  const { error: membershipError } = await service.from("memberships").delete().eq("id", membershipId);
  if (membershipError) return { ok: false, error: "delete_failed" };
  if (deleteScope(otherOrgs) === "membership") {
    revalidatePath(LIST_PATH);
    revalidatePath(MOBILE_LIST_PATH);
    return { ok: true };
  }
  await service.from("profiles").delete().eq("id", userId);
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: "delete_failed" };

  revalidatePath(LIST_PATH);
  revalidatePath(MOBILE_LIST_PATH);
  return { ok: true };
}
