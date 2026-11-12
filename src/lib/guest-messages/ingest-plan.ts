/**
 * 받은 메시지를 어떻게 넣을지 정한다 — **순수**. DB 는 `store.ts` 가 이 결과대로 쓴다.
 * docs/product/47-guest-messaging.md §4 「중복 막기」 · 「보낸 메시지 되돌아옴」 · §6-1
 */

import type { GuestConversationStatus, NormalizedMessage } from "@/lib/guest-messages/types";

/**
 * 보냈거나 보내는 중인 발송 큐 줄(status = sent · sending · uncertain) — 되돌아온 host 메시지와 맞춘다.
 * `sending` · `uncertain` 도 본다: 발송 작업이 결과를 저장하기 전에 웹훅이 먼저 올 수 있고(경합),
 * 결과를 모르는 줄은 되돌아옴이 곧 「나갔다」는 증거다.
 */
export type SentOutboxRow = {
  id: string;
  status?: "sent" | "sending" | "uncertain";
  external_id: string | null;
  body: string;
  sent_at: string | null;
  created_at?: string | null;
};

export type EchoMerge = {
  message: NormalizedMessage;
  outboxId: string;
  /** 외부 번호로 맞췄나(아니면 같은 글 · 가까운 시각으로 맞춤). */
  matchedBy: "external_id" | "body";
};

export type IngestPlan = {
  inserts: NormalizedMessage[];
  echoMerges: EchoMerge[];
  /** 이미 있는 번호 — 건너뜀. */
  duplicates: number;
  /** 이미 있는데 읽음 표시가 없던 줄 중, 이번에 통로가 읽음이라고 준 것 — `read_at` 을 채운다. */
  markReadExternalIds: string[];
};

/** 번호를 모르는 보낸 줄을 글로 맞출 때 허용하는 시각 차이. */
export const ECHO_BODY_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

export function planIngest(args: {
  incoming: readonly NormalizedMessage[];
  existingExternalIds: ReadonlySet<string>;
  /** 이미 있는 줄 중 `read_at` 이 비어 있는 번호. */
  existingUnreadExternalIds?: ReadonlySet<string>;
  sentOutbox: readonly SentOutboxRow[];
}): IngestPlan {
  const inserts: NormalizedMessage[] = [];
  const markRead = new Set<string>();
  const echoMerges: EchoMerge[] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  const usedOutbox = new Set<string>();
  const byExternal = new Map<string, SentOutboxRow>();
  for (const row of args.sentOutbox) {
    if (row.external_id) byExternal.set(row.external_id, row);
  }

  const ordered = [...args.incoming].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  for (const message of ordered) {
    if (seen.has(message.externalId) || args.existingExternalIds.has(message.externalId)) {
      if (message.read && args.existingUnreadExternalIds?.has(message.externalId)) markRead.add(message.externalId);
      duplicates += 1;
      continue;
    }
    seen.add(message.externalId);

    if (message.direction === "host") {
      const exact = byExternal.get(message.externalId);
      if (exact && !usedOutbox.has(exact.id)) {
        usedOutbox.add(exact.id);
        echoMerges.push({ message, outboxId: exact.id, matchedBy: "external_id" });
        continue;
      }
      const target = normalizeBody(message.body);
      const sentAt = Date.parse(message.sentAt);
      const byBody = args.sentOutbox.find(
        (row) =>
          !row.external_id &&
          !usedOutbox.has(row.id) &&
          normalizeBody(row.body) === target &&
          Math.abs(Date.parse(row.sent_at ?? row.created_at ?? message.sentAt) - sentAt) <= ECHO_BODY_MATCH_WINDOW_MS,
      );
      if (byBody) {
        usedOutbox.add(byBody.id);
        echoMerges.push({ message, outboxId: byBody.id, matchedBy: "body" });
        continue;
      }
    }
    inserts.push(message);
  }
  return { inserts, echoMerges, duplicates, markReadExternalIds: [...markRead] };
}

export type ConversationStateFields = {
  status: GuestConversationStatus;
  snooze_until: string | null;
  last_guest_at: string | null;
  last_reply_at: string | null;
  last_message_at: string | null;
};

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : null);

/** 대화를 새로 만들 때, 이보다 오래된 손님 말은 「답장 기다림」을 만들지 않는다(웹훅은 이력 전체를 싣는다). */
export const NEW_CONVERSATION_STALE_MS = 48 * 60 * 60 * 1000;

