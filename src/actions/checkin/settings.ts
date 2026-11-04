"use server";

import { revalidatePath } from "next/cache";

import { checkinPropertyName } from "@/lib/checkin/model";
import { checkinDb, checkinGate, runCheckinAction, throwOnCheckinError, writeCheckinAuditAfterChange } from "@/lib/checkin/server";
import {
  CHECKIN_SETTINGS_DEFAULTS,
  cleanContacts,
  cleanFieldOverrides,
  cleanLanguages,
  cleanLocalizedText,
  parseCheckinSettingsInput,
  type CheckinPropertySettings,
  type CheckinSettingsInvalidField,
  type SaveCheckinSettingsInput,
} from "@/lib/checkin/settings-model";
import { hashCheckinStaffPin } from "@/lib/checkin/staff-pin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 셀프 체크인 건물 설정(FR-S08). 권한 `checkin.manage`. 16 §4-1.
 * PIN 해시는 읽어 내보내지 않는다(`hasStaffPin` 만). 약관 글이 바뀌면 서버가 버전을 올린다 — 동의 기록이 어떤 글에 대한 것인지 틀어지면 안 된다.
 * 같은 이유로 저장은 폼을 읽은 시점의 `updated_at` 조건을 건다: 두 사람이 동시에 저장하면 뒤의 글이 앞의 글을 덮으면서 버전이 하나만 오른다.
 */

type CommonFailure = { ok: false; errorKey: "forbidden" | "not_ready" | "invalid" | "failed" };

const SETTINGS_COLUMNS =
  "languages, welcome_text, terms_text, terms_version, required_fields, video_seconds_per_guest, support_contacts, idle_seconds_input, idle_seconds_done, verification_method, staff_pin_hash, mrz_autofill, updated_at, updated_by";

