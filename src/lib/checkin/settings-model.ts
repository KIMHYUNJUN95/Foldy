// 건물 설정(FR-S08) 입력 검증 · 기본값. 한계는 apps/checkin 계약 스키마(contract/schema.ts)와 같게 둔다 —
// 어긋나면 태블릿이 계약을 받지 못한다. 칸 키 · 언어 · 연락처 키도 거기 있는 것만 받는다.

export const CHECKIN_LANGUAGES = ["ja", "en", "zh-Hans", "ko"] as const;
export type CheckinLanguage = (typeof CHECKIN_LANGUAGES)[number];

export const CHECKIN_FIELD_KEYS = ["name_roman", "address", "nationality", "passport_number", "next_dest", "prev_stay"] as const;
export type CheckinFieldKey = (typeof CHECKIN_FIELD_KEYS)[number];

export const CHECKIN_CONTACT_KEYS = ["phone", "line", "whatsapp"] as const;
export type CheckinContactKey = (typeof CHECKIN_CONTACT_KEYS)[number];

export type CheckinLocalizedText = Partial<Record<CheckinLanguage, string>>;
export type CheckinFieldOverride = { key: CheckinFieldKey; required: boolean; foreignOnly: boolean };

/** 화면에 주는 건물 설정 — PIN 해시는 싣지 않고 `hasStaffPin` 만. 약관 버전은 서버가 올린다. */
export type CheckinPropertySettings = {
  propertyKey: string;
  propertyName: string;
  saved: boolean;
  languages: CheckinLanguage[];
  welcomeText: CheckinLocalizedText;
  termsText: CheckinLocalizedText;
  termsVersion: number;
  requiredFields: CheckinFieldOverride[];
  videoSecondsPerGuest: number;
  supportContacts: Partial<Record<CheckinContactKey, string>>;
  idleSecondsInput: number;
  idleSecondsDone: number;
  verificationMethod: string;
  hasStaffPin: boolean;
  mrzAutofill: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type SaveCheckinSettingsInput = {
  propertyKey: string;
  languages: readonly string[];
  welcomeText: Record<string, unknown>;
  termsText: Record<string, unknown>;
  requiredFields: readonly { key: string; required: boolean; foreignOnly: boolean }[];
  videoSecondsPerGuest: number;
  supportContacts: Record<string, unknown>;
  idleSecondsInput: number;
  idleSecondsDone: number;
  /** 1차는 `video` 만(FR-S08). */
  verificationMethod: string;
  mrzAutofill: boolean;
  /** 폼을 읽은 시점의 `updatedAt`(저장한 적 없으면 null). 그 사이 누가 저장했으면 `conflict`. */
  expectedUpdatedAt: string | null;
  /** 안 주면 그대로, null 이면 지움, 문자열이면 새 PIN(숫자 4~8자리). */
  staffPin?: string | null;
};

export type CheckinSettingsInvalidField =
  | "languages"
  | "welcomeText"
  | "termsText"
  | "requiredFields"
  | "videoSecondsPerGuest"
  | "supportContacts"
  | "idleSecondsInput"
  | "idleSecondsDone"
  | "verificationMethod"
  | "mrzAutofill"
  | "staffPin";

export type ParsedCheckinSettings = {
  languages: CheckinLanguage[];
  welcomeText: CheckinLocalizedText;
  termsText: CheckinLocalizedText;
  requiredFields: CheckinFieldOverride[];
  videoSecondsPerGuest: number;
  supportContacts: Partial<Record<CheckinContactKey, string>>;
  idleSecondsInput: number;
  idleSecondsDone: number;
  mrzAutofill: boolean;
  staffPin: string | null | undefined;
};

const WELCOME_MAX = 200;
const TERMS_MAX = 20_000;
const CONTACT_MAX = 200;

/** 줄이 없는 건물의 기본값 — 마이그레이션 칼럼 기본값과 같다. */
export const CHECKIN_SETTINGS_DEFAULTS = {
  languages: [...CHECKIN_LANGUAGES] as CheckinLanguage[],
  termsVersion: 1,
  videoSecondsPerGuest: 5,
  idleSecondsInput: 240,
  idleSecondsDone: 30,
  verificationMethod: "video",
  mrzAutofill: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 빈 칸 · 모르는 언어 · 글이 아닌 값은 버리고 언어 순서로 맞춘다. 저장값을 비교할 때도 쓴다. */
export function cleanLocalizedText(value: unknown): CheckinLocalizedText {
  const out: CheckinLocalizedText = {};
  if (!isRecord(value)) return out;
  for (const language of CHECKIN_LANGUAGES) {
    const text = value[language];
    if (typeof text === "string" && text.trim()) out[language] = text.trim();
  }
  return out;
}

export function cleanContacts(value: unknown): Partial<Record<CheckinContactKey, string>> {
  const out: Partial<Record<CheckinContactKey, string>> = {};
  if (!isRecord(value)) return out;
  for (const key of CHECKIN_CONTACT_KEYS) {
    const text = value[key];
    if (typeof text === "string" && text.trim()) out[key] = text.trim();
  }
  return out;
}

export function cleanLanguages(value: unknown): CheckinLanguage[] {
  if (!Array.isArray(value)) return [];
  return CHECKIN_LANGUAGES.filter((language) => value.includes(language));
}

export function cleanFieldOverrides(value: unknown): CheckinFieldOverride[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !(CHECKIN_FIELD_KEYS as readonly unknown[]).includes(item.key)) return [];
    return [{ key: item.key as CheckinFieldKey, required: item.required !== false, foreignOnly: item.foreignOnly === true }];
  });
}

