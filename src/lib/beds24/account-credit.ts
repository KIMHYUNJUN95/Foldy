import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

/**
 * Beds24 **계정 전체**의 마지막 크레딧 기록 (2026-11-12, docs/product/47-guest-messaging.md §4-1).
 *
 * 크레딧은 계정 단위(5분 창)라 한 곳에만 둔다 — 쿨다운과 같은 표 `beds24_sync_locks` 의 `account_credit` 줄.
 * `expires_at` = 리셋 시각이라, 지난 기록은 `beds24_sync_locks` 의 규칙대로 「없는 것」이다. 리셋 헤더가 없던 값은
 * 만료를 5분 뒤로 **추정**하고 `metadata.expiresEstimated = true` 로 표시한다 — DB 함수가 그 값을 살아 있는 창의 값으로 다룬다.
 * `guest_message_channel_state.last_credit_*` 는 손님 메시지 화면용 **사본**이다.
 *
 * 2026-11-18 부터 모든 Beds24 호출이 `beds24Fetch`(`credit-ledger.ts`)를 지나며 여기를 갱신한다.
 */

export const ACCOUNT_CREDIT = "account_credit";

export type AccountCreditRecord = {
  remaining: number | null;
  resetsAt: number | null;
  requestCost: number | null;
  /** 5분 한도(헤더가 준 경우만). */
  limit: number | null;
  recordedAt: number;
  source: string;
};

type Client = SupabaseClient<Database>;

export async function recordBeds24AccountCredit(
  supabase: Client,
  credit: { remaining: number | null; resetsAt: number | null; requestCost: number | null; limit?: number | null },
  source: string,
  nowMs: number = Date.now(),
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  if (credit.remaining === null && credit.resetsAt === null && credit.requestCost === null) return;
  try {
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(credit.resetsAt ?? nowMs + 5 * 60 * 1000).toISOString();
    const metadata = {
      remaining: credit.remaining,
      resetsAt: credit.resetsAt,
      requestCost: credit.requestCost,
      ...(typeof credit.limit === "number" ? { limit: credit.limit } : {}),
      recordedAt: nowMs,
      source,
      ...(credit.resetsAt === null ? { expiresEstimated: true } : {}),
    } as unknown as Json;
    // 덮을지는 DB 함수의 판정표가 정한다 — 마이그레이션 202611180003 주석 · 01 「크레딧 사용 기록」.
    const rpcQuery = supabase.rpc("beds24_record_account_credit", {
      p_expires_at: expiresAt,
      p_source: source,
      p_metadata: metadata,
    });
    const rpc = await (options.signal ? rpcQuery.abortSignal(options.signal) : rpcQuery);
    if (!rpc.error) return;
    if (rpc.error.code !== "PGRST202") {
      console.error("[beds24/account-credit] write failed", rpc.error.message);
      return;
    }
    // 마이그레이션 202611180003 적용 전 — 예전처럼 마지막 값이 이긴다.
    const upsert = supabase.from("beds24_sync_locks").upsert(
      { name: ACCOUNT_CREDIT, locked_by: source, locked_at: nowIso, expires_at: expiresAt, reason: null, metadata, updated_at: nowIso },
      { onConflict: "name" },
    );
    const result = await (options.signal ? upsert.abortSignal(options.signal) : upsert);
    if (result.error) console.error("[beds24/account-credit] write failed", result.error.message);
  } catch (error) {
    console.error("[beds24/account-credit] write failed", error instanceof Error ? error.message : "unknown");
  }
}

/** 마지막 기록(만료됐으면 null). 읽기 실패도 null(모름). */
export async function readBeds24AccountCredit(supabase: Client, nowMs: number = Date.now()): Promise<AccountCreditRecord | null> {
  const result = await supabase
    .from("beds24_sync_locks")
    .select("expires_at, metadata")
    .eq("name", ACCOUNT_CREDIT)
    .maybeSingle();
  const row = result.data as { expires_at: string; metadata: unknown } | null;
  if (!row || Date.parse(row.expires_at) <= nowMs) return null;
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    remaining: num(meta.remaining),
    resetsAt: num(meta.resetsAt),
    requestCost: num(meta.requestCost),
    limit: num(meta.limit),
    recordedAt: num(meta.recordedAt) ?? 0,
    source: typeof meta.source === "string" ? meta.source : "",
  };
}
