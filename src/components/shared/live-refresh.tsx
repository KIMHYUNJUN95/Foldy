"use client";

import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { createLiveRefreshScheduler } from "@/lib/live-refresh-schedule";
import type { LiveSource } from "@/lib/live-sources";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * 실시간 갱신 — 공용 (2026-10-29, 연차 승인의 `AdminLiveRefresh` 를 여러 테이블 · PC · 모바일 공용으로 넓힘).
 *
 * 테이블 변경 **신호만** 받아 `router.refresh()` 로 서버 렌더를 다시 받는다. 행 데이터는 웹소켓으로 쓰지 않으니
 * 화면 값은 권한 검사를 통과한 서버 결과 그대로이고, 구독도 select RLS 를 통과해야 신호가 온다(볼 수 없는 행은
 * 신호도 없다). `router.refresh()` 는 서버 컴포넌트만 다시 받는다 — 열린 시트 · 입력 · 스크롤은 그대로.
 * 언제 다시 읽을지(디바운스 · 숨은 탭 · 끊김 따라잡기)는 `createLiveRefreshScheduler`.
 * 테이블은 `supabase_realtime` publication 에 들어 있어야 한다(`202610290001_enable_ops_realtime.sql`).
 * 폴링이 아니라 함수 호출이 늘지 않는다. 삭제 신호는 오지 않는다(replica identity 기본값).
 * docs/product/16-mobile-navigation.md 「실시간 갱신 — 공용」
 *
 * `onChange` 를 주면 `router.refresh()` 대신 그것을 부른다 — 서버 렌더가 아니라 스스로 불러오는 부품(PC 알림 벨)용.
 * `sources` 가 비어 있으면 구독하지 않는다.
 */
export function useLiveRefresh(sources: readonly LiveSource[], onChange?: () => void) {
  const router = useRouter();
  const id = useId();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // 배열은 렌더마다 새로 만들어지니 내용으로 구독을 다시 할지 정한다.
  const sourcesKey = sources.map((s) => `${s.table}|${s.filter}`).join(",");

  useEffect(() => {
    if (!sourcesKey) return;
    const parsed = sourcesKey.split(",").map((entry) => {
      const [table, filter] = entry.split("|");
      return { table, filter };
    });
    const supabase = getSupabaseBrowserClient();
    const scheduler = createLiveRefreshScheduler({
      refresh: () => (onChangeRef.current ? onChangeRef.current() : router.refresh()),
    });
    const visible = () => document.visibilityState === "visible";
    const onSignal = () => scheduler.onSignal(visible());
    const onVisibility = () => (visible() ? scheduler.onVisible() : scheduler.onHidden());
    const onOnline = () => scheduler.onReconnect();

    // 로그인 토큰을 먼저 소켓에 실은 뒤 구독한다. 쿠키 세션이 아직 안 읽힌 채로 붙으면 anon 으로 들어가
    // `invalid column for filter organization_id` 로 거절되고 신호가 영영 안 온다(2026-10-15 실측).
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disposed = false;
    let wasDisconnected = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
      if (disposed) return;
      // 같은 화면에 여럿(홈 · 분할 패널) 있어도 채널 이름이 겹치지 않게 `useId` 를 붙인다.
      let next = supabase.channel(`live:${id}:${parsed.map((s) => s.table).join("+")}`);
      for (const { table, filter } of parsed) {
        next = next.on("postgres_changes", { event: "*", schema: "public", table, filter }, onSignal);
      }
      channel = next.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // 처음 붙은 것이 아니라 **다시** 붙었다 — 끊긴 동안의 신호를 놓쳤을 수 있다.
          if (wasDisconnected) scheduler.onReconnect();
          wasDisconnected = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!disposed) wasDisconnected = true;
        }
      });
    })();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      scheduler.dispose();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [sourcesKey, id, router]);
}

/** 서버 페이지에 한 줄로 끼우는 형태. 아무것도 그리지 않는다. */
export function LiveRefresh({ sources }: { sources: readonly LiveSource[] }) {
  useLiveRefresh(sources);
  return null;
}
