"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchGuestConversations } from "@/actions/guest-messages";
import type { InboxChannelFilter, InboxConversationRow, InboxStatusFilter } from "@/lib/guest-messages/inbox-model";
import {
  answerOnRunStart,
  normalizeSearchQuery,
  searchViewState,
  type InboxSearchMatch,
  type SearchAnswer,
} from "@/lib/guest-messages/inbox-search";

const DEBOUNCE_MS = 300;

export type InboxSearchHitRow = { row: InboxConversationRow; match: InboxSearchMatch };

type Answer = SearchAnswer<InboxSearchHitRow>;

/** 주소의 `q` 만 바꾼다(서버 렌더 없이) — 필터를 바꿔 다시 그려도, 새로 고쳐도 검색어가 남는다. */
function writeQueryToUrl(query: string) {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * 손님 메시지 검색(47 §5-10) — 입력 300ms 뒤 서버에서 찾는다. 요청마다 번호를 붙여, 늦게 온 옛 답이 새 답을 덮지 않는다.
 * - `active` — 검색어가 2글자 이상이면 목록 대신 결과를 그린다.
 * - `refresh()` — 실시간 신호가 왔을 때 같은 검색어로 조용히 다시 찾는다(보이던 결과는 그대로 두고 갈아 끼운다).
 */
export function useInboxSearch(
  filter: { status: InboxStatusFilter; building: string | null; channel: InboxChannelFilter },
  initialQuery: string,
) {
  const [input, setInput] = useState(initialQuery);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  });
  const query = normalizeSearchQuery(input);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  const run = useCallback(async (q: string) => {
    const mine = ++seq.current;
    setAnswer(answerOnRunStart);
    const result = await searchGuestConversations({ query: q, ...filterRef.current }).catch(() => null);
    if (mine !== seq.current) return;
    setAnswer(
      result?.ok
        ? { query: q, status: "ready", results: result.results, truncated: result.truncated }
        : { query: q, status: "error" },
    );
  }, []);

  const schedule = useCallback(
    (q: string | null, delay: number) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      if (!q) {
        seq.current += 1;
        return;
      }
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void run(q);
      }, delay);
    },
    [run],
  );

  useEffect(() => {
    const first = normalizeSearchQuery(initialQuery);
    if (first) schedule(first, 0);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      seq.current += 1;
    };
    // 처음 한 번 — 주소에 검색어가 있으면 바로 찾는다(필터를 바꿔 다시 그린 경우 포함).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = useCallback(
    (value: string) => {
      setInput(value);
      const q = normalizeSearchQuery(value);
      writeQueryToUrl(q ?? "");
      // 지운 뒤 같은 말을 다시 쳤을 때 예전 결과가 새 결과처럼 보이지 않게.
      if (!q) setAnswer(null);
      schedule(q, DEBOUNCE_MS);
    },
    [schedule],
  );

  const submit = useCallback(() => schedule(queryRef.current, 0), [schedule]);
  const clear = useCallback(() => change(""), [change]);
  const refresh = useCallback(() => {
    if (queryRef.current && timer.current === null) void run(queryRef.current);
  }, [run]);

  const { current, loading, stale } = searchViewState(answer, query);
  return {
    input,
    query,
    active: query !== null,
    /** 검색어는 있는데 2글자가 안 된다. */
    tooShort: query === null && input.trim().length > 0,
    loading,
    answer: current,
    /** 새 검색어의 답을 기다리는 동안 앞 결과를 흐리게 둔다(빈 화면 깜빡임 대신). */
    stale,
    change,
    submit,
    clear,
    refresh,
  };
}
