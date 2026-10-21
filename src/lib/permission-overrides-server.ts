// Permission override data layer — service-role reads/writes for the per-user, time-bound feature
// exceptions granted from /admin/users/[id]. The table has NO write RLS policies (service-role only);
// authorization (owner/developer, org scope, self-grant block) is enforced by the calling server
// action. See migration 202607090002 and docs/product/27-permission-override-workflow.md.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  canBeDenied,
  capabilityPolicy,
  isCapability,
  type Capability,
  type CapabilityEffect,
} from "@/config/capabilities";
import type { Role } from "@/config/roles";

export type MemberOverride = {
  id: string;
  key: string;
  /** 부여(grant) 인지 차단(deny) 인지. 차단이 부여를 이긴다. */
  effect: CapabilityEffect;
  reason: string;
  /** ISO. `null` 이면 무기한(2026-10-20 부터 모든 키에서 고를 수 있다). */
  expires: string | null;
  granted: string; // ISO (created_at)
  by: string; // granter display name ("—" if unknown)
};

type OverrideRow = {
  id: string;
  permission_key: string;
  effect: string;
  reason: string;
  expires_at: string | null;
  created_at: string;
  granted_by_user_id: string | null;
};

/** Active (not revoked, not expired) overrides for one member, newest first, with granter names. */
export async function listMemberOverrides(
  organizationId: string,
  userId: string,
): Promise<MemberOverride[]> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("membership_permission_overrides")
    .select("id, permission_key, effect, reason, expires_at, created_at, granted_by_user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return [];
  // 만료 필터를 SQL 이 아니라 여기서 한다. `gt("expires_at", …)` 는 NULL 행(무기한)을 제외해 버린다 —
  // 무기한을 허용한 뒤로는 그 필터가 곧 「상시 지정은 목록에 안 뜬다」가 된다.
  const now = Date.now();
  const rows = ((data ?? []) as OverrideRow[]).filter(
    (row) => !row.expires_at || new Date(row.expires_at).getTime() > now,
  );

  const granterIds = [...new Set(rows.map((r) => r.granted_by_user_id).filter((v): v is string => !!v))];
  const nameById = new Map<string, string>();
  if (granterIds.length > 0) {
    const { data: profs } = await service.from("profiles").select("id, name").in("id", granterIds);
    for (const p of (profs ?? []) as { id: string; name: string }[]) nameById.set(p.id, p.name);
  }

  return rows.map((r) => ({
    id: r.id,
    key: r.permission_key,
    effect: (r.effect === "deny" ? "deny" : "grant") as CapabilityEffect,
    reason: r.reason,
    expires: r.expires_at,
    granted: r.created_at,
    by: (r.granted_by_user_id && nameById.get(r.granted_by_user_id)) || "—",
  }));
}

/**
 * 이 사용자가 해당 키의 **활성 개인 부여**를 갖고 있는가.
 *
 * RLS 가 아니라 서버 코드로 막는 기능이 쓴다(모바일 업무일지, 발주·수리 상태 변경 등).
 * SQL 쪽 대응은 `has_permission_override()`.
 *
 * **두 가지를 반드시 지킨다(2026-09-10 감사에서 둘 다 깨져 있었다):**
 *
 * 1. `effect = 'grant'` 로 좁힌다. 좁히지 않으면 **차단(deny) 행이 오히려 권한을 준다** —
 *    「빼라」가 「줘라」로 뒤집히는, 가능한 실패 중 가장 나쁜 것이다.
 * 2. 만료 필터를 SQL 이 아니라 여기서 한다. `gt("expires_at", …)` 는 **NULL 행(무기한)을
 *    제외**해 버린다. 무기한 부여를 허용한 뒤로 그 필터는 곧 「상시 지정은 인식되지 않는다」가
 *    된다 — 실제로 사용자 관리 위임(무기한)이 이 때문에 통하지 않고 있었다.
 *
 * 이 함수는 **부여 여부만** 본다. 역할 기본 부여·차단·키별 정책까지 포함한 최종 판정은
 * `resolveCapabilities`(앱) / `has_capability`(SQL) 다.
 */
