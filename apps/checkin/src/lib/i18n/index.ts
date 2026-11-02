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