function intWithin(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function textsWithin(texts: Record<string, string | undefined>, max: number) {
  return Object.values(texts).every((text) => (text ?? "").length <= max);
}

// 계약의 기본 칸은 전부 필수이고 국적 · 여권 번호만 「외국인만」이다. 법에 정해진 칸을 건물 설정으로 끄거나 좁히지 못하게 막는다.
const FOREIGN_ONLY_BY_DEFAULT: readonly CheckinFieldKey[] = ["nationality", "passport_number"];

function narrowsLegalField(field: { key: string; required: boolean; foreignOnly: boolean }) {
  if (!field.required) return true;
  return field.foreignOnly && !(FOREIGN_ONLY_BY_DEFAULT as readonly string[]).includes(field.key);
}

export function parseCheckinSettingsInput(
  input: SaveCheckinSettingsInput,
): { ok: true; value: ParsedCheckinSettings } | { ok: false; field: CheckinSettingsInvalidField } {
  const languages = cleanLanguages(input.languages);
  if (languages.length === 0 || !input.languages.every((value) => languages.includes(value as CheckinLanguage))) {
    return { ok: false, field: "languages" };
  }
  if (!isRecord(input.welcomeText)) return { ok: false, field: "welcomeText" };
  const welcomeText = cleanLocalizedText(input.welcomeText);
  if (!textsWithin(welcomeText, WELCOME_MAX)) return { ok: false, field: "welcomeText" };
  if (!isRecord(input.termsText)) return { ok: false, field: "termsText" };
  const termsText = cleanLocalizedText(input.termsText);
  if (!textsWithin(termsText, TERMS_MAX)) return { ok: false, field: "termsText" };

  if (!Array.isArray(input.requiredFields)) return { ok: false, field: "requiredFields" };
  const requiredFields = cleanFieldOverrides(input.requiredFields);
  if (requiredFields.length !== input.requiredFields.length || input.requiredFields.some(narrowsLegalField)) {
    return { ok: false, field: "requiredFields" };
  }

  if (!intWithin(input.videoSecondsPerGuest, 3, 15)) return { ok: false, field: "videoSecondsPerGuest" };
  if (!isRecord(input.supportContacts)) return { ok: false, field: "supportContacts" };
  const supportContacts = cleanContacts(input.supportContacts);
  if (!textsWithin(supportContacts, CONTACT_MAX)) return { ok: false, field: "supportContacts" };
  if (!intWithin(input.idleSecondsInput, 30, 900)) return { ok: false, field: "idleSecondsInput" };
  if (!intWithin(input.idleSecondsDone, 5, 120)) return { ok: false, field: "idleSecondsDone" };
  if (input.verificationMethod !== "video") return { ok: false, field: "verificationMethod" };
  if (typeof input.mrzAutofill !== "boolean") return { ok: false, field: "mrzAutofill" };
  if (typeof input.staffPin === "string" && !/^[0-9]{4,8}$/.test(input.staffPin)) return { ok: false, field: "staffPin" };
  if (input.staffPin !== undefined && input.staffPin !== null && typeof input.staffPin !== "string") {
    return { ok: false, field: "staffPin" };
  }

  return {
    ok: true,
    value: {
      languages,
      welcomeText,
      termsText,
      requiredFields,
      videoSecondsPerGuest: input.videoSecondsPerGuest,
      supportContacts,
      idleSecondsInput: input.idleSecondsInput,
      idleSecondsDone: input.idleSecondsDone,
      mrzAutofill: input.mrzAutofill,
      staffPin: input.staffPin,
    },
  };
}
