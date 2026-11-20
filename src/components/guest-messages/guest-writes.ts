"use client";

import {
  addGuestInternalNote,
  retryGuestOutbox,
  sendGuestReply,
  setGuestConversationDone,
  snoozeGuestConversation,
  unsnoozeGuestConversation,
} from "@/actions/guest-messages";
import { GUEST_WRITE_MESSAGE, type PaneMessage } from "@/lib/guest-messages/pane-messages";
import { guestWriteFreshness } from "@/lib/guest-messages/write-freshness";

/**
 * 손님 메시지 쓰기 — 화면은 서버 액션을 바로 부르지 않고 이것을 부른다(2026-11-20, 47 §5-9).
 * 성공하면 이 창의 쓰기 표시를 남겨(`write-freshness`) 캐시에서 되살아난 목록 · 대화가 나타날 때 다시 읽게 한다.
 * 태블릿 칸(iframe) 안이면 바깥 창(왼쪽 목록)에도 알린다(`pane-messages`) — 칸과 목록은 다른 창이라 표시를 나눠 갖지 않는다.
 */

function marked<R extends { ok: boolean }>(conversationId: string, result: R): R {
  if (!result.ok) return result;
  guestWriteFreshness.markWrite(conversationId);
  if (typeof window !== "undefined" && window.parent !== window) {
    window.parent.postMessage({ type: GUEST_WRITE_MESSAGE, id: conversationId } satisfies PaneMessage, window.location.origin);
  }
  return result;
}

export const guestWrites = {
  sendReply: async (input: Parameters<typeof sendGuestReply>[0]) => marked(input.conversationId, await sendGuestReply(input)),
  addNote: async (input: Parameters<typeof addGuestInternalNote>[0]) =>
    marked(input.conversationId, await addGuestInternalNote(input)),
  setDone: async (conversationId: string, done: boolean) => marked(conversationId, await setGuestConversationDone(conversationId, done)),
  snooze: async (conversationId: string, input: Parameters<typeof snoozeGuestConversation>[1]) =>
    marked(conversationId, await snoozeGuestConversation(conversationId, input)),
  unsnooze: async (conversationId: string) => marked(conversationId, await unsnoozeGuestConversation(conversationId)),
  retry: async (conversationId: string, outboxId: string, options?: Parameters<typeof retryGuestOutbox>[1]) =>
    marked(conversationId, await retryGuestOutbox(outboxId, options)),
};
