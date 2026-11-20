"use client";

import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { createLiveChangeBatcher, createLiveRefreshScheduler } from "@/lib/live-refresh-schedule";
import { createPrivateTopicHub } from "@/lib/live-private-topic";
import {
  LIVE_BROADCAST_EVENT,
  liveChangeFromBroadcast,
  liveChangeMatches,
  liveSourcesKey,
  liveSubscriptionKey,
  parseLiveSourcesKey,
  pickLiveIds,
  type LiveChange,
  type LiveSource,
} from "@/lib/live-sources";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * 실시간 갱신 — 공용 (2026-10-29, 연차 승인의 `AdminLiveRefresh` 를 여러 테이블 · PC · 모바일 공용으로 넓힘).
 *
 * 세 층이다(2026-11-13 손님 메시지 실시간에서 나눔 — 소켓 다루는 곳은 하나):
 * - `useLiveChannel` — 소켓만: 로그인 토큰 싣기 · 구독 · 다시 붙음 · 네트워크 복귀 · 탭 보임/숨김을 손잡이로 넘긴다.
 * - `useLiveRefresh` — 신호만 받아 `router.refresh()`(또는 `onChange`). 화면 값은 서버 렌더 그대로.
 * - `useLiveChanges` — 신호의 **id 만** 열쇠로 모아(`toKeys`) 화면이 그 항목만 서버 액션으로 다시 읽게 한다(`onFlush`),
 *   홍수 · 끊김 · 오래 숨음은 `onCatchUp`(보이는 것만 다시 읽기). 서버 렌더 없이 그 자리에서 바뀐다.
 *
 * 어느 쪽이든 웹소켓의 행 데이터는 **그리지 않는다** — 권한 검사를 통과한 서버 결과만 그린다. 구독도 select RLS 를 통과해야
 * 신호가 온다(볼 수 없는 행은 신호도 없다). 테이블은 `supabase_realtime` publication 에 들어 있어야 한다.
 * 예외 — `topic` 이 있는 구독 줄(손님 메시지, 2026-11-16): publication 이 아니라 **private broadcast** 로 받는다. DB 트리거가
 * id 칸만 든 신호를 보내고, 구독 허가는 `realtime.messages` RLS, 거르기(표 · 종류 · 필터)는 여기서 `liveChangeMatches` 로 한다.
 * 같은 토픽은 화면 안에서 채널 하나를 나눠 쓴다(`createPrivateTopicHub` — supabase-js 가 같은 토픽 채널을 하나로 묶기 때문).
 * 폴링이 아니라 함수 호출이 늘지 않는다. 삭제 신호는 오지 않는다(replica identity 기본값).
 * docs/product/16-mobile-navigation.md 「실시간 갱신 — 공용」
 *
 * `sources` 가 비어 있으면 구독하지 않는다.
 */
type ChannelHandlers = {
  onChange: (change: LiveChange) => void;
  onVisible?: () => void;
  onHidden?: () => void;
  /** 소켓이 끊겼다 다시 붙었거나 네트워크가 돌아왔다 — 끊긴 동안의 신호를 놓쳤을 수 있다. */
  onReconnect?: () => void;
};

