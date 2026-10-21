import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCleaningTargets } from "@/lib/cleaning-targets";
import { getReservationGuests } from "@/lib/reservation-guests";
import { GUEST_PAYLOAD_KEYS, slimPayloadOf, slimPayloadSelect } from "@/lib/reservation-payload-slim";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { addDays } from "@/lib/cleaning-assign/day-state";
import {
  CALENDAR_BUILDING_ORDER,
  buildRoomKey,
  buildSessionRoomLabel,
  compareRoomLabel,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
  physicalRoomKeyOfSessionLabel,
} from "@/lib/room-label-normalization";
import type { Database } from "@/types/database";

/**
 * 청소 배정 — 그날 청소할 방(배정 대상). 청소 화면 · Slack 청소 명단과 **같은 계산**(`getCleaningTargets`)에 수기 추가 방
 * (`cleaning_list_extra_rooms`)과 **못 한 방**(전날까지 청소 기록이 없는 방 — 「어제부터 · N일째」)을 더한다. 셋팅은 대상이 아니다.
 * 방 키는 물리 객실 키(아라키초 `_2` 접음). docs/product/37-cleaning-shift-assignment.md
 */

type Client = SupabaseClient<Database>;

export type AssignRoomSource = "checkout" | "extra" | "carry";
export type AssignRoomStatus = "pending" | "progress" | "done";

export type AssignRoom = {
  roomKey: string;
  propertyName: string;
  roomLabel: string;
  /** `cleaning_sessions.room_label` 모양 — 청소 시작 · 기록 짝짓기. */
  sessionRoomLabel: string;
  source: AssignRoomSource;
  hasTurnover: boolean;
  arrivingGuests: number | null;
  /** 오늘 들어오는 손님 이름(체크인 있는 방). */
  arrivingGuestName: string | null;
  nextCheckInDate: string | null;
  nextGuests: number | null;
  /** 다음 체크인 손님 이름(오늘 체크인 없는 방 · 30일 안). */
  nextGuestName: string | null;
  /** 수기 추가 메모. */
  note: string | null;
  /** 못 한 방 — 원래 청소해야 했던 날 · 며칠째. */
  carriedFrom: string | null;
  carryDays: number;
  /** 이전에 미룰 때 남긴 사유. */
  holdReason: string | null;
  /** 오늘 미룬 방(다음 날 · 날짜 지정) — 미배정에서 빠진다. */
  deferredUntil: string | null;
  status: AssignRoomStatus;
  usualHeadcount: number;
};

/** 못 한 방을 몇 날 앞까지 찾는가. */
const CARRY_LOOKBACK_DAYS = 7;
/** 「날짜 정해 미루기」 최대 일수(서버 액션 `holdRoom` 과 같다) — 이만큼 앞의 미룸까지 찾아야 정한 날 다시 뜬다. */
export const MAX_DEFER_DAYS = 60;

export function physicalKeyOf(propertyName: string, roomLabel: string): { roomKey: string; propertyName: string; roomLabel: string; sessionRoomLabel: string } {
  const cp = getCanonicalPropertyName(propertyName);
  const cr = getCanonicalRoomLabel(cp, roomLabel);
  const display = getDisplayRoomLabel(cp, cr);
  return { roomKey: buildRoomKey(cp, display), propertyName: cp, roomLabel: display === cp ? cp : display, sessionRoomLabel: buildSessionRoomLabel(cp, cr) };
}

