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
import { createKeyedSingleFlight, mergeThread } from "@/lib/guest-messages/live-merge";

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

  // 지금 보이는 대화 — 조용히 다시 읽은 것을 여기에 합친다(서버가 처음 준 것을 보고 있을 때도).
  const shown = useRef(thread);
  useEffect(() => {
    shown.current = thread;
  });
  // 같은 대화 읽기는 하나로 — 진행 중에 또 부르면(실시간 신호 · 내 쓰기) 끝난 뒤 한 번 더 읽고 마지막 것만 반영한다.
  // 그래서 「처리 끝」의 전환은 최신 값이 들어온 뒤에 끝나고, `useOptimistic` 이 옛 상태로 잠깐 되돌아가지 않는다(47 §5-9).
  const flight = useRef<((id: string) => Promise<void>) | null>(null);
  const load = useCallback((id: string) => {
    flight.current ??= createKeyedSingleFlight<string, Awaited<ReturnType<typeof getGuestConversation>>>(
      (id) => getGuestConversation(id),
      (id, result) => {
        if (result.ok) {
          // 그대로인 말 · 예약 · 자동 안내는 같은 객체로 둔다 — 쓰던 답장 · 열린 시트 · 사진이 흔들리지 않게.
          setEntry((prev) => {
            const base = prev?.id === id && prev.thread ? prev.thread : shown.current?.conversation.id === id ? shown.current : null;
            const merged = mergeThread(base, result.thread);
            return prev?.id === id && prev.thread === merged ? prev : { id, thread: merged, error: null };
          });
        } else {
          // 다시 읽다 실패하면 보던 대화를 그대로 둔다(처음 읽기면 오류 화면).
          setEntry((prev) => (prev?.id === id && prev.thread ? prev : { id, thread: null, error: result.errorKey }));
        }
      },
      (id) => latest.current === id,
    );
    return flight.current(id);
  }, []);

  const hasThread = Boolean(thread);
  useEffect(() => {
    if (!conversationId || hasThread) return;
    // 서버에서 읽어 오는 외부 동기화 — setState 는 응답이 온 뒤(await 뒤)에만 일어난다.
    void load(conversationId);
  }, [conversationId, hasThread, load]);

  /** 조용히 다시 읽기 — 실시간 신호 · 내 쓰기 뒤. 실패하면 보던 대화를 그대로 둔다. */
  const refresh = useCallback(() => {
    if (conversationId) void load(conversationId);
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
        if (result.ok && conversationId) await load(conversationId);
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