/** DB 함수 `guest_conversation_apply_messages` 에 넘길 값. */
export type ApplyMessagesParams = {
  guestAt: string | null;
  /** 「답장 기다림」을 만들 수 있는 손님 말(안 읽음)의 가장 늦은 시각. */
  unreadGuestAt: string | null;
  replyAt: string | null;
  messageAt: string | null;
};

/**
 * 새로 들어온 메시지(넣은 것 + 합친 것) → DB 함수 인자.
 * - 통로가 이미 읽음(`read = true`)이라고 준 손님 말은 기다림을 만들지 않는다(누군가 Beds24 에서 이미 봤다).
 * - 새 대화이고 가장 늦은 안 읽은 손님 말이 48시간보다 오래됐으면 기다림을 만들지 않는다(첫 웹훅의 옛 이력).
 * - 내부 메모 · 시스템 줄은 시각만 남기고(last_message_at) 답장으로 치지 않는다.
 */
export function summarizeAddedMessages(
  added: readonly Pick<NormalizedMessage, "direction" | "sentAt" | "read">[],
  options: { isNewConversation: boolean; now: Date },
): ApplyMessagesParams {
  let guestAt: string | null = null;
  let unreadGuestAt: string | null = null;
  let replyAt: string | null = null;
  let messageAt: string | null = null;
  for (const message of added) {
    messageAt = maxIso(messageAt, message.sentAt);
    if (message.direction === "guest") {
      guestAt = maxIso(guestAt, message.sentAt);
      if (!message.read) unreadGuestAt = maxIso(unreadGuestAt, message.sentAt);
    } else if (message.direction === "host") {
      replyAt = maxIso(replyAt, message.sentAt);
    }
  }
  if (
    options.isNewConversation &&
    unreadGuestAt &&
    Date.parse(unreadGuestAt) < options.now.getTime() - NEW_CONVERSATION_STALE_MS
  ) {
    unreadGuestAt = null;
  }
  return { guestAt, unreadGuestAt, replyAt, messageAt };
}

/**
 * 대화 상태 바꾸기 — **DB 함수 `guest_conversation_apply_messages`(마이그레이션 202611120002 → 202611130001 에서 다시 정의)의 거울**. 실제 저장은 DB 함수가
 * 한 문장으로 한다(읽고 → 고치기 사이에 직원 「처리 끝」이 덮이지 않게). 이 함수는 규칙 시험용이고, 둘을 고칠 때는 함께 고친다.
 *
 * - 시각 칸은 뒤로 가지 않는다.
 * - 「답장 기다림」: 새 안 읽은 손님 말이 지금까지의 손님 말 · 답장보다 모두 나중일 때만. 「나중에」가 안 끝났으면 snoozed 그대로.
 * - 답장이 마지막 손님 말 이후면 awaiting → done.
 */
export function nextConversationState(
  current: ConversationStateFields,
  params: ApplyMessagesParams,
  now: Date,
): ConversationStateFields {
  const lastGuest = maxIso(current.last_guest_at, params.guestAt);
  const lastReply = maxIso(current.last_reply_at, params.replyAt);
  const lastMessage = maxIso(current.last_message_at, params.messageAt);
  const unread = ms(params.unreadGuestAt);
  const reopens =
    unread !== null &&
    (current.last_guest_at === null || unread > Date.parse(current.last_guest_at)) &&
    (lastReply === null || unread > Date.parse(lastReply));
  const snoozeActive =
    current.status === "snoozed" && !!current.snooze_until && Date.parse(current.snooze_until) > now.getTime();

  let status = current.status;
  let snoozeUntil = current.snooze_until;
  if (reopens) {
    if (!snoozeActive) {
      status = "awaiting";
      snoozeUntil = null;
    }
  } else if (
    // 끝난 「나중에」는 답장 기다림과 같이 본다(202611130001 판).
    (current.status === "awaiting" || (current.status === "snoozed" && !snoozeActive)) &&
    params.replyAt !== null &&
    lastReply !== null &&
    Date.parse(lastReply) >= (lastGuest ? Date.parse(lastGuest) : -Infinity)
  ) {
    status = "done";
    snoozeUntil = null;
  }
  return { status, snooze_until: snoozeUntil, last_guest_at: lastGuest, last_reply_at: lastReply, last_message_at: lastMessage };
}
