import "server-only";

import type { CheckinServiceClient as SupabaseClient } from "../supabase/service";

import { newCheckinCode } from "../checkin-code";
import { addDays, todayTokyo } from "../tokyo-date";
import { planSync, type ReservationRow, type StayRoomRow, type StayRow } from "./plan";

// sync-stays: 우리 DB 의 public.reservations 만 읽어 checkin.stays · stay_rooms 를 맞춘다(Beds24 호출 없음, 44 §14-6).
// 범위는 도쿄 오늘 −1 ~ +30일 체크인(16 §3). 결과는 건수만 — 이름 · 예약 번호를 돌려주지 않는다.

const PAGE = 1000;
const IN_CHUNK = 200;
const CODE_TRIES = 8;
const WINDOW_BEFORE = 1;
const WINDOW_AFTER = 30;

export type SyncResult = {
  reservations: number;
  inserted: number;
  updated: number;
  cancelled: number;
  roomsAdded: number;
  roomsRemoved: number;
  changedAfterCheckin: number;
  unknownProperty: number;
  skippedConflicts: number;
};

type PgError = { code?: string; message?: string } | null;

function isUniqueViolation(error: PgError, index: string) {
  return error?.code === "23505" && (error.message ?? "").includes(index);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function readReservations(db: SupabaseClient, from: string, to: string) {
  const rows: ReservationRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .schema("public")
      .from("reservations")
      .select("id, organization_id, original_reservation_id, property_name, room_label, check_in_date, check_out_date, status, raw_payload")
      .gte("check_in_date", from)
      .lte("check_in_date", to)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`reservations 읽기 실패: ${error.message}`);
    rows.push(...((data ?? []) as ReservationRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function readStays(db: SupabaseClient, groupKeys: string[]) {
  const stays: StayRow[] = [];
  for (const part of chunks(groupKeys, IN_CHUNK)) {
    const { data, error } = await db
      .from("stays")
      .select("id, organization_id, reservation_group_key, property_key, check_in_date, check_out_date, guest_count_expected, status, retain_until")
      .in("reservation_group_key", part);
    if (error) throw new Error(`stays 읽기 실패: ${error.message}`);
    stays.push(...((data ?? []) as StayRow[]));
  }
  return stays;
}

async function readStayRooms(db: SupabaseClient, stayIds: string[]) {
  const rooms: StayRoomRow[] = [];
  for (const part of chunks(stayIds, IN_CHUNK)) {
    const { data, error } = await db.from("stay_rooms").select("id, stay_id, reservation_id").in("stay_id", part);
    if (error) throw new Error(`stay_rooms 읽기 실패: ${error.message}`);
    rooms.push(...((data ?? []) as StayRoomRow[]));
  }
  return rooms;
}

export async function runSyncStays(db: SupabaseClient, now: Date = new Date()): Promise<SyncResult> {
  const today = todayTokyo(now);
  const reservations = await readReservations(db, addDays(today, -WINDOW_BEFORE), addDays(today, WINDOW_AFTER));
  const groupKeys = [
    ...new Set(reservations.map((row) => row.original_reservation_id?.trim()).filter((key): key is string => !!key)),
  ];
  const stays = await readStays(db, groupKeys);
  const stayRooms = await readStayRooms(db, stays.map((stay) => stay.id));
  const plan = planSync(reservations, stays, stayRooms, today);

  const result: SyncResult = {
    reservations: reservations.length,
    inserted: 0,
    updated: 0,
    cancelled: 0,
    roomsAdded: 0,
    roomsRemoved: 0,
    changedAfterCheckin: plan.changedAfterCheckin,
    unknownProperty: plan.unknownProperty,
    skippedConflicts: 0,
  };

  for (const { rooms, ...stay } of plan.inserts) {
    let stayId: string | null = null;
    for (let attempt = 0; attempt < CODE_TRIES && !stayId; attempt += 1) {
      const { data, error } = await db
        .from("stays")
        .insert({ ...stay, checkin_code: newCheckinCode(), status: "pending" })
        .select("id")
        .single();
      if (!error) {
        stayId = data.id as string;
        break;
      }
      if (isUniqueViolation(error, "stays_active_code_idx")) continue;
      // 같은 예약 묶음을 다른 실행이 먼저 만들었다 — 다음 실행이 갱신한다.
      if (isUniqueViolation(error, "reservation_group_key")) break;
      throw new Error(`stays 추가 실패: ${error.message}`);
    }
    if (!stayId) {
      result.skippedConflicts += 1;
      continue;
    }
    const { error } = await db
      .from("stay_rooms")
      .insert(rooms.map((room) => ({ ...room, organization_id: stay.organization_id, stay_id: stayId })));
    if (error) throw new Error(`stay_rooms 추가 실패: ${error.message}`);
    result.inserted += 1;
    result.roomsAdded += rooms.length;
  }

  for (const update of plan.updates) {
    const tries = update.needsCode ? CODE_TRIES : 1;
    let done = false;
    for (let attempt = 0; attempt < tries && !done; attempt += 1) {
      const patch = {
        ...update.patch,
        ...(update.needsCode ? { checkin_code: newCheckinCode() } : {}),
        updated_at: new Date().toISOString(),
      };
      const { error } = await db.from("stays").update(patch).eq("id", update.id);
      if (!error) done = true;
      else if (!(update.needsCode && isUniqueViolation(error, "stays_active_code_idx"))) {
        throw new Error(`stays 갱신 실패: ${error.message}`);
      }
    }
    if (!done) {
      result.skippedConflicts += 1;
      continue;
    }
    if (update.patch.status === "cancelled") result.cancelled += 1;
    else result.updated += 1;
  }

  if (plan.roomInserts.length > 0) {
    const { error } = await db
      .from("stay_rooms")
      .upsert(plan.roomInserts, { onConflict: "stay_id,reservation_id", ignoreDuplicates: true });
    if (error) throw new Error(`stay_rooms 추가 실패: ${error.message}`);
    result.roomsAdded += plan.roomInserts.length;
  }
  for (const part of chunks(plan.roomDeletes, IN_CHUNK)) {
    const { error } = await db.from("stay_rooms").delete().in("id", part);
    if (error) throw new Error(`stay_rooms 정리 실패: ${error.message}`);
    result.roomsRemoved += part.length;
  }

  return result;
}
