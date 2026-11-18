import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { ACCOUNT_CREDIT } from "@/lib/beds24/account-credit";
import { getBeds24Cooldown } from "@/lib/beds24/sync-locks";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  BEDS24_DEFAULT_CREDENTIAL_KEY,
  BEDS24_CREDIT_FEATURES,
  type Beds24CreditCall,
  type Beds24CreditDetail,
  type Beds24CreditFeature,
  type Beds24CreditRange,
  type Beds24CreditSnapshot,
  type Beds24CreditSummary,
} from "@/lib/beds24/credit-usage-types";
import {
  beds24CreditDetailFetchStart,
  beds24CreditRangeStart,
  buildBeds24CreditDetailView,
  buildBeds24CreditSnapshot,
  groupBeds24CreditWindows,
  parseBeds24CreditWindowRows,
  summarizeBeds24CreditCurrent,
  type Beds24AccountCreditRaw,
} from "@/lib/beds24/credit-usage-model";

/**
 * Beds24 크레딧 사용 기록 — 서버 읽기(service role). 테스트는 `deps.supabase` · `deps.nowMs` 로 바꾼다.
 * 도메인 계약: docs/engineering/01-beds24-integration.md → 「크레딧 사용 기록」.
 *
 * 조직 격리: 창 집계 RPC · 최근 호출 모두 「이 조직 줄 + 조직 없는 줄(계정 전체 작업)」만 읽는다.
 * 다른 조직이 쓴 양은 「Foldy 밖」으로만 보인다(남은 값 차이). 지금은 토큰이 하나라 'main' 만 읽는다.
 */

type Client = SupabaseClient<Database>;
export type Beds24CreditReadDeps = { supabase?: Client; nowMs?: number };

const RECENT_CALL_LIMIT = 30;
const SUMMARY_LOOKBACK_MS = 6 * 60 * 1000;

async function readAccountCreditRaw(supabase: Client): Promise<Beds24AccountCreditRaw | null> {
  const result = await supabase
    .from("beds24_sync_locks")
    .select("expires_at, metadata")
    .eq("name", ACCOUNT_CREDIT)
    .maybeSingle();
  const row = result.data as { expires_at: string; metadata: unknown } | null;
  if (!row) return null;
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const expiresAt = Date.parse(row.expires_at);
  return {
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    remaining: num(meta.remaining),
    resetsAt: num(meta.resetsAt),
    limit: num(meta.limit),
    recordedAt: num(meta.recordedAt),
  };
}

async function readSnapshot(supabase: Client, nowMs: number): Promise<Beds24CreditSnapshot> {
  const [raw, cooldown] = await Promise.all([readAccountCreditRaw(supabase), getBeds24Cooldown(supabase)]);
  const until = cooldown.active && cooldown.until ? Date.parse(cooldown.until) : null;
  return buildBeds24CreditSnapshot(raw, until, nowMs);
}

/** 게이지 값. 크레딧은 계정 단위라 조직과 상관없이 같지만, 부르는 쪽 모양을 다른 두 함수와 맞춘다. */
export async function getBeds24CreditSnapshot(
  _organizationId: string,
  deps: Beds24CreditReadDeps = {},
): Promise<Beds24CreditSnapshot> {
  return readSnapshot(deps.supabase ?? getSupabaseServiceClient(), deps.nowMs ?? Date.now());
}

async function readWindows(supabase: Client, organizationId: string, fromMs: number, nowMs: number) {
  const result = await supabase.rpc("beds24_credit_usage_windows", {
    p_organization_id: organizationId,
    p_from: new Date(fromMs).toISOString(),
    p_to: new Date(nowMs + 60_000).toISOString(),
    p_credential_key: BEDS24_DEFAULT_CREDENTIAL_KEY,
  });
  if (result.error) throw new Error(result.error.message);
  const rows = parseBeds24CreditWindowRows((result.data ?? []) as unknown as Record<string, unknown>[]);
  return groupBeds24CreditWindows(rows, BEDS24_DEFAULT_CREDENTIAL_KEY);
}

export async function getBeds24CreditSummary(
  organizationId: string,
  deps: Beds24CreditReadDeps = {},
): Promise<Beds24CreditSummary> {
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const nowMs = deps.nowMs ?? Date.now();
  const [snapshot, windows] = await Promise.all([
    readSnapshot(supabase, nowMs),
    readWindows(supabase, organizationId, nowMs - SUMMARY_LOOKBACK_MS, nowMs),
  ]);
  return { snapshot, ...summarizeBeds24CreditCurrent(windows, snapshot, nowMs) };
}

const isFeature = (value: string): value is Beds24CreditFeature =>
  (BEDS24_CREDIT_FEATURES as readonly string[]).includes(value);

async function readRecentCalls(
  supabase: Client,
  organizationId: string,
  fromMs: number,
): Promise<Beds24CreditCall[]> {
  const result = await supabase
    .from("beds24_credit_usage")
    .select("id, called_at, actor_kind, actor_name, actor_job, feature, action, item_count, cost, remaining, http_status")
    .eq("credential_key", BEDS24_DEFAULT_CREDENTIAL_KEY)
    .or(`organization_id.eq.${organizationId},organization_id.is.null`)
    .gte("called_at", new Date(fromMs).toISOString())
    .order("called_at", { ascending: false })
    .limit(RECENT_CALL_LIMIT);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((row) => ({
    id: String(row.id),
    at: Date.parse(row.called_at),
    actor: {
      kind: row.actor_kind === "user" ? ("user" as const) : ("auto" as const),
      name: row.actor_name ?? "",
      job: row.actor_job,
    },
    feature: isFeature(row.feature) ? row.feature : "other",
    action: row.action,
    itemCount: row.item_count,
    cost: row.cost,
    remaining: row.remaining,
    httpStatus: row.http_status,
  }));
}

export async function getBeds24CreditDetail(
  organizationId: string,
  range: Beds24CreditRange,
  deps: Beds24CreditReadDeps = {},
): Promise<Beds24CreditDetail> {
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const nowMs = deps.nowMs ?? Date.now();
  const [snapshot, windows, recentCalls] = await Promise.all([
    readSnapshot(supabase, nowMs),
    readWindows(supabase, organizationId, beds24CreditDetailFetchStart(range, nowMs), nowMs),
    readRecentCalls(supabase, organizationId, beds24CreditRangeStart(range, nowMs)),
  ]);
  return { snapshot, range, recentCalls, ...buildBeds24CreditDetailView(windows, snapshot, range, nowMs) };
}
