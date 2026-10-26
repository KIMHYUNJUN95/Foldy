import "server-only";

import type { OrganizationRole, Role } from "@/config/roles";
import { officeAdminAssignableRoles } from "@/config/roles";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { DEFAULT_INVITE_MAX_USES, buildInviteName, defaultInviteExpiry, generateInviteCode } from "@/lib/invite-code-gen";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isYmd, tokyoToday } from "@/lib/tokyo-date";
import { INVITE_AUDIT_TARGET, logUserAudit } from "@/lib/user-audit";
import { actorCanManageUsersInOrg } from "@/lib/user-management-access";
import type { Database } from "@/types/database";

/**
 * 초대코드 만들기 · 끄기 · 켜기 · 삭제 — **결과를 돌려주는** 서버 공용 본체(2026-10-20).
 *
 * 대시보드(`/admin/settings/actions.ts` 의 폼 액션 — 결과를 주소 쿼리로 바꿔 넘긴다)와 모바일(`/mobile/users/actions.ts`
 * — 결과를 그대로 화면에 돌려준다)이 같은 판정 · 같은 쓰기를 쓰게 여기로 모았다. 권한 판정은 `/admin/users` 와 같다
 * (개발자이거나 그 조직에서 `user.manage` 를 받음). docs/product/17-user-profile-directory.md
 */

// owner 와 cs_staff 는 초대 코드 셀프 생성에서 일부러 뺐다(2026-07-09):
// owner 는 아직 만들지 않은 별도 1회용 흐름이 필요하고, cs_staff 는 초대 분류 자체가 없다
// (관리자 지정 전용, src/config/roles.ts).
export const INVITE_DEFAULT_ROLES = [
  "staff",
  "part_time_staff",
  "office_admin",
  "field_manager",
] as const satisfies readonly OrganizationRole[];

export type InviteActor = { userId: string; role: Role };
export type InviteError = "forbidden" | "invalid_invite" | "duplicate_code" | "save_failed";
export type InviteResult = { ok: true } | { ok: false; error: InviteError };

type InviteInsert = Database["public"]["Tables"]["invite_codes"]["Insert"];

/** 이 사람이 초대코드 기본 역할로 줄 수 있는 역할 — 대표 · 전무 · 개발자는 전부, 그 밖은 오피스 관리자 아래만. */
export function selectableInviteRoles(role: Role): OrganizationRole[] {
  const top = role === "developer_super_admin" || role === "owner" || role === "senior_managing_director";
  return INVITE_DEFAULT_ROLES.filter(
    (candidate) => top || (officeAdminAssignableRoles as readonly OrganizationRole[]).includes(candidate),
  );
}

/**
 * 그 **조직에서** 줄 수 있는 기본 역할 — 서버 판정용(2026-10-26 버그 수정). 세션 역할은 다른 조직 것일 수 있어서
 * (A 조직 대표 · B 조직 오피스 관리자), B 조직 초대에 대표용 역할 목록이 열렸다. 개발자가 아니면 그 조직의 활성 멤버십
 * 역할로 본다(`isTopAdminInOrg` 와 같은 방식).
 */
export async function selectableInviteRolesInOrg(actor: InviteActor, organizationId: string): Promise<OrganizationRole[]> {
  if (actor.role === "developer_super_admin") return selectableInviteRoles(actor.role);
  const { data } = await getSupabaseServiceClient()
    .from("memberships")
    .select("role")
    .eq("user_id", actor.userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();
  const orgRole = (data as { role: OrganizationRole } | null)?.role;
  if (!orgRole) return [];
  return selectableInviteRoles(orgRole);
}

function normalizeInviteCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "-");
}

function dateToExpiry(value: string) {
  return new Date(`${value}T23:59:59.000Z`).toISOString();
}

