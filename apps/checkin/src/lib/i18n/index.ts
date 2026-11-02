import en from "./en.json";
import ja from "./ja.json";
import ko from "./ko.json";
import zhHans from "./zh-Hans.json";

// 손님 화면 사전. Foldy `src/lib/i18n.ts` 는 쓰지 않는다(16 §6). 기본 언어는 일본어.
export const LOCALES = ["ja", "en", "zh-Hans", "ko"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ja";

export type Dictionary = typeof ja;

const dictionaries: Record<Locale, Dictionary> = { ja, en, "zh-Hans": zhHans, ko };

export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && (LOCALES as readonly string[]).includes(value);
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

// Accept-Language 에서 지원하는 첫 언어. 「zh-CN」 · 「zh」 는 간체로 본다.
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  for (const part of acceptLanguage.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag.startsWith("zh")) return "zh-Hans";
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** `{name}` 자리 바꾸기. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

const INTL_TAG: Record<Locale, string> = { ja: "ja-JP", en: "en-US", "zh-Hans": "zh-Hans-CN", ko: "ko-KR" };

export function intlTag(locale: Locale): string {
  return INTL_TAG[locale];
}

/** 도쿄 날짜 "YYYY-MM-DD" 를 그 언어로(「10월 30일 (금)」). */
export function formatStayDate(locale: Locale, isoDate: string, withWeekday = true): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
    ...(withWeekday ? { weekday: "short" } : {}),
  }).format(new Date(`${isoDate}T12:00:00+09:00`));
}

export function formatTokyoTime(locale: Locale, iso: string, withDate = false): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: "Asia/Tokyo",
    ...(withDate ? { month: "long", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}
