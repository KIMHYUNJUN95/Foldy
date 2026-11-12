"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import {
  getGuestConversation,
  setGuestConversationDone,
  snoozeGuestConversation,
  unsnoozeGuestConversation,
  type GuestMessageErrorKey,
} from "@/actions/guest-messages";
import type { InboxRowState, InboxThread, SnoozeInput } from "@/lib/guest-messages/inbox-model";
import { haptic } from "@/lib/haptics";

/**
 * 대화 한 건 읽기 · 상태 바꾸기(처리 끝 · 나중에) — PC · 모바일 공용.
 * 「처리 끝」은 바로 반영(`useOptimistic`, 16 「줄 접힘 · 즉시 반영」) — 실패하면 저절로 되돌아간다.
 */
export function useThread(conversationId: string | null, initial: InboxThread | null) {
  // 읽은 대화는 id 와 함께 둔다 — 고른 대화가 바뀌면 다른 id 의 것은 버리고(렌더에서 판정) 새로 읽는다.
  const [entry, setEntry] = useState<{
    id: string;
    thread: InboxThread | null;
    error: GuestMessageErrorKey | null;
  } | null>(null);
  const fromInitial = initial && initial.conversation.id === conversationId ? initial : null;
  const current = entry && entry.id === conversationId ? entry : null;
  const thread = current?.thread ?? fromInitial;
  const error = current && !current.thread ? current.error : null;
  const loading = Boolean(conversationId) && !thread && !error;
  const [pending, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useOptimistic<InboxRowState | null, InboxRowState>(
    thread?.conversation.state ?? null,
    (_current, next) => next,
  );
  const latest = useRef(conversationId);
  useEffect(() => {
    latest.current = conversationId;
  }, [conversationId]);

  const load = useCallback(async (id: string, quiet: boolean) => {
    const result = await getGuestConversation(id);
    if (latest.current !== id) return;
    if (result.ok) {
      setEntry({ id, thread: result.thread, error: null });
    } else {
      // 조용히 다시 읽다 실패하면 보던 대화를 그대로 둔다.
      setEntry((prev) => (quiet && prev?.id === id && prev.thread ? prev : { id, thread: null, error: result.errorKey }));
    }
  }, []);

  const hasThread = Boolean(thread);
  useEffect(() => {
    if (!conversationId || hasThread) return;
    // 서버에서 읽어 오는 외부 동기화 — setState 는 응답이 온 뒤(await 뒤)에만 일어난다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(conversationId, false);
  }, [conversationId, hasThread, load]);

  const refresh = useCallback(() => {
    if (conversationId) void load(conversationId, true);
  }, [conversationId, load]);

  const run = useCallback(
    (
      optimistic: InboxRowState | null,
      work: () => Promise<{ ok: true } | { ok: false; errorKey: GuestMessageErrorKey }>,
      onDone: (result: { ok: true } | { ok: false; errorKey: GuestMessageErrorKey }) => void,
    ) => {
      startTransition(async () => {
        if (optimistic) setOptimisticState(optimistic);
        const result = await work();
        onDone(result);
        if (result.ok && conversationId) await load(conversationId, true);
      });
    },
    [conversationId, load, setOptimisticState],
  );

  const setDone = useCallback(
    (done: boolean, onDone: (result: { ok: true } | { ok: false; errorKey: GuestMessageErrorKey }) => void) => {
      if (!conversationId) return;
      haptic("light");
      run(done ? "done" : "awaiting", () => setGuestConversationDone(conversationId, done), onDone);
    },
    [conversationId, run],
  );

  const snooze = useCallback(
    (input: SnoozeInput, onDone: (result: { ok: true; snoozeUntil?: string } | { ok: false; errorKey: GuestMessageErrorKey }) => void) => {
      if (!conversationId) return;
      haptic("light");
      run("snoozed", () => snoozeGuestConversation(conversationId, input), onDone);
    },
    [conversationId, run],
  );

  const unsnooze = useCallback(
    (onDone: (result: { ok: true } | { ok: false; errorKey: GuestMessageErrorKey }) => void) => {
      if (!conversationId) return;
      haptic("light");
      run(null, () => unsnoozeGuestConversation(conversationId), onDone);
    },
    [conversationId, run],
  );

  return {
    thread,
    error,
    loading,
    pending,
    state: optimisticState,
    refresh,
    setDone,
    snooze,
    unsnooze,
  };
}
