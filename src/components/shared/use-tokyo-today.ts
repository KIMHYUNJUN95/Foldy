"use client";

import { useEffect, useRef, useState } from "react";
import { msUntilNextTokyoMidnight, tokyoToday } from "@/lib/tokyo-date";

/**
 * 「오늘」(도쿄 날짜 키) — 화면을 켜 둔 채 도쿄 자정을 넘기면 바뀐다 (2026-11-12 예약 캘린더 점검).
 *
 * 서버가 준 `serverToday` 로 시작하고, 다음 도쿄 자정에 타이머로 · 화면이 다시 보일 때(`visibilitychange`) 다시 읽는다.
 * 잠든 기기는 타이머가 늦게 울려서 보일 때 다시 읽는 쪽이 꼭 필요하다. 날이 바뀌면 `onDayChange`(보통 `router.refresh()` —
 * 서버의 읽는 창 · 오늘 목록도 새 날 기준으로).
 */
export function useTokyoToday(serverToday: string, onDayChange?: (today: string) => void): string {
  const [today, setToday] = useState(serverToday);
  const [prevServerToday, setPrevServerToday] = useState(serverToday);
  if (prevServerToday !== serverToday) {
    setPrevServerToday(serverToday);
    setToday(serverToday);
  }

  const todayRef = useRef(today);
  const onDayChangeRef = useRef(onDayChange);
  useEffect(() => {
    todayRef.current = today;
    onDayChangeRef.current = onDayChange;
  });

  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      const next = tokyoToday();
      if (next <= todayRef.current) return;
      todayRef.current = next;
      setToday(next);
      onDayChangeRef.current?.(next);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        check();
        schedule();
      }, msUntilNextTokyoMidnight());
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      check();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return today;
}
