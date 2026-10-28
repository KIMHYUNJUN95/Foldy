"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchOpsRecentBookings } from "./ops-reads";
import type { OpsRecentBooking } from "@/lib/ops-calendar";
import { msUntilNextTokyoMidnight, tokyoDateOf } from "@/lib/ops-recent-bookings-range";

const RECENT_DEFAULT_ROLL_MS = 10 * 60 * 1000;

/**
 * 「최근 예약」 상태 — 데스크톱 격자 · 모바일 판매 캘린더 공용(2026-10-05).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「최근 예약」
 *
 * - 격자가 그린 뒤 따로 받는다(가격 개입 성공과 같은 방식) — **보고 있는 창 × 고른 건물**, 바뀌면 「불러오는 중」부터.
 * - 시간대: 기본(지금부터 48시간 전 ~ 지금, 서버가 계산) 또는 직접 지정(시작 · 끝 ISO). 기본은 시간이 흐르면 창도
 *   밀리므로 켜 둔 화면은 **10분마다** 다시 받는다. 직접 지정은 **지정한 도쿄 날짜에만** 유효하다 — 화면을 켜 둔 채
 *   도쿄 자정이 지나면 타이머가 기본으로 돌리고 다시 받는다.
 * - 기억은 이 화면(컴포넌트)에만 둔다 — 새로 열면 기본.
 */
export function useRecentBookings(args: {
  windowStart: string;
  days: number;
  propertyKey: string;
  /** 라이브 신호 · 쓰기 반영으로 서버 데이터가 새로 오면 바뀌는 값 — 「지금」까지 다시 받는다. */
  refreshToken: unknown;
}) {
  const { days, propertyKey, refreshToken, windowStart } = args;
  const [dayKey, setDayKey] = useState(() => tokyoDateOf(Date.now()));
  const [custom, setCustom] = useState<{ from: string; to: string; day: string } | null>(null);
  const activeCustom = custom && custom.day === dayKey ? custom : null;

  // 도쿄 자정 — 직접 지정이 풀린다.
  useEffect(() => {
    const timer = window.setTimeout(() => setDayKey(tokyoDateOf(Date.now())), msUntilNextTokyoMidnight(Date.now()) + 1_000);
    return () => window.clearTimeout(timer);
  }, [dayKey]);

  // 기본(48시간)은 시간이 흐르면 창이 밀린다 — 켜 둔 화면은 10분마다 다시 받는다(직접 지정 중에는 그대로).
  const [rollTick, setRollTick] = useState(0);
  useEffect(() => {
    if (activeCustom) return;
    const timer = window.setInterval(() => setRollTick((tick) => tick + 1), RECENT_DEFAULT_ROLL_MS);
    return () => window.clearInterval(timer);
  }, [activeCustom]);

  // 다시 시도 — 요청 키에 넣어 같은 조건으로 한 번 더 받는다(2026-10-28).
  const [retryTick, setRetryTick] = useState(0);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [state, setState] = useState<{
    key: string;
    bookings: OpsRecentBooking[];
    from: string;
    to: string;
    isDefault: boolean;
    endsNow: boolean;
  } | null>(null);
  const requestKey = `${propertyKey}#${windowStart}#${days}#${activeCustom?.from ?? ""}#${activeCustom?.to ?? ""}#${dayKey}#${activeCustom ? 0 : rollTick}#${retryTick}`;
  const requestRef = useRef(0);
  useEffect(() => {
    requestRef.current += 1;
    const requestId = requestRef.current;
    if (!windowStart) return;
    void fetchOpsRecentBookings({
      days,
      from: activeCustom?.from ?? null,
      properties: propertyKey ? propertyKey.split("\n") : [],
      start: windowStart,
      to: activeCustom?.to ?? null,
    }).then((result) => {
      if (requestId !== requestRef.current) return;
      // 못 받으면 「받는 중」에 멈춰 두지 않는다 — 화면이 실패와 「다시 시도」를 띄운다.
      if (!result.ok) {
        setFailedKey(requestKey);
        return;
      }
      setState({
        bookings: result.bookings,
        endsNow: result.endsNow,
        from: result.from,
        isDefault: result.isDefault,
        key: requestKey,
        to: result.to,
      });
    });
  }, [activeCustom, days, propertyKey, refreshToken, requestKey, windowStart]);

  const current = state && state.key === requestKey ? state : null;
  return useMemo(
    () => ({
      /** `null` = 받는 중(또는 실패 — `failed`). */
      bookings: current?.bookings ?? null,
      /** 지금 조건으로 못 받았다(서버 읽기 실패). */
      failed: !current && failedKey === requestKey,
      retry: () => setRetryTick((tick) => tick + 1),
      range: current ? { endsNow: current.endsNow, from: current.from, isDefault: current.isDefault, to: current.to } : null,
      /** 직접 지정 — 시작 · 끝 ISO. 오늘(도쿄)만 유지된다. */
      setRange: (from: string, to: string) => setCustom({ day: tokyoDateOf(Date.now()), from, to }),
      resetRange: () => setCustom(null),
    }),
    [current, failedKey, requestKey],
  );
}
