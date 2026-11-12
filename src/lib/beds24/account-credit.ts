import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

/**
 * Beds24 **계정 전체**의 마지막 크레딧 기록 (2026-11-12, docs/product/47-guest-messaging.md §4-1).
 *
 * 크레딧은 계정 단위(5분 창)라 한 곳에만 둔다 — 쿨다운과 같은 표 `beds24_sync_locks` 의 `account_credit` 줄.
 * `expires_at` = 리셋 시각(모르면 5분 뒤)이라, 지난 기록은 `beds24_sync_locks` 의 규칙대로 「없는 것」이다.
 * `guest_message_channel_state.last_credit_*` 는 손님 메시지 화면용 **사본**이다.
 *
 * 지금은 손님 메시지 경로만 쓴다. 다른 Beds24 경로(가격 · 리뷰)가 쓰게 되면 그쪽도 여기 기록한다.
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
): Promise<void> {
  if (credit.remaining === null && credit.resetsAt === null && credit.requestCost === null) return;
  try {
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(credit.resetsAt ?? nowMs + 5 * 60 * 1000).toISOString();
    const result = await supabase.from("beds24_sync_locks").upsert(
      {
        name: ACCOUNT_CREDIT,
        locked_by: source,
        locked_at: nowIso,
        expires_at: expiresAt,
        reason: null,
        metadata: {
          remaining: credit.remaining,
          resetsAt: credit.resetsAt,
          requestCost: credit.requestCost,
          ...(typeof credit.limit === "number" ? { limit: credit.limit } : {}),
          recordedAt: nowMs,
          source,
        } as unknown as Json,
        updated_at: nowIso,
      },
      { onConflict: "name" },
    );
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
