"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import "./date-picker-sheet.css";

/**
 * 모바일 공용 날짜 선택 바텀시트.
 *
 * 화살표만으로는 먼 날짜로 못 간다는 문제에서 나왔다(2026-08-04). 네이티브 `<input type="date">`
 * 를 잠깐 썼지만 OS 달력이라 앱의 시각 언어와 어긋났고, **CLAUDE.md §3 — 모든 슬라이드업 시트는
 * 공용 `BottomSheet` 를 쓴다** 는 계약과도 맞지 않았다.
 *
 * 여기 하나만 두고 모든 모바일 화면이 같은 달력을 쓴다. 콘솔은 별개다 — 그쪽은 `.calpop` 규격의
 * `AdminDatePicker` 를 쓰며(§4a), 두 규격을 섞지 않는다.
 *
 * 2026-10-15 화이트 리디자인(시안 DateSheet-Phone): 테두리 없는 화살표 · 달 이름 왼쪽 · 44px 날 · 고른 날 보라 원 ·
 * 오늘은 보라 글자 + 점 · 아래 「오늘 · 10월 15일」 옅은 보라 버튼. 달은 좌우로 밀어도 넘어가고, 넘길 때 그 방향에서 미끄러져 들어온다.
 *
 * 날짜 계산은 전부 **Tokyo 운영일 문자열(YYYY-MM-DD)** 기준이다. `Date` 로 왕복시키면 자정 근처에서
 * 하루가 밀린다 — 이 저장소가 반복해서 겪은 종류의 버그다.
 */

function ymdOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 그 달의 1일이 무슨 요일인지(0=일). UTC 로 계산해 로컬 타임존 영향을 받지 않는다. */
function firstDowOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function DatePickerSheet({
  value,
  today,
  locale,
  labels,
  onClose,
  onSelect,
}: {
  /** 현재 선택된 날짜(YYYY-MM-DD). */
  value: string;
  /** Tokyo 운영일 기준 오늘. 서버가 계산해 내려준 값을 쓴다. */
  today: string;
  locale: string;
  labels: { title: string; prevMonth: string; nextMonth: string; today: string };
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  const [cursor, setCursor] = useState(() => value.slice(0, 7));
  // 넘긴 방향 — 새 달이 그쪽에서 들어온다(처음 열 때는 0, 움직이지 않음).
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const [cy, cm] = cursor.split("-").map(Number);
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);

  const shiftMonth = (delta: -1 | 1) => {
    const idx = cy * 12 + (cm - 1) + delta;
    setDir(delta);
    setCursor(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
    haptic("light");
  };

  const monthLabel = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(cy, cm - 1, 1)));

  // 요일 머리글 — 2026-06-07 이 일요일이라 그 주를 기준으로 로케일 약칭을 뽑는다.
  const dowLabels = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "narrow" }).format(
      new Date(Date.UTC(2026, 5, 7 + i)),
    ),
  );

  // 「오늘 · 10월 15일」 — 오늘이 몇 일인지 버튼에서 바로 보이게.
  const [ty, tm, td] = today.split("-").map(Number);
  const todayText = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", day: "numeric" }).format(
    new Date(Date.UTC(ty, tm - 1, td)),
  );

  const lead = firstDowOf(cy, cm);
  const total = daysInMonth(cy, cm);
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];

  return (
    <BottomSheet
      ariaLabel={labels.title}
      header={
        <div className="dps-head">
          <p className="dps-head__m" aria-live="polite">
            {monthLabel}
          </p>
          <button aria-label={labels.prevMonth} className="dps-nav" onClick={() => shiftMonth(-1)} type="button">
            <ChevronLeft aria-hidden="true" size={20} />
          </button>
          <button aria-label={labels.nextMonth} className="dps-nav" onClick={() => shiftMonth(1)} type="button">
            <ChevronRight aria-hidden="true" size={20} />
          </button>
        </div>
      }
      onClose={onClose}
    >
      {/* 고르면 바로 알리고(부모가 이동 등을 곧장 시작) 시트는 같은 움직임으로 미끄러져 닫힌다(2026-10-02). */}
      {({ close }) => (
        <div className="dps">
          <div className="dps-dow">
            {dowLabels.map((d, i) => (
              <span className={i === 0 ? "is-sun" : undefined} key={`${d}-${i}`}>
                {d}
              </span>
            ))}
          </div>

          {/* 좌우로 밀면 달 넘김 — 화면 스와이프 뒤로가기와 겹치지 않게 막는다. */}
          <div
            className="dps-gridwrap"
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
              if (Math.abs(dx) > Math.abs(dy) * 1.4 && (Math.abs(dx) > 48 || (fast && Math.abs(dx) > 20))) {
                shiftMonth(dx < 0 ? 1 : -1);
              }
            }}
          >
            <div className={cn("dps-grid", dir === 1 && "is-next", dir === -1 && "is-prev")} key={cursor}>
              {cells.map((day, i) => {
                if (day === null) return <span key={`pad-${i}`} />;
                const key = ymdOf(cy, cm, day);
                const isSelected = key === value;
                const isToday = key === today;
                const isSun = (lead + day - 1) % 7 === 0;
                return (
                  <button
                    aria-current={isToday ? "date" : undefined}
                    aria-pressed={isSelected}
                    className={cn("dps-day", isSelected && "is-sel", !isSelected && isToday && "is-today", isSun && "is-sun")}
                    key={key}
                    onClick={() => {
                      haptic("light");
                      onSelect(key);
                      close();
                    }}
                    type="button"
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            className="dps-today"
            onClick={() => {
              haptic("light");
              onSelect(today);
              close();
            }}
            type="button"
          >
            {labels.today} · {todayText}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
