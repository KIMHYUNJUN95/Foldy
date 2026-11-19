"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadBeds24CreditCalls } from "@/actions/beds24-credit";
import {
  appendCreditCallPage,
  creditCallCursor,
  creditCallListKey,
  creditCallRetryTarget,
  groupCreditCalls,
  isCreditCallFilterOn,
  isCurrentCreditCallResponse,
  mergeCreditCallHead,
  NO_CREDIT_CALL_FILTER,
  startCreditCallList,
  toggleCreditCallFilter,
  toggleCreditCallGroup,
  type CreditCallFailure,
  type CreditCallGroup,
  type CreditCallList,
} from "@/lib/beds24-credit-view";
import { settleWithin, LIVE_REQUEST_TIMEOUT_MS } from "@/lib/live-request";
import type {
  Beds24CreditCallCursor,
  Beds24CreditCallFilter,
  Beds24CreditCallPage,
  Beds24CreditDetail,
  Beds24CreditRange,
} from "@/lib/beds24/credit-usage-types";

/**
 * Beds24 크레딧 「최근 호출」 목록 — PC 관제실 칸과 모바일 자동화 칸이 같이 쓴다(2026-11-18).
 *
 * - 첫 장은 상세 응답(`recentCalls`)이 준다. 거르기가 걸려 있으면 상세와 따로 첫 장을 읽는다.
 * - 자동 갱신으로 온 첫 장은 위에 합치고, 「더 보기」로 받은 아래 줄 · 펼친 묶음 · 거르기는 그대로 둔다.
 * - 기간 · 거르기를 바꾸면 목록을 새로 시작한다(세대 +1) — 그 전에 보낸 응답은 버린다. 첫 장이 빈틈을 알아채 다시 시작할 때도 같다.
 * - 오류 띠는 마지막에 실패한 읽기(첫 장 · 더 보기)를 기억하고, 어느 쪽이든 목록 반영이 성공하면 지운다.
 * 판정은 모두 `beds24-credit-view.ts` 의 순수 함수.
 */

