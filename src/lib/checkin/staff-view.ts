// 셀프 체크인 직원 PC 화면의 판정 · 표시 규칙(DB · 서버 없음). 클라이언트 컴포넌트가 그대로 import 한다.
// 화면 코드에서 로직을 뽑아 둔 파일이라 vitest 로 바로 돌린다. docs/product/44 §4-4 · docs/engineering/16 §4-1.

import { getCanonicalRoomLabel, getDisplayRoomLabel, getUnsuffixedRoomKey } from "@/lib/room-label-normalization";

import { checkinPropertyName, type CheckinArrivalGroup, type CheckinArrivalRow, type CheckinStayStatus, type MissingField } from "./model";
import type {
  CheckinContactKey,
  CheckinLanguage,
  CheckinPropertySettings,
  CheckinSettingsInvalidField,
  SaveCheckinSettingsInput,
} from "./settings-model";
import { CHECKIN_CONTACT_KEYS, CHECKIN_LANGUAGES } from "./settings-model";

// ── 체크인 코드 칸 ───────────────────────────────────────────────────────────
/** 코드는 보여 준 지 5분이 지나면 스스로 가린다(시안 S1d). */
export const CODE_AUTO_HIDE_MS = 5 * 60_000;

export type CodeErrorKey = "checked_in" | "cancelled" | "expired" | "no_code" | "not_found" | "forbidden" | "not_ready" | "invalid" | "failed";

export type CodeState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "shown"; code: string; shownAt: number }
  | { kind: "error"; errorKey: CodeErrorKey };

export type CodeEvent =
  | { type: "request" }
  | { type: "success"; code: string; now: number }
  | { type: "failure"; errorKey: CodeErrorKey }
  | { type: "hide" }
  | { type: "tick"; now: number };

export const CODE_INITIAL_STATE: CodeState = { kind: "hidden" };

/**
 * 코드 칸 상태 전이. 코드는 이 상태 안에서만 산다 — 다른 예약으로 옮기면 컴포넌트를 `key` 로 새로 만들어 통째로 버린다.
 * 늦게 온 응답(이미 가린 뒤 · 다시 누른 뒤)은 `loading` 일 때만 받아서 무시한다.
 */
export function codeReducer(state: CodeState, event: CodeEvent): CodeState {
  switch (event.type) {
    case "request":
      return state.kind === "hidden" || state.kind === "error" ? { kind: "loading" } : state;
    case "success":
      return state.kind === "loading" ? { kind: "shown", code: event.code, shownAt: event.now } : state;
    case "failure":
      return state.kind === "loading" ? { kind: "error", errorKey: event.errorKey } : state;
    case "hide":
      return CODE_INITIAL_STATE;
    case "tick":
      return state.kind === "shown" && event.now - state.shownAt >= CODE_AUTO_HIDE_MS ? CODE_INITIAL_STATE : state;
  }
}

