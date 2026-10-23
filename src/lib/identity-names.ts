/**
 * 국적 + 이름 세 가지(한국어 · 영문 · 가타카나) — 가입 첫 화면 · 내 정보 · 관리자 사용자 화면이 같이 쓰는 규칙.
 * `docs/product/41-residence-card-workflow.md` §2 (2026-10-22).
 *
 * - 국적에 따라 필수 칸이 바뀐다: 대한민국 → 한국어 이름 · 일본 → 일본어 이름(한자) · 그 밖 → 둘 다 선택.
 *   가타카나 이름은 필수(급여명세서 氏名). 영문 이름은 **입력받지 않는다**(2026-10-23 사용자) — 재류카드를 등록하면 카드의 로마자
 *   이름으로 채운다(비어 있을 때만). 예전에 적은 값은 그대로 두고, 적혀 있으면 형식만 본다.
 * - 앱에 보이는 이름(`profiles.name`)은 한국어 → 일본어 → 영문 → 가타카나 순으로 있는 것.
 * - 이 파일은 클라이언트 · 서버 둘 다 쓴다 — 서버 액션이 같은 함수로 다시 검사한다.
 */

/** ISO 3166-1 alpha-2. 이름은 `Intl.DisplayNames` 로 화면 언어에 맞춰 만든다(목록만 여기). */
export const NATIONALITY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AS", "AT", "AU", "AW", "AX", "AZ", "BA",
  "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT",
  "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR",
  "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH",
  "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH",
  "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GT", "GU", "GW", "GY", "HK", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH",
  "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT",
  "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP",
  "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI",
  "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN",
  "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE",
  "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA",
  "UG", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "XK", "YE", "YT",
  "ZA", "ZM", "ZW",
] as const;

/** 목록 맨 위에 먼저 보여 줄 나라 — 숙박 현장에서 자주 고르는 순서. */
export const FREQUENT_NATIONALITIES = ["KR", "JP", "VN", "CN", "TW", "NP", "PH", "ID", "MM", "LK", "TH", "US"] as const;

const NATIONALITY_SET = new Set<string>(NATIONALITY_CODES);

export function isNationalityCode(value: string): boolean {
  return NATIONALITY_SET.has(value);
}

/** 화면 언어로 된 나라 이름. ICU 가 모르면 코드 그대로. */
export function nationalityName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export type IdentityNames = {
  nationality: string;
  nameKo: string;
  nameJa: string;
  nameEn: string;
  nameKatakana: string;
};

export type IdentityField = "nationality" | "nameKo" | "nameJa" | "nameEn" | "nameKatakana";
export type IdentityErrorKey =
  | "nationality_required"
  | "name_ko_required"
  | "name_ja_required"
  | "name_en_required"
  | "name_en_invalid"
  | "name_katakana_required"
  | "name_katakana_invalid";

const NAME_MAX = 60;

/** 국적에 따라 한국어 · 일본어 이름 칸 중 어느 쪽을 보여 주는지. */
export function localNameField(nationality: string): "nameKo" | "nameJa" {
  return nationality === "JP" ? "nameJa" : "nameKo";
}

function collapseSpaces(value: string): string {
  return value.replace(/[\s　]+/g, " ").trim();
}

/**
 * 가타카나 정리 — 반각 → 전각(NFKC), 히라가나 → 가타카나, 공백 하나로.
 * 「・」 「ー」 와 공백은 그대로 둔다(キム・ハル · アーロン).
 */
export function normalizeKatakana(value: string): string {
  const nfkc = value.normalize("NFKC");
  const kata = nfkc.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  return collapseSpaces(kata);
}

const KATAKANA_NAME = /^[ァ-ヺー・ヽヾ ]+$/;

export function isKatakanaName(value: string): boolean {
  return KATAKANA_NAME.test(value) && /[ァ-ヺ]/.test(value);
}

/** 영문 이름 정리 — 전각 → 반각, 대문자, 공백 하나로(재류카드 로마자 표기와 같은 꼴). */
export function normalizeEnglishName(value: string): string {
  return collapseSpaces(value.normalize("NFKC").toUpperCase());
}

const ENGLISH_NAME = /^[A-Z][A-Z .,'-]*$/;

export function isEnglishName(value: string): boolean {
  return ENGLISH_NAME.test(value);
}

export function normalizeIdentityNames(input: IdentityNames): IdentityNames {
  const nationality = input.nationality.trim().toUpperCase();
  return {
    nationality,
    nameKo: collapseSpaces(input.nameKo).slice(0, NAME_MAX),
    nameJa: collapseSpaces(input.nameJa.normalize("NFKC")).slice(0, NAME_MAX),
    nameEn: normalizeEnglishName(input.nameEn).slice(0, NAME_MAX),
    nameKatakana: normalizeKatakana(input.nameKatakana).slice(0, NAME_MAX),
  };
}

/**
 * 칸별 첫 오류. 빈 객체면 통과. 넘기기 전에 `normalizeIdentityNames` 를 거친 값이어야 한다.
 */
export function validateIdentityNames(
  names: IdentityNames,
): Partial<Record<IdentityField, IdentityErrorKey>> {
  const errors: Partial<Record<IdentityField, IdentityErrorKey>> = {};
  if (!isNationalityCode(names.nationality)) errors.nationality = "nationality_required";
  if (names.nationality === "KR" && !names.nameKo) errors.nameKo = "name_ko_required";
  if (names.nationality === "JP" && !names.nameJa) errors.nameJa = "name_ja_required";
  if (names.nameEn && !isEnglishName(names.nameEn)) errors.nameEn = "name_en_invalid";
  if (!names.nameKatakana) errors.nameKatakana = "name_katakana_required";
  else if (!isKatakanaName(names.nameKatakana)) errors.nameKatakana = "name_katakana_invalid";
  return errors;
}

/** 앱에 보이는 이름 — 한국어 → 일본어 → 영문 → 가타카나 순(가타카나는 늘 있다). */
export function displayNameFrom(names: IdentityNames): string {
  if (names.nationality === "JP") return names.nameJa || names.nameKo || names.nameEn || names.nameKatakana;
  return names.nameKo || names.nameJa || names.nameEn || names.nameKatakana;
}

/** 국적 · 이름 세 가지 중 빠진 게 있어 「정보를 채워 주세요」 를 띄워야 하는지. */
export function identityIncomplete(row: {
  nationality: string | null;
  name_en: string | null;
  name_katakana: string | null;
  name_ko: string | null;
  name_ja: string | null;
}): boolean {
  const names = normalizeIdentityNames({
    nationality: row.nationality ?? "",
    nameKo: row.name_ko ?? "",
    nameJa: row.name_ja ?? "",
    nameEn: row.name_en ?? "",
    nameKatakana: row.name_katakana ?? "",
  });
  return Object.keys(validateIdentityNames(names)).length > 0;
}
