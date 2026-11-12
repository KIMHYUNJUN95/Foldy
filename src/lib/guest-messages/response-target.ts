/**
 * 응답 목표 시간 — 「기다린 시간」 계산. **순수**, 도쿄 기준. docs/product/47-guest-messaging.md §6-1
 *
 * - 기다린 시간 = 마지막 손님 말 이후 우리 답장(또는 「처리 끝」)이 없는 시간. 내부 메모는 답장이 아니다
 *   (`last_reply_at` 에는 host 메시지만 들어간다 — `ingest-plan.ts`).
 * - 「나중에」(snoozed)가 안 끝났으면 기다리지 않는 것으로 본다. 끝났으면 그 시각부터 다시 센다(직원이 그때 보겠다고 정했으니).
 * - `night_pause` 가 켜져 있으면 도쿄 23:00–07:00 은 세지 않는다. 날 · 달 · 해 경계는 `tokyo-date.ts` 로 넘긴다(UTC 자르기 금지).
 */

import { tokyoDateOf, tokyoDayStart, ymdShift } from "@/lib/tokyo-date";
import type {
  GuestConversationStatus,
  GuestMessageSettings,
  ResponseTargetCategory,
} from "@/lib/guest-messages/types";

export type WaitingConversation = {
  status: GuestConversationStatus;
  snooze_until: string | null;
  last_guest_at: string | null;
  last_reply_at: string | null;
  booking_status: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
};

export type WaitingResult = {
  waitingMinutes: number;
  targetMinutes: number;
  /** waiting / target. 기다리지 않으면 0. */
  ratio: number;
  overdue: boolean;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** 밤 구간: 그날 0시 기준 -1시간(전날 23:00) ~ +7시간(07:00). */
const NIGHT_START_OFFSET_MS = -1 * HOUR_MS;
const NIGHT_END_OFFSET_MS = 7 * HOUR_MS;

/** 예약 상태 → 응답 목표 분류. 숙박 중은 도쿄 오늘이 체크인 ≤ 오늘 < 체크아웃. */
export function responseTargetCategory(
  conversation: Pick<WaitingConversation, "booking_status" | "check_in_date" | "check_out_date">,
  now: Date,
): ResponseTargetCategory {
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

/** [startMs, endMs) 안에서 도쿄 밤(23:00–07:00)에 걸친 밀리초. */
export function tokyoNightOverlapMs(startMs: number, endMs: number): number {
  if (!(endMs > startMs)) return 0;
  const firstDay = tokyoDateOf(new Date(startMs).toISOString());
  const lastDay = tokyoDateOf(new Date(endMs).toISOString());
  if (!firstDay || !lastDay) return 0;
  let total = 0;
  // 시작 날의 밤(전날 23:00 부터)과 끝 다음 날 밤(끝 날 23:00 부터)까지 덮는다.
  for (let day = firstDay; day <= ymdShift(lastDay, 1); day = ymdShift(day, 1)) {
    const midnight = Date.parse(tokyoDayStart(day));
    const nightStart = midnight + NIGHT_START_OFFSET_MS;
    const nightEnd = midnight + NIGHT_END_OFFSET_MS;
    const overlap = Math.min(endMs, nightEnd) - Math.max(startMs, nightStart);
    if (overlap > 0) total += overlap;
  }
  return total;
}

export function computeWaiting(
  conversation: WaitingConversation,
  settings: Pick<GuestMessageSettings, "responseTargetMinutes" | "nightPause">,
  now: Date,
): WaitingResult {
  const targetMinutes = settings.responseTargetMinutes[responseTargetCategory(conversation, now)];
  const idle: WaitingResult = { waitingMinutes: 0, targetMinutes, ratio: 0, overdue: false };

  if (!conversation.last_guest_at) return idle;
  if (conversation.status === "done") return idle;
  const lastGuest = Date.parse(conversation.last_guest_at);
  if (Number.isNaN(lastGuest)) return idle;
  if (conversation.last_reply_at && Date.parse(conversation.last_reply_at) >= lastGuest) return idle;

  let startMs = lastGuest;
  if (conversation.status === "snoozed" && conversation.snooze_until) {
    const until = Date.parse(conversation.snooze_until);
    if (!Number.isNaN(until)) {
      if (until > now.getTime()) return idle;
      startMs = Math.max(startMs, until);
    }
  }

  const endMs = now.getTime();
  if (endMs <= startMs) return idle;
  let elapsed = endMs - startMs;
  if (settings.nightPause) elapsed -= tokyoNightOverlapMs(startMs, endMs);
  const waitingMinutes = Math.max(0, Math.floor(elapsed / MINUTE_MS));
  const ratio = targetMinutes > 0 ? waitingMinutes / targetMinutes : 0;
  return { waitingMinutes, targetMinutes, ratio, overdue: waitingMinutes > targetMinutes };
}