export function useLiveChannel(sources: readonly LiveSource[], handlers: ChannelHandlers) {
  const id = useId();
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  // 배열은 렌더마다 새로 만들어지니 내용으로 구독을 다시 할지 정한다. 토픽 줄은 토픽 이름만 본다(`liveSubscriptionKey`) —
  // 필터는 신호가 올 때 지금 값으로 거르니 필터만 바뀌어도 채널을 떠나지 않는다(틈도 따라잡기도 없음).
  const subscriptionKey = liveSubscriptionKey(sources);
  const sourcesKey = liveSourcesKey(sources);
  const topicSources = useRef<LiveSource[]>([]);
  useEffect(() => {
    topicSources.current = parseLiveSourcesKey(sourcesKey).filter((s) => s.topic);
  }, [sourcesKey]);
  // 앞 채널을 닫고 새로 붙는 것(구독 묶음이 바뀜)도 틈이다 — 그사이 신호를 놓쳤을 수 있어 새로 붙으면 따라잡기.
  const hadChannel = useRef(false);

  useEffect(() => {
    if (!subscriptionKey) return;
    const parsed = parseLiveSourcesKey(subscriptionKey);
    const supabase = getSupabaseBrowserClient();
    const visible = () => document.visibilityState === "visible";
    const onVisibility = () => (visible() ? handlersRef.current.onVisible?.() : handlersRef.current.onHidden?.());
    const onOnline = () => handlersRef.current.onReconnect?.();

    // 로그인 토큰을 먼저 소켓에 실은 뒤 구독한다. 쿠키 세션이 아직 안 읽힌 채로 붙으면 anon 으로 들어가
    // `invalid column for filter organization_id` 로 거절되고 신호가 영영 안 온다(2026-10-15 실측). private 토픽은 anon 이면
    // join 자체가 거절된다. 토큰 갱신은 supabase-js 가 `TOKEN_REFRESHED` 때 `realtime.setAuth` 로 채널마다 다시 싣는다.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const leaves: Array<() => void> = [];
    let disposed = false;
    // 채널마다 따로 센다 — 하나가 다시 붙으면 그 하나가 놓친 신호를 따라잡는다.
    const trackStatus = () => {
      let wasDisconnected = hadChannel.current;
      return (status: string) => {
        if (status === "SUBSCRIBED") {
          // 처음 붙은 것이 아니라 **다시** 붙었다 — 끊긴 동안의 신호를 놓쳤을 수 있다.
          if (wasDisconnected) handlersRef.current.onReconnect?.();
          wasDisconnected = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!disposed) wasDisconnected = true;
        }
      };
    };
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
      if (disposed) return;

      const changes = parsed.filter((s) => !s.topic);
      if (changes.length > 0) {
        // 같은 화면에 여럿(홈 · 분할 패널) 있어도 채널 이름이 겹치지 않게 `useId` 를 붙인다.
        let next = supabase.channel(`live:${id}:${changes.map((s) => s.table).join("+")}`);
        for (const { table, filter, event } of changes) {
          next = next.on(
            "postgres_changes",
            { event: event ?? "*", schema: "public", table, filter },
            (payload: { eventType?: string; new?: unknown }) => {
              // 행 전체가 오지만(RLS 를 통과한 그 사람이 REST 로 읽을 수 있는 칸) id 칸만 남기고 버린다 — 화면 상태 · 그리기에 들어가지 않게.
              const record = pickLiveIds(payload.new);
              const eventType = payload.eventType === "INSERT" || payload.eventType === "UPDATE" ? payload.eventType : "DELETE";
              handlersRef.current.onChange({ table, eventType, record });
            },
          );
        }
        channel = next.subscribe(trackStatus());
      }

      // private 토픽 — 토픽마다 한 번 듣고, 이 화면의 구독 줄 중 하나라도 맞으면 한 번 넘긴다.
      const topics = parsed.flatMap((source) => (source.topic ? [source.topic] : []));
      for (const topic of topics) {
        leaves.push(
          privateTopicHub().join(topic, {
            onMessage: (payload) => {
              const change = liveChangeFromBroadcast(payload);
              const lines = topicSources.current.filter((source) => source.topic === topic);
              if (change && lines.some((source) => liveChangeMatches(source, change))) handlersRef.current.onChange(change);
            },
            onStatus: trackStatus(),
          }),
        );
      }
    })();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      hadChannel.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      if (channel) void supabase.removeChannel(channel);
      for (const leave of leaves.splice(0)) leave();
    };
  }, [subscriptionKey, id]);
}

