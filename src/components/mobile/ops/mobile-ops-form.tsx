"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatIncompletePhoneNumber, type MetadataJson } from "libphonenumber-js/core";
import metadataModule from "libphonenumber-js/metadata.min";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";
import { haptic } from "@/lib/haptics";
import "./mobile-ops-sheets-white.css";

/**
 * 모바일 판매 캘린더 시트의 공용 입력 조각 — 화이트 리디자인(2026-10-16, 시안 `SalesNew-Phone` · `SalesResvEdit-Phone`).
 *
 * - `MswField` — 테두리 위에 이름표가 걸린 입력칸(시안의 노치 라벨).
 * - `MobileStepper` — 인원처럼 작은 정수는 키보드 없이 −/+ 로(한 줄: 이름 · − · 값 · +).
 * - `MobileStayDates` — 체크인 · 체크아웃을 각각 앱 공용 날짜 시트(`DatePickerSheet`)로 고른다. 데스크톱의 범위 달력
 *   (`AdminDateRangePicker`)은 콘솔 전용 규격이라 모바일 시트 안에서 쓰지 않는다.
 * - `MswPhoneInput` — 입력하며 자동 하이픈(`090-1234-5678`, `+1-415-555-0142`). 보내는 값은 숫자와 맨 앞 `+` 만.
 * - `MswSuccess` + `useSuccessThen` — 저장이 접수되면 초록 체크를 그리고(햅틱) 잠깐 뒤 부모 콜백을 부른다.
 */

const METADATA = ((metadataModule as unknown as { default?: MetadataJson }).default ?? metadataModule) as MetadataJson;

/** 입력 중인 전화번호를 하이픈으로 끊는다. `0` 으로 시작하면 일본 국내 번호, `+` 면 국제 번호. 그 밖에는 그대로. */
export function formatPhoneTyping(raw: string): string {
  const value = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (!value) return "";
  try {
    if (value.startsWith("+")) {
      if (value.length < 2) return value;
      return formatIncompletePhoneNumber(value, METADATA).replace(/\s+/g, "-");
    }
    if (value.startsWith("0")) return formatIncompletePhoneNumber(value, "JP", METADATA).replace(/\s+/g, "-");
  } catch {
    return value;
  }
  return value;
}

/** 저장용 — 숫자와 맨 앞 `+` 만. */
export const phoneDigits = (raw: string) => raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");

export function MswField({
  children,
  className,
  hint,
  label,
}: {
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
  label: string;
}) {
  return (
    <label className={`msw-field${className ? ` ${className}` : ""}`}>
      <span className="msw-field__l">{label}</span>
      {children}
      {hint ? <span className="msw-field__hint">{hint}</span> : null}
    </label>
  );
}

export function MswPhoneInput({
  disabled,
  onChange,
  placeholder,
  value,
}: {
  disabled?: boolean;
  /** 숫자와 맨 앞 `+` 만 넘긴다. */
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <input
      autoComplete="tel"
      className="msw-in mono"
      disabled={disabled}
      enterKeyHint="next"
      inputMode="tel"
      onChange={(event) => {
        const next = phoneDigits(event.target.value);
        const shown = formatPhoneTyping(value) || value;
        // 하이픈만 지웠으면(숫자는 그대로) 그 앞 숫자를 지운다 — 아니면 지우기가 하이픈에 걸려 멈춘다.
        if (next === phoneDigits(value) && event.target.value.length < shown.length) onChange(next.slice(0, -1));
        else onChange(next);
      }}
      placeholder={placeholder}
      type="tel"
      value={formatPhoneTyping(value) || value}
    />
  );
}

export function MobileStepper({
  label,
  max = 30,
  min,
  onChange,
  value,
}: {
  label: string;
  max?: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="msw-stepper" role="group" aria-label={label}>
      <span className="msw-stepper__l">{label}</span>
      <button
        aria-label={`${label} −`}
        className="msw-press"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        type="button"
      >
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button
        aria-label={`${label} +`}
        className="msw-press"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        type="button"
      >
        +
      </button>
    </div>
  );
}

const nextDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** `10/17 (금)` — 도쿄 기준 요일. */
export function mdWeekday(date: string, locale: string): string {
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", weekday: "short" }).format(
    new Date(`${date}T12:00:00+09:00`),
  );
  return `${date.slice(5, 7)}/${date.slice(8, 10)} (${weekday})`;
}

export function MobileStayDates({
  arrival,
  checkInLabel,
  checkOutLabel,
  departure,
  disabled,
  labels,
  locale,
  onChange,
  today,
}: {
  arrival: string;
  checkInLabel: string;
  checkOutLabel: string;
  departure: string;
  /** 채널 예약 — 날짜는 보이되 고를 수 없다. */
  disabled?: boolean;
  labels: { prevMonth: string; nextMonth: string; today: string };
  locale: string;
  /** 체크아웃이 체크인보다 앞이면 다음 날로 밀어 최소 1박을 만든다(데스크톱과 같다). */
  onChange: (arrival: string, departure: string) => void;
  today: string;
}) {
  const [picking, setPicking] = useState<"in" | "out" | null>(null);
  return (
    <>
      <div className="msw-two">
        <div className="msw-field">
          <span className="msw-field__l">{checkInLabel}</span>
          <button className="msw-in msw-date" disabled={disabled} onClick={() => setPicking("in")} type="button">
            {mdWeekday(arrival, locale)}
          </button>
        </div>
        <div className="msw-field">
          <span className="msw-field__l">{checkOutLabel}</span>
          <button className="msw-in msw-date" disabled={disabled} onClick={() => setPicking("out")} type="button">
            {mdWeekday(departure, locale)}
          </button>
        </div>
      </div>
      {picking && !disabled && (
        <DatePickerSheet
          labels={{ ...labels, title: picking === "in" ? checkInLabel : checkOutLabel }}
          locale={locale}
          onClose={() => setPicking(null)}
          onSelect={(date) => {
            if (picking === "in") onChange(date, departure > date ? departure : nextDay(date));
            else onChange(arrival, date > arrival ? date : nextDay(arrival));
          }}
          today={today}
          value={picking === "in" ? arrival : departure}
        />
      )}
    </>
  );
}

/** 저장 접수 — 초록 원 안에 체크를 그린다. */
export function MswSuccess({ label }: { label: string }) {
  return (
    <div aria-live="assertive" className="msw-done" role="status">
      <span className="msw-done__c">
        <svg aria-hidden="true" fill="none" height="30" viewBox="0 0 24 24" width="30">
          <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
        </svg>
      </span>
      <b>{label}</b>
    </div>
  );
}

/** 성공 표시 후 잠깐 뒤 콜백 — 체크가 그려지는 것을 보여 주고 시트를 닫게 한다. */
export function useSuccessThen(delayMs = 720) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const succeed = useCallback(
    (then: () => void) => {
      setDone(true);
      haptic("success");
      timer.current = window.setTimeout(then, delayMs);
    },
    [delayMs],
  );
  return { done, succeed };
}