/** 자동 생성되는 초대코드 이름을 만든 사람의 표시 언어로 쓰기 위한 조회. */
async function getActorLocale(userId: string): Promise<Locale> {
  const { data } = await getSupabaseServiceClient()
    .from("profiles")
    .select("preferred_language")
    .eq("id", userId)
    .maybeSingle();
  const preferred = (data as { preferred_language: string } | null)?.preferred_language;
  return isLocale(preferred) ? preferred : "ko";
}

export async function createInviteCodeAs(
  actor: InviteActor,
  input: { organizationId: string; defaultRole: string; code?: string; name?: string; expiresAt?: string; maxUses?: string | number },
): Promise<InviteResult> {
  const organizationId = input.organizationId;
  const defaultRole = input.defaultRole as OrganizationRole;
  // 이름 / 코드 / 만료일 / 최대 사용 횟수는 비워 보낼 수 있다. 비면 여기서 자동으로 채운다(2026-09-09).
  const rawCode = String(input.code ?? "").trim();
  const rawName = String(input.name ?? "").trim();
  const rawExpiresAt = String(input.expiresAt ?? "").trim();
  const rawMaxUses = String(input.maxUses ?? "").trim();

  if (!organizationId || !(INVITE_DEFAULT_ROLES as readonly OrganizationRole[]).includes(defaultRole)) {
    return { ok: false, error: "invalid_invite" };
  }
  if (!(await actorCanManageUsersInOrg(actor.userId, actor.role, organizationId))) {
    return { ok: false, error: "forbidden" };
  }
  // office_admin 은 초대 코드로 office_admin 이상 권한을 줄 수 없다 — 수동 역할 변경에
  // 이미 적용된 같은 단계 규칙을 따른다(canAssignRole, src/actions/users.ts).
  // 판정은 **그 조직의 멤버십 역할**로(세션 역할 아님).
  if (!(await selectableInviteRolesInOrg(actor, organizationId)).includes(defaultRole)) {
    return { ok: false, error: "invalid_invite" };
  }

  const service = getSupabaseServiceClient();
  const { data: organizationResult } = await service.from("organizations").select("name, slug").eq("id", organizationId).maybeSingle();
  const organization = organizationResult as { name: string; slug: string | null } | null;
  if (!organization) return { ok: false, error: "invalid_invite" };

  const today = tokyoToday();
  const expiresAt = isYmd(rawExpiresAt) ? rawExpiresAt : defaultInviteExpiry(today);
  const parsedMaxUses = Number(rawMaxUses);
  const maxUses = Number.isInteger(parsedMaxUses) && parsedMaxUses >= 1 ? parsedMaxUses : DEFAULT_INVITE_MAX_USES;

  const dictionary = getDictionary(await getActorLocale(actor.userId));
  const name = rawName || buildInviteName(dictionary.admin.settings.inviteAutoName, dictionary.roles[defaultRole], today);

  const codeSource = organization.slug || organization.name;
  const isAutoCode = !rawCode;

  // `invite_codes.code` 는 전역 unique 다. 자동 생성 코드가 부딪히면 조용히 다시 뽑고, 사용자가
  // 직접 넣은 코드가 부딪히면 그 사실을 알려준다 — 말없이 다른 코드로 바꿔치기하면 안 된다.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = isAutoCode ? generateInviteCode(codeSource) : normalizeInviteCode(rawCode);
    const invite: InviteInsert = {
      code,
      created_by_user_id: actor.userId,
      default_role: defaultRole,
      expires_at: dateToExpiry(expiresAt),
      max_uses: maxUses,
      name,
      organization_id: organizationId,
    };
    const { data: created, error } = await service.from("invite_codes").insert(invite).select("id").single();
    if (!error) {
      await logUserAudit({
        organizationId,
        actorUserId: actor.userId,
        action: "invite.create",
        targetType: INVITE_AUDIT_TARGET,
        targetId: (created as { id: string } | null)?.id ?? null,
        metadata: { code, role: defaultRole, expires: expiresAt, max_uses: maxUses },
      });
      return { ok: true };
    }
    if (error.code === "23505") {
      if (isAutoCode) continue;
      return { ok: false, error: "duplicate_code" };
    }
    return { ok: false, error: "save_failed" };
  }
  return { ok: false, error: "save_failed" };
}

