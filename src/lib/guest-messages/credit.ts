/**
 * 크레딧 판단 — 발송 큐 · 보정 조회가 **같은 함수**를 쓴다(순수). docs/product/47-guest-messaging.md §4-1
 */

import { LOW_CREDIT_THRESHOLD } from "@/lib/beds24/calendar-client";
import type { ChannelCreditSnapshot } from "@/lib/guest-messages/types";

/**
 * 기록된 남은 크레딧을 아직 믿을 수 있나. 리셋 시각을 모르거나 이미 지났으면 null(모름 — 창이 새로 열렸을 수 있다).
 */
export function knownRemainingCredit(credit: ChannelCreditSnapshot | null | undefined, nowMs: number): number | null {
  if (!credit || credit.remaining === null) return null;
  if (credit.resetsAt === null || credit.resetsAt <= nowMs) return null;
  return credit.remaining;
}

/** 실제 남겨 둘 선 — 설정값과 계정 전체 저크레딧 선(`LOW_CREDIT_THRESHOLD`) 중 큰 쪽. */
export function effectiveCreditReserve(settingsReserve: number): number {
  return Math.max(settingsReserve, LOW_CREDIT_THRESHOLD);
}

/**
 * 묶음 한 번의 예상 비용 — 실측 전이라 **건수에 비례**로 넉넉히 잡는다(마지막 `x-request-cost` × 건수, 모르면 건수).
 * V3 에서 배열 POST 의 실제 비용을 재면 줄인다.
 */
export function estimateBatchCost(itemCount: number, lastRequestCost: number | null): number {
  const perItem = Math.max(1, lastRequestCost ?? 1);
  return Math.max(1, itemCount) * perItem;
}

/** 이 응답 뒤 계정 전체가 쉬어야 하나(가격 작업과 같은 선). */
export function isBelowLowCreditThreshold(remaining: number | null): boolean {
  return remaining !== null && remaining < LOW_CREDIT_THRESHOLD;
}