export async function hasPermissionOverride(
  organizationId: string,
  userId: string,
  key: string,
): Promise<boolean> {
  const service = getSupabaseServiceClient();
  const { data } = await service
    .from("membership_permission_overrides")
    .select("expires_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("permission_key", key)
    .eq("effect", "grant")
    .is("revoked_at", null);
  const now = Date.now();
  return (data ?? []).some(
    (row) => !row.expires_at || new Date(row.expires_at).getTime() > now,
  );
}

/**
 * 개인 부여·차단 한 건을 만든다.
 *
 * 검증은 전부 **레지스트리를 근거로** 한다(`src/config/capabilities.ts`) — 어떤 키가 개인 지정
 * 가능한지, 기한이 필수인지, 차단을 걸 수 있는지가 거기 한 곳에만 적혀 있다. 여기서 규칙을 다시
 * 적으면 그 순간 정의가 두 벌이 된다.
 */
export async function grantMemberOverride(input: {
  organizationId: string;
  userId: string;
  permissionKey: string;
  effect: CapabilityEffect;
  grantedByUserId: string;
  reason: string;
  /** 비우면 무기한. 키가 기한을 요구하면 거부한다. */
  expiresAt: string | null;
  /** 대상자의 역할 — 차단 면역 판정에 쓴다. */
  targetRole: Role;
  /**
   * 거는 사람이 플랫폼 개발자인가. 개발자는 키의 개인 부여 · 차단 허용 여부와 무관하게 무엇이든 켜고 끈다
   * (역할로 받은 기본 기능도 끌 수 있다, 2026-10-21 사용자 결정). 차단 면역 역할 · 시스템 키 · 자기부여 막기는 그대로.
   */
  actorIsDeveloper?: boolean;
}): Promise<{ ok: true; override: MemberOverride } | { ok: false; error: string }> {
  if (!isCapability(input.permissionKey)) return { ok: false, error: "invalid_key" };
  const capability = input.permissionKey as Capability;
  const policy = capabilityPolicy(capability);

  // 관리 화면에 뜨지 않는 키(권한 관리 자체)는 개인 지정 대상이 아니다 — 뺏고 줄 수 있으면
  // 「아무도 권한을 관리할 수 없는」 잠금 상태가 만들어진다.
  if (policy.systemOnly) return { ok: false, error: "not_assignable" };
  if (input.effect === "grant" && !policy.individualGrant && !input.actorIsDeveloper) {
    return { ok: false, error: "grant_not_allowed" };
  }
  if (input.effect === "deny" && !policy.individualDeny && !input.actorIsDeveloper) {
    return { ok: false, error: "deny_not_allowed" };
  }
  // 소유자를 잠그면 되돌릴 사람이 없다.
  if (input.effect === "deny" && !canBeDenied(input.targetRole)) {
    return { ok: false, error: "deny_immune_role" };
  }

  // 사유는 선택이다(2026-09-30 사용자 결정). 컬럼은 `not null` 이라 비우면 빈 문자열로 남는다.
  const reason = input.reason.trim();

  let expiresIso: string | null = null;
  const raw = input.expiresAt?.trim();
  if (raw) {
    const expiresMs = Date.parse(raw);
    if (!Number.isFinite(expiresMs)) return { ok: false, error: "invalid_expiry" };
    if (expiresMs <= Date.now()) return { ok: false, error: "expiry_in_past" };
    expiresIso = new Date(expiresMs).toISOString();
  }
  // 기한을 비우면 무기한이다 — 기한을 묻는 권한도 「무기한」을 고를 수 있다(2026-10-20 사용자 결정,
  // 27-permission-override-workflow.md). DB 는 2026-09-10 부터 NULL 을 허용한다.

  // DB 제약도 자기부여를 막지만, 깔끔한 오류를 위해 먼저 거른다.
  if (input.grantedByUserId === input.userId) return { ok: false, error: "self_grant_blocked" };

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("membership_permission_overrides")
    .insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      permission_key: capability,
      effect: input.effect,
      granted_by_user_id: input.grantedByUserId,
      reason,
      expires_at: expiresIso,
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    // 활성 행 부분 유니크 인덱스 위반 = 같은 방향의 지정이 이미 있다.
    if (error?.code === "23505") return { ok: false, error: "already_assigned" };
    return { ok: false, error: "insert_failed" };
  }
  const row = data as { id: string; created_at: string };

  return {
    ok: true,
    override: {
      id: row.id,
      key: capability,
      effect: input.effect,
      reason,
      expires: expiresIso,
      granted: row.created_at,
      by: "", // filled by the caller from the actor's name
    },
  };
}

/** Soft-revoke: set revoked_at + revoked_by. Org-scoped so an override can't be revoked cross-org. */
export async function revokeMemberOverride(input: {
  overrideId: string;
  organizationId: string;
  revokedByUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("membership_permission_overrides")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: input.revokedByUserId,
    })
    .eq("id", input.overrideId)
    .eq("organization_id", input.organizationId)
    .is("revoked_at", null);
  if (error) return { ok: false, error: "revoke_failed" };
  return { ok: true };
}

/**
 * 한 사람의 이 조직 개인 부여 · 차단을 **전부** 회수한다(2026-10-20 권한 정리 ④ B) — 비활성 · 삭제 때. 다시 활성으로 돌려도 예전 권한이
 * 조용히 살아나지 않게 한다(필요한 것만 다시 켠다). 회수한 키 목록을 돌려준다(변경 기록용).
 */
export async function revokeAllMemberOverrides(input: {
  organizationId: string;
  userId: string;
  revokedByUserId: string;
}): Promise<{ ok: true; revoked: { key: string; effect: string }[] } | { ok: false; error: string }> {
  const { data, error } = await getSupabaseServiceClient()
    .from("membership_permission_overrides")
    .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: input.revokedByUserId })
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .is("revoked_at", null)
    .select("permission_key, effect");
  if (error) return { ok: false, error: "revoke_failed" };
  return {
    ok: true,
    revoked: ((data ?? []) as { permission_key: string; effect: string }[]).map((row) => ({ key: row.permission_key, effect: row.effect })),
  };
}

