"use client";

import { useState } from "react";

import { intlTag, type Locale } from "@/lib/i18n";

// 생년월일 — 연 · 월 · 일 세 칸(2026-11-02). 휴대폰 기본 달력은 기기 언어로 나오고, 1980년대까지 넘기기 힘들다.
// 세 칸이 다 골라져야 "YYYY-MM-DD" 를 올려 보내고, 아니면 "" (서버가 빈 칸으로 본다).

type Props = {
  locale: Locale;
  value: string;
  onChange: (iso: string) => void;
  labels: { year: string; month: string; day: string };
  invalid?: boolean;
};

const OLDEST = 1900;

function split(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? { y: match[1], m: String(Number(match[2])), d: String(Number(match[3])) } : { y: "", m: "", d: "" };
}

function daysIn(year: string, month: string) {
  if (!month) return 31;
  return new Date(Date.UTC(Number(year) || 2000, Number(month), 0)).getUTCDate();
}

export function BirthDateField({ locale, value, onChange, labels, invalid }: Props) {
  const [parts, setParts] = useState(() => split(value));
  const thisYear = new Date().getFullYear();
  const monthName = new Intl.DateTimeFormat(intlTag(locale), { month: "short", timeZone: "UTC" });

  function update(next: Partial<typeof parts>) {
    const merged = { ...parts, ...next };
    if (merged.d && Number(merged.d) > daysIn(merged.y, merged.m)) merged.d = "";
    setParts(merged);
    onChange(
      merged.y && merged.m && merged.d
        ? `${merged.y}-${merged.m.padStart(2, "0")}-${merged.d.padStart(2, "0")}`
        : "",
    );
  }

  const field = (key: "y" | "m" | "d", label: string, options: { value: string; text: string }[]) => (
    <select
      key={key}
      className="w-in num"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={parts[key]}
      onChange={(event) => update({ [key]: event.target.value })}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.text}
        </option>
      ))}
    </select>
  );

  const year = field(
    "y",
    labels.year,
    Array.from({ length: thisYear - OLDEST + 1 }, (_, index) => String(thisYear - index)).map((y) => ({ value: y, text: y })),
  );
  const month = field(
    "m",
    labels.month,
    Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1),
      text: monthName.format(new Date(Date.UTC(2000, index, 1))),
    })),
  );
  const day = field(
    "d",
    labels.day,
    Array.from({ length: daysIn(parts.y, parts.m) }, (_, index) => ({ value: String(index + 1), text: String(index + 1) })),
  );

  // 영어는 월 · 일 · 연, 나머지는 연 · 월 · 일.
  const order = locale === "en" ? [month, day, year] : [year, month, day];
  return <div className="grid grid-cols-[1.2fr_1fr_0.9fr] gap-2">{order}</div>;
}