async function readSettingsRow(organizationId: string, propertyKey: string) {
  const { data, error } = await checkinDb()
    .from("property_settings")
    .select(SETTINGS_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("property_key", propertyKey)
    .maybeSingle();
  throwOnCheckinError(error, "property_settings");
  return data;
}

async function toSettingsView(
  propertyKey: string,
  propertyName: string,
  row: Awaited<ReturnType<typeof readSettingsRow>>,
): Promise<CheckinPropertySettings> {
  const updatedByName = row?.updated_by
    ? ((await getSupabaseServiceClient().from("profiles").select("name").eq("id", row.updated_by).maybeSingle()).data?.name ?? null)
    : null;
  const languages = row ? cleanLanguages(row.languages) : CHECKIN_SETTINGS_DEFAULTS.languages;
  return {
    propertyKey,
    propertyName,
    saved: !!row,
    languages,
    welcomeText: cleanLocalizedText(row?.welcome_text),
    termsText: cleanLocalizedText(row?.terms_text),
    termsVersion: row?.terms_version ?? CHECKIN_SETTINGS_DEFAULTS.termsVersion,
    requiredFields: cleanFieldOverrides(row?.required_fields),
    videoSecondsPerGuest: row?.video_seconds_per_guest ?? CHECKIN_SETTINGS_DEFAULTS.videoSecondsPerGuest,
    supportContacts: cleanContacts(row?.support_contacts),
    idleSecondsInput: row?.idle_seconds_input ?? CHECKIN_SETTINGS_DEFAULTS.idleSecondsInput,
    idleSecondsDone: row?.idle_seconds_done ?? CHECKIN_SETTINGS_DEFAULTS.idleSecondsDone,
    verificationMethod: row?.verification_method ?? CHECKIN_SETTINGS_DEFAULTS.verificationMethod,
    hasStaffPin: !!row?.staff_pin_hash,
    mrzAutofill: row?.mrz_autofill ?? CHECKIN_SETTINGS_DEFAULTS.mrzAutofill,
    updatedAt: row?.updated_at ?? null,
    updatedByName,
  };
}

export type GetCheckinPropertySettingsResult = { ok: true; settings: CheckinPropertySettings } | CommonFailure;

/** 저장한 적 없는 건물은 기본값(`saved: false`). */
export async function getCheckinPropertySettings(propertyKey: string): Promise<GetCheckinPropertySettingsResult> {
  const gate = await checkinGate("checkin.manage");
  if (!gate.ok) return gate;
  const propertyName = checkinPropertyName(propertyKey);
  if (!propertyName) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("settings-read", async () => {
    const row = await readSettingsRow(gate.organizationId, propertyKey);
    return { ok: true as const, settings: await toSettingsView(propertyKey, propertyName, row) };
  });
}

export type SaveCheckinPropertySettingsResult =
  | { ok: true; settings: CheckinPropertySettings }
  | CommonFailure
  | { ok: false; errorKey: "conflict" }
  | { ok: false; errorKey: "invalid"; field: CheckinSettingsInvalidField };

export async function saveCheckinPropertySettings(input: SaveCheckinSettingsInput): Promise<SaveCheckinPropertySettingsResult> {
  const gate = await checkinGate("checkin.manage");
  if (!gate.ok) return gate;
  const propertyName = checkinPropertyName(input.propertyKey);
  if (!propertyName) return { ok: false, errorKey: "invalid" };
  const parsed = parseCheckinSettingsInput(input);
  if (!parsed.ok) return { ok: false, errorKey: "invalid", field: parsed.field };
  const value = parsed.value;

  return runCheckinAction("settings-save", async () => {
    const current = await readSettingsRow(gate.organizationId, input.propertyKey);
    if ((current?.updated_at ?? null) !== input.expectedUpdatedAt) return { ok: false as const, errorKey: "conflict" as const };
    const now = new Date().toISOString();

    const compared: Record<string, [unknown, unknown]> = {
      languages: [value.languages, current ? cleanLanguages(current.languages) : null],
      welcome_text: [value.welcomeText, cleanLocalizedText(current?.welcome_text)],
      terms_text: [value.termsText, cleanLocalizedText(current?.terms_text)],
      required_fields: [value.requiredFields, cleanFieldOverrides(current?.required_fields)],
      video_seconds_per_guest: [value.videoSecondsPerGuest, current?.video_seconds_per_guest],
      support_contacts: [value.supportContacts, cleanContacts(current?.support_contacts)],
      idle_seconds_input: [value.idleSecondsInput, current?.idle_seconds_input],
      idle_seconds_done: [value.idleSecondsDone, current?.idle_seconds_done],
      mrz_autofill: [value.mrzAutofill, current?.mrz_autofill],
    };
    const changed = Object.keys(compared).filter((key) => JSON.stringify(compared[key][0]) !== JSON.stringify(compared[key][1]));
    const termsChanged = changed.includes("terms_text");

    const baseVersion = current?.terms_version ?? CHECKIN_SETTINGS_DEFAULTS.termsVersion;
    const fields = {
      languages: value.languages,
      welcome_text: value.welcomeText,
      terms_text: value.termsText,
      terms_version: termsChanged ? baseVersion + 1 : baseVersion,
      required_fields: value.requiredFields,
      video_seconds_per_guest: value.videoSecondsPerGuest,
      support_contacts: value.supportContacts,
      idle_seconds_input: value.idleSecondsInput,
      idle_seconds_done: value.idleSecondsDone,
      verification_method: "video",
      mrz_autofill: value.mrzAutofill,
      updated_by: gate.userId,
      updated_at: now,
      // 안 주면 칼럼을 빼서 지금 값을 그대로 둔다.
      ...(value.staffPin === undefined ? {} : { staff_pin_hash: value.staffPin === null ? null : hashCheckinStaffPin(value.staffPin) }),
    };

    // 위 비교와 쓰기 사이의 틈도 막는다: 있는 줄은 updated_at 이 그대로일 때만, 없는 줄은 insert 가 겹치면 충돌.
    if (current) {
      const { data, error } = await checkinDb()
        .from("property_settings")
        .update(fields)
        .eq("organization_id", gate.organizationId)
        .eq("property_key", input.propertyKey)
        .eq("updated_at", current.updated_at)
        .select("property_key")
        .maybeSingle();
      throwOnCheckinError(error, "property_settings");
      if (!data) return { ok: false as const, errorKey: "conflict" as const };
    } else {
      const { error } = await checkinDb()
        .from("property_settings")
        .insert({ organization_id: gate.organizationId, property_key: input.propertyKey, ...fields });
      if (error?.code === "23505") return { ok: false as const, errorKey: "conflict" as const };
      throwOnCheckinError(error, "property_settings");
    }

    await writeCheckinAuditAfterChange({
      organizationId: gate.organizationId,
      userId: gate.userId,
      action: "property_settings_updated",
      meta: {
        property_key: input.propertyKey,
        changed: value.staffPin === undefined ? changed : [...changed, "staff_pin"],
      },
    });
    revalidatePath("/admin/checkin");

    const saved = await readSettingsRow(gate.organizationId, input.propertyKey);
    return { ok: true as const, settings: await toSettingsView(input.propertyKey, propertyName, saved) };
  });
}
