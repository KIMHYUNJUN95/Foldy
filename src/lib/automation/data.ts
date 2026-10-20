import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAssignedNamesByRoom } from "@/lib/cleaning-assign/data";
import {
  AUTOMATION_JOB_KEYS,
  defaultJobConfig,
  isAutomationJobKey,
  parseLocales,
  parseSettings,
  parseWeekdays,
  toHhmm,
  type AutomationDestination,
  type AutomationJobConfig,
  type AutomationJobKey,
  type AutomationLocale,
} from "@/lib/automation/jobs";
import type { CleaningDataIssue, CleaningListModel, CleaningListRoom } from "@/lib/automation/messages";
import {
  AUTOMATION_RESERVATION_SELECT,
  toAutomationReservation,
  type AutomationReservation,
} from "@/lib/automation/reservation-fields";
import { getCleaningTargets } from "@/lib/cleaning-targets";
import { getDictionary } from "@/lib/i18n";
import {
  buildRoomKey,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
  localizePropertyName,
} from "@/lib/room-label-normalization";
import { getActiveRoomCatalog } from "@/lib/rooms";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { tokyoDayStart, ymdShift } from "@/lib/tokyo-date";
import type { Database } from "@/types/database";

/**
 * 자동화가 읽는 데이터 — 설정 · 받는 곳 · 예약 · 청소 명단 · 담당자 이름. service-role 로 읽으므로 **조직을 직접 건다.**
 *
 * 도메인 계약: docs/product/36-automation-control.md
 */

type Client = SupabaseClient<Database>;

export type StoredJob = AutomationJobConfig & {
  /** 표에 줄이 있나(없으면 기본값 + 꺼짐). */
  stored: boolean;
  nextWakeAt: string | null;
  lastDoneOn: string | null;
  eventCursor: string | null;
  /** 마지막으로 켠 시각 — 취소 · 당일예약 알림은 이 뒤에 생긴 일만 보낸다. */
  enabledAt: string | null;
  updatedAt: string | null;
};

type JobRow = Database["public"]["Tables"]["automation_jobs"]["Row"];

export function toStoredJob(row: JobRow): StoredJob {
  const jobKey = row.job_key as AutomationJobKey;
  const base = defaultJobConfig(jobKey);
  return {
    enabled: row.enabled,
    enabledAt: row.enabled_at,
    eventCursor: row.event_cursor,
    jobKey,
    lastDoneOn: row.last_done_on,
    nextWakeAt: row.next_wake_at,
    retryUntil: toHhmm(row.retry_until, base.retryUntil),
    sendTime: toHhmm(row.send_time, base.sendTime),
    settings: parseSettings(row.settings),
    stored: true,
    updatedAt: row.updated_at,
    weekdays: parseWeekdays(row.weekdays),
  };
}

export async function loadJobs(supabase: Client, organizationId: string): Promise<Record<AutomationJobKey, StoredJob>> {
  const result = await supabase.from("automation_jobs").select("*").eq("organization_id", organizationId);
  if (result.error) throw new Error(result.error.message);
  const out = Object.fromEntries(
    AUTOMATION_JOB_KEYS.map((key) => [
      key,
      { ...defaultJobConfig(key), enabledAt: null, eventCursor: null, lastDoneOn: null, nextWakeAt: null, stored: false, updatedAt: null },
    ]),
  ) as Record<AutomationJobKey, StoredJob>;
  for (const row of result.data ?? []) {
    if (isAutomationJobKey(row.job_key)) out[row.job_key] = toStoredJob(row);
  }
  return out;
}

export async function loadDestinations(
  supabase: Client,
  organizationId: string,
): Promise<Record<AutomationJobKey, AutomationDestination[]>> {
  const result = await supabase
    .from("automation_destinations")
    .select("job_key, channel_key, locales")
    .eq("organization_id", organizationId)
    .order("channel_key");
  if (result.error) throw new Error(result.error.message);
  const out = Object.fromEntries(AUTOMATION_JOB_KEYS.map((key) => [key, [] as AutomationDestination[]])) as Record<
    AutomationJobKey,
    AutomationDestination[]
  >;
  for (const row of result.data ?? []) {
    if (!isAutomationJobKey(row.job_key)) continue;
    const locales = parseLocales(row.locales);
    if (locales.length > 0) out[row.job_key].push({ channelKey: row.channel_key, locales });
  }
  return out;
}