export async function fetchCalls(
  range: Beds24CreditRange,
  filter: Beds24CreditCallFilter,
  cursor: Beds24CreditCallCursor | null,
): Promise<Beds24CreditCallPage | null> {
  try {
    // 응답이 끝나지 않는 액션(Next 액션 줄에서 잃어버린 요청)에 「더 보기」 · 첫 장이 영영 묶이지 않게.
    const result = await settleWithin(loadBeds24CreditCalls(range, filter, cursor), LIVE_REQUEST_TIMEOUT_MS);
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

/** 스크롤 부모 — 모바일 셸은 자기 칸이 스크롤된다. 없으면 문서. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

export function useBeds24CreditCalls(initial: Beds24CreditDetail | null) {
  const [filter, setFilter] = useState<Beds24CreditCallFilter>(NO_CREDIT_CALL_FILTER);
  const [list, setList] = useState<CreditCallList>(() =>
    startCreditCallList(creditCallListKey(initial?.range ?? "today", NO_CREDIT_CALL_FILTER), 0, initial?.recentCalls ?? null),
  );
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingHead, setLoadingHead] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState<CreditCallFailure>(null);

  // 응답 판정은 그린 값이 아니라 지금 값으로 — 상태 갱신 전에 온 응답도 바로 가린다.
  const listRef = useRef(list);
  const rangeRef = useRef<Beds24CreditRange>(initial?.range ?? "today");
  const filterRef = useRef(filter);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<{ row: string; top: number } | null>(null);

  // 같은 목록(세대)에서만 「더 보기」 겹침을 막는다 — 새로 시작한 목록의 「더 보기」는 옛 요청을 기다리지 않는다.
  const inMore = useRef<number | null>(null);
  // 첫 장(로딩 표시를 켠) 요청 순번 — 마지막 요청이 끝나면 표시를 끈다(응답을 버려도).
  const headSeq = useRef(0);

  /** 목록 반영 — 반영은 성공이라 오류 띠를 지운다. 세대가 바뀌면(다시 시작) 그 전 「더 보기」의 표시 · 잠금을 푼다. */
  const apply = useCallback((next: CreditCallList, keepScroll: boolean) => {
    // 위에 새 줄이 붙어도 보던 줄이 제자리에 있게 — 화면에 걸친 첫 줄의 위치를 기억해 그린 뒤 맞춘다.
    anchor.current = null;
    const root = rootRef.current;
    if (keepScroll && root && root.getBoundingClientRect().top < 0) {
      const rows = root.querySelectorAll<HTMLElement>("[data-row]");
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > 0) {
          anchor.current = { row: row.dataset.row ?? "", top: rect.top };
          break;
        }
      }
    }
    if (next.generation !== listRef.current.generation) {
      inMore.current = null;
      setLoadingMore(false);
    }
    listRef.current = next;
    setList(next);
    setFailed(null);
  }, []);

  useLayoutEffect(() => {
    const saved = anchor.current;
    anchor.current = null;
    const root = rootRef.current;
    if (!saved || !root) return;
    const row = root.querySelector<HTMLElement>(`[data-row="${CSS.escape(saved.row)}"]`);
    if (!row) return;
    const delta = row.getBoundingClientRect().top - saved.top;
    if (Math.abs(delta) >= 1) scrollParentOf(root)?.scrollBy({ top: delta });
  }, [list]);

  const loadHead = useCallback(
    async (silent: boolean) => {
      const sent = listRef.current;
      const seq = silent ? headSeq.current : ++headSeq.current;
      if (!silent) setLoadingHead(true);
      const page = await fetchCalls(rangeRef.current, filterRef.current, null);
      if (!silent && seq === headSeq.current) setLoadingHead(false);
      if (!isCurrentCreditCallResponse(sent, listRef.current)) return;
      if (!page) {
        if (!silent) setFailed("head");
        return;
      }
      apply(silent ? mergeCreditCallHead(listRef.current, page) : startCreditCallList(sent.key, sent.generation, page), silent);
    },
    [apply],
  );

  /** 기간 · 거르기가 바뀌면 새로 시작 — 첫 장이 손에 있으면 바로, 없으면 읽는다. */
  const restart = useCallback(
    (range: Beds24CreditRange, nextFilter: Beds24CreditCallFilter, page: Beds24CreditCallPage | null) => {
      rangeRef.current = range;
      filterRef.current = nextFilter;
      setFilter(nextFilter);
      setOpenIds(new Set());
      const next = startCreditCallList(creditCallListKey(range, nextFilter), listRef.current.generation + 1, page);
      apply(next, false);
      if (page) {
        headSeq.current += 1;
        setLoadingHead(false);
      } else void loadHead(false);
    },
    [apply, loadHead],
  );

  /** 상세 응답이 올 때마다 — 기간이 바뀌었으면 새로 시작, 같으면(거르기 없을 때) 첫 장을 위에 합친다. */
  const syncDetail = useCallback(
    (detail: Beds24CreditDetail) => {
      const on = isCreditCallFilterOn(filterRef.current);
      if (detail.range !== rangeRef.current) {
        restart(detail.range, filterRef.current, on ? null : detail.recentCalls);
        return;
      }
      if (!on && listRef.current.key === creditCallListKey(detail.range, filterRef.current)) {
        apply(mergeCreditCallHead(listRef.current, detail.recentCalls), true);
      }
    },
    [apply, restart],
  );

  /** 자동 갱신 — 거르기가 걸려 있을 때만 따로 첫 장을 읽는다(아니면 상세 응답이 대신한다). */
  const refreshFiltered = useCallback(() => {
    if (isCreditCallFilterOn(filterRef.current)) void loadHead(true);
  }, [loadHead]);

  const toggleFilter = useCallback(
    (part: "actor" | "feature", value: string) => {
      restart(rangeRef.current, toggleCreditCallFilter(filterRef.current, part, value), null);
    },
    [restart],
  );

  const clearFilter = useCallback(() => {
    restart(rangeRef.current, NO_CREDIT_CALL_FILTER, null);
  }, [restart]);

  const loadMore = useCallback(async () => {
    const sent = listRef.current;
    const cursor = creditCallCursor(sent);
    if (inMore.current === sent.generation || !sent.hasMore || !cursor) return;
    inMore.current = sent.generation;
    setLoadingMore(true);
    const page = await fetchCalls(rangeRef.current, filterRef.current, cursor);
    // 기간 · 거르기를 바꾼 뒤 · 첫 장이 다시 시작한 뒤 늦게 온 「더 보기」는 버린다(그때 표시 · 잠금은 `apply` 가 풀었다).
    if (!isCurrentCreditCallResponse(sent, listRef.current)) return;
    inMore.current = null;
    setLoadingMore(false);
    if (!page) {
      setFailed("more");
      return;
    }
    const next = appendCreditCallPage(listRef.current, page, cursor);
    if (next !== listRef.current) apply(next, false);
  }, [apply]);

  const toggleGroup = useCallback((group: CreditCallGroup) => {
    setOpenIds((current) => toggleCreditCallGroup(group, current));
  }, []);

  const groups = useMemo(() => groupCreditCalls(list.calls), [list.calls]);
  const retry = useCallback(() => {
    const target = creditCallRetryTarget(failed, listRef.current);
    if (target === "more") void loadMore();
    else if (target === "head") void loadHead(false);
  }, [failed, loadHead, loadMore]);

  const state = {
    filter,
    groups,
    hasMore: list.hasMore,
    empty: list.calls.length === 0,
    openIds,
    loadingHead,
    loadingMore,
    failed: failed !== null,
    syncDetail,
    refreshFiltered,
    toggleFilter,
    clearFilter,
    loadMore,
    retry,
    toggleGroup,
  };
  // 목록 칸 ref 는 따로 — 상태 묶음에 ref 가 섞이면 그리는 중 읽는 값으로 취급된다.
  return [state, rootRef] as const;
}

export type Beds24CreditCallsState = ReturnType<typeof useBeds24CreditCalls>[0];
