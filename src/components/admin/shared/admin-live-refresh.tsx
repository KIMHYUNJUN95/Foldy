"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * 콘솔 실시간 갱신 — 공용 (2026-10-15, 연차 승인부터).
 *
 * `recruit-live-refresh.tsx` · 캘린더와 같은 패턴: 테이블 변경 **신호만** 받아 `router.refresh()` 로
 * 서버 렌더를 다시 받는다. 행 데이터는 웹소켓으로 쓰지 않으니 화면 값은 권한 검사를 통과한 서버 결과
 * 그대로이고, 구독도 select RLS 를 통과해야 신호가 온다. 250ms 디바운스, 숨은 탭은 돌아올 때 한 번.
 * 폴링이 아니라 함수 호출이 늘지 않는다. 테이블은 `supabase_realtime` publication 에 들어 있어야 한다.
 */
export function AdminLiveRefresh({ table, organizationId }: { table: string; organizationId: string }) {
  const router = useRouter();
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefreshRef = useRef(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const scheduleRefresh = () => {
      if (document.visibilityState !== "visible") {
        pendingRefreshRef.current = true;
        return;
      }
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        pendingRefreshRef.current = false;
        router.refresh();
      }, 250);
    };

    // 로그인 토큰을 먼저 소켓에 실은 뒤 구독한다. 쿠키 세션이 아직 안 읽힌 채로 붙으면 anon 으로 들어가
    // `invalid column for filter organization_id` 로 거절되고 신호가 영영 안 온다(2026-10-15 실측).
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disposed = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
      if (disposed) return;
      channel = supabase
        .channel(`live:${table}:${organizationId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `organization_id=eq.${organizationId}` },
          scheduleRefresh,
        )
        .subscribe();
    })();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && pendingRefreshRef.current) scheduleRefresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [table, organizationId, router]);

  return null;
}