/** 건물 표시 이름 — 우리 건물 정보(`properties.display_name_*`) 우선, 없으면 사전의 건물 이름. */
export async function loadPropertyLabeler(
  supabase: Client,
  organizationId: string,
): Promise<(canonicalName: string, locale: AutomationLocale) => string> {
  const result = await supabase
    .from("properties")
    .select("name, display_name_ko, display_name_ja, display_name_en")
    .eq("organization_id", organizationId);
  const names = new Map<string, Record<AutomationLocale, string | null>>();
  for (const row of result.data ?? []) {
    names.set(getCanonicalPropertyName(row.name), { en: row.display_name_en, ja: row.display_name_ja, ko: row.display_name_ko });
  }
  return (canonicalName, locale) => {
    const stored = names.get(canonicalName)?.[locale]?.trim();
    if (stored) return stored;
    return localizePropertyName(canonicalName, getDictionary(locale).cleaning.buildingLabels);
  };
}

/**
 * 자동화 메시지의 건물 순서 — **저쪽 청소 명단 순서**(`CLEANING_BUILDING_ORDER`: 스테이아리가 오쿠보 뒤). 판매 캘린더 순서와
 * 다르다. 일일 리포트도 같은 순서를 쓰고 사노는 맨 끝(2026-10-07 사용자 결정).
 */
export const AUTOMATION_BUILDING_ORDER: readonly string[] = [
  "아라키초A",
  "아라키초B",
  "가부키초",
  "다카다노바바",
  "오쿠보A",
  "오쿠보B",
  "오쿠보C",
  "STAY ARI Apartment Hotel",
  "사노",
];

/**
 * 일일 리포트 재료 — 이번 달 예약(예약 시각 기준)과 어제 근처에 취소된 예약.
 *
 * 예약 시각 · 취소 시각은 원본(`raw_payload`)에만 있어 JSON 경로로 거른다. 경계는 하루씩 넉넉히 잡고 정확한 판정은
 * `computeDailyStats` 가 한다(도쿄 날짜).
 */
export async function loadDailyReportReservations(
  supabase: Client,
  organizationId: string,
  reportDate: string,
): Promise<AutomationReservation[]> {
  const monthStart = `${reportDate.slice(0, 7)}-01`;
  const bookedFrom = tokyoDayStart(ymdShift(monthStart, -1));
  const cancelFrom = tokyoDayStart(ymdShift(reportDate, -2));
  const [booked, cancelled] = await Promise.all([
    readAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("reservations")
        .select(AUTOMATION_RESERVATION_SELECT)
        .eq("organization_id", organizationId)
        .or(`raw_payload->>bookingTime.gte.${bookedFrom},raw_payload->>bookTime.gte.${bookedFrom},raw_payload->>entryTime.gte.${bookedFrom}`)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
    ),
    readAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("reservations")
        .select(AUTOMATION_RESERVATION_SELECT)
        .eq("organization_id", organizationId)
        .eq("status", "cancelled")
        .or(`raw_payload->>cancelTime.gte.${cancelFrom},raw_payload->>modifiedTime.gte.${cancelFrom}`)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
    ),
  ]);
  if (booked.error) throw new Error(booked.error.message);
  if (cancelled.error) throw new Error(cancelled.error.message);
  return [...booked.data, ...cancelled.data].map(toAutomationReservation);
}

/** 방 코드 — 현장이 부르는 이름(저쪽 `formatCleaningRoomCode`, 스테이아리만 숫자만). 오쿠보처럼 건물 = 방이면 null(건물 이름을 쓴다). */
export function cleaningRoomCode(canonicalProperty: string, canonicalRoom: string): string | null {
  if (canonicalRoom === canonicalProperty) return null;
  const display = getDisplayRoomLabel(canonicalProperty, canonicalRoom);
  const digits = display.replace(/[^0-9]/g, "");
  if (!digits) return display;
  switch (canonicalProperty) {
    case "아라키초A":
      return `AA${digits}`;
    case "아라키초B":
      return `AB${digits}`;
    case "가부키초":
      return `K${digits}`;
    case "다카다노바바":
      return `T${digits[0]}`;
    case "STAY ARI Apartment Hotel":
      // 숫자만(`107`) — 저쪽은 `sky107`, 우리 객실 이름은 `O107`. 2026-10-07 사용자 결정으로 접두어 없이.
      return digits;
    default:
      return display;
  }
}

