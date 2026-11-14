"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { countAppended } from "@/lib/guest-messages/live-merge";
import type { InboxThread } from "@/lib/guest-messages/inbox-model";

/** 맨 아래로 볼 거리(px) — 이만큼 안이면 「맨 아래에 있다」. */
const BOTTOM_SLACK = 80;

/** 대화를 감싼 스크롤 칸(PC 대화 칸 · 모바일 셸 본문) — 실제로 넘치는 칸이 먼저, 없으면 첫 스크롤 칸, 그것도 없으면 문서. */
function scrollerOf(anchor: HTMLElement | null): HTMLElement | null {
  let el = anchor?.parentElement ?? null;
  let first: HTMLElement | null = null;
  while (el) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      if (el.scrollHeight > el.clientHeight) return el;
      first ??= el;
    }
    el = el.parentElement;
  }
  return first ?? (typeof document !== "undefined" ? (document.scrollingElement as HTMLElement | null) : null);
}

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
}

/**
 * 대화 따라가기(47 §5-9) — 맨 아래에 있으면 새 말을 따라 내려가고, 위로 올려 읽는 중이면 자리를 지키고 「새 메시지」 숫자를 센다.
 * 대화를 처음 열 때 · 바꿀 때는 맨 아래로. 내가 보낸 직후(`follow()`)는 올려 둔 상태여도 내려간다.
 */
export function useThreadFollow(thread: InboxThread | null) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const followNext = useRef(false);
  const seenIds = useRef<Set<string>>(new Set());
  const seenConversation = useRef<string | null>(null);
  const [unseen, setUnseen] = useState(0);

  const conversationId = thread?.conversation.id ?? null;
  const messages = thread?.messages;
  const lastId = messages?.[messages.length - 1]?.id ?? null;
  // 말이 하나도 없으면 끝 표시가 없다 — 첫 말이 생기면 스크롤 칸을 다시 찾는다.
  const hasMessages = lastId !== null;

  const toEnd = useCallback((smooth: boolean) => {
    const el = scrollerOf(endRef.current);
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
    atBottom.current = true;
  }, []);

  // 스크롤할 때마다 「맨 아래인가」를 적어 둔다 — 새 말이 붙기 **전** 자리로 따라갈지 정한다.
  useEffect(() => {
    if (!conversationId) return;
    const el = scrollerOf(endRef.current);
    if (!el) return;
    const target: HTMLElement | Window = el === document.scrollingElement ? window : el;
    const onScroll = () => {
      atBottom.current = isAtBottom(el);
      if (atBottom.current) setUnseen((n) => (n === 0 ? n : 0));
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [conversationId, hasMessages]);

  useLayoutEffect(() => {
    if (!conversationId || !messages) return;
    if (seenConversation.current !== conversationId) {
      seenConversation.current = conversationId;
      seenIds.current = new Set(messages.map((m) => m.id));
      followNext.current = false;
      // 다른 대화로 바뀌었다 — 숫자를 비우고 맨 아래로(예전 동작 그대로).
      setUnseen(0);
      toEnd(false);
      return;
    }
    const appended = countAppended(seenIds.current, messages);
    seenIds.current = new Set(messages.map((m) => m.id));
    if (appended === 0 && !followNext.current) return;
    if (atBottom.current || followNext.current) {
      followNext.current = false;
      toEnd(true);
    } else {
      setUnseen((n) => n + appended);
    }
  }, [conversationId, lastId, messages, toEnd]);

  const jump = useCallback(() => {
    setUnseen(0);
    toEnd(true);
  }, [toEnd]);

  /** 내가 보낸 직후 — 올려 둔 상태여도 다음 새 말에 내려간다. */
  const follow = useCallback(() => {
    followNext.current = true;
  }, []);

  return { endRef, unseen, jump, follow };
}

/**
 * 「새 메시지」 — 위로 올려 읽는 동안 새 말이 오면 답장 칸 위에 뜬다. 누르면 맨 아래로. 들어오고 나가는 움직임은 같은 전환이라
 * 중간에 끊겨도 자연스럽다. 숫자는 화면 읽기 프로그램에 조용히(polite) 알린다. 햅틱 없음(들어온 말은 내 동작이 아니다 — 16 「햅틱」).
 */
export function NewMessagesPill({ count, copy, onJump }: { count: number; copy: GmCopy; onJump: () => void }) {
  const shown = count > 0;
  return (
    <>
      <button
        type="button"
        className="gm-newpill"
        data-shown={shown ? "" : undefined}
        data-press="off"
        aria-hidden={shown ? undefined : true}
        tabIndex={shown ? undefined : -1}
        onClick={onJump}
      >
        <span className="gm-newpill__face">
          <ArrowDown />
          {copy.liveNewMessages}
          {count > 1 ? <span className="gm-newpill__n">{count}</span> : null}
        </span>
      </button>
      <span className="gm-sr-only" role="status" aria-live="polite">
        {shown ? fill(copy.liveNewMessagesCount, { n: count }) : ""}
      </span>
    </>
  );
}

function ArrowDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}
