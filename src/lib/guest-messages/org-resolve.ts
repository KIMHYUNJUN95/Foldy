/**
 * 메시지 → 조직. 예약 처리와 같은 규칙(우리 DB 매핑 → 서버 기본값, `webhook-organization.ts`) — 페이로드의 조직 id 는 믿지 않는다.
 * 매핑이 없어 **기본값(`BEDS24_DEFAULT_ORGANIZATION_ID`)으로만** 정해진 경우를 알려 준다(넣기는 하되 경고 로그).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { pickWebhookOrganizationId, readMappedOrganizationIds } from "@/lib/beds24/webhook-organization";

export type ResolvedOrganization = { organizationId: string | null; viaFallback: boolean };

/** 순수 — 매핑 결과 + 기본값 → 조직 · 기본값으로만 정해졌나. */
export function decideMessageOrganization(mapped: readonly string[], fallback: string | null): ResolvedOrganization {
  const organizationId = pickWebhookOrganizationId({ mappedOrganizationIds: mapped, fallbackOrganizationId: fallback });
  const viaFallback = organizationId !== null && !mapped.includes(organizationId);
  return { organizationId, viaFallback };
}

export async function resolveMessageOrganization(
  supabase: SupabaseClient<Database>,
  ids: { externalPropertyId: string | null; externalRoomId: string | null },
  fallback: string | null,
): Promise<ResolvedOrganization> {
  return decideMessageOrganization(await readMappedOrganizationIds(supabase, ids), fallback);
}

/**
 * 예약 하나의 조직 정하기 — 순수. `mapped` = 매핑 조직들, `existing` = 그 예약 번호의 기존 대화가 있는 조직들.
 */
export function decideReconcileOrganization(args: {
  mapped: readonly string[];
  existing: readonly string[];
  fallback: string | null;
}): { organizationId: string | null; viaFallback: boolean; mismatch: boolean } {
  const byMapping = decideMessageOrganization(args.mapped, args.fallback);
  const existing = [...new Set(args.existing)];
  if (byMapping.organizationId && !byMapping.viaFallback) {
    const mismatch = existing.length > 0 && !existing.includes(byMapping.organizationId);
    return { organizationId: mismatch ? null : byMapping.organizationId, viaFallback: false, mismatch };
  }
  if (existing.length === 1) return { organizationId: existing[0], viaFallback: false, mismatch: false };
  if (existing.length > 1) return { organizationId: null, viaFallback: false, mismatch: true };
  return { organizationId: byMapping.organizationId, viaFallback: byMapping.viaFallback, mismatch: false };
}
