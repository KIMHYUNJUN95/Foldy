import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 건물별 요금 읽기 상태 — `beds24_property_rates_state`.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「안전망은 건물을 나눠 돈다 · 웹훅이 놓친 변경 감지」
 *
 * 판매 캘린더 요금은 재고 웹훅이 메인이다(`price-webhook.ts`). 주기 동기화는 놓친 배달을 메우는
 * 안전망인데, 예전에는 9건물 × 12개월을 한 번에 읽다 Beds24 연결이 한 번 늦으면 60초를 넘겼다
 * (2026-10-19 · 10-21 504). 이제 **가장 오래 안 읽힌 건물부터 몇 곳만** 읽고, 읽었는데 Beds24 가격이
 * 우리 표와 다르면 그것을 「웹훅이 놓친 변경」으로 남긴다.
 *
 * 기록은 전부 **던지지 않는다** — 상태 표가 실패해도 요금 읽기 자체는 성공이어야 한다.
 */

type Supabase = SupabaseClient<Database>;

export type PropertyReadSource = "webhook" | "tick" | "net";

/** 안전망 한 번에 읽는 건물 수 상한. 9건물이면 세 번(명목 45분)에 한 바퀴. */
export const NET_MAX_PROPERTIES_PER_RUN = 3;
/**
 * 이 시간이 지나면 다음 건물을 **시작하지 않는다.** 큰 건물 하나가 연결 지연(10초)까지 겹쳐도
 * 라우트 상한(60초) 안에 끝나도록 남겨 둔 몫이다.
 */
export const NET_START_BUDGET_MS = 25_000;
/**
 * 웹훅이 이 안에 왔으면 안전망이 찾은 변경을 「놓침」으로 보지 않는다 — 배달은 왔고 디바운스
 * (20초 + 한 번 더 읽기) 중이었을 수 있다.
 */
export const MISSED_WEBHOOK_GRACE_MS = 3 * 60 * 1000;

export type NetCandidate = {
  externalPropertyId: string;
  organizationId: string;
  lastFullReadAt: string | null;
};

/** 한 번도 안 읽힌 건물이 먼저, 그다음 오래된 순. 같으면 건물 번호 순(결과가 흔들리지 않게). */
export function orderNetCandidates(candidates: NetCandidate[]): NetCandidate[] {
  const time = (value: string | null) => (value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY);
  return [...candidates].sort(
    (a, b) =>
      time(a.lastFullReadAt) - time(b.lastFullReadAt) ||
      a.externalPropertyId.localeCompare(b.externalPropertyId),
  );
}

/**
 * 안전망이 찾은 가격 변경이 **웹훅이 놓친 것**인가.
 *
 * - 변경이 없으면 놓친 게 없다.
 * - 그 건물 재조회가 미뤄져 있으면(쿨다운 · 가격 작업 · 읽기 실패) 배달은 왔다 — 놓친 게 아니다.
 * - 웹훅이 방금 왔으면 아직 읽는 중일 수 있다.
 */
export function isMissedWebhookChange(args: {
  externalPriceChanges: number;
  lastWebhookAt: string | null;
  deferredPending: boolean;
  now?: number;
}): boolean {
  if (args.externalPriceChanges <= 0) return false;
  if (args.deferredPending) return false;
  if (!args.lastWebhookAt) return true;
  const at = new Date(args.lastWebhookAt).getTime();
  if (!Number.isFinite(at)) return true;
  return (args.now ?? Date.now()) - at > MISSED_WEBHOOK_GRACE_MS;
}

