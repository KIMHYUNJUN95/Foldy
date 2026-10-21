import "server-only";
import { cache } from "react";
import {
  CAPABILITY_KEYS,
  evaluateCapability,
  type Capability,
  type CapabilityEffect,
} from "@/config/capabilities";
import type { Role } from "@/config/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 권한 판정 — 서버 쪽 리졸버.
 *
 * 설계: `docs/engineering/14-permission-architecture.md` §5
 *
 * 규칙 자체는 `evaluateCapability`(순수 함수)가 갖고 있고, 여기서는 **개인 부여·차단을 읽어와**
 * 그 함수에 넘긴다. SQL 쪽 `has_capability()` 도 같은 규칙을 담는다 — 세 경로(서버·클라이언트·RLS)가
 * 한 규칙을 공유하는 것이 이 설계의 핵심이다.
 *
 * **요청당 1회만 조회한다.** `react.cache` 로 감싸 같은 요청 안에서 여러 게이트가 물어도 DB 는 한
 * 번만 간다. 이 저장소는 세션 워터폴로 첫 바이트가 늦어지는 문제를 이미 겪었다.
 */

export type ActiveOverride = { permission_key: string; effect: CapabilityEffect };

/** 한 사용자의 활성 개인 부여·차단(회수 안 됐고, 기한이 있으면 아직 안 지난 것). */
const loadActiveOverrides = cache(
  async (organizationId: string, userId: string): Promise<ActiveOverride[]> => {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("membership_permission_overrides")
      .select("permission_key, effect, expires_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .is("revoked_at", null);

    if (error) {
      // 조회 실패를 「권한 없음」으로 흘린다. 부여를 못 읽어 막히는 것이 잘못 열어 주는 것보다 낫다.
      // 조용하면 안 된다 — 사람이 「어제까지 되던 게 안 된다」를 겪게 된다.
      console.error("[capabilities] override read failed:", error.message);
      return [];
    }

    const now = Date.now();
    return (data ?? [])
      .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now)
      .map((row) => ({
        permission_key: row.permission_key,
        effect: (row.effect === "deny" ? "deny" : "grant") as CapabilityEffect,
      }));
  },
);

type CapabilityInput = {
  organizationId: string;
  userId: string;
  role: Role;
};

/**
 * 이미 읽어 둔 부여·차단 행으로 권한을 계산한다 — **조회를 하지 않는다.**
 *
 * 세션 조립부가 쓴다. 거기서는 이 행들을 프로필·멤버십과 **같은 배치로 미리 읽어** 두므로,
 * 여기서 또 조회하면 요청마다 왕복이 한 번 늘어난다(2026-09-11 성능 점검에서 실제로 그랬다).
 */
export function computeCapabilities(
  role: Role,
  overrides: readonly ActiveOverride[],
): Capability[] {
  const granted = new Set(overrides.filter((o) => o.effect === "grant").map((o) => o.permission_key));
  const denied = new Set(overrides.filter((o) => o.effect === "deny").map((o) => o.permission_key));
  return CAPABILITY_KEYS.filter((capability) =>
    evaluateCapability({
      capability,
      role,
      granted: granted.has(capability),
      denied: denied.has(capability),
    }),
  );
}

/** 활성 부여·차단인지(회수 안 됨 · 기한 안 지남) 판정한다. 세션 조립부와 공유한다. */
export function isActiveOverrideRow(row: { expires_at: string | null }, now = Date.now()): boolean {
  return !row.expires_at || new Date(row.expires_at).getTime() > now;
}

/**
 * 이 사용자가 **지금 실제로 가진** 권한 키 전체.
 *
 * 세션에 실어 클라이언트로 보낸다. 클라이언트가 스스로 계산하지 않게 하는 것이 목적이다 —
 * 계산이 두 벌이면 반드시 갈라진다.
 */
export const resolveCapabilities = cache(
  async (input: CapabilityInput): Promise<Capability[]> => {
    const overrides = await loadActiveOverrides(input.organizationId, input.userId);
    return computeCapabilities(input.role, overrides);
  },
);

/** 단건 판정. 내부적으로 같은 캐시를 타므로 여러 번 불러도 조회는 1회다. */
export async function can(input: CapabilityInput, capability: Capability): Promise<boolean> {
  const capabilities = await resolveCapabilities(input);
  return capabilities.includes(capability);
}

/**
 * 조직 · 사용자만으로 그 사람의 권한을 계산한다(역할 · 플랫폼 개발자 · 부여/차단을 직접 읽음) — 세션 역할이 다른 조직 것일 수 있는
 * 서버 액션이나 **다른 사람**을 판정할 때 쓴다(근태 · 급여 · 연차 게이트, 2026-10-21). 플랫폼 개발자는 `developer_super_admin` 으로 판정.
 * 비활성 · 멤버 아님이면 빈 목록.
 */
export const memberCapabilities = cache(
  async (organizationId: string, userId: string): Promise<readonly Capability[]> => {
    const service = getSupabaseServiceClient();
    const [pa, m, overrides] = await Promise.all([
      service.from("platform_admins").select("id").eq("user_id", userId).eq("is_active", true).maybeSingle(),
      service
        .from("memberships")
        .select("role, status")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle(),
      loadActiveOverrides(organizationId, userId),
    ]);
    const row = m.data as { role: string; status: string } | null;
    const role: Role | null = pa.data ? "developer_super_admin" : row?.status === "active" ? (row.role as Role) : null;
    return role ? computeCapabilities(role, overrides) : [];
  },
);

/** 이 키를 가진 활성 멤버의 id — 알림 받는 사람 고르기(보이는 범위는 넓히지 않는다). 멤버십 역할 + 부여/차단으로 센다. */
export async function memberIdsWithCapability(organizationId: string, capability: Capability): Promise<string[]> {
  const service = getSupabaseServiceClient();
  const [mRes, oRes] = await Promise.all([
    service.from("memberships").select("user_id, role").eq("organization_id", organizationId).eq("status", "active"),
    service
      .from("membership_permission_overrides")
      .select("user_id, effect, expires_at")
      .eq("organization_id", organizationId)
      .eq("permission_key", capability)
      .is("revoked_at", null),
  ]);
  const overrides = ((oRes.data ?? []) as { user_id: string; effect: string; expires_at: string | null }[]).filter(
    (r) => isActiveOverrideRow(r),
  );
  return ((mRes.data ?? []) as { user_id: string; role: string }[])
    .filter((m) =>
      evaluateCapability({
        capability,
        role: m.role as Role,
        granted: overrides.some((r) => r.user_id === m.user_id && r.effect === "grant"),
        denied: overrides.some((r) => r.user_id === m.user_id && r.effect === "deny"),
      }),
    )
    .map((m) => m.user_id);
}
