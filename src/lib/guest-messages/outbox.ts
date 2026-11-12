/**
 * 발송 큐 한 바퀴 — **어댑터를 주입받는 함수**(DB 를 모른다). docs/product/47-guest-messaging.md §4-1
 *
 * 순위: 직원 답장(reply) → 자동 안내(auto). 같은 종류는 한 POST 로 묶는다(Beds24 는 배열을 한 번에 받는다).
 * - 자동 안내는 「남은 크레딧 − 예상 비용(건수 비례)」이 남겨 둘 선(`effectiveCreditReserve` — 설정값과 계정 저크레딧 선 중 큰 쪽)
 *   아래로 내려갈 것 같으면 **보내지 않고 큐에 둔다**. 직원 답장은 선과 무관(선은 직원 답장 몫이다).
 * - 429 · 동기화 멈춤 · 계정 쿨다운: 그 묶음을 `retryAfterSec` 뒤로 미루고(시도 횟수 그대로) 이번 바퀴를 멈춘다.
 * - 보내기 전 실패(설정 · 토큰 없음): 5분 뒤 다시, 시도 횟수 그대로 — 나간 것이 없다.
 * - **요청이 나간 뒤의 실패**(네트워크 끊김 · 5xx · 응답 줄 빠짐): `uncertain` — **다시 보내지 않는다**. 되돌아온 host 메시지
 *   (웹훅 · 보정 조회)가 `sent` 로 합친다(`store.ts`). 같은 글이 손님에게 두 번 가는 것을 막는다.
 * - Beds24 거절(4xx · 줄 단위 거절) · 직접 예약 · 채널 모름: 바로 `failed`.
 *
 * 줄을 `sending` 으로 잡는 일(경합 막기)과 결과 저장은 이 함수를 부르는 쪽(2단계 발송 작업)이 한다. 이 함수는 계획만 돌려준다.
 * 발송 작업이 `sent` 를 저장할 때는 메시지 줄을 `guest_messages_outbox_key`(outbox_id) 로 upsert 한다 — 되돌아옴 합치기가 먼저
 * 만든 줄이 있으면 새로 넣지 않고 그 줄에 잇는다(04 「손님 메시지」 발송 계약).
 */

import { effectiveCreditReserve, estimateBatchCost, knownRemainingCredit } from "@/lib/guest-messages/credit";
import type {
  ChannelCreditSnapshot,
  GuestChannelKey,
  GuestMessageChannelAdapter,
  OutboundItem,
} from "@/lib/guest-messages/types";

export type OutboxStatus = "queued" | "sending" | "sent" | "uncertain" | "failed" | "cancelled";

export type OutboxRow = {
  id: string;
  kind: "reply" | "auto";
  status: OutboxStatus;
  attempts: number;
  next_try_at: string;
  created_at: string;
  body: string;
  provider_booking_id: string;
  channel: GuestChannelKey | null;
};

export type OutboxUpdate = {
  id: string;
  status: "queued" | "sent" | "uncertain" | "failed";
  attempts: number;
  next_try_at: string;
  error_code: string | null;
  external_id: string | null;
  sent_at: string | null;
};

export type ProcessOutboxResult = {
  updates: OutboxUpdate[];
  /** 크레딧 선 · 앞 묶음의 멈춤 때문에 이번에 안 보낸 줄(그대로 queued). */
  deferredIds: string[];
  credit: ChannelCreditSnapshot;
  stoppedReason: "rate_limited" | "credit_reserve" | "pre_send" | null;
};

export const OUTBOX_BATCH_LIMIT = 50;
/** 보내기 전 실패(설정 · 토큰)의 다시 시도 간격. */
export const OUTBOX_PRE_SEND_RETRY_SEC = 5 * 60;

function mergeCredit(prev: ChannelCreditSnapshot, next: ChannelCreditSnapshot | null): ChannelCreditSnapshot {
  if (!next) return prev;
  return {
    remaining: next.remaining ?? prev.remaining,
    resetsAt: next.resetsAt ?? prev.resetsAt,
    requestCost: next.requestCost ?? prev.requestCost,
  };
}