/** Beds24 와 연결된 건물 전부를 안전망 순서로 돌려준다. */
export async function listNetCandidates(supabase: Supabase): Promise<NetCandidate[]> {
  const [propertiesResult, statesResult] = await Promise.all([
    supabase.from("properties").select("organization_id, external_property_id").not("external_property_id", "is", null),
    supabase.from("beds24_property_rates_state").select("external_property_id, last_full_read_at"),
  ]);
  if (propertiesResult.error) throw new Error(propertiesResult.error.message);
  if (statesResult.error) {
    // 순서를 모르면 건물 번호 순으로라도 돈다 — 안전망이 멈추는 것보다 낫다.
    console.error("[beds24/property-rates-state] state read failed", { code: statesResult.error.code });
  }
  const lastReadById = new Map(
    (statesResult.data ?? []).map((row) => [row.external_property_id, row.last_full_read_at]),
  );
  const seen = new Set<string>();
  const candidates: NetCandidate[] = [];
  for (const row of propertiesResult.data ?? []) {
    const externalPropertyId = row.external_property_id ? String(row.external_property_id) : null;
    if (!externalPropertyId || seen.has(externalPropertyId)) continue;
    seen.add(externalPropertyId);
    candidates.push({
      externalPropertyId,
      organizationId: row.organization_id,
      lastFullReadAt: lastReadById.get(externalPropertyId) ?? null,
    });
  }
  return orderNetCandidates(candidates);
}

async function upsertState(
  supabase: Supabase,
  row: Database["public"]["Tables"]["beds24_property_rates_state"]["Insert"],
  label: string,
): Promise<void> {
  const result = await supabase
    .from("beds24_property_rates_state")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "external_property_id" });
  if (result.error) {
    console.error(`[beds24/property-rates-state] ${label} failed`, {
      code: result.error.code,
      externalPropertyId: row.external_property_id,
    });
  }
}

/** 재고(가격) 웹훅이 이 건물에 도착했다. 디바운스로 읽기를 미룬 배달도 센다. */
export async function markPropertyWebhook(
  supabase: Supabase,
  organizationId: string,
  externalPropertyId: string,
): Promise<void> {
  await upsertState(
    supabase,
    { external_property_id: externalPropertyId, last_webhook_at: new Date().toISOString(), organization_id: organizationId },
    "webhook mark",
  );
}

/** 이 건물 12개월을 오류 없이 다시 읽었다. `readStartedAt` 은 Beds24 를 읽기 **시작한** 시각. */
export async function markPropertyFullRead(
  supabase: Supabase,
  organizationId: string,
  externalPropertyId: string,
  source: PropertyReadSource,
  readStartedAt: number,
): Promise<void> {
  await upsertState(
    supabase,
    {
      external_property_id: externalPropertyId,
      last_full_read_at: new Date(readStartedAt).toISOString(),
      last_full_read_source: source,
      organization_id: organizationId,
    },
    "full read mark",
  );
}

/** 안전망이 웹훅이 놓친 가격 변경을 찾았다. */
export async function markPropertyMissed(
  supabase: Supabase,
  organizationId: string,
  externalPropertyId: string,
  changes: number,
): Promise<void> {
  await upsertState(
    supabase,
    {
      external_property_id: externalPropertyId,
      last_missed_at: new Date().toISOString(),
      last_missed_changes: changes,
      organization_id: organizationId,
    },
    "missed mark",
  );
}

/** 놓침 판정에 필요한 것 — 마지막 웹훅 시각과 미뤄 둔 재조회가 있는지. 못 읽으면 놓침으로 보지 않는다. */
export async function readMissedContext(
  supabase: Supabase,
  externalPropertyId: string,
): Promise<{ lastWebhookAt: string | null; deferredPending: boolean } | null> {
  const [stateResult, deferredResult] = await Promise.all([
    supabase
      .from("beds24_property_rates_state")
      .select("last_webhook_at")
      .eq("external_property_id", externalPropertyId)
      .maybeSingle(),
    supabase
      .from("beds24_deferred_refreshes")
      .select("external_property_id")
      .eq("external_property_id", externalPropertyId)
      .maybeSingle(),
  ]);
  if (stateResult.error || deferredResult.error) return null;
  return {
    deferredPending: Boolean(deferredResult.data),
    lastWebhookAt: stateResult.data?.last_webhook_at ?? null,
  };
}
