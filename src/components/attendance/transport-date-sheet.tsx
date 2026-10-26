"use client";

import { useMemo, useState } from "react";
import "./transport.css";
import type { Dictionary } from "@/lib/i18n";

function ArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 'YYYY-MM-DD' → {y, m(1-12), d} */
function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  return { y, m, d };
}
function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Tokyo 오늘 'YYYY-MM-DD' */
function todayTokyo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

type Props = {
  /** 'YYYY-MM-DD' 선택값(없으면 오늘). */
  value: string;
  dict: Dictionary;
  localeTag: string;
  /** 확인(날짜 확정) → 부모가 폼으로 복귀시킴. */
  onConfirm: (iso: string) => void;
  /** 뒤로(날짜 변경 없이) → 폼으로 복귀. */
  onBack: () => void;
  /**
   * 'YYYY-MM' — 정산서의 달. 주면 그 달만 고를 수 있다(달 이동 · 다른 달 칸 · 그 달이 아닐 때의 「오늘」 잠금).
   * 서버도 같은 판정을 한다(`createTransportItemAction` — 사용일은 정산서 달 안).
   */
  monthKey?: string;
};

/**
 * 캘린더 패널 — BottomSheet를 직접 들지 않는다.
 * 항목 추가 시트 내부에서 폼과 "교체"되어 단일 시트로 표시된다(겹침 방지).
 */
export function CalendarPanel({ value, dict, localeTag, onConfirm, onBack, monthKey }: Props) {
  const t = dict.transport;
  const today = todayTokyo();
  const locked = Boolean(monthKey && /^\d{4}-\d{2}$/.test(monthKey));
  const inLockedMonth = (iso: string) => !locked || iso.slice(0, 7) === monthKey;
  const fallback = locked && !inLockedMonth(today) ? `${monthKey}-01` : today;
  const initial = value && /^\d{4}-\d{2}-\d{2}$/.test(value) && inLockedMonth(value) ? value : fallback;
  const init = parseISO(initial);

  const [selected, setSelected] = useState(initial);
  const [viewY, setViewY] = useState(init.y);
  const [viewM, setViewM] = useState(init.m); // 1-12

  // 요일 헤더 (일~토, 로케일화). 2024-12-01 = 일요일 기준.
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(localeTag, { weekday: "short" }).format(
          new Date(2024, 11, 1 + i),
        ),
      ),
    [localeTag],
  );

  const monthTitle = new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "long",
  }).format(new Date(viewY, viewM - 1, 1));

  // 6주 x 7일 = 42칸 (앞뒤 달 채움)
  const cells = useMemo(() => {
    const first = new Date(viewY, viewM - 1, 1);
    const startDow = first.getDay(); // 0=일
    const gridStart = new Date(viewY, viewM - 1, 1 - startDow);
    return Array.from({ length: 42 }, (_, i) => {
      const dt = new Date(gridStart);
      dt.setDate(gridStart.getDate() + i);
      const y = dt.getFullYear();
      const m = dt.getMonth() + 1;
      const d = dt.getDate();
      return { iso: toISO(y, m, d), d, dow: dt.getDay(), inMonth: m === viewM };
    });
  }, [viewY, viewM]);

  const goPrev = () => {
    if (viewM === 1) {
      setViewM(12);
      setViewY((y) => y - 1);
    } else {
      setViewM((m) => m - 1);
    }
  };
  const goNext = () => {
    if (viewM === 12) {
      setViewM(1);
      setViewY((y) => y + 1);
    } else {
      setViewM((m) => m + 1);
    }
  };
  const goToday = () => {
    const tk = parseISO(today);
    setViewY(tk.y);
    setViewM(tk.m);
    setSelected(today);
  };

  return (
    <div className="trn trn-cal-root">
      <div className="trn-cal">
        {/* Header: 뒤로 + 월 네비게이션 */}
        <div className="trn-cal-head">
          <button
            type="button"
            className="trn-cal-nav"
            onClick={onBack}
            aria-label={t.calConfirm}
          >
            <ArrowLeft />
          </button>
          <div className="trn-cal-navgrp">
            <button
              type="button"
              className="trn-cal-nav"
              onClick={goPrev}
              disabled={locked}
              aria-label={t.calPrevMonth}
            >
              <ChevLeft />
            </button>
            <div className="trn-cal-title">{monthTitle}</div>
            <button
              type="button"
              className="trn-cal-nav"
              onClick={goNext}
              disabled={locked}
              aria-label={t.calNextMonth}
            >
              <ChevRight />
            </button>
          </div>
          <span className="trn-cal-spacer" />
        </div>

        {/* Weekday labels */}
        <div className="trn-cal-wk">
          {weekdays.map((w, i) => (
            <span
              key={w}
              className={`trn-cal-wk-c${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}
            >
              {w}
            </span>
          ))}
        </div>

        {/* Day grid */}
        <div className="trn-cal-grid">
          {cells.map((c) => {
            const isSel = c.iso === selected;
            const isToday = c.iso === today;
            const cls = [
              "trn-cal-day",
              c.inMonth ? "" : "out",
              isSel ? "sel" : "",
              isToday && !isSel ? "today" : "",
              c.dow === 0 ? "sun" : c.dow === 6 ? "sat" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={c.iso}
                type="button"
                className={cls}
                disabled={locked && !c.inMonth}
                onClick={() => setSelected(c.iso)}
              >
                {c.d}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="trn-cal-foot">
          <button type="button" className="trn-cal-today" onClick={goToday} disabled={!inLockedMonth(today)}>
            {t.calToday}
          </button>
          <button
            type="button"
            className="trn-cal-confirm"
            onClick={() => onConfirm(selected)}
          >
            {t.calConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
