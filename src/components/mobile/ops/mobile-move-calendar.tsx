"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * 「객실 · 날짜 옮기기」 시트 **안에서 펼치는** 달력(2026-10-19 사용자 확정, 시안 「예약 옮기기 · 모바일 날짜 시안」 ②).
 *
 * 시트 위에 시트를 쌓지 않으려고 공용 `DatePickerSheet` 대신 같은 모양의 달 격자를 시트 본문에 그린다(44px 날 · 일요일 빨강 ·
 * 오늘 점 · 좌우로 밀어 달 넘김). 다른 점: **체크인만 누르면 박수만큼 띠가 따라오고**(체크아웃은 테두리 원), 지난 날과
 * `fullDays`(그날 체크인하면 비어 있는 객실이 하나도 없는 날)는 흐리게 막는다.
 *
 * 날짜는 전부 도쿄 운영일 문자열(YYYY-MM-DD) — `Date` 왕복은 정오 UTC 로만.
 */

const ymd = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function addDaysKey(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function MobileMoveCalendar({
  arrival,
  fullDays,
  labels,
  locale,
  month,
  nights,
  onMonth,
  onPick,
  today,
}: {
  /** 지금 고른 체크인. */
  arrival: string;
  /** 보고 있는 달의 막힌 체크인 날. 읽는 중이면 null(그동안은 지난 날만 막는다). */
  fullDays: Set<string> | null;
  labels: { prevMonth: string; nextMonth: string; checkIn: string; checkOut: string; full: string };
  locale: string;
  /** 보고 있는 달 `YYYY-MM`. */
  month: string;
  nights: number;
  onMonth: (month: string) => void;
  onPick: (arrival: string) => void;
  today: string;
}) {
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const [cy, cm] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(cy, cm - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const departure = addDaysKey(arrival, nights);
  // 지난 달로는 갈 필요가 없다(체크인을 과거로 옮기지 않는다).
  const canPrev = month > today.slice(0, 7);

  const shift = (delta: -1 | 1) => {
    if (delta === -1 && !canPrev) return;
    const index = cy * 12 + (cm - 1) + delta;
    setDir(delta);
    onMonth(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
    haptic("light");
  };

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC", year: "numeric" }).format(
    new Date(Date.UTC(cy, cm - 1, 1)),
  );
  const dow = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "narrow" }).format(new Date(Date.UTC(2026, 5, 7 + i))),
  );
  const dayLabel = (key: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

  return (
    <div className="msw-mc">
      <div className="msw-mc-head">
        <button aria-label={labels.prevMonth} className="msw-mc-nav" disabled={!canPrev} onClick={() => shift(-1)} type="button">
          <ChevronLeft aria-hidden size={20} />
        </button>
        <b aria-live="polite">{monthLabel}</b>
        <button aria-label={labels.nextMonth} className="msw-mc-nav" onClick={() => shift(1)} type="button">
          <ChevronRight aria-hidden size={20} />
        </button>
      </div>
      <div className="msw-mc-dow">
        {dow.map((d, i) => (
          <span className={i === 0 ? "is-sun" : undefined} key={`${d}-${i}`}>
            {d}
          </span>
        ))}
      </div>
      {/* 좌우로 밀면 달 넘김 — 화면 스와이프 뒤로가기와 겹치지 않게 막는다. */}
      <div
        className="msw-mc-wrap"
        data-swipe-back="off"
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onPointerDown={(event) => {
          swipe.current = { t: event.timeStamp, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          const fast = Math.abs(dx) / Math.max(1, event.timeStamp - start.t) > 0.4;
          if (Math.abs(dx) > Math.abs(dy) * 1.4 && (Math.abs(dx) > 48 || (fast && Math.abs(dx) > 20))) shift(dx < 0 ? 1 : -1);
        }}
      >
        <div
          aria-label={monthLabel}
          className={cn("msw-mc-grid", dir === 1 && "is-next", dir === -1 && "is-prev")}
          key={month}
          role="group"
        >
          {Array.from({ length: lead }, (_, i) => (
            <span key={`pad-${i}`} />
          ))}
          {Array.from({ length: total }, (_, i) => {
            const day = i + 1;
            const key = ymd(cy, cm, day);
            const col = (lead + i) % 7;
            const isIn = key === arrival;
            const isOut = key === departure;
            const inStay = key > arrival && key < departure;
            const blocked = key < today || (fullDays?.has(key) ?? false);
            // 띠: 체크인 오른쪽 반 ~ 체크아웃 왼쪽 반, 줄 끝(토 · 일)에서 끊는다.
            const bandLeft = (inStay || isOut) && col !== 0;
            const bandRight = (inStay || isIn) && !isOut && col !== 6 && nights > 0;
            const label =
              dayLabel(key) +
              (isIn ? ` · ${labels.checkIn}` : isOut ? ` · ${labels.checkOut}` : "") +
              (fullDays?.has(key) ? ` · ${labels.full}` : "");
            return (
              <div className="msw-mc-cell" key={key}>
                {(bandLeft || bandRight) && (
                  <i aria-hidden className={cn("msw-mc-band", bandLeft && "l", bandRight && "r")} />
                )}
                <button
                  aria-current={key === today ? "date" : undefined}
                  aria-label={label}
                  aria-pressed={isIn}
                  className={cn(
                    "msw-mc-day",
                    col === 0 && "is-sun",
                    isIn && "is-in",
                    isOut && "is-out",
                    inStay && "is-stay",
                    key === today && "is-today",
                  )}
                  disabled={blocked}
                  onClick={() => {
                    haptic("light");
                    onPick(key);
                  }}
                  type="button"
                >
                  {day}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
