import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { CANONICAL_TO_BUILDING_KEY, getCanonicalPropertyName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";

export type AttendanceSiteDisplayRow = {
  name: string;
  properties?: {
    display_name_ko: string | null;
    display_name_ja: string | null;
    display_name_en: string | null;
  } | null;
};

export function resolveAttendanceLocale(locale: string): Locale {
  if (isLocale(locale)) return locale;
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("en")) return "en";
  return "ko";
}

function localizeKnownSiteName(name: string, locale: Locale): string {
  const key = name.replace(/\s+/g, "").toLowerCase();
  const dictionary = getDictionary(locale);
  const buildingKey = CANONICAL_TO_BUILDING_KEY[getCanonicalPropertyName(name)];
  if (buildingKey) {
    return dictionary.cleaning.buildingLabels[buildingKey] ?? name;
  }
  const copy = dictionary.attendance;
  if (key === "사무실" || key === "office" || key === "事務所") {
    return copy.siteOffice;
  }
  if (key === "스카이" || key === "sky" || key === "スカイ") {
    return copy.siteSky;
  }
  if (
    key === "레거시테스트현장" ||
    key === "legacytestsite" ||
    key === "レガシーテスト拠点"
  ) {
    return copy.siteLegacyTest;
  }
  return name;
}

export function localizeAttendanceSiteName(
  site: AttendanceSiteDisplayRow,
  locale: string,
): string {
  const resolvedLocale = resolveAttendanceLocale(locale);
  const property = site.properties;
  if (property) {
    if (resolvedLocale === "ja" && property.display_name_ja) return property.display_name_ja;
    if (resolvedLocale === "en" && property.display_name_en) return property.display_name_en;
    if (property.display_name_ko) return property.display_name_ko;
  }
  return localizeKnownSiteName(site.name, resolvedLocale);
}

/**
 * 교통비 항목의 `work_context` 처럼 **저장된 장소 글자**(「아라키초A · 아라키초A 201」 · 「사무실」)를 보는 사람 언어로(2026-10-23).
 * 등록할 때의 한국어 건물 이름이 그대로 남아 있어 읽을 때 바꾼다. ` · ` 로 나눈 조각마다 — 근무지(사무실 · 스카이 · 건물)면
 * 그 이름, 「건물 객실」이면 건물 부분만. 모르는 글자는 그대로.
 */
export function localizeStoredPlaceText(text: string, locale: string): string {
  if (!text) return text;
  const resolvedLocale = resolveAttendanceLocale(locale);
  const buildingLabels = getDictionary(resolvedLocale).cleaning.buildingLabels;
  return text
    .split(" · ")
    // 「건물 객실」(공백 있음)은 건물 부분만 — 근무지 이름 찾기는 앞부분만 보고 방 번호를 떨어뜨린다.
    .map((part) => (part.trim().includes(" ") ? localizeRoomPlaceLabel(part, buildingLabels) : localizeKnownSiteName(part, resolvedLocale)))
    .join(" · ");
}