/** 브라우저 클라이언트 하나에 허브 하나(클라이언트도 하나다). 처음 쓸 때 만든다. */
type BrowserChannel = ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]>;
let hub: ReturnType<typeof createPrivateTopicHub<BrowserChannel>> | null = null;
function privateTopicHub() {
  if (hub) return hub;
  const supabase = getSupabaseBrowserClient();
  hub = createPrivateTopicHub<BrowserChannel>({
    open: (topic, onMessage, onStatus) =>
      supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: LIVE_BROADCAST_EVENT }, (message: { payload?: unknown }) => onMessage(message.payload))
        .subscribe(onStatus),
    close: (channel) => supabase.removeChannel(channel),
  });
  return hub;
}

/**
 * 신호만 받아 다시 읽는다. `onChange` 를 주면 `router.refresh()` 대신 그것을 부른다 — 서버 렌더가 아니라 스스로 불러오는
 * 부품(PC 알림 벨)용. 언제 다시 읽을지(디바운스 · 숨은 탭 · 끊김 따라잡기)는 `createLiveRefreshScheduler`.
 */
export function useLiveRefresh(sources: readonly LiveSource[], onChange?: () => void) {
  const router = useRouter();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const schedulerRef = useRef<ReturnType<typeof createLiveRefreshScheduler> | null>(null);
  useEffect(() => {
    const scheduler = createLiveRefreshScheduler({
      refresh: () => (onChangeRef.current ? onChangeRef.current() : router.refresh()),
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [router]);
  useLiveChannel(sources, {
    onChange: () => schedulerRef.current?.onSignal(document.visibilityState === "visible"),
    onVisible: () => schedulerRef.current?.onVisible(),
    onHidden: () => schedulerRef.current?.onHidden(),
    onReconnect: () => schedulerRef.current?.onReconnect(),
  });
}

/**
 * 신호 → 열쇠(id) → 그 항목만 다시 읽기. `toKeys` 는 신호에서 **id 만** 꺼낸다(행 내용은 쓰지 않는다) — 관심 없는 신호는 빈 배열.
 * `onFlush(keys)` 는 묶인 열쇠들, `onCatchUp()` 은 홍수 · 다시 붙음 · 오래 숨음 뒤 보이는 것만 통째로 다시 읽기.
 * 묶는 규칙은 `createLiveChangeBatcher`.
 */
export function useLiveChanges(
  sources: readonly LiveSource[],
  handlers: {
    toKeys: (change: LiveChange) => readonly string[];
    onFlush: (keys: string[]) => void;
    onCatchUp: () => void;
  },
  options: { debounceMs?: number; maxWaitMs?: number; maxKeys?: number } = {},
) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const batcherRef = useRef<ReturnType<typeof createLiveChangeBatcher> | null>(null);
  const { debounceMs, maxWaitMs, maxKeys } = options;
  useEffect(() => {
    const batcher = createLiveChangeBatcher({
      flush: (keys) => handlersRef.current.onFlush(keys),
      catchUp: () => handlersRef.current.onCatchUp(),
      debounceMs,
      maxWaitMs,
      maxKeys,
    });
    batcherRef.current = batcher;
    return () => {
      batcher.dispose();
      batcherRef.current = null;
    };
  }, [debounceMs, maxWaitMs, maxKeys]);
  useLiveChannel(sources, {
    onChange: (change) => {
      const keys = handlersRef.current.toKeys(change);
      if (keys.length > 0) batcherRef.current?.add(keys, document.visibilityState === "visible");
    },
    onVisible: () => batcherRef.current?.onVisible(),
    onHidden: () => batcherRef.current?.onHidden(),
    onReconnect: () => batcherRef.current?.onReconnect(),
  });
}

/** 서버 페이지에 한 줄로 끼우는 형태. 아무것도 그리지 않는다. */
export function LiveRefresh({ sources }: { sources: readonly LiveSource[] }) {
  useLiveRefresh(sources);
  return null;
}
