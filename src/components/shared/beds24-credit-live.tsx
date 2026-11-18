"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadBeds24CreditDetail, loadBeds24CreditSummary } from "@/actions/beds24-credit";
import { creditDisplay, creditView, shouldRefreshCredit } from "@/lib/beds24-credit-view";
import type {
  Beds24CreditDetail,
  Beds24CreditRange,
  Beds24CreditSnapshot,
  Beds24CreditSummary,
} from "@/lib/beds24/credit-usage-types";

/**
 * Beds24 크레딧 — 화면 쪽 값 받기(PC 상단 줄 · 요약 창 · 관제실 · 모바일 공용).
 *
 * **Beds24 를 부르지 않는다** — 우리 DB 에 남은 기록을 읽는 서버 액션만 부른다. 탭이 보일 때만 30초마다,
 * 탭 · 창으로 돌아오면 바로(5초 안에 받은 적 있으면 건너뜀). 남은 시간은 화면에서 초 단위로 줄인다.
 * 도메인 계약: docs/product/36-automation-control.md 「Beds24 크레딧」.
 */

export const CREDIT_POLL_MS = 30_000;
const CREDIT_MIN_GAP_MS = 5_000;

export type CreditLoad<T> = { ok: true; data: T } | { ok: false };

// 서버 액션의 결과 모양은 이 두 함수에서만 읽는다 — 화면은 `CreditLoad` 만 안다.
export async function fetchCreditSummary(): Promise<CreditLoad<Beds24CreditSummary>> {
  try {
    const result = await loadBeds24CreditSummary();
    return result.ok ? { ok: true, data: result.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function fetchCreditDetail(range: Beds24CreditRange): Promise<CreditLoad<Beds24CreditDetail>> {
  try {
    const result = await loadBeds24CreditDetail(range);
    return result.ok ? { ok: true, data: result.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** 1초 단위 시각 — 같은 초 안에서는 같은 값이라 `useSyncExternalStore` 가 다시 그리지 않는다. */
const secondNow = () => Math.floor(Date.now() / 1000) * 1000;
const nullOnServer = () => null;
const subscribeNoop = () => () => {};
function subscribeSecond(onChange: () => void) {
  let timer: number | null = null;
  const start = () => {
    if (timer === null) timer = window.setInterval(onChange, 1000);
  };
  const stop = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };
  // 탭이 안 보이면 멈춘다 — 다시 보이면 바로 한 번 새로 그리고 다시 센다.
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      onChange();
      start();
    } else stop();
  };
  if (document.visibilityState === "visible") start();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** 붙은 뒤에만 숫자를 갖는 「지금」 — 서버 그림과 첫 그림이 어긋나지 않게 서버에선 null. `ticking` 이면 1초마다. */
export function useNowSecond(ticking: boolean): number | null {
  return useSyncExternalStore<number | null>(ticking ? subscribeSecond : subscribeNoop, secondNow, nullOnServer);
}

/**
 * 스냅샷 + 요약을 살아 있게 둔다. `enabled` 가 false 면 아무것도 부르지 않는다(권한 없는 사람).
 * 요약은 30초마다 받는 값 그대로 — 요약 창 · 시트를 열면 `refresh()` 로 한 번 더 받는다.
 */
export function useBeds24CreditLive(initial: Beds24CreditSnapshot | null, enabled = true, serverNow: number | null = null) {
  const [snapshot, setSnapshot] = useState<Beds24CreditSnapshot | null>(initial);
  const [summary, setSummary] = useState<Beds24CreditSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastFetchedAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    lastFetchedAt.current = Date.now();
    setLoading(true);
    const run = fetchCreditSummary().then((result) => {
      inFlight.current = null;
      setLoading(false);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setSummary(result.data);
      setSnapshot(result.data.snapshot);
    });
    inFlight.current = run;
    return run;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const tryRefresh = () => {
      if (
        shouldRefreshCredit({
          visible: document.visibilityState === "visible",
          lastFetchedAt: lastFetchedAt.current,
          now: Date.now(),
          minGapMs: CREDIT_MIN_GAP_MS,
        })
      ) {
        void refresh();
      }
    };
    // 레이아웃이 첫 값을 줬으면 그 시각부터 30초를 센다.
    lastFetchedAt.current = Date.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, CREDIT_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tryRefresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tryRefresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tryRefresh);
    };
  }, [enabled, refresh]);

  const countdownWanted = snapshot !== null && (snapshot.pausedUntil !== null || snapshot.resetsAt !== null);
  const tick = useNowSecond(enabled && countdownWanted);
  // 붙기 전(서버 그림 · 첫 그림)은 서버가 그린 시각(`serverNow`)으로 읽어 두 그림이 같다. 그것도 없으면 기록 시각으로
  // 상태만 정하고 카운트다운 자리는 비운다(now null) — 「곧」 → 「2:40」 으로 글자가 바뀌어 흔들리지 않게.
  const now = tick ?? serverNow;
  const view = creditView(snapshot, now ?? snapshot?.recordedAt ?? 0);

  const display = creditDisplay(view, now);
  return { snapshot, summary, view, display, now, failed, loading, refresh };
}