/** 청소 · 셋팅 명단 — 청소 화면과 **같은 계산**(`getCleaningTargets`)을 쓴다. 제외 건물은 설정에서. */
export async function loadCleaningListModel(
  supabase: Client,
  organizationId: string,
  targetDate: string,
  excludedProperties: readonly string[],
): Promise<CleaningListModel> {
  const targets = await getCleaningTargets(organizationId, targetDate, supabase);
  const excluded = new Set(excludedProperties);
  const cleaning: CleaningListRoom[] = targets.cleaningList
    .filter((item) => !excluded.has(item.canonicalPropertyName))
    .map((item) => ({
      code: cleaningRoomCode(item.canonicalPropertyName, item.canonicalRoomLabel) ?? "",
      guestName: item.hasTurnover ? item.arrivingGuestName : null,
      kind: item.hasTurnover ? "turnover" : "no_checkin",
      pax: item.hasTurnover ? item.arrivingGuestsTotal : item.nextCheckInGuestsTotal,
      propertyName: item.canonicalPropertyName,
      roomKey: item.roomKey,
    }));
  const setting: CleaningListRoom[] = targets.settingList
    .filter((item) => !excluded.has(item.canonicalPropertyName))
    .map((item) => ({
      code: cleaningRoomCode(item.canonicalPropertyName, item.canonicalRoomLabel) ?? "",
      guestName: item.arrivingGuestName,
      kind: "setting",
      pax: item.arrivingGuestsTotal,
      propertyName: item.canonicalPropertyName,
      roomKey: item.roomKey,
    }));
  // 사람이 직접 더한 청소 방(연박 청소 등 — Hotelsmart 대신). 그날 이미 퇴실 청소가 있는 물리 객실이면 한 번만.
  const [extras, dataIssues] = await Promise.all([
    loadExtraRooms(supabase, organizationId, targetDate),
    findCleaningDataIssues(supabase, organizationId, targetDate),
  ]);
  const listed = new Set(cleaning.map(physicalOf));
  for (const extra of extras) {
    if (excluded.has(extra.propertyName) || listed.has(extra.roomKey)) continue;
    cleaning.push({
      code: cleaningRoomCode(extra.propertyName, extra.roomLabel) ?? "",
      guestName: null,
      kind: "extra",
      note: extra.note,
      pax: null,
      propertyName: extra.propertyName,
      roomKey: extra.roomKey,
    });
  }
  return { cleaning, dataIssues, setting, targetDate };
}

/** 명단 방 키 → 물리 객실 키(아라키초 `_2` 접음) — 수기 추가 방 · 청소 배정과 같은 기준. */
function physicalOf(room: { propertyName: string; roomKey: string }): string {
  const roomPart = room.roomKey.slice(room.propertyName.length + 1);
  return buildRoomKey(room.propertyName, getDisplayRoomLabel(room.propertyName, roomPart));
}

/**
 * Slack 청소 명단 담당자 — 수기 입력(`cleaning_list_assignees`)에 **청소 배정**(2026-10-20, docs/product/37)을 겹친다. 그날 그 방에 배정이 있으면
 * 배정한 사람 이름이 이긴다(배정 화면이 원본). 배정이 없는 방 · 날은 지금처럼 수기 이름.
 */
export async function loadAssigneesForModel(
  supabase: Client,
  organizationId: string,
  date: string,
  model: CleaningListModel,
): Promise<Map<string, string>> {
  const [manual, assigned] = await Promise.all([
    loadAssignees(supabase, organizationId, date),
    loadAssignedNamesByRoom(supabase, organizationId, date),
  ]);
  if (assigned.size === 0) return manual;
  const out = new Map(manual);
  for (const room of model.cleaning) {
    const names = assigned.get(physicalOf(room)) ?? assigned.get(room.roomKey);
    if (names) out.set(room.roomKey, names);
  }
  return out;
}

export type CleaningExtraRoom = { roomKey: string; propertyName: string; roomLabel: string; note: string | null };

export async function loadExtraRooms(supabase: Client, organizationId: string, date: string): Promise<CleaningExtraRoom[]> {
  const result = await supabase
    .from("cleaning_list_extra_rooms")
    .select("room_key, property_name, room_label, note")
    .eq("organization_id", organizationId)
    .eq("target_date", date);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((row) => ({ note: row.note, propertyName: row.property_name, roomKey: row.room_key, roomLabel: row.room_label }));
}

/** 「청소 방 추가」에서 고를 수 있는 방 — 활성 객실 카탈로그를 물리 객실(아라키초 `_2` 접음) 단위로. */
export async function loadCleaningRoomOptions(
  supabase: Client,
  organizationId: string,
): Promise<Array<{ roomKey: string; propertyName: string; roomLabel: string; code: string }>> {
  const catalog = (await getActiveRoomCatalog(organizationId, supabase)) ?? [];
  const seen = new Map<string, { roomKey: string; propertyName: string; roomLabel: string; code: string }>();
  for (const item of catalog) {
    const roomKey = buildRoomKey(item.propertyName, item.displayRoomLabel);
    if (seen.has(roomKey)) continue;
    seen.set(roomKey, {
      code: cleaningRoomCode(item.propertyName, item.displayRoomLabel) ?? item.propertyName,
      propertyName: item.propertyName,
      roomKey,
      roomLabel: item.displayRoomLabel,
    });
  }
  return [...seen.values()];
}

