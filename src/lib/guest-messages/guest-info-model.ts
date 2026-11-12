/**
 * 건물 정보 — 손님에게 보내도 되는 칸(언어별) · 답장 칸 「건물 정보 넣기」. **순수 모듈**. docs/product/47-guest-messaging.md §6-3
 *
 * - 저장 모양(`property_operation_infos.guest_info`, 202611130003): 와이파이 이름 · 비밀번호는 언어와 무관한 한 칸,
 *   나머지는 `{ ko, ja, en }`. 이상한 값은 빈 칸으로 다듬는다(던지지 않음).
 * - 직원용 칸(출입 코드 · 운영 메모)은 여기 없다 — 답장 칸에서는 따로(자물쇠 · 직원용) 보인다.
 * - 넣을 언어(`insertLanguageFor`): 번역 안 하고 보내면 손님 언어(ko · ja · en 이 아니면 en), 번역해서 보내면
 *   직원 언어(쓴 글 전체가 번역되므로 — 손님 언어 글을 넣으면 번역기가 두 번 거친다).
 * - 고른 언어 값이 비면 영어 값, 그것도 비면 「비어 있음」(넣지 못함). 한국어 · 일본어로 거꾸로 물러서지 않는다(손님이 못 읽을 수 있다).
 */

export const GUEST_LANGS = ["ko", "ja", "en"] as const;
export type GuestLang = (typeof GUEST_LANGS)[number];
export type Localized = Record<GuestLang, string>;

export const LOCALIZED_GUEST_FIELDS = ["checkIn", "checkOut", "luggage", "parking", "trash", "directions", "freeText"] as const;
export type LocalizedGuestField = (typeof LOCALIZED_GUEST_FIELDS)[number];

export type GuestInfo = {
  wifiName: string;
  wifiPassword: string;
} & Record<LocalizedGuestField, Localized>;

/** 답장 칸 · 고치기 화면의 줄 순서(와이파이는 이름 + 비밀번호 한 줄). */
export const GUEST_INSERT_KEYS = ["wifi", "checkIn", "checkOut", "luggage", "parking", "trash", "directions", "freeText"] as const;
export type GuestInsertKey = (typeof GUEST_INSERT_KEYS)[number];

export const GUEST_INFO_LIMITS = { short: 120, text: 500, freeText: 2000 } as const;

export function isGuestLang(value: unknown): value is GuestLang {
  return typeof value === "string" && (GUEST_LANGS as readonly string[]).includes(value);
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fieldLimit(field: LocalizedGuestField): number {
  return field === "freeText" ? GUEST_INFO_LIMITS.freeText : GUEST_INFO_LIMITS.text;
}

export function emptyGuestInfo(): GuestInfo {
  const info = { wifiName: "", wifiPassword: "" } as GuestInfo;
  for (const field of LOCALIZED_GUEST_FIELDS) info[field] = { ko: "", ja: "", en: "" };
  return info;
}

/** DB 값 → 모양 맞춘 값(모르는 키 버림, 길이 자름). */
export function sanitizeGuestInfo(raw: unknown): GuestInfo {
  const info = emptyGuestInfo();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return info;
  const record = raw as Record<string, unknown>;
  info.wifiName = str(record.wifiName, GUEST_INFO_LIMITS.short);
  info.wifiPassword = str(record.wifiPassword, GUEST_INFO_LIMITS.short);
  for (const field of LOCALIZED_GUEST_FIELDS) {
    const value = record[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const lang of GUEST_LANGS) info[field][lang] = str((value as Record<string, unknown>)[lang], fieldLimit(field));
  }
  return info;
}

/** 저장할 값 검사 — 길이를 넘으면 자르지 않고 거절(쓴 글이 몰래 잘리지 않게). */
export function validateGuestInfoInput(raw: unknown): { ok: true; value: GuestInfo } | { ok: false; error: "invalid_input" | "too_long" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_input" };
  const record = raw as Record<string, unknown>;
  const tooLong = (value: unknown, max: number) => typeof value === "string" && value.trim().length > max;
  if (tooLong(record.wifiName, GUEST_INFO_LIMITS.short) || tooLong(record.wifiPassword, GUEST_INFO_LIMITS.short)) {
    return { ok: false, error: "too_long" };
  }
  for (const field of LOCALIZED_GUEST_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_input" };
    for (const lang of GUEST_LANGS) {
      if (tooLong((value as Record<string, unknown>)[lang], fieldLimit(field))) return { ok: false, error: "too_long" };
    }
  }
  return { ok: true, value: sanitizeGuestInfo(raw) };
}

/** 한 칸(언어별)의 값 — 그 언어가 비면 영어, 둘 다 비면 null. */
export function pickLocalized(value: Localized, lang: GuestLang): { text: string; lang: GuestLang } | null {
  if (value[lang].trim()) return { text: value[lang].trim(), lang };
  if (value.en.trim()) return { text: value.en.trim(), lang: "en" };
  return null;
}

/** 대화 손님 언어(정리된 코드) + 지금 번역 대상 → 넣을 언어. */
export function insertLanguageFor(guestLanguage: string | null, translateTarget: string | null, staffLocale: string): GuestLang {
  if (translateTarget) return isGuestLang(staffLocale) ? staffLocale : "en";
  const base = guestLanguage?.toLowerCase().split(/[-_]/)[0] ?? "";
  return isGuestLang(base) ? base : "en";
}

/** 넣을 글의 꼴(언어마다 사전에서 — 서버가 손님 언어 사전으로 채운다). */
export type GuestInsertFormats = { wifi: string; wifiNameOnly: string; wifiPasswordOnly: string };

export type GuestInsertItem = { key: GuestInsertKey; text: string | null; lang: GuestLang | null };

/** 한 언어의 넣기 목록 — 빈 칸도 줄은 남긴다(화면이 「비어 있음」으로 흐리게). */
export function buildGuestInserts(info: GuestInfo, lang: GuestLang, formats: GuestInsertFormats): GuestInsertItem[] {
  return GUEST_INSERT_KEYS.map((key) => {
    if (key === "wifi") {
      const name = info.wifiName.trim();
      const password = info.wifiPassword.trim();
      const text =
        name && password
          ? formats.wifi.replace("{name}", name).replace("{password}", password)
          : name
            ? formats.wifiNameOnly.replace("{name}", name)
            : password
              ? formats.wifiPasswordOnly.replace("{password}", password)
              : null;
      return { key, text, lang: text ? lang : null };
    }
    const picked = pickLocalized(info[key], lang);
    return { key, text: picked?.text ?? null, lang: picked?.lang ?? null };
  });
}

/** 고치기 목록의 「8칸 중 7칸」 — 와이파이는 이름이 있으면 찬 것, 나머지는 영어 또는 아무 언어든 하나. */
export function guestInfoFillCount(info: GuestInfo): { filled: number; total: number; empty: GuestInsertKey[] } {
  const empty: GuestInsertKey[] = [];
  for (const key of GUEST_INSERT_KEYS) {
    const has =
      key === "wifi" ? Boolean(info.wifiName.trim() || info.wifiPassword.trim()) : GUEST_LANGS.some((lang) => info[key][lang].trim());
    if (!has) empty.push(key);
  }
  return { filled: GUEST_INSERT_KEYS.length - empty.length, total: GUEST_INSERT_KEYS.length, empty };
}

/** 어느 언어에 값이 하나라도 있나(목록의 「언어」 칸). */
export function guestInfoLanguages(info: GuestInfo): GuestLang[] {
  return GUEST_LANGS.filter((lang) => LOCALIZED_GUEST_FIELDS.some((field) => info[field][lang].trim()));
}
