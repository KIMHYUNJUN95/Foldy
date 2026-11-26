"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getGuestConversationRows, listGuestConversations, listMoreGuestConversations } from "@/actions/guest-messages";
import { inboxLiveReducer, initialInboxLive, type InboxLiveState } from "@/lib/guest-messages/live-merge";
import { LIVE_CHANGE_MAX_KEYS } from "@/lib/live-refresh-schedule";
import { beginNavBadgeRead, reportNavBadge } from "@/components/shared/nav-badge-overrides";
import { guestWriteFreshness } from "@/lib/guest-messages/write-freshness";
import type { InboxChannelFilter, InboxListData, InboxStatusFilter } from "@/lib/guest-messages/inbox-model";

/** 줄 접힘(`.row-collapse` 260ms)이 끝난 뒤 목록에서 뺀다. */
const LEAVE_MS = 320;
/** 새 줄 나타나기 표시를 떼는 때(움직임 220ms + 여유). */
const ENTER_MS = 600;

/**
 * 손님 메시지 목록 — 서버가 처음 준 목록을 손에 들고, 실시간 신호의 대화만 다시 읽어 그 자리에서 합친다(47 §5-9).
 * 서버 렌더를 다시 받지 않는다(`router.refresh()` 없음). 서버가 새 목록을 주면(필터 이동) 그것으로 갈아 끼운다.
 * 내 쓰기도 서버 렌더 없이(2026-11-20) — PC 는 쓴 뒤 `applyIds`. 캐시에서 되살아난 목록이면(이 창에서 그 뒤 썼다) 나타날 때
 * 목록을 한 번 다시 읽는다(`write-freshness` — 남이 바꾼 다른 줄도 맞게, 돌아올 때마다).
 * 응답 순서 · 접힘 · 나타남은 순수 리듀서 `inboxLiveReducer`(id 마다 요청 번호), 빼는 시각만 여기 타이머.
 * - `applyIds(ids)` — 그 대화들만 목록 줄로 다시 읽기(권한 · 조직 · 필터 판정은 서버). 너무 많으면 `reload()`.
 * - `reload()` — 보는 필터 그대로 목록 한 번(따라잡기 · 다시 해 보기). 처리 끝을 더 펼쳤으면 그 범위까지(`doneUntil`).
 * - `loadMore()` — 처리 끝 다음 묶음(무한 스크롤, 2026-11-26). 한 번에 하나만, 실패하면 `more === "error"`(다시 해 보기 단추).
 *   필터가 바뀌면(서버가 새 목록을 줌) 펼친 범위는 첫 묶음으로 돌아간다.
 */
