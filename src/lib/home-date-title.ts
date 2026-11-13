import type { Locale } from "@/lib/i18n";

const TAG: Record<Locale, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };

/** 도쿄 기준 오늘 날짜 제목(연도 없음) — ko 「11월 13일 금요일」 · ja 「11月13日(金)」 · en 「Friday, November 13」. */
export function formatTokyoDateTitle(locale: Locale, now: Date = new Date()): string {
  return new Intl.DateTimeFormat(
    TAG[locale] ?? TAG.ko,
    locale === "en"
      ? { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Tokyo" }
      : { month: "long", day: "numeric", weekday: locale === "ja" ? "short" : "long", timeZone: "Asia/Tokyo" },
  ).format(now);
}
