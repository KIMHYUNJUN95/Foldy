import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCleaningTargets } from "@/lib/cleaning-targets";
import { getReservationGuests } from "@/lib/reservation-guests";
import { GUEST_PAYLOAD_KEYS, slimPayloadOf, slimPayloadSelect } from "@/lib/reservation-payload-slim";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { addDays } from "@/lib/cleaning-assign/day-state";
import { physicalKeyOf } from "@/lib/cleaning-assign/room-key";
import { buildDayRooms,
  CARRY_LOOKBACK_DAYS,
  holdBlocksAddRoom,
  indexSessions,
  MAX_DEFER_DAYS,
  type AssignRoom,
  type AssignRoomSource,
  type DayRoomSeed,
  type HoldRow,
  type SessionRow, } from "@/lib/cleaning-assign/room-rules";
import {
  buildSessionRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
} from "@/lib/room-label-normalization";
import type { StayKeys } from "@/lib/cleaning-assign/task-kind";
import type { Database } from "@/types/database";

/**
 * 청소 배정 — 그날 청소할 방(배정 대상). 청소 화면 · Slack 청소 명단과 **같은 계산**(`getCleaningTargets`)에 수기 추가 방
 * (`cleaning_list_extra_rooms`)과 **못 한 방**(전날까지 청소 기록이 없는 방 — 「어제부터 · N일째」)을 더한다. 셋팅은 대상이 아니다.
 * 방 키는 물리 객실 키(아라키초 `_2` 접음). docs/product/37-cleaning-shift-assignment.md
 */

type Client = SupabaseClient<Database>;

export type { AssignRoom, AssignRoomSource, AssignRoomStatus } from "@/lib/cleaning-assign/room-rules";
export { buildingRank, compareAssignRooms, MAX_DEFER_DAYS } from "@/lib/cleaning-assign/room-rules";

/**
 * 그날 밤 손님이 있는 방(물리 방 키) — 오늘 내 방 청소 종류(`todayTaskKey`)용(2026-11-02).
 * `staying` = 어제 이전 체크인 · 오늘 이후 체크아웃, `arriving` = 오늘 체크인. 확정 예약만, 운영 제외 방은 뺀다.
 * 하루에 걸친 예약만 읽어 방 수만큼이다.
 */