export function useInboxLive(
  data: InboxListData | null,
  filter: { status: InboxStatusFilter; building: string | null; channel: InboxChannelFilter },
) {
  const [state, dispatch] = useReducer(inboxLiveReducer, data, initialInboxLive);
  // 더 불러오기 상태는 그 요청의 커서에 묶는다 — 목록이 갈아 끼워져 커서가 달라지면 저절로 「쉼」(효과에서 되돌리지 않는다).
  const [moreState, setMoreState] = useState<{ kind: "loading" | "error"; from: string } | null>(null);
  // 요청이 끝날 때마다 하나씩 — 화면의 끝 줄 관찰을 다시 건다(응답을 버렸는데 끝 줄이 계속 보이는 경우).
  const [moreRound, setMoreRound] = useState(0);
  const seq = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  // 손에 든 목록이 어느 필터의 것인가 — 필터를 바꾼 뒤 서버 목록이 오기 전에는 커서를 보내지 않는다(다른 필터의 커서).
  const listFilterKey = useRef(data ? filterKeyOf(filter) : null);
  // 그 필터 표시를 정한 통째 읽기의 번호 — 늦게 온 예전 응답(리듀서가 버림)이 표시를 덮지 않게.
  const listFilterSeq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  });

  // 서버가 새 목록을 줬다(필터 이동 등 서버 렌더) — 통째 읽기와 같은 길로 합친다. 내 쓰기는 서버 렌더를 부르지 않는다(`applyIds`).
  const seenData = useRef(data);
  useEffect(() => {
    if (seenData.current === data) return;
    seenData.current = data;
    if (!data) return;
    const mine = ++seq.current;
    listFilterSeq.current = mine;
    listFilterKey.current = filterKeyOf(filterRef.current);
    dispatch({ type: "replace", seq: mine, data });
  }, [data]);

  // 접힌 줄은 접힘이 끝난 뒤 뺀다 — 그사이 다시 들어온 줄은 리듀서가 남긴다.
  useEffect(() => {
    if (state.leaving.size === 0) return;
    const ids = [...state.leaving];
    const timer = window.setTimeout(() => dispatch({ type: "drop", ids }), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [state.leaving]);
  useEffect(() => {
    if (state.entered.size === 0) return;
    const ids = [...state.entered];
    const timer = window.setTimeout(() => dispatch({ type: "settleEntered", ids }), ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [state.entered]);

  // 메뉴 숫자는 서버 렌더를 다시 받지 않으니 읽기가 같이 가져온 수(`navAwaitingCount`)로 고친다 — 순서는 읽기를 시작한 때로(`beginNavBadgeRead`).
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const at = beginNavBadgeRead();
    // 응답이 올 때의 필터가 아니라 보낼 때의 필터로 목록 표시를 정한다 — 그사이 필터를 바꿔도 예전 목록에 새 필터 표시가 붙지 않게.
    const sent = filterRef.current;
    const held = doneWindowOf(stateRef.current, listFilterKey.current, sent);
    const doneUntil = held && stateRef.current.paged ? held.doneCursor : null;
    const result = await listGuestConversations({ ...sent, doneUntil }).catch(() => null);
    if (!result?.ok) return;
    reportNavBadge("messages", result.navAwaitingCount, at);
    if (!alive.current) return;
    if (mine > listFilterSeq.current) {
      listFilterSeq.current = mine;
      listFilterKey.current = filterKeyOf(sent);
    }
    dispatch({
      type: "replace",
      seq: mine,
      keepPaged: true,
      data: {
        rows: result.rows,
        awaitingCount: result.awaitingCount,
        buildings: result.buildings,
        doneCursor: result.doneCursor,
        doneHasMore: result.doneHasMore,
      },
    });
  }, []);

  const moreFlight = useRef(false);
  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    const from = current.list?.doneHasMore ? current.list.doneCursor : null;
    if (!from || moreFlight.current || listFilterKey.current !== filterKeyOf(filterRef.current)) return;
    moreFlight.current = true;
    setMoreState({ kind: "loading", from });
    const mine = ++seq.current;
    const sinceReplace = current.replaceSeq;
    const result = await listMoreGuestConversations({ ...filterRef.current, cursor: from }).catch(() => null);
    moreFlight.current = false;
    if (alive.current) setMoreRound((round) => round + 1);
    if (!alive.current) return;
    if (!result?.ok) {
      setMoreState({ kind: "error", from });
      return;
    }
    setMoreState(null);
    dispatch({
      type: "appendDone",
      seq: mine,
      sinceReplace,
      from,
      page: { rows: result.rows, doneCursor: result.doneCursor, doneHasMore: result.doneHasMore },
    });
  }, []);

  // 받은 목록에 번호를 붙이고(처음일 때만), 받은 뒤 이 창에서 쓴 것이 있으면(캐시에서 되살아남) 한 번 통째로 다시 읽는다. 새 서버 렌더면 요청 없음.
  useEffect(() => {
    if (!data) return;
    const stale = guestWriteFreshness.isStale(data, { kind: "list" });
    guestWriteFreshness.observe(data);
    if (stale) void reload();
  }, [data, reload]);

  const applyIds = useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0) return;
      if (ids.length > LIVE_CHANGE_MAX_KEYS) {
        await reload();
        return;
      }
      const mine = ++seq.current;
      dispatch({ type: "claim", ids, seq: mine });
      const at = beginNavBadgeRead();
      const held = doneWindowOf(stateRef.current, listFilterKey.current, filterRef.current);
      const result = await getGuestConversationRows({ ids, ...filterRef.current, ...held }).catch(() => null);
      if (!result?.ok) return;
      reportNavBadge("messages", result.navAwaitingCount, at);
      if (!alive.current) return;
      dispatch({ type: "rows", seq: mine, result });
    },
    [reload],
  );

  const more: "idle" | "loading" | "error" =
    moreState && state.list?.doneCursor === moreState.from ? moreState.kind : "idle";

  return { list: state.list, leaving: state.leaving, entered: state.entered, applyIds, reload, loadMore, more, moreRound };
}

type InboxFilterValue = { status: InboxStatusFilter; building: string | null; channel: InboxChannelFilter };

function filterKeyOf(filter: InboxFilterValue): string {
  return `${filter.status}|${filter.channel}|${filter.building ?? ""}`;
}

/** 지금 손에 든 처리 끝 범위 — 목록이 지금 필터의 것일 때만(아니면 서버가 첫 묶음 경계로 판정). */
function doneWindowOf(
  state: InboxLiveState,
  listKey: string | null,
  filter: InboxFilterValue,
): { doneCursor: string | null; doneHasMore: boolean } | null {
  if (!state.list || listKey !== filterKeyOf(filter)) return null;
  return { doneCursor: state.list.doneCursor, doneHasMore: state.list.doneHasMore };
}
