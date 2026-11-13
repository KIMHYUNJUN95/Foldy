import { z } from "zod";

import { devicePin } from "../device/pin";
import { getDictionary, LOCALES, type Locale } from "../i18n";

import { ADDRESS_MAX, ADDRESS_MIN_FOREIGN, ADDRESS_MIN_JAPAN } from "../guest/address";
import { CONTRACT_VERSION, fieldKeySchema, type Contract } from "./schema";

// 건물 설정 줄(checkin.property_settings) → 계약 JSON. 줄이 없으면 기본값(43 §8-6(3) · 신주쿠 구 명부 규칙).
// DB 없이 테스트한다. 문구 원본은 이 앱의 사전(ko · ja · en · zh-Hans).

export type PropertySettingsRow = {
  languages: string[] | null;
  welcome_text: unknown;
  terms_text: unknown;
  terms_version: number;
  required_fields: unknown;
  video_seconds_per_guest: number;
  support_contacts: unknown;
  idle_seconds_input: number;
  idle_seconds_done: number;
  verification_method: "video" | "staff_call" | "auto_match";
  staff_pin_hash: string | null;
  mrz_autofill: boolean;
  staff_call_enabled: boolean;
};

type FieldKey = z.infer<typeof fieldKeySchema>;

// 기본 칸 — 웹 사전 등록의 필수 칸(guest/fields.ts missingFields)과 같은 규칙.
const DEFAULT_FIELDS: { key: FieldKey; required: boolean; foreignOnly: boolean }[] = [
  { key: "name_roman", required: true, foreignOnly: false },
  { key: "address", required: true, foreignOnly: false },
  { key: "nationality", required: true, foreignOnly: true },
  { key: "passport_number", required: true, foreignOnly: true },
  { key: "prev_stay", required: true, foreignOnly: false },
  { key: "next_dest", required: true, foreignOnly: false },
];

// 건물 설정이 칸을 바꿀 때의 모양: [{ key, required?, foreignOnly? }]. 모르는 키 · 잘못된 줄은 버린다.
const overrideSchema = z.object({ key: fieldKeySchema, required: z.boolean().optional(), foreignOnly: z.boolean().optional() });

const localized = z.record(z.string(), z.unknown());

function localizedText(value: unknown): Partial<Record<Locale, string>> {
  const parsed = localized.safeParse(value);
  if (!parsed.success) return {};
  const out: Partial<Record<Locale, string>> = {};
  for (const locale of LOCALES) {
    const text = parsed.data[locale];
    if (typeof text === "string" && text.trim()) out[locale] = text;
  }
  return out;
}

function fieldLabel(key: FieldKey): Partial<Record<Locale, string>> {
  return Object.fromEntries(LOCALES.map((locale) => [locale, getDictionary(locale).fields[key]]));
}

function contractFields(raw: unknown): Contract["fields"] {
  const overrides = Array.isArray(raw)
    ? raw.flatMap((item) => {
        const parsed = overrideSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const byKey = new Map(DEFAULT_FIELDS.map((field) => [field.key, { ...field }]));
  for (const item of overrides) {
    const base = byKey.get(item.key) ?? { key: item.key, required: false, foreignOnly: false };
    byKey.set(item.key, {
      key: item.key,
      required: item.required ?? base.required,
      foreignOnly: item.foreignOnly ?? base.foreignOnly,
    });
  }
  // 이름은 늘 필수(법 요건).
  byKey.set("name_roman", { key: "name_roman", required: true, foreignOnly: false });
  return [...byKey.values()].map((field) => ({ ...field, label: fieldLabel(field.key) }));
}

function contacts(value: unknown): Contract["supportContacts"] {
  const parsed = localized.safeParse(value);
  if (!parsed.success) return {};
  const out: Contract["supportContacts"] = {};
  for (const key of ["phone", "line", "whatsapp"] as const) {
    const text = parsed.data[key];
    if (typeof text === "string" && text.trim()) out[key] = text.trim();
  }
  return out;
}

/**
 * 태블릿이 「설정을 다시 받을까」를 판단하는 불투명한 값. ping 과 settings 가 이 함수 하나로 만든다.
 * 직원 통화 켜기는 폼 동시 저장 검사 때문에 `updated_at` 을 바꾸지 않으므로 값에 함께 넣는다.
 */
export function settingsVersionOf(row: { updated_at?: string | null; staff_call_enabled?: boolean | null } | null): string {
  // 계약 버전도 넣는다 — 계약 모양이 바뀌면 설정 줄이 그대로여도 값이 달라져 태블릿이 다시 받는다(옛 앱은 다시 받은 뒤 「업데이트 필요」).
  return `${row?.updated_at ?? "default"}|call:${row?.staff_call_enabled ?? false}|contract:${CONTRACT_VERSION}`;
}

/** `device` 가 없으면 PIN 을 싣지 않는다 — PIN 값은 기기마다 달라 기기 토큰으로 부를 때만 만든다. */
export function buildContract(row: PropertySettingsRow | null, device?: { id: string; secret: string }): Contract {
  const languages = (row?.languages ?? []).filter((value): value is Locale => (LOCALES as readonly string[]).includes(value));
  return {
    contractVersion: CONTRACT_VERSION,
    languages: languages.length ? languages : [...LOCALES],
    welcomeText: localizedText(row?.welcome_text),
    termsVersion: row?.terms_version ?? 1,
    fields: contractFields(row?.required_fields),
    videoSecondsPerGuest: row?.video_seconds_per_guest ?? 5,
    verificationMethod: row?.verification_method ?? "video",
    termsText: localizedText(row?.terms_text),
    idleSecondsInput: row?.idle_seconds_input ?? 240,
    idleSecondsDone: row?.idle_seconds_done ?? 30,
    mrzAutofill: row?.mrz_autofill ?? true,
    addressRules: { maxLength: ADDRESS_MAX, minLengthForeign: ADDRESS_MIN_FOREIGN, minLengthJapan: ADDRESS_MIN_JAPAN, foreignScript: "latin" },
    supportContacts: contacts(row?.support_contacts),
    staffPin: device ? devicePin(row?.staff_pin_hash, device.id, device.secret) : null,
    staffCallEnabled: row?.staff_call_enabled ?? false,
  };
}
