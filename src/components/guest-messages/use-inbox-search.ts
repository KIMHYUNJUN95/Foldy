"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { searchGuestConversations } from "@/actions/guest-messages";
import type { InboxChannelFilter, InboxConversationRow } from "@/lib/guest-messages/inbox-model";
import {
  answerOnRunStart,
  normalizeSearchQuery,
  searchViewState,
  type InboxSearchMatch,
  type SearchAnswer,
} from "@/lib/guest-messages/inbox-search";
import { createSearchRunner, type SearchRunner } from "@/lib/guest-messages/search-runner";

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
 * 손님 메시지 검색(47 §5-10) — 입력이 300ms 멈추면 서버에서 찾는다. 언제 물을지는 `createSearchRunner` 가 정한다:
 * 지난 검색어의 답은 버리고, 묻는 동안 새 말은 마지막 하나만 기다리며, 주소 `q` 는 입력이 멈춘 뒤에 쓴다
 * (그 전에 누르거나 화면이 사라지면 그때 바로 — 목록 화면 주소일 때만).
 * - `active` — 검색어가 2글자 이상이면 목록 대신 결과를 그린다.
 * - `refresh()` — 내 손으로 바꾼 뒤 같은 검색어로 바로 다시 찾는다(보이던 결과는 그대로 두고 갈아 끼운다).
 * - `live()` — 실시간 신호. 신호마다 찾지 않고 간격을 두고 모아서 한 번(입력 중이면 건너뜀).
 * 검색은 상태 탭을 보지 않는다(받지도 않는다). 그래서 이 훅은 상태 탭 `key` 바깥(`InboxSearchProvider`)에 둔다 — 탭을 바꿔도
 * 러너 · 결과가 그대로 살아 있어 다시 묻지도 · 깜빡이지도 않고, 바꾸기 직전에 보낸 refresh 의 답도 버려지지 않는다.
 */
export function useInboxSearch(
  filter: { building: string | null; channel: InboxChannelFilter },
  initialQuery: string,
) {
  const [input, setInput] = useState(initialQuery);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  });
  // 결과 목록 다시 그리기는 입력보다 뒤로 — 글자 치는 칸은 늘 바로 반응한다.
  const query = normalizeSearchQuery(useDeferredValue(input));
  const runner = useRef<SearchRunner | null>(null);

  useEffect(() => {
    const listPath = window.location.pathname;
    const instance = createSearchRunner({
      fetch: (q) => searchGuestConversations({ query: q, ...filterRef.current }),
      onStart: () => setAnswer(answerOnRunStart),
      onResult: (q, result) =>
        setAnswer(
          result?.ok
            ? { query: q, status: "ready", results: result.results, truncated: result.truncated, bodyRecentOnly: result.bodyRecentOnly }
            : { query: q, status: "error" },
        ),
      // 목록 화면 주소에만 쓴다 — 이미 다른 화면(대화 상세)으로 넘어간 뒤 사라지며 쓰면 그 화면 주소를 망친다.
      onCommit: (q) => {
        if (window.location.pathname === listPath) writeQueryToUrl(q ?? "");
      },
    });
    runner.current = instance;
    // 입력이 멈추기 전(300ms 안)에 대화 · 탭을 눌러 떠나도 마지막 검색어가 주소에 남게 — 누르는 순간(이동 전) 먼저 쓴다.
    // 사라질 때(dispose)도 쓰지만, 그때는 주소가 이미 다음 화면이라 위 확인에서 걸러진다(같은 화면 다시 그리기만 쓴다).
    const flushBeforeLeave = () => instance.flush();
    document.addEventListener("click", flushBeforeLeave, true);
    window.addEventListener("pagehide", flushBeforeLeave);
    // 처음 한 번 — 주소에 검색어가 있으면 바로 찾는다.
    const first = normalizeSearchQuery(initialQuery);
    if (first) instance.submit(first);
    return () => {
      document.removeEventListener("click", flushBeforeLeave, true);
      window.removeEventListener("pagehide", flushBeforeLeave);
      instance.dispose();
      runner.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = useCallback((value: string) => {
    setInput(value);
    const q = normalizeSearchQuery(value);
    // 지운 뒤 같은 말을 다시 쳤을 때 예전 결과가 새 결과처럼 보이지 않게.
    if (!q) setAnswer(null);
    runner.current?.type(q);
  }, []);

  const submit = useCallback(() => runner.current?.submit(normalizeSearchQuery(input)), [input]);
  const clear = useCallback(() => change(""), [change]);
  const refresh = useCallback(() => runner.current?.refresh(), []);
  const live = useCallback(() => runner.current?.live(), []);

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
    live,
  };
}