export async function loadStayKeys(supabase: Client, organizationId: string, date: string): Promise<StayKeys> {
  const { data, error } = await supabase
    .from("reservations")
    .select("property_name, room_label, check_in_date")
    .eq("organization_id", organizationId)
    .eq("status", "confirmed")
    .lte("check_in_date", date)
    .gt("check_out_date", date);
  if (error) throw new Error(error.message);
  const staying = new Set<string>();
  const arriving = new Set<string>();
  for (const row of data ?? []) {
    if (!row.property_name || !row.room_label) continue;
    if (isExcludedOperationalProperty(row.property_name) || isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
    const { roomKey } = physicalKeyOf(row.property_name, row.room_label);
    (row.check_in_date === date ? arriving : staying).add(roomKey);
  }
  return { arriving, staying };
}

/**
 * `loadStayKeys` — 못 읽으면 빈 값(모든 방이 체크아웃 청소로 보인다). 청소 종류는 시작을 막을 이유가 아니라서
 * 오늘 내 방 화면 · 시작 둘 다 이 한 가지 처리로 쓴다(로그는 남긴다).
 */
export async function loadStayKeysOrEmpty(supabase: Client, organizationId: string, date: string): Promise<StayKeys> {
  try {
    return await loadStayKeys(supabase, organizationId, date);
  } catch (error) {
    console.error("[cleaning-assign] stay keys", error);
    return { arriving: new Set<string>(), staying: new Set<string>() };
  }
}

/** 날짜 범위의 청소 방(퇴실 + 수기 추가) — 월 보기 · 못 한 방 찾기용. 인원 정보 없이 가볍게. */
export async function loadRangeRooms(
  supabase: Client,
  organizationId: string,
  from: string,
  to: string,
): Promise<Map<string, Map<string, DayRoomSeed>>> {
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
  const byDate = new Map<string, Map<string, DayRoomSeed>>();
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

const HOLD_SELECT = "room_key, origin_date, kind, until_date, reason, property_name, room_label, created_at";
const SESSION_SELECT = "room_key, room_label, status, cleaning_date, staff_user_id, closed_without_cleaning";

/** 미룸 · 처리 끝 줄 — `to` 날을 보려면 밀려 온 방(7일)에서 60일 미룰 수 있으므로 그만큼 앞에서부터. */
async function loadHolds(supabase: Client, organizationId: string, from: string, to: string): Promise<HoldRow[]> {
  const holdFrom = addDays(from, -(MAX_DEFER_DAYS + CARRY_LOOKBACK_DAYS + 1));
  const result = await readAllPages<HoldRow>((start, end) =>
    supabase
      .from("cleaning_room_holds")
      .select(HOLD_SELECT)
      .eq("organization_id", organizationId)
      .gte("origin_date", holdFrom)
      .lte("origin_date", to)
      .order("origin_date")
      .order("room_key")
      .range(start, end),
  );
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** 오래 미룬 방이 그 사이 청소됐는지도 봐야 해서 미룸 최대 기간만큼 — 1,000줄을 넘으므로 페이지로. 취소도 읽는다(판정에서 빠진다). */
async function loadSessionsForRooms(supabase: Client, organizationId: string, from: string, to: string): Promise<SessionRow[]> {
  const holdFrom = addDays(from, -(MAX_DEFER_DAYS + CARRY_LOOKBACK_DAYS + 1));
  const result = await readAllPages<SessionRow>((start, end) =>
    supabase
      .from("cleaning_sessions")
      .select(SESSION_SELECT)
      .eq("organization_id", organizationId)
      .gte("cleaning_date", holdFrom)
      .lte("cleaning_date", to)
      .neq("status", "cancelled")
      .order("id")
      .range(start, end),
  );
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** 그날 청소 기록(진행 중 · 완료) — 사람별 기록 판단(`personHasRoomRecord` · `planCancelDay`). 2인 방이라 사람 단위로 읽는다. */
export async function loadDaySessionRows(supabase: Client, organizationId: string, date: string, userId?: string): Promise<SessionRow[]> {
  let query = supabase.from("cleaning_sessions").select(SESSION_SELECT).eq("organization_id", organizationId).eq("cleaning_date", date).in("status", ["in_progress", "completed"]);
  if (userId) query = query.eq("staff_user_id", userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** 한 번의 화면 읽기에서 기록 · 미룸을 나눠 쓴다 — 오늘 내 방은 오늘 · 내일을 같이 계산하는데 약 68일치를 두 번씩 읽었다. 결과는 따로 읽을 때와 같은 범위. */
export type SharedRoomReads = {
  holds: (from: string, to: string) => Promise<HoldRow[]>;
  sessions: (from: string, to: string) => Promise<SessionRow[]>;
};

export function createSharedRoomReads(supabase: Client, organizationId: string, from: string, to: string): SharedRoomReads {
  let holds: Promise<HoldRow[]> | null = null;
  let sessions: Promise<SessionRow[]> | null = null;
  const inWindow = (day: string, rangeFrom: string, rangeTo: string) => day >= addDays(rangeFrom, -(MAX_DEFER_DAYS + CARRY_LOOKBACK_DAYS + 1)) && day <= rangeTo;
  return {
    holds: async (rangeFrom, rangeTo) => (await (holds ??= loadHolds(supabase, organizationId, from, to))).filter((row) => inWindow(row.origin_date, rangeFrom, rangeTo)),
    sessions: async (rangeFrom, rangeTo) => (await (sessions ??= loadSessionsForRooms(supabase, organizationId, from, to))).filter((row) => inWindow(row.cleaning_date, rangeFrom, rangeTo)),
  };
}

/** 「방 추가」를 막는 방(문서 45 A5) — 미룬 기간 · 그날 처리 끝. 목록에 안 나오는 방(R8)도 있어 미룸 줄에서 직접 본다. */
export async function loadAddBlockedRoomKeys(supabase: Client, organizationId: string, date: string): Promise<Set<string>> {
  const holds = await loadHolds(supabase, organizationId, date, date);
  return new Set(holds.filter((hold) => holdBlocksAddRoom(hold, date)).map((hold) => hold.room_key));
}

async function loadUsualHeadcounts(supabase: Client, organizationId: string, ownerId: string | null): Promise<Map<string, number>> {
  if (!ownerId) return new Map();
  const { data, error } = await supabase.from("cleaning_room_settings").select("room_key, usual_headcount").eq("organization_id", organizationId).eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.room_key, row.usual_headcount]));
}

/** `ownerId` 기준 방별 보통 인원 — 화면의 인원 · 하루 몫 경고(문서 45 L6). 설정은 배정 담당마다 따로다. */
export async function loadUsualByRoomKey(supabase: Client, organizationId: string, ownerId: string): Promise<Record<string, number>> {
  return Object.fromEntries(await loadUsualHeadcounts(supabase, organizationId, ownerId));
}

/** 못 한 방을 찾는 날 — 그 날짜 배정이 한 줄이라도 있는 날. */
async function loadAssignmentRowsForRooms(supabase: Client, organizationId: string, from: string, to: string): Promise<{ work_date: string; room_key: string; user_id: string }[]> {
  const result = await readAllPages<{ work_date: string; room_key: string; user_id: string }>((start, end) =>
    supabase
      .from("cleaning_assignments")
      .select("work_date, room_key, user_id")
      .eq("organization_id", organizationId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("id")
      .range(start, end),
  );
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** 지난 날짜별 방을 읽을 범위 — 배정 쓴 날 · 미룸 처음 날 중 가장 이른 날부터 `until` 까지. */
function rangeStart(usedDays: Iterable<string>, holds: readonly HoldRow[], fallback: string): string {
  let first = fallback;
  for (const day of usedDays) if (day < first) first = day;
  for (const hold of holds) if (hold.kind === "defer" && hold.origin_date < first) first = hold.origin_date;
  return first;
}

/**
 * 하루 배정 대상 방. `date` 는 도쿄 운영일. 판단은 `buildDayRooms` 하나(월 보기 · 알바 「배정 없음」도 같은 함수), 여기는 읽기 + 체크인 정보만.
 * `ownerId` — 큰 방(보통 인원)은 배정 담당마다 따로라 누구 기준인지. 없으면 모든 방 1명.
 */
export async function loadAssignDayRooms(supabase: Client, organizationId: string, date: string, ownerId: string | null, shared?: SharedRoomReads): Promise<AssignRoom[]> {
  const lookFrom = addDays(date, -CARRY_LOOKBACK_DAYS);
  const [targets, extras, assignmentRows, sessions, usual, holds] = await Promise.all([
    getCleaningTargets(organizationId, date, supabase),
    supabase
      .from("cleaning_list_extra_rooms")
      .select("room_key, property_name, room_label, note")
      .eq("organization_id", organizationId)
      .eq("target_date", date),
    loadAssignmentRowsForRooms(supabase, organizationId, lookFrom, date),
    shared ? shared.sessions(date, date) : loadSessionsForRooms(supabase, organizationId, date, date),
    loadUsualHeadcounts(supabase, organizationId, ownerId),
    shared ? shared.holds(date, date) : loadHolds(supabase, organizationId, date, date),
  ]);
  if (extras.error) throw new Error(extras.error.message);

  const seeds: DayRoomSeed[] = [
    ...targets.cleaningList.map((target) => ({
      ...physicalKeyOf(target.canonicalPropertyName, target.canonicalRoomLabel),
      arrivingGuestName: target.hasTurnover ? target.arrivingGuestName : null,
      arrivingGuests: target.hasTurnover ? target.arrivingGuestsTotal : null,
      hasTurnover: target.hasTurnover,
      nextCheckInDate: target.hasTurnover ? null : target.nextCheckInDate,
      nextGuestName: target.hasTurnover ? null : target.nextCheckInGuestName,
      nextGuests: target.hasTurnover ? null : target.nextCheckInGuestsTotal,
      note: null,
      sessionRoomLabel: target.sessionRoomLabel,
      source: "checkout" as AssignRoomSource,
    })),
    ...(extras.data ?? []).map((extra) => ({
      note: extra.note,
      propertyName: extra.property_name,
      roomKey: extra.room_key,
      roomLabel: extra.room_label,
      sessionRoomLabel: buildSessionRoomLabel(extra.property_name, extra.room_label),
      source: "extra" as AssignRoomSource,
    })),
  ];
  const usedDays = new Set(assignmentRows.filter((row) => row.work_date < date).map((row) => row.work_date));
  const first = rangeStart(usedDays, holds, date);
  const range = first < date ? await loadRangeRooms(supabase, organizationId, first, addDays(date, -1)) : new Map<string, Map<string, DayRoomSeed>>();
  const assignees = new Map<string, string[]>();
  for (const row of assignmentRows) if (row.work_date === date) assignees.set(row.room_key, [...(assignees.get(row.room_key) ?? []), row.user_id]);

  const rooms = buildDayRooms({
    assignees,
    date,
    holds,
    range,
    seeds,
    sessions: indexSessions(sessions),
    today: getCleaningOperatingDateKey(),
    usedDays,
    usual,
  });
  await fillCheckIns(supabase, organizationId, date, rooms);
  return rooms;
}

/**
 * 날짜 범위의 하루 목록 — 월 보기 · 월 제안 · 알바 달력이 하루 보기와 **같은 계산**으로 본다(문서 45 C9 · C10).
 * 체크인 정보는 채우지 않는다(이 화면들은 쓰지 않는다).
 */
export async function loadRangeDayRooms(supabase: Client, organizationId: string, from: string, to: string, ownerId: string | null, shared?: SharedRoomReads): Promise<Map<string, AssignRoom[]>> {
  const lookFrom = addDays(from, -CARRY_LOOKBACK_DAYS);
  const [assignmentRows, sessions, usual, holds] = await Promise.all([
    loadAssignmentRowsForRooms(supabase, organizationId, lookFrom, to),
    shared ? shared.sessions(from, to) : loadSessionsForRooms(supabase, organizationId, from, to),
    loadUsualHeadcounts(supabase, organizationId, ownerId),
    shared ? shared.holds(from, to) : loadHolds(supabase, organizationId, from, to),
  ]);
  const usedDays = new Set(assignmentRows.map((row) => row.work_date));
  const range = await loadRangeRooms(supabase, organizationId, rangeStart(usedDays, holds, from), to);
  const index = indexSessions(sessions);
  const today = getCleaningOperatingDateKey();
  const out = new Map<string, AssignRoom[]>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const assignees = new Map<string, string[]>();
    for (const row of assignmentRows) if (row.work_date === date) assignees.set(row.room_key, [...(assignees.get(row.room_key) ?? []), row.user_id]);
    out.set(date, buildDayRooms({ assignees, date, holds, range, seeds: [...(range.get(date)?.values() ?? [])], sessions: index, today, usedDays, usual }));
  }
  return out;
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