export async function setInviteCodeActiveAs(
  actor: InviteActor,
  input: { inviteCodeId: string; organizationId: string; active: boolean },
): Promise<InviteResult> {
  if (!input.inviteCodeId || !input.organizationId) return { ok: false, error: "forbidden" };
  if (!(await actorCanManageUsersInOrg(actor.userId, actor.role, input.organizationId))) {
    return { ok: false, error: "forbidden" };
  }
  // 쓰기를 조직 범위로 제한한다 — 게이트는 호출자가 이 조직의 초대를 관리할 수 있다는 것만 증명할 뿐,
  // 주어진 코드가 이 조직의 것임은 증명하지 않는다. 이게 없으면 초대 관리자가 id 로 다른 조직의 코드를 켜고 끌 수 있다.
  const { error } = await getSupabaseServiceClient()
    .from("invite_codes")
    .update({ is_active: input.active })
    .eq("id", input.inviteCodeId)
    .eq("organization_id", input.organizationId);
  if (error) return { ok: false, error: "save_failed" };
  await logUserAudit({
    organizationId: input.organizationId,
    actorUserId: actor.userId,
    action: "invite.active",
    targetType: INVITE_AUDIT_TARGET,
    targetId: input.inviteCodeId,
    metadata: { to: input.active },
  });
  return { ok: true };
}

export async function deleteInviteCodeAs(
  actor: InviteActor,
  input: { inviteCodeId: string; organizationId: string },
): Promise<InviteResult> {
  if (!input.inviteCodeId || !input.organizationId) return { ok: false, error: "forbidden" };
  if (!(await actorCanManageUsersInOrg(actor.userId, actor.role, input.organizationId))) {
    return { ok: false, error: "forbidden" };
  }
  // 완전 삭제(MVP 삭제 정책). 조직 범위. 이 코드로 이미 가입한 구성원은
  // 멤버십을 그대로 유지하며, 코드 레코드만 지워진다.
  const { error } = await getSupabaseServiceClient()
    .from("invite_codes")
    .delete()
    .eq("id", input.inviteCodeId)
    .eq("organization_id", input.organizationId);
  if (error) return { ok: false, error: "save_failed" };
  await logUserAudit({
    organizationId: input.organizationId,
    actorUserId: actor.userId,
    action: "invite.delete",
    targetType: INVITE_AUDIT_TARGET,
    targetId: input.inviteCodeId,
  });
  return { ok: true };
}

type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];

/**
 * 초대를 만들 수 있는 조직 — 개발자는 전부, 그 밖은 대표 · 전무인 조직(2026-10-20)이나 `user.manage` 를 위임받은 조직. 액션 게이트 `actorCanManageUsersInOrg` 와 같은
 * 판정이라 조직 선택기 · 페이지 접근 · 서버 액션이 서로 어긋나지 않는다.
 */
export async function listManageableOrganizations(userId: string, role: string): Promise<OrganizationRow[]> {
  const service = getSupabaseServiceClient();
  if (role === "developer_super_admin") {
    const { data } = await service.from("organizations").select("id, name, slug, status, created_at, updated_at").order("created_at", { ascending: false });
    return (data ?? []) as OrganizationRow[];
  }
  const { data: membershipData } = await service.from("memberships").select("organization_id").eq("user_id", userId).eq("status", "active");
  const organizationIds: string[] = [];
  for (const membership of (membershipData ?? []) as { organization_id: string }[]) {
    if (await actorCanManageUsersInOrg(userId, role as Role, membership.organization_id)) organizationIds.push(membership.organization_id);
  }
  if (organizationIds.length === 0) return [];
  const { data } = await service
    .from("organizations")
    .select("id, name, slug, status, created_at, updated_at")
    .in("id", organizationIds)
    .order("created_at", { ascending: false });
  return (data ?? []) as OrganizationRow[];
}