/** 날짜 범위의 청소 방(퇴실 + 수기 추가) — 월 보기 · 못 한 방 찾기용. 인원 정보 없이 가볍게. */
export async function loadRangeRooms(
  supabase: Client,
  organizationId: string,
  from: string,
  to: string,
): Promise<Map<string, Map<string, { roomKey: string; propertyName: string; roomLabel: string; sessionRoomLabel: string; source: AssignRoomSource; note: string | null }>>> {
  // 한 달 퇴실이 1,000줄(Supabase 한 번 상한)에 가깝다 — 페이지로 끝까지 읽는다.
  const [resResult, extraResult] = await Promise.all([
    readAllPages<{ check_out_date: string; property_name: string | null; room_label: string | null }>((start, end) =>
      supabase
        .from("reservations")
        .select("check_out_date, property_name, room_label")
        .eq("organization_id", organizationId)
        .eq("status", "confirmed")
        .gte("check_out_date", from)
        .lte("check_out_date", to)
        .order("id")
        .range(start, end),
    ),
    readAllPages<{ target_date: string; room_key: string; property_name: string; room_label: string; note: string | null }>((start, end) =>
      supabase
        .from("cleaning_list_extra_rooms")
        .select("target_date, room_key, property_name, room_label, note")
        .eq("organization_id", organizationId)
        .gte("target_date", from)
        .lte("target_date", to)
        .order("target_date")
        .order("room_key")
        .range(start, end),
    ),
  ]);
  if (resResult.error) throw new Error(resResult.error.message);
  if (extraResult.error) throw new Error(extraResult.error.message);
  const byDate = new Map<string, Map<string, { roomKey: string; propertyName: string; roomLabel: string; sessionRoomLabel: string; source: AssignRoomSource; note: string | null }>>();
  const day = (date: string) => {
    let map = byDate.get(date);
    if (!map) {
      map = new Map();
      byDate.set(date, map);
    }
    return map;
  };
  for (const row of resResult.data ?? []) {
    if (!row.property_name || !row.room_label) continue;
    if (isExcludedOperationalProperty(row.property_name) || isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
    const key = physicalKeyOf(row.property_name, row.room_label);
    const map = day(row.check_out_date);
    if (!map.has(key.roomKey)) map.set(key.roomKey, { ...key, source: "checkout", note: null });
  }
  for (const row of extraResult.data ?? []) {
    const map = day(row.target_date);
    if (map.has(row.room_key)) continue;
    map.set(row.room_key, {
      note: row.note,
      propertyName: row.property_name,
      roomKey: row.room_key,
      roomLabel: row.room_label,
      sessionRoomLabel: buildSessionRoomLabel(row.property_name, row.room_label),
      source: "extra",
    });
  }
  return byDate;
}

/**
 * 그 날짜에 배정 대상에서 빠지는 방 — 「날짜 × 방」 키(`${date}|${roomKey}`). 처리 끝(resolved)이거나, 그날 미뤄 둔(defer, until 이 그날 뒤) 방.
 * 하루 보기(`loadAssignDayRooms`)와 같은 기준 — 월 보기 미배정 수 · 월 자동 제안이 미룬 방에 사람을 다시 넣지 않게.
 */
export async function loadHeldRoomKeys(supabase: Client, organizationId: string, from: string, to: string): Promise<Set<string>> {
  const result = await readAllPages<{ room_key: string; origin_date: string; kind: string; until_date: string | null }>((start, end) =>
    supabase
      .from("cleaning_room_holds")
      .select("room_key, origin_date, kind, until_date")
      .eq("organization_id", organizationId)
      .gte("origin_date", from)
      .lte("origin_date", to)
      .order("origin_date")
      .order("room_key")
      .range(start, end),
  );
  if (result.error) throw new Error(result.error.message);
  const out = new Set<string>();
  for (const row of result.data) {
    if (row.kind === "resolved" || (row.kind === "defer" && row.until_date && row.until_date > row.origin_date)) out.add(`${row.origin_date}|${row.room_key}`);
  }
  return out;
}

type SessionRow = { room_label: string; status: string; cleaning_date: string };

/**
 * 하루 배정 대상 방. `date` 는 도쿄 운영일.
 */
export async function loadAssignDayRooms(supabase: Client, organizationId: string, date: string): Promise<AssignRoom[]> {
  const lookFrom = addDays(date, -CARRY_LOOKBACK_DAYS);
  // 밀려 온 방(최대 7일 전 것)을 오늘에서 60일 미룰 수 있으므로 둘을 더한 만큼 앞까지.
  const holdFrom = addDays(date, -(MAX_DEFER_DAYS + CARRY_LOOKBACK_DAYS + 1));
  const yesterday = addDays(date, -1);

  const [targets, extras, usedDaysResult, sessionsResult, roomSettingsResult, holdsResult] = await Promise.all([
    getCleaningTargets(organizationId, date, supabase),
    supabase
      .from("cleaning_list_extra_rooms")
      .select("room_key, property_name, room_label, note")
      .eq("organization_id", organizationId)
      .eq("target_date", date),
    supabase
      .from("cleaning_assignments")
      .select("work_date")
      .eq("organization_id", organizationId)
      .gte("work_date", lookFrom)
      .lte("work_date", yesterday)
      .limit(5000),
    // 오래 미룬 방이 그 사이 청소됐는지도 봐야 해서 미룸 최대 기간만큼 — 1,000줄을 넘으므로 페이지로.
    readAllPages<SessionRow>((start, end) =>
      supabase
        .from("cleaning_sessions")
        .select("room_label, status, cleaning_date")
        .eq("organization_id", organizationId)
        .gte("cleaning_date", holdFrom)
        .lte("cleaning_date", date)
        .neq("status", "cancelled")
        .order("id")
        .range(start, end),
    ),
    supabase.from("cleaning_room_settings").select("room_key, usual_headcount").eq("organization_id", organizationId),
    supabase
      .from("cleaning_room_holds")
      .select("room_key, origin_date, kind, until_date, reason, property_name, room_label")
      .eq("organization_id", organizationId)
      .gte("origin_date", holdFrom)
      .lte("origin_date", date),
  ]);
  for (const result of [extras, usedDaysResult, sessionsResult, roomSettingsResult, holdsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const usual = new Map((roomSettingsResult.data ?? []).map((row) => [row.room_key, row.usual_headcount]));
  const holds = new Map((holdsResult.data ?? []).map((row) => [`${row.room_key}|${row.origin_date}`, row]));

  // 청소 기록 — 물리 객실 키 → 끝낸 날짜들 · 오늘 상태.
  const completedDates = new Map<string, string[]>();
  const todayStatus = new Map<string, AssignRoomStatus>();
  for (const row of sessionsResult.data) {
    const key = physicalRoomKeyOfSessionLabel(row.room_label);
    if (!key) continue;
    if (row.status === "completed") {
      const list = completedDates.get(key) ?? [];
      list.push(row.cleaning_date);
      completedDates.set(key, list);
    }
    if (row.cleaning_date === date) {
      const prev = todayStatus.get(key);
      if (row.status === "completed") todayStatus.set(key, "done");
      else if (row.status === "in_progress" && prev !== "done") todayStatus.set(key, "progress");
    }
  }

  const rooms = new Map<string, AssignRoom>();
  const base = (key: { roomKey: string; propertyName: string; roomLabel: string; sessionRoomLabel: string }): AssignRoom => ({
    ...key,
    source: "checkout",
    hasTurnover: false,
    arrivingGuests: null,
    arrivingGuestName: null,
    nextCheckInDate: null,
    nextGuests: null,
    nextGuestName: null,
    note: null,
    carriedFrom: null,
    carryDays: 0,
    holdReason: null,
    deferredUntil: null,
    status: todayStatus.get(key.roomKey) ?? "pending",
    usualHeadcount: usual.get(key.roomKey) ?? 1,
  });

  for (const target of targets.cleaningList) {
    const key = physicalKeyOf(target.canonicalPropertyName, target.canonicalRoomLabel);
    if (rooms.has(key.roomKey)) continue;
    rooms.set(key.roomKey, {
      ...base(key),
      sessionRoomLabel: target.sessionRoomLabel,
      hasTurnover: target.hasTurnover,
      arrivingGuests: target.hasTurnover ? target.arrivingGuestsTotal : null,
      arrivingGuestName: target.hasTurnover ? target.arrivingGuestName : null,
      nextCheckInDate: target.hasTurnover ? null : target.nextCheckInDate,
      nextGuests: target.hasTurnover ? null : target.nextCheckInGuestsTotal,
      nextGuestName: target.hasTurnover ? null : target.nextCheckInGuestName,
    });
  }
  for (const extra of extras.data ?? []) {
    if (rooms.has(extra.room_key)) continue;
    rooms.set(extra.room_key, {
      ...base({ roomKey: extra.room_key, propertyName: extra.property_name, roomLabel: extra.room_label, sessionRoomLabel: buildSessionRoomLabel(extra.property_name, extra.room_label) }),
      source: "extra",
      note: extra.note,
    });
  }

  // 오늘 미룬 방(origin = 오늘).
  for (const room of rooms.values()) {
    const hold = holds.get(`${room.roomKey}|${date}`);
    if (hold?.kind === "defer" && hold.until_date && hold.until_date > date) {
      room.deferredUntil = hold.until_date;
      room.holdReason = hold.reason;
    }
    if (hold?.kind === "resolved") room.status = "done";
  }

  // 못 한 방 — 배정을 쓴 날(그날 배정이 한 줄이라도 있는 날)만 본다. 기능을 쓰기 전 날의 방까지 몰려오지 않게.
  // 미룬 방이 있는 날도 넣는다 — 그날 배정이 하나도 없었어도 미룬 방은 정한 날 다시 떠야 한다.
  const deferDays = (holdsResult.data ?? []).filter((row) => row.kind === "defer" && row.origin_date < date).map((row) => row.origin_date);
  const usedDays = [...new Set([...(usedDaysResult.data ?? []).map((row) => row.work_date), ...deferDays])].sort();
  if (usedDays.length > 0) {
    const range = await loadRangeRooms(supabase, organizationId, usedDays[0], yesterday);
    for (const origin of usedDays) {
      for (const candidate of range.get(origin)?.values() ?? []) {
        const cleaned = (completedDates.get(candidate.roomKey) ?? []).some((d) => d >= origin && d < date);
        if (cleaned) continue;
        const hold = holds.get(`${candidate.roomKey}|${origin}`);
        if (hold?.kind === "resolved") continue;
        if (hold?.kind === "defer" && hold.until_date && hold.until_date > date) continue;
        const existing = rooms.get(candidate.roomKey);
        const carryDays = Math.round((Date.parse(date) - Date.parse(origin)) / 86_400_000);
        if (existing) {
          // 오늘도 퇴실이 있는 방 — 오늘 방으로 두되 밀려 온 표시는 남긴다(가장 이른 날 기준).
          if (!existing.carriedFrom || origin < existing.carriedFrom) {
            existing.carriedFrom = origin;
            existing.carryDays = carryDays;
            existing.holdReason = existing.holdReason ?? hold?.reason ?? null;
          }
          continue;
        }
        rooms.set(candidate.roomKey, {
          ...base(candidate),
          source: "carry",
          note: candidate.note,
          carriedFrom: origin,
          carryDays,
          holdReason: hold?.reason ?? null,
        });
      }
    }
  }

  // 7일보다 앞서 미룬 방 — 정한 날이 됐고 그 사이 청소 기록이 없으면 다시 띄운다(위 반복은 최근 7일만 본다).
  for (const hold of holdsResult.data ?? []) {
    if (hold.kind !== "defer" || hold.origin_date >= lookFrom || !hold.until_date || hold.until_date > date) continue;
    const cleaned = (completedDates.get(hold.room_key) ?? []).some((d) => d >= hold.origin_date && d < date);
    if (cleaned) continue;
    const carryDays = Math.round((Date.parse(date) - Date.parse(hold.origin_date)) / 86_400_000);
    const existing = rooms.get(hold.room_key);
    if (existing) {
      if (!existing.carriedFrom || hold.origin_date < existing.carriedFrom) {
        existing.carriedFrom = hold.origin_date;
        existing.carryDays = carryDays;
        existing.holdReason = existing.holdReason ?? hold.reason;
      }
      continue;
    }
    rooms.set(hold.room_key, {
      ...base({
        roomKey: hold.room_key,
        propertyName: hold.property_name,
        roomLabel: hold.room_label,
        sessionRoomLabel: buildSessionRoomLabel(hold.property_name, hold.room_label),
      }),
      source: "carry",
      carriedFrom: hold.origin_date,
      carryDays,
      holdReason: hold.reason,
    });
  }

  await fillCheckIns(supabase, organizationId, date, [...rooms.values()]);
  return [...rooms.values()].sort(compareAssignRooms);
}

/** 체크인 정보를 찾는 범위 — 청소 화면(`getCleaningTargets`)의 「다음 체크인」과 같은 30일. */
const CHECKIN_LOOKAHEAD_DAYS = 30;
// 인원은 원본에서 키만 받는다(`getCleaningTargets` 와 같은 방식).
const CHECKIN_SELECT: string = `id, check_in_date, guest_name, property_name, room_label, ${slimPayloadSelect(GUEST_PAYLOAD_KEYS)}`;

/**
 * 오늘 퇴실이 없는 방(수기 추가 · 못 한 방)과 30일 안에 체크인이 안 잡힌 방은 체크인 정보가 비어 있다 — 그 방들만 도착 예약을 찾아
 * 오늘 체크인(인원 · 이름) 또는 다음 체크인(날짜 · 인원 · 이름)을 채운다. 하루 보기 「오늘 체크인 2명 · 이름」 · 「다음 체크인 날짜 · 인원 · 이름」.
 */
async function fillCheckIns(supabase: Client, organizationId: string, date: string, rooms: AssignRoom[]): Promise<void> {
  const blank = new Map(rooms.filter((room) => !room.hasTurnover && !room.nextCheckInDate).map((room) => [room.roomKey, room]));
  if (blank.size === 0) return;
  const result = await readAllPages<Record<string, unknown>>((start, end) =>
    supabase
      .from("reservations")
      .select(CHECKIN_SELECT)
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .gte("check_in_date", date)
      .lt("check_in_date", addDays(date, CHECKIN_LOOKAHEAD_DAYS))
      .order("check_in_date")
      .order("id")
      .range(start, end) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
  );
  if (result.error) throw new Error(result.error.message);
  for (const row of result.data) {
    const propertyName = row.property_name as string | null;
    const roomLabel = row.room_label as string | null;
    if (!propertyName || !roomLabel) continue;
    const room = blank.get(physicalKeyOf(propertyName, roomLabel).roomKey);
    if (!room) continue;
    blank.delete(room.roomKey);
    const guests = getReservationGuests(slimPayloadOf(row, GUEST_PAYLOAD_KEYS)).total;
    const name = (row.guest_name as string | null) || null;
    if (row.check_in_date === date) {
      room.hasTurnover = true;
      room.arrivingGuests = guests;
      room.arrivingGuestName = name;
    } else {
      room.nextCheckInDate = row.check_in_date as string;
      room.nextGuests = guests;
      room.nextGuestName = name;
    }
  }
}

/** 운영 건물 순서(가부키초 다음 스테이아리 · 사노 맨 뒤) → 객실 번호 순. */
export function buildingRank(propertyName: string): number {
  const index = CALENDAR_BUILDING_ORDER.indexOf(propertyName);
  return index === -1 ? CALENDAR_BUILDING_ORDER.length : index;
}

export function compareAssignRooms(a: { propertyName: string; roomLabel: string }, b: { propertyName: string; roomLabel: string }): number {
  return buildingRank(a.propertyName) - buildingRank(b.propertyName) || a.propertyName.localeCompare(b.propertyName, "ko") || compareRoomLabel(a.roomLabel, b.roomLabel);
}
