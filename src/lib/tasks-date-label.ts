import type { Locale } from "@/lib/i18n";

const TOKYO = "Asia/Tokyo";

/**
 * 도쿄 기준 «월 일» 짧은 라벨 — ko 「11월 21일」 · ja 「11月21日」 · en "Nov 21".
 * 예전에는 `Intl` 숫자 월·일 그대로라 ko 가 「11. 21.」 로 나왔다.
 */
export function formatMonthDayTokyo(iso: string | Date, locale: Locale): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (locale === "en") {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: TOKYO }).format(date);
  }
  const parts = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", timeZone: TOKYO }).formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return locale === "ja" ? `${m}月${d}日` : `${m}월 ${d}일`;
}

/** 도쿄 시각 "HH:MM"(24시간) — 모바일 · PC 업데이트 시각이 같은 모양이도록 한 곳에서 만든다. */
export function formatClockTokyo(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TOKYO,
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/**
 * 업데이트 기록의 시각 — 오늘이면 "HH:MM", 아니면 "M/D HH:MM"(도쿄). 모바일 · PC 가 같이 쓴다.
 * `today` 는 도쿄 기준 YYYY-MM-DD.
 */
export function formatUpdateStampTokyo(iso: string | Date, today: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TOKYO,
  }).formatToParts(date);
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  const ymd = `${get("year")}-${get("month").padStart(2, "0")}-${get("day").padStart(2, "0")}`;
  const clock = `${get("hour")}:${get("minute")}`;
  return ymd === today ? clock : `${get("month")}/${get("day")} ${clock}`;
}