export async function processOutboxBatch(input: {
  rows: readonly OutboxRow[];
  adapter: Pick<GuestMessageChannelAdapter, "send">;
  creditReserve: number;
  credit: ChannelCreditSnapshot;
  now: Date;
  batchLimit?: number;
}): Promise<ProcessOutboxResult> {
  const nowMs = input.now.getTime();
  const batchLimit = input.batchLimit ?? OUTBOX_BATCH_LIMIT;
  const reserve = effectiveCreditReserve(input.creditReserve);
  let credit = { ...input.credit };
  const updates: OutboxUpdate[] = [];
  const deferredIds: string[] = [];
  let stoppedReason: ProcessOutboxResult["stoppedReason"] = null;
  const iso = (ms: number) => new Date(ms).toISOString();

  const due = input.rows
    .filter((row) => row.status === "queued" && Date.parse(row.next_try_at) <= nowMs)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const groups: OutboxRow[][] = [
    due.filter((row) => row.kind === "reply").slice(0, batchLimit),
    due.filter((row) => row.kind === "auto").slice(0, batchLimit),
  ];

  for (const group of groups) {
    if (group.length === 0) continue;
    if (stoppedReason) {
      deferredIds.push(...group.map((row) => row.id));
      continue;
    }
    if (group[0].kind === "auto") {
      const remaining = knownRemainingCredit(credit, nowMs);
      if (remaining !== null && remaining - estimateBatchCost(group.length, credit.requestCost) < reserve) {
        stoppedReason = "credit_reserve";
        deferredIds.push(...group.map((row) => row.id));
        continue;
      }
    }

    const items: OutboundItem[] = group.map((row) => ({
      outboxId: row.id,
      providerBookingId: row.provider_booking_id,
      body: row.body,
      channel: row.channel,
    }));
    const outcome = await input.adapter.send(items);
    credit = mergeCredit(credit, outcome.credit);
    const byId = new Map(group.map((row) => [row.id, row]));
    const handled = new Set<string>();

    for (const item of outcome.items) {
      const row = byId.get(item.outboxId);
      if (!row) continue;
      handled.add(row.id);
      const attempts = row.attempts + 1;
      if (item.ok) {
        updates.push({ id: row.id, status: "sent", attempts, next_try_at: row.next_try_at, error_code: null, external_id: item.externalId, sent_at: iso(nowMs) });
      } else if (item.reason === "uncertain") {
        updates.push({ id: row.id, status: "uncertain", attempts, next_try_at: row.next_try_at, error_code: "uncertain", external_id: null, sent_at: null });
      } else {
        updates.push({ id: row.id, status: "failed", attempts, next_try_at: row.next_try_at, error_code: item.reason, external_id: null, sent_at: null });
      }
    }

    const rest = group.filter((row) => !handled.has(row.id));
    if (outcome.kind === "rate_limited") {
      stoppedReason = "rate_limited";
      for (const row of rest) {
        // 한도 · 멈춤은 메시지 탓이 아니다 — 시도 횟수를 늘리지 않는다.
        updates.push({ id: row.id, status: "queued", attempts: row.attempts, next_try_at: iso(nowMs + outcome.retryAfterSec * 1000), error_code: "rate_limited", external_id: null, sent_at: null });
      }
    } else if (outcome.kind === "failed") {
      for (const row of rest) {
        if (outcome.phase === "pre_send") {
          updates.push({ id: row.id, status: "queued", attempts: row.attempts, next_try_at: iso(nowMs + OUTBOX_PRE_SEND_RETRY_SEC * 1000), error_code: outcome.errorCode, external_id: null, sent_at: null });
        } else if (outcome.phase === "uncertain") {
          updates.push({ id: row.id, status: "uncertain", attempts: row.attempts + 1, next_try_at: row.next_try_at, error_code: outcome.errorCode, external_id: null, sent_at: null });
        } else {
          updates.push({ id: row.id, status: "failed", attempts: row.attempts + 1, next_try_at: row.next_try_at, error_code: outcome.errorCode, external_id: null, sent_at: null });
        }
      }
      // 설정 · 토큰이 없으면 다음 묶음도 같다 — 멈춘다.
      if (outcome.phase === "pre_send") stoppedReason = "pre_send";
    }
  }

  return { updates, deferredIds, credit, stoppedReason };
}