/** 6자리 코드를 「482 917」 로. 모양이 다르면 그대로. */
export function formatCheckinCode(code: string): string {
  return /^[0-9]{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** 서버를 부르기 전에 이미 코드가 필요 없는 상태인가 — 끝남 · 기간 지남은 사유만 보여 준다. */
export function codeAvailability(status: CheckinStayStatus): "available" | "checked_in" | "expired" | "cancelled" {
  if (status === "checked_in") return "checked_in";
  if (status === "expired") return "expired";
  if (status === "cancelled") return "cancelled";
  return "available";
}

/** 서버 응답의 errorKey 중 코드 칸이 아는 것만 — 모르는 값은 failed. */
export function toCodeErrorKey(errorKey: string): CodeErrorKey {
  const known: readonly CodeErrorKey[] = ["checked_in", "cancelled", "expired", "no_code", "not_found", "forbidden", "not_ready", "invalid", "failed"];
  return (known as readonly string[]).includes(errorKey) ? (errorKey as CodeErrorKey) : "failed";
}

// ── 패널 권한 ───────────────────────────────────────────────────────────────
export type PanelAccess = {
  /** 여권 사진 · 영상 줄을 그릴지(`checkin.documents`). 없으면 줄 자체가 없다. */
  showDocuments: boolean;
  /** 「확인함」: 누를 수 있음 · 이미 확인됨 · 그리지 않음. */
  verify: "ready" | "done" | "hidden";
};

export function panelAccess(input: {
  status: CheckinStayStatus;
  verifiedAt: string | null;
  canViewDocuments: boolean;
  canVerify: boolean;
}): PanelAccess {
  const verify: PanelAccess["verify"] = input.verifiedAt
    ? "done"
    : input.canVerify && input.status === "checked_in"
      ? "ready"
      : "hidden";
  return { showDocuments: input.canViewDocuments, verify };
}

// ── 목록 ────────────────────────────────────────────────────────────────────
export const ARRIVAL_GROUP_ORDER: readonly CheckinArrivalGroup[] = ["attention", "in_progress", "not_yet", "done"];

export function groupArrivalRows(rows: readonly CheckinArrivalRow[]): { group: CheckinArrivalGroup; rows: CheckinArrivalRow[] }[] {
  return ARRIVAL_GROUP_ORDER.flatMap((group) => {
    const inGroup = rows.filter((row) => row.group === group);
    return inGroup.length ? [{ group, rows: inGroup }] : [];
  });
}

export type RowStatusKey =
  | "verified"
  | "checkedIn"
  | "inProgress"
  | "preRegistered"
  | "notArrived"
  | "expired"
  | "partyMismatch"
  | "staffCheck";

/** 줄 상태 글자 하나와 색 — 확인이 필요한 줄은 붉게, 끝난 줄은 진하게, 나머지는 옅게. */
export function rowStatus(row: Pick<CheckinArrivalRow, "status" | "group" | "partyMismatch" | "verifiedAt">): { key: RowStatusKey; tone: "red" | "ok" | "soft" } {
  if (row.status === "checked_in") {
    if (row.verifiedAt) return { key: "verified", tone: "ok" };
    if (row.group === "attention") return { key: row.partyMismatch ? "partyMismatch" : "staffCheck", tone: "red" };
    return { key: "checkedIn", tone: "ok" };
  }
  if (row.status === "in_progress") return { key: "inProgress", tone: "soft" };
  if (row.status === "pre_registered") return { key: "preRegistered", tone: "soft" };
  if (row.status === "expired") return { key: "expired", tone: "soft" };
  return { key: "notArrived", tone: "soft" };
}

/**
 * 방 이름 줄 — 건물 이름은 한 번, 방은 현장에서 부르는 이름으로. 현지화된 건물 이름과 방 미확인 문구는 부르는 쪽이 넘긴다.
 * 저장된 라벨은 Beds24 방 이름 그대로다(`K202` · `Ab101` · `401_2_2`, 건물 이름 없음). 독채는 건물 이름만 남는다.
 * 앞에 건물 이름이 붙어 들어와도 뗀다. 같은 방의 Beds24 유닛(`401` · `401_2_2`)은 `_N` 만 뗀 내부 키로 한 번만 보여 주고,
 * 내부 키가 다른데 표시 이름이 같으면(`A301` · `301`, 다른 방이다 — 문서 01 · 15) 구분이 사라지지 않게 내부 키로 보여 준다.
 * `(unknown)` 은 방을 못 찾은 예약의 저장값이라 원문 대신 문구를 붙인다.
 */
export function roomsText(input: { propertyName: string; roomLabels: readonly string[]; localizedProperty: string; unknownRoomLabel: string }): string {
  const { propertyName } = input;
  const keys = new Set<string>();
  let hasUnknown = false;
  for (const label of input.roomLabels) {
    const trimmed = label.trim();
    const bare = trimmed.startsWith(`${propertyName} `) ? trimmed.slice(propertyName.length + 1).trim() : trimmed;
    if (bare === "(unknown)") hasUnknown = true;
    else if (bare) keys.add(getUnsuffixedRoomKey(propertyName, getCanonicalRoomLabel(propertyName, bare)));
  }
  keys.delete(propertyName); // 독채
  const displayOf = (key: string) => getDisplayRoomLabel(propertyName, key);
  const rooms = [...keys].map((key) => ([...keys].filter((other) => displayOf(other) === displayOf(key)).length > 1 ? key : displayOf(key)));
  const parts = hasUnknown ? [...rooms, input.unknownRoomLabel] : rooms;
  return parts.length ? `${input.localizedProperty} · ${parts.join(", ")}` : input.localizedProperty;
}

/** 통화 중 예약 요약의 방 줄 — 건물 키에서 정규 이름을 찾아 `roomsText` 로 그린다. `buildingName` 은 `useBuildingName()`. */
export function stayRoomsText(stay: { propertyKey: string; roomLabels: readonly string[] }, buildingName: (name: string) => string, unknownRoomLabel: string): string {
  const propertyName = checkinPropertyName(stay.propertyKey) ?? stay.propertyKey;
  return roomsText({ propertyName, roomLabels: stay.roomLabels, localizedProperty: buildingName(propertyName), unknownRoomLabel });
}

// ── 명부 ────────────────────────────────────────────────────────────────────
export const MISSING_FIELD_ORDER: readonly MissingField[] = [
  "name",
  "address",
  "nationality",
  "passport_number",
  "passport_photo",
  "age",
  "gender",
  "contact",
  "prev_stay",
  "next_dest",
];

/** 명부 점(●○) — 채움 수만큼 채운 점. */
export function rosterDots(filled: number, total: number): boolean[] {
  const count = Math.max(0, Math.min(total, 12));
  return Array.from({ length: count }, (_, index) => index < filled);
}

/** 사람 한 명의 MRZ 줄 상태. */
export function mrzState(mrzValid: boolean | null): "ok" | "bad" | "none" {
  return mrzValid === true ? "ok" : mrzValid === false ? "bad" : "none";
}

// ── 시각 ────────────────────────────────────────────────────────────────────
const TOKYO_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const TOKYO_MONTH_DAY_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(formatter: Intl.DateTimeFormat, iso: string): Record<string, string> | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/** 도쿄 기준 「16:05」. */
export function formatTokyoTime(iso: string | null): string {
  if (!iso) return "";
  const p = parts(TOKYO_TIME, iso);
  return p ? `${p.hour}:${p.minute}` : "";
}

/** 도쿄 기준 「11/1 16:05」. */
export function formatTokyoStamp(iso: string | null): string {
  if (!iso) return "";
  const p = parts(TOKYO_MONTH_DAY_TIME, iso);
  return p ? `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}` : "";
}

/** 「2026-11-01」 → 「11/1」. */
export function formatMonthDay(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  return month && day ? `${month}/${day}` : dateKey;
}

/** 머문 밤 수. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const days = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) && days > 0 ? Math.round(days) : 0;
}

// ── 기기 ────────────────────────────────────────────────────────────────────
/** 8자리 등록 코드를 「4827 1593」 로. */
export function groupEnrollmentCode(code: string): string {
  return /^[0-9]{8}$/.test(code) ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/** 남은 시간 「9:42」 — 0 이하면 「0:00」. */
export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function summarizeDevices(devices: readonly { disconnected: boolean }[]): { total: number; connected: number; disconnected: number } {
  const disconnected = devices.filter((device) => device.disconnected).length;
  return { total: devices.length, connected: devices.length - disconnected, disconnected };
}

// ── 건물 설정 폼 ────────────────────────────────────────────────────────────
/** PIN 은 읽어 오지 않는다 — 건드리지 않음 · 새로 입력 · 지움 세 가지만. */
export type PinPlan = { mode: "keep" } | { mode: "set"; value: string } | { mode: "clear" };

export type SettingsForm = {
  languages: CheckinLanguage[];
  welcomeText: Record<CheckinLanguage, string>;
  termsText: Record<CheckinLanguage, string>;
  videoSecondsPerGuest: string;
  supportContacts: Record<CheckinContactKey, string>;
  pin: PinPlan;
};

function perLanguage(source: Partial<Record<CheckinLanguage, string>>): Record<CheckinLanguage, string> {
  return Object.fromEntries(CHECKIN_LANGUAGES.map((language) => [language, source[language] ?? ""])) as Record<CheckinLanguage, string>;
}

export function toSettingsForm(settings: CheckinPropertySettings): SettingsForm {
  return {
    languages: [...settings.languages],
    welcomeText: perLanguage(settings.welcomeText),
    termsText: perLanguage(settings.termsText),
    videoSecondsPerGuest: String(settings.videoSecondsPerGuest),
    supportContacts: Object.fromEntries(CHECKIN_CONTACT_KEYS.map((key) => [key, settings.supportContacts[key] ?? ""])) as Record<CheckinContactKey, string>,
    pin: { mode: "keep" },
  };
}

function trimmedEntries<K extends string>(source: Record<K, string>): Record<string, string> {
  return Object.fromEntries(Object.entries<string>(source).flatMap(([key, value]) => (value.trim() ? [[key, value.trim()]] : [])));
}

/** 저장 입력으로 — 칸 설정 · 대기 시간 · MRZ 는 이 화면에서 고치지 않아 지금 값을 그대로 돌려보낸다. */
export function toSaveInput(settings: CheckinPropertySettings, form: SettingsForm): SaveCheckinSettingsInput {
  return {
    propertyKey: settings.propertyKey,
    expectedUpdatedAt: settings.updatedAt,
    languages: CHECKIN_LANGUAGES.filter((language) => form.languages.includes(language)),
    welcomeText: trimmedEntries(form.welcomeText),
    termsText: trimmedEntries(form.termsText),
    requiredFields: settings.requiredFields,
    videoSecondsPerGuest: Number(form.videoSecondsPerGuest),
    supportContacts: trimmedEntries(form.supportContacts),
    idleSecondsInput: settings.idleSecondsInput,
    idleSecondsDone: settings.idleSecondsDone,
    verificationMethod: "video",
    mrzAutofill: settings.mrzAutofill,
    ...(form.pin.mode === "set" ? { staffPin: form.pin.value } : form.pin.mode === "clear" ? { staffPin: null } : {}),
  };
}

export type SettingsSection = "languages" | "welcome" | "terms" | "verify" | "contacts" | "pin" | "other";

const FIELD_SECTION: Record<CheckinSettingsInvalidField, SettingsSection> = {
  languages: "languages",
  welcomeText: "welcome",
  termsText: "terms",
  videoSecondsPerGuest: "verify",
  verificationMethod: "verify",
  supportContacts: "contacts",
  staffPin: "pin",
  requiredFields: "other",
  idleSecondsInput: "other",
  idleSecondsDone: "other",
  mrzAutofill: "other",
};

export function sectionOfInvalidField(field: CheckinSettingsInvalidField): SettingsSection {
  return FIELD_SECTION[field];
}

/** 바뀐 곳 수 — 「바뀐 곳 N」 과 저장 단추 켜기. PIN 은 건드렸으면 한 곳. */
export function countSettingsChanges(initial: SettingsForm, current: SettingsForm): number {
  let count = 0;
  if (JSON.stringify([...initial.languages].sort()) !== JSON.stringify([...current.languages].sort())) count += 1;
  if (JSON.stringify(trimmedEntries(initial.welcomeText)) !== JSON.stringify(trimmedEntries(current.welcomeText))) count += 1;
  if (JSON.stringify(trimmedEntries(initial.termsText)) !== JSON.stringify(trimmedEntries(current.termsText))) count += 1;
  if (initial.videoSecondsPerGuest.trim() !== current.videoSecondsPerGuest.trim()) count += 1;
  if (JSON.stringify(trimmedEntries(initial.supportContacts)) !== JSON.stringify(trimmedEntries(current.supportContacts))) count += 1;
  if (current.pin.mode !== "keep") count += 1;
  return count;
}

/** PIN 새로 입력 모양(숫자 4~8자리) — 서버 검사와 같다. */
export function isValidPinInput(value: string): boolean {
  return /^[0-9]{4,8}$/.test(value);
}
