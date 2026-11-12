/**
 * 서버에서 쓰는 Beds24 어댑터. docs/product/47-guest-messaging.md §4-1
 * - 부르기 전: Beds24 동기화 멈춤 · 계정 쿨다운이면 부르지 않는다(`rate_limited` 로 돌려 큐가 그 뒤로 미룸).
 * - 응답마다: 계정 전체 크레딧 기록(`beds24_sync_locks` 'account_credit') + 이 조직 화면용 사본, 남은 크레딧이
 *   `LOW_CREDIT_THRESHOLD` 아래면 계정 쿨다운(low_credit — 가격 작업과 같은 선).
 * - 429: 계정 쿨다운(rate_limit).
 * 2단계 발송 작업(`processOutboxBatch` 를 부르는 쪽)이 이걸 쓴다.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recordBeds24AccountCredit } from "@/lib/beds24/account-credit";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { activateBeds24Cooldown, getBeds24Cooldown } from "@/lib/beds24/sync-locks";
import { createBeds24GuestMessageAdapter, type Beds24CallGate } from "@/lib/guest-messages/beds24-adapter";
import { isBelowLowCreditThreshold } from "@/lib/guest-messages/credit";
import { recordChannelCredit } from "@/lib/guest-messages/store";
import type { ChannelCreditSnapshot, GuestMessageChannelAdapter } from "@/lib/guest-messages/types";

type Client = SupabaseClient<Database>;

export function beds24ServerGate(supabase: Client): Beds24CallGate {
  return async () => {
    if (isBeds24SyncPaused()) return { blocked: true, retryAfterSec: 300, reason: "paused" };
    const cooldown = await getBeds24Cooldown(supabase);
    if (cooldown.active) return { blocked: true, retryAfterSec: Math.max(15, cooldown.remainingSec), reason: "cooldown" };
    return { blocked: false };
  };
}

/** 받은 크레딧 헤더 기록 + 저크레딧 쿨다운. 보정 조회도 같은 함수를 쓴다. */
export async function recordGuestMessageCredit(
  supabase: Client,
  organizationIds: readonly string[],
  credit: ChannelCreditSnapshot,
  source: string,
  nowMs: number = Date.now(),
): Promise<void> {
  await recordBeds24AccountCredit(supabase, credit, source, nowMs);
  for (const organizationId of organizationIds) await recordChannelCredit(supabase, organizationId, credit);
  if (isBelowLowCreditThreshold(credit.remaining)) {
    const resetInSec = credit.resetsAt !== null ? Math.max(0, Math.round((credit.resetsAt - nowMs) / 1000)) : null;
    await activateBeds24Cooldown(supabase, { reason: "low_credit", resetInSec, fallbackSec: 30 });
  }
}

export function createServerBeds24GuestMessageAdapter(supabase: Client, organizationId: string): GuestMessageChannelAdapter {
  return createBeds24GuestMessageAdapter({
    gate: beds24ServerGate(supabase),
    onCredit: (credit) => recordGuestMessageCredit(supabase, [organizationId], credit, "guest-messages-send"),
    onRateLimited: async (resetsInSec) => {
      await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: resetsInSec });
    },
  });
}
