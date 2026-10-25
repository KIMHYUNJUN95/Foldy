import type { PrepRow } from "@/lib/payroll-prep";

// 서버(내보내기)와 클라이언트(표)가 같은 모양으로 쓴다 — 순수 함수만.

export function localeTagOf(locale: string): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

/** 분 → 「H:MM」. */
export function formatPrepTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** 「2026-10」 → ko 10월 · ja 10月 · en October. */
export function formatPrepMonth(ym: string, localeTag: string): string {
  const month = Number(ym.slice(5, 7));
  return new Intl.DateTimeFormat(localeTag, { month: "long" }).format(new Date(2021, month - 1, 1));
}

/** 「2026-11-10」 → 11월 10일 (화). */
export function formatPrepPayday(date: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** 「2026-10-16」 → 10월 16일. */
export function formatPrepDay(date: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function prepInitial(row: Pick<PrepRow, "name">): string {
  return Array.from(row.name.trim())[0] ?? "·";
}
