/**
 * 손님이 기다린 시간 — 마지막 손님 말부터 지금까지. **순수**, 도쿄 기준. docs/product/47-guest-messaging.md §6-1
 *
 * - 마지막 손님 말 뒤로 우리 답장(또는 「처리 끝」)이 없을 때만 센다. 내부 메모는 답장이 아니다
 *   (`last_reply_at` 에는 host 메시지만 들어간다 — `ingest-plan.ts`).
 * - 「나중에」(snoozed)가 안 끝났으면 기다리지 않는 것으로 본다. 끝났으면 손님 말 시각부터 그대로 센다.
 * - 목표 시간 · 밤 제외는 없다(2026-11-17 결정) — 1시간 이상이면 빨간 글자 하나뿐.
 */

import { tokyoDateOf } from "@/lib/tokyo-date";
import type { GuestConversationStatus } from "@/lib/guest-messages/types";

export type WaitingConversation = {
  status: GuestConversationStatus;
  snooze_until: string | null;
  last_guest_at: string | null;
  last_reply_at: string | null;
};

export type WaitingResult = {
  /** 손님 말부터 지금까지(분). 기다리지 않으면 0. */
  waitingMinutes: number;
};

/** 이 시간 이상 기다리면 빨간 글자. 고정 규칙 — 설정 없음. */
export const LONG_WAIT_MINUTES = 60;

const MINUTE_MS = 60_000;

export function computeWaiting(conversation: WaitingConversation, now: Date): WaitingResult {
  const idle: WaitingResult = { waitingMinutes: 0 };
  if (!conversation.last_guest_at) return idle;
  if (conversation.status === "done") return idle;
  const lastGuest = Date.parse(conversation.last_guest_at);
  if (Number.isNaN(lastGuest)) return idle;
  if (conversation.last_reply_at && Date.parse(conversation.last_reply_at) >= lastGuest) return idle;
  if (conversation.status === "snoozed" && conversation.snooze_until) {
    const until = Date.parse(conversation.snooze_until);
    if (!Number.isNaN(until) && until > now.getTime()) return idle;
  }
  const elapsed = now.getTime() - lastGuest;
  if (elapsed <= 0) return idle;
  return { waitingMinutes: Math.floor(elapsed / MINUTE_MS) };
}

export function isLongWait(waitingMinutes: number): boolean {
  return waitingMinutes >= LONG_WAIT_MINUTES;
}

export type BookingStateCategory = "inquiry" | "request" | "staying" | "other";

/** 예약 상태 → 화면 한 마디 분류. 숙박 중은 도쿄 오늘이 체크인 ≤ 오늘 < 체크아웃. */
export function bookingStateCategory(
  conversation: { booking_status: string | null; check_in_date: string | null; check_out_date: string | null },
  now: Date,
): BookingStateCategory {
  const status = conversation.booking_status?.trim().toLowerCase() ?? "";
  if (status === "inquiry") return "inquiry";
  if (status === "request") return "request";
  const today = tokyoDateOf(now.toISOString());
  if (
    today &&
    status !== "cancelled" &&
    conversation.check_in_date &&
    conversation.check_out_date &&
    conversation.check_in_date <= today &&
    today < conversation.check_out_date
  ) {
    return "staying";
  }
  return "other";
}
