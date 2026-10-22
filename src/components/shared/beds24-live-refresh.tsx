"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  BEDS24_DATA_KINDS,
  BEDS24_LIVE_CHANNEL_OPTIONS,
  BEDS24_LIVE_EVENT,
  beds24LiveScopesOverlap,
  beds24LiveTopic,
  type Beds24LiveKind,
  type Beds24LivePayload,
  type Beds24LiveScope,
} from "@/lib/beds24-live";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Beds24 데이터가 바뀌면 이 화면을 새로고침 없이 다시 읽는다.
 *
 * 계약: `src/lib/beds24-live.ts` · 문서 `docs/product/33-calendar-write-features.md` → 「화면도 웹훅 기준으로」
 *
 * - 신호가 몰려 와도(웹훅 여러 건 · 요금+차단) **한 번**만 다시 읽는다(`REFRESH_DEBOUNCE_MS`).
 * - `scope` 를 주면 **이 화면이 보여주는 건물·날짜와 겹치는 신호만** 받는다. 다른 건물의 요금 동기화가
 *   이 화면을 다시 읽게 하지 않는다(2026-09-30 — 판매 캘린더 무한 새로고침). 없으면 전부 받는다.
 * - 탭이 가려져 있으면 미뤘다가 다시 보일 때 한 번 읽는다.
 * - **놓친 신호를 따라잡는다**(2026-09-30 — 「내 컴퓨터엔 뜨는데 다른 컴퓨터는 안 바뀐다」). 브로드캐스트는
 *   저장되지 않아서, 절전·와이파이 전환·오래 가려 둔 탭으로 연결이 끊긴 동안 온 신호는 사라진다.
 *   그래서 ① 끊겼다가 다시 구독되면 ② 네트워크가 돌아오면(`online`) ③ `CATCH_UP_HIDDEN_MS` 넘게
 *   가려졌던 탭이 다시 보이면 **한 번 다시 읽는다**(범위 판정 없이 — 무엇을 놓쳤는지 모른다).
 * - **private 채널**이다 — 구독 전에 `realtime.setAuth()` 를 기다려 첫 join 에 사용자 JWT 를 싣는다.
 *   토큰 갱신은 supabase-js 가 한다(`TOKEN_REFRESHED` → `setAuth`, heartbeat 마다 콜백으로 재확인).
 * - 연결 상태를 `BEDS24_LIVE_STATUS_EVENT` 로 알린다 — `Beds24LiveDot` 이 화면에 점으로 보여 준다.
 * - `kinds` 를 주면 **그 종류의 신호만** 받는다(2026-10-08 — 매출 · 가동률은 예약만 본다. 요금 · 차단 동기화마다 2년 넘는
 *   예약을 다시 읽을 이유가 없다). 끊김 따라잡기(①②③)는 종류와 상관없이 그대로 한다.
 * - `router.refresh()` 는 서버 컴포넌트만 다시 받는다 — 열려 있는 패널·입력·선택 같은 클라이언트
 *   상태는 그대로 남는다.
 */
const REFRESH_DEBOUNCE_MS = 600;
/** 이보다 오래 가려졌던 탭은 다시 보일 때 무조건 한 번 읽는다 — 그 사이 연결이 끊겼을 수 있다. */
const CATCH_UP_HIDDEN_MS = 60_000;

/** `window` 이벤트. `detail` = 연결됐는지. */
export const BEDS24_LIVE_STATUS_EVENT = "beds24-live:status";
export type Beds24LiveStatus = "connected" | "disconnected";

let lastStatus: Beds24LiveStatus | null = null;
function announceStatus(status: Beds24LiveStatus) {
  lastStatus = status;
  window.dispatchEvent(new CustomEvent<Beds24LiveStatus>(BEDS24_LIVE_STATUS_EVENT, { detail: status }));
}
/** 점이 늦게 마운트돼도 현재 상태를 읽을 수 있게. */
export function currentBeds24LiveStatus(): Beds24LiveStatus | null {
  return lastStatus;
}

export function useBeds24LiveRefresh(
  organizationId: string | null | undefined,
  onChange?: () => void,
  scope?: Beds24LiveScope | null,
  kinds?: readonly Beds24LiveKind[] | null,
) {
  const router = useRouter();
  const onChangeRef = useRef(onChange);
  const scopeRef = useRef(scope);
  const kindsRef = useRef(kinds);
  useEffect(() => {
    onChangeRef.current = onChange;
    scopeRef.current = scope;
    kindsRef.current = kinds;
  }, [onChange, scope, kinds]);

  useEffect(() => {
    if (!organizationId) return;
    const supabase = getSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;

    const refresh = () => {
      pending = false;
      if (onChangeRef.current) onChangeRef.current();
      else router.refresh();
    };
    const schedule = () => {
      if (document.visibilityState !== "visible") {
        pending = true;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    };
    let hiddenAt: number | null = null;
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        hiddenAt = Date.now();
        return;
      }
      const longHidden = hiddenAt !== null && Date.now() - hiddenAt > CATCH_UP_HIDDEN_MS;
      hiddenAt = null;
      if (pending || longHidden) schedule();
    };
    const onOnline = () => schedule();

    const onSignal = (message: { payload?: Partial<Beds24LivePayload> }) => {
      const kind = message.payload?.kind;
      if (kind && !(kindsRef.current ?? BEDS24_DATA_KINDS).includes(kind)) return;
      if (!beds24LiveScopesOverlap(message.payload?.scope, scopeRef.current)) return;
      schedule();
    };

    let wasDisconnected = false;
    let disposed = false;
    const channel = supabase
      .channel(beds24LiveTopic(organizationId), BEDS24_LIVE_CHANNEL_OPTIONS)
      .on("broadcast", { event: BEDS24_LIVE_EVENT }, onSignal);
    const subscribe = () => {
      if (disposed) return;
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // 처음 붙은 것이 아니라 **다시** 붙었다 — 끊긴 동안의 신호를 놓쳤을 수 있다.
          if (wasDisconnected) schedule();
          wasDisconnected = false;
          announceStatus("connected");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!disposed) {
            wasDisconnected = true;
            announceStatus("disconnected");
          }
        }
      });
    };
    void supabase.realtime.setAuth().then(subscribe, subscribe);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [organizationId, router]);
}

/** 서버 페이지에 한 줄로 끼우는 형태. 아무것도 그리지 않는다. */
export function Beds24LiveRefresh({
  organizationId,
  scope,
  kinds,
}: {
  organizationId: string;
  /** 이 화면이 보여주는 건물·날짜. 없으면 모든 신호에 다시 읽는다. */
  scope?: Beds24LiveScope | null;
  /** 받을 신호 종류. 없으면 Beds24 데이터 전부(예약 · 요금 · 차단 — 청소 배정 신호는 빼고). */
  kinds?: readonly Beds24LiveKind[] | null;
}) {
  useBeds24LiveRefresh(organizationId, undefined, scope, kinds);
  return null;
}
