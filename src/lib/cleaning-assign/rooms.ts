import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCleaningTargets } from "@/lib/cleaning-targets";
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
  nextCheckInDate: string | null;
  nextGuests: number | null;
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
  const [resResult, extraResult] = await Promise.all([
    supabase
      .from("reservations")
      .select("check_out_date, property_name, room_label")
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .gte("check_out_date", from)
      .lte("check_out_date", to)
      .limit(5000),
    supabase
      .from("cleaning_list_extra_rooms")
      .select("target_date, room_key, property_name, room_label, note")
      .eq("organization_id", organizationId)
      .gte("target_date", from)
      .lte("target_date", to),
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

type SessionRow = { room_label: string; status: string; cleaning_date: string };

/**
 * 하루 배정 대상 방. `date` 는 도쿄 운영일.
 */
export async function loadAssignDayRooms(supabase: Client, organizationId: string, date: string): Promise<AssignRoom[]> {
  const lookFrom = addDays(date, -CARRY_LOOKBACK_DAYS);
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
    supabase
      .from("cleaning_sessions")
      .select("room_label, status, cleaning_date")
      .eq("organization_id", organizationId)
      .gte("cleaning_date", lookFrom)
      .lte("cleaning_date", date)
      .neq("status", "cancelled")
      .limit(5000),
    supabase.from("cleaning_room_settings").select("room_key, usual_headcount").eq("organization_id", organizationId),
    supabase
      .from("cleaning_room_holds")
      .select("room_key, origin_date, kind, until_date, reason")
      .eq("organization_id", organizationId)
      .gte("origin_date", lookFrom)
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
  for (const row of (sessionsResult.data ?? []) as SessionRow[]) {
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
    nextCheckInDate: null,
    nextGuests: null,
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
      nextCheckInDate: target.hasTurnover ? null : target.nextCheckInDate,
      nextGuests: target.hasTurnover ? null : target.nextCheckInGuestsTotal,
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
  const usedDays = [...new Set((usedDaysResult.data ?? []).map((row) => row.work_date))].sort();
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

  return [...rooms.values()].sort(compareAssignRooms);
}

/** 운영 건물 순서(가부키초 다음 스테이아리 · 사노 맨 뒤) → 객실 번호 순. */
export function buildingRank(propertyName: string): number {
  const index = CALENDAR_BUILDING_ORDER.indexOf(propertyName);
  return index === -1 ? CALENDAR_BUILDING_ORDER.length : index;
}

export function compareAssignRooms(a: { propertyName: string; roomLabel: string }, b: { propertyName: string; roomLabel: string }): number {
  return buildingRank(a.propertyName) - buildingRank(b.propertyName) || a.propertyName.localeCompare(b.propertyName, "ko") || compareRoomLabel(a.roomLabel, b.roomLabel);
}