/**
 * 오늘 청소 · 셋팅에 걸리는 예약(오늘 입실 · 퇴실, 확정) 중 **필수 정보가 빠진 것**. 저쪽 `RESERVATION_REQUIRED_FIELDS`
 * (예약 번호 · 상태 · 건물 · 객실 · 입실 · 퇴실)에 맞춘다 — 우리 쪽에서는 건물을 모르거나(운영 건물로 못 맞춤) 객실이 비었거나
 * 날짜가 뒤집혔거나 예약 번호가 없는 것. 이런 예약은 청소 계산에서 조용히 빠지므로 명단 끝에 경고로 드러낸다.
 *
 * 저쪽은 이런 예약이 **하나라도 있으면 명단을 안 보냈다.** 우리는 보내고 경고를 붙인다(2026-10-07 사용자 결정 — 상관없는
 * 예약 하나로 아침 명단이 통째로 안 나가는 쪽이 현장에 더 위험).
 */
export async function findCleaningDataIssues(supabase: Client, organizationId: string, date: string): Promise<CleaningDataIssue[]> {
  const result = await supabase
    .from("reservations")
    .select("id, source_reservation_id, property_name, room_label, check_in_date, check_out_date, rp_id:raw_payload->id, rp_bookId:raw_payload->bookId")
    .eq("organization_id", organizationId)
    .eq("status", "confirmed")
    .or(`check_in_date.eq.${date},check_out_date.eq.${date}`);
  if (result.error) throw new Error(result.error.message);
  const known = new Set(AUTOMATION_BUILDING_ORDER);
  const issues: CleaningDataIssue[] = [];
  for (const row of (result.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const propertyName = String(row.property_name ?? "").trim();
    const roomLabel = String(row.room_label ?? "").trim();
    const canonical = propertyName ? getCanonicalPropertyName(propertyName) : "";
    if (canonical && isExcludedOperationalProperty(canonical)) continue;
    if (canonical && roomLabel && isExcludedOperationalRoom(propertyName, roomLabel)) continue;
    const bookingId = String(row.rp_id ?? row.rp_bookId ?? row.source_reservation_id ?? "").trim();
    const checkIn = String(row.check_in_date ?? "");
    const checkOut = String(row.check_out_date ?? "");
    const broken = !canonical || !known.has(canonical) || !roomLabel || !checkIn || !checkOut || checkIn >= checkOut || !bookingId;
    if (!broken) continue;
    const code = canonical && roomLabel ? (cleaningRoomCode(canonical, getCanonicalRoomLabel(canonical, roomLabel)) ?? canonical) : roomLabel || propertyName;
    issues.push({ bookingId, code });
  }
  return issues;
}

/** 방 코드가 없는(오쿠보) 줄은 건물 이름을 코드 자리에 넣는다 — 언어마다 다르므로 메시지를 만들 때 채운다. */
export function withLocalizedCodes(
  model: CleaningListModel,
  label: (canonicalName: string) => string,
): CleaningListModel {
  const fix = (room: CleaningListRoom) => (room.code ? room : { ...room, code: label(room.propertyName) });
  return { ...model, cleaning: model.cleaning.map(fix), setting: model.setting.map(fix) };
}

export async function loadAssignees(supabase: Client, organizationId: string, date: string): Promise<Map<string, string>> {
  const result = await supabase
    .from("cleaning_list_assignees")
    .select("room_key, names")
    .eq("organization_id", organizationId)
    .eq("assign_date", date);
  if (result.error) throw new Error(result.error.message);
  return new Map((result.data ?? []).map((row) => [row.room_key, row.names]));
}

/** 예약 데이터 관문 — 증분 정합성이 24시간 안에 돌았나(저쪽 `assertReservationDataReady` 의 24시간). */
export const RESERVATION_GATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function checkReservationGate(
  supabase: Client,
  now: Date,
): Promise<{ ok: boolean; lastSyncAt: string | null; ageMinutes: number | null }> {
  const result = await supabase.from("beds24_sync_state").select("last_modified_cursor").eq("id", true).maybeSingle();
  const lastSyncAt = result.data?.last_modified_cursor ?? null;
  if (!lastSyncAt) return { ageMinutes: null, lastSyncAt: null, ok: false };
  const age = now.getTime() - Date.parse(lastSyncAt);
  return { ageMinutes: Math.round(age / 60_000), lastSyncAt, ok: age <= RESERVATION_GATE_MAX_AGE_MS };
}
