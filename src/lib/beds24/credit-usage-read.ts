import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { ACCOUNT_CREDIT } from "@/lib/beds24/account-credit";
import { getBeds24Cooldown } from "@/lib/beds24/sync-locks";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readAllPages, SUPABASE_PAGE_SIZE } from "@/lib/supabase/read-all-pages";
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
/**
 * 창 집계 줄 상한(7일 ≈ 창 2,016개 × 사람 · 기능 조합). 넘으면 잘라서 적게 보이지 않게 오류로 드러낸다 —
 * 줄은 옛 창부터라 자르면 지금 창부터 빠지고, 그 양이 통째로 「Foldy 밖」이 된다.
 */
export const BEDS24_CREDIT_WINDOW_MAX_ROWS = 50 * SUPABASE_PAGE_SIZE;

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

type WindowRow = Record<string, unknown>;

/** 같은 창의 키(`resets_at` 최댓값)가 이 간격 안이면 같은 창 — DB 함수의 창 가르기(60초)와 같은 기준. */
const SAME_WINDOW_GAP_MS = 60_000;

/**
 * 페이지마다 DB 함수가 창 묶기를 새로 계산한다. 범위 끝을 고정해도 그 전 시각으로 찍힌 줄이 늦게 들어오면
 * (insert 는 `after()` · 서버 시계 차이) 지금 창의 키가 장 사이에 커져 한 창이 키 둘로 갈라져 온다.
 * 한 번의 결과 안에서 서로 다른 창의 키는 60초 넘게 떨어져 있으므로, 60초 안의 키들은 가장 큰 키로 합친다.
 */
function mergeSplitWindowKeys(rows: readonly WindowRow[]): WindowRow[] {
  const keys = [...new Set(rows.map((row) => row.window_resets_at).filter((v): v is string => typeof v === "string"))]
    .map((raw) => ({ raw, ms: Date.parse(raw) }))
    .filter((key) => Number.isFinite(key.ms))
    .sort((a, b) => a.ms - b.ms);
  const canonical = new Map<string, string>();
  let cluster: typeof keys = [];
  const flush = () => {
    const last = cluster.at(-1);
    if (last) for (const key of cluster) canonical.set(key.raw, last.raw);
    cluster = [];
  };
  for (const key of keys) {
    const prev = cluster.at(-1);
    if (prev && key.ms - prev.ms > SAME_WINDOW_GAP_MS) flush();
    cluster.push(key);
  }
  flush();
  return rows.map((row) => {
    const raw = row.window_resets_at;
    const to = typeof raw === "string" ? canonical.get(raw) : undefined;
    return to && to !== raw ? { ...row, window_resets_at: to } : row;
  });
}

async function readWindows(supabase: Client, organizationId: string, fromMs: number, nowMs: number) {
  // 범위 끝은 읽기 시작 시각 하나로 — 모든 장이 같은 범위를 본다. 예전 +60초는 근거 기록이 없었고(시계 차이 대비로 보임),
  // 그 사이 시작된 호출이 장 사이에 끼어 창 키를 바꿨다. 시계가 앞선 서버의 줄은 다음 새로고침에 보인다.
  const args = {
    p_organization_id: organizationId,
    p_from: new Date(fromMs).toISOString(),
    p_to: new Date(nowMs).toISOString(),
    p_credential_key: BEDS24_DEFAULT_CREDENTIAL_KEY,
  };
  const page = (from: number, to: number) =>
    supabase
      .rpc("beds24_credit_usage_windows", args)
      // 함수 안 정렬(202611180004 — group by 키 전부)과 같은 순서를 바깥에도 건다 — 페이지 경계가 이 순서로 정해진다.
      .order("window_resets_at", { ascending: true, nullsFirst: false })
      .order("actor_kind", { ascending: true })
      .order("actor_user_id", { ascending: true, nullsFirst: false })
      .order("actor_job", { ascending: true, nullsFirst: false })
      .order("feature", { ascending: true })
      .range(from, to);
  // PostgREST 는 1,000줄에서 조용히 자른다 — 페이지로 끝까지 읽는다(`read-all-pages.ts`).
  // 상한 자리에선 한 줄만 더 물어, 상한을 넘는 줄이 실제로 있을 때만 오류(정확히 상한이면 정상 끝).
  const result = await readAllPages<WindowRow>((from, to) =>
    from >= BEDS24_CREDIT_WINDOW_MAX_ROWS
      ? page(from, from).then((probe) =>
          probe.error || (probe.data ?? []).length === 0
            ? { data: [] as WindowRow[], error: probe.error }
            : { data: null, error: { message: `over ${BEDS24_CREDIT_WINDOW_MAX_ROWS} rows` } },
        )
      : page(from, to),
  );
  if (result.error) throw new Error(`beds24_credit_usage_windows: ${result.error.message}`);
  // 장 사이에 새 묶음이 앞에 끼면 같은 키 줄이 두 장에 겹쳐 온다 — 키로 한 줄만(뒤 장이 더 새 값).
  const byKey = new Map<string, WindowRow>();
  for (const row of mergeSplitWindowKeys(result.data)) {
    const key = [row.credential_key, row.window_resets_at, row.actor_kind, row.actor_user_id, row.actor_job, row.feature]
      .map((part) => (part === null || part === undefined ? "\u0000" : String(part)))
      .join("\u0001");
    byKey.delete(key);
    byKey.set(key, row);
  }
  const rows = parseBeds24CreditWindowRows([...byKey.values()]);
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
