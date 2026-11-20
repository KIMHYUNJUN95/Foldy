"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { getGuestConversation, type GuestMessageErrorKey } from "@/actions/guest-messages";
import { guestWrites } from "@/components/guest-messages/guest-writes";
import { beginNavBadgeRead, reportNavBadge } from "@/components/shared/nav-badge-overrides";
import { guestWriteFreshness } from "@/lib/guest-messages/write-freshness";
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
  const current = entry && entry.id === conversationId ? entry : null;
  // 서버가 준 대화(`initial`)를 보여 주려는데 받은 뒤 이 창에서 이 대화에 썼다(캐시에서 되살아난 화면 · PC 에서 처음 연 대화로 돌아옴)
  // → 그 옛 값을 그리지 않고 로딩으로, 아래 첫 읽기가 새로 읽는다(47 §5-9, `write-freshness`). 판정은 대화 · initial 이 바뀔 때 한 번만 —
  // 보는 중에 쓴 것(답장 · 처리 끝)으로 화면이 로딩으로 깜빡이지 않게. 판정 함수는 순수하다(번호는 아래 효과에서 받을 때 붙인다).
  const [initialCheck, setInitialCheck] = useState(() => ({
    id: conversationId,
    initial,
    stale: guestWriteFreshness.shownInitialIsStale(initial, conversationId, false),
  }));
  let staleInitial = initialCheck.stale;
  if (initialCheck.id !== conversationId || initialCheck.initial !== initial) {
    staleInitial = guestWriteFreshness.shownInitialIsStale(initial, conversationId, Boolean(current));
    setInitialCheck({ id: conversationId, initial, stale: staleInitial });
  }
  const fromInitial = initial && initial.conversation.id === conversationId && !staleInitial ? initial : null;
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
      (id) => {
        const at = beginNavBadgeRead();
        return getGuestConversation(id).then((result) => {
          // 메뉴 숫자(탭바 · 서랍 · 레일 · 사이드바) — 서버 렌더를 다시 받지 않으니 대화 읽기가 같이 가져온 수로 고친다.
          if (result.ok) reportNavBadge("messages", result.navAwaitingCount, at);
          return result;
        });
      },
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

  // 서버가 준 대화를 받았다 — 받은 때 번호를 붙인다(읽어 둔 대화를 보이는 중에 온 새 initial 도).
  useEffect(() => {
    if (initial) guestWriteFreshness.observe(initial);
  }, [initial]);

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
      run(done ? "done" : "awaiting", () => guestWrites.setDone(conversationId, done), onDone);
    },
    [conversationId, run],
  );

  const snooze = useCallback(
    (input: SnoozeInput, onDone: (result: { ok: true; snoozeUntil?: string } | { ok: false; errorKey: GuestMessageErrorKey }) => void) => {
      if (!conversationId) return;
      haptic("light");
      run("snoozed", () => guestWrites.snooze(conversationId, input), onDone);
    },
    [conversationId, run],
  );

  const unsnooze = useCallback(
    (onDone: (result: { ok: true } | { ok: false; errorKey: GuestMessageErrorKey }) => void) => {
      if (!conversationId) return;
      haptic("light");
      run(null, () => guestWrites.unsnooze(conversationId), onDone);
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
