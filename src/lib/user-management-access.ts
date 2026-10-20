// User-management access — the gate for /admin/users, /mobile/users and their server actions.
//
// 접근 = 개발자 + **대표 · 전무(역할 기본, 2026-10-20 사용자 결정)** + `user.manage` 를 개인 부여받은 사람. 판정은 권한 레지스트리
// (`evaluateCapability("user.manage")`) 한 곳 — 2026-07-13 모델은 「개발자가 기본, 개인에게 위임」이었고(위임 수단은 2026-09-10 에
// `memberships.manage_users` 불리언 → 권한 키 개인 부여), 대표가 자기 직원을 관리하려면 개발자가 열어 줘야 했다.
// 위임(개인 부여)은 여전히 개발자만 줄 수 있다(`developerOnly`).
//
// 사이드바도 같은 키로 메뉴를 거른다(세션 capabilities = 같은 레지스트리) — 「권한을 줬는데 메뉴가 안 뜬다」가 생기지 않는다.
// 설계: docs/engineering/14-permission-architecture.md

import { evaluateCapability } from "@/config/capabilities";
import type { Role } from "@/config/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasPermissionOverride } from "@/lib/permission-overrides-server";

export function isDeveloper(role: Role): boolean {
  return role === "developer_super_admin";
}

/** 한 조직 안에서의 판정 — 그 조직의 **멤버십 역할**로 본다(세션 역할은 다른 조직 것일 수 있다). */
async function canManageInOrg(organizationId: string, actorUserId: string, orgRole: Role): Promise<boolean> {
  const granted = await hasPermissionOverride(organizationId, actorUserId, "user.manage");
  return evaluateCapability({ capability: "user.manage", role: orgRole, granted, denied: false });
}

/** May the actor OPEN the user-management screen at all? 개발자이거나, 어느 활성 조직에서든 대표 · 전무이거나 `user.manage` 를 받았다. */
export async function actorCanOpenUserManagement(actorUserId: string, actorRole: Role): Promise<boolean> {
  if (isDeveloper(actorRole)) return true;
  const service = getSupabaseServiceClient();
  const { data: orgs } = await service
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", actorUserId)
    .eq("status", "active");
  for (const row of (orgs ?? []) as { organization_id: string; role: Role }[]) {
    if (await canManageInOrg(row.organization_id, actorUserId, row.role)) return true;
  }
  return false;
}

/** May the actor manage users WITHIN a specific org? 개발자이거나 그 조직의 대표 · 전무이거나 그 조직에서 `user.manage` 를 받았다. */
export async function actorCanManageUsersInOrg(
  actorUserId: string,
  actorRole: Role,
  organizationId: string,
): Promise<boolean> {
  if (isDeveloper(actorRole)) return true;
  const { data } = await getSupabaseServiceClient()
    .from("memberships")
    .select("role")
    .eq("user_id", actorUserId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();
  const orgRole = (data as { role: Role } | null)?.role;
  if (!orgRole) return false;
  return canManageInOrg(organizationId, actorUserId, orgRole);
}
