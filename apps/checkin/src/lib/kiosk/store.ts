import "server-only";

import type { DeviceRow } from "../device/auth";
import { loadStayById, type StayView } from "../guest/store";
import type { CheckinServiceClient } from "../supabase/service";
import { heldByOther, kioskGate, kioskLanguageOf, type NameCandidate } from "./find";
import { kioskStatusAfterSave } from "./guests";

// 태블릿 「예약 찾기」 읽기 · 쓰기(서비스 롤). 태블릿에는 이 파일이 만든 값만 넘긴다 — 원문 payload · 다른 예약은 넘기지 않는다.

export type KioskStayRow = { id: string; property_key: string; status: string; checkInDate: string; checkOutDate: string };

const STAY_COLUMNS = "id, property_key, status, check_in_date, check_out_date";

function toRow(row: Record<string, unknown>): KioskStayRow {
  return {
    id: row.id as string,
    property_key: row.property_key as string,
    status: row.status as string,
    checkInDate: row.check_in_date as string,
    checkOutDate: row.check_out_date as string,
  };
}

/** 코드로 찾기 — 조직 안 전체(다른 건물이면 「다른 건물」로 알려 주려고). */
export async function readStaysByCode(db: CheckinServiceClient, organizationId: string, code: string): Promise<KioskStayRow[]> {
  const { data, error } = await db
    .from("stays")
    .select(STAY_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("checkin_code", code)
    .limit(5);
  if (error) throw new Error(`stays 읽기 실패: ${error.message}`);
  return (data ?? []).map(toRow);
}

/** 이름 + 날짜로 찾기 — 이 기기의 건물 · 그 날 체크인하는 stay 전부(상태 무관 — 막는 사유를 알려 주려고). */
export async function readNameCandidates(
  db: CheckinServiceClient,
  organizationId: string,
  propertyKey: string,
  checkInDate: string | string[],
): Promise<{ stays: KioskStayRow[]; candidates: NameCandidate[] }> {
  const { data: stays, error } = await db
    .from("stays")
    .select(STAY_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("property_key", propertyKey)
    .in("check_in_date", Array.isArray(checkInDate) ? checkInDate : [checkInDate]);
  if (error) throw new Error(`stays 읽기 실패: ${error.message}`);
  if (!stays?.length) return { stays: [], candidates: [] };

  const { data: rooms, error: roomError } = await db
    .from("stay_rooms")
    .select("stay_id, reservation_id")
    .in("stay_id", stays.map((stay) => stay.id as string));
  if (roomError) throw new Error(`stay_rooms 읽기 실패: ${roomError.message}`);
  const reservationIds = (rooms ?? []).map((room) => room.reservation_id as string);
  const { data: reservations, error: resError } = reservationIds.length
    ? await db.schema("public").from("reservations").select("id, guest_name").in("id", reservationIds)
    : { data: [] as { id: string; guest_name: string }[], error: null };
  if (resError) throw new Error(`reservations 읽기 실패: ${resError.message}`);

  const nameById = new Map((reservations ?? []).map((row) => [row.id as string, (row.guest_name as string) ?? ""]));
  return {
    stays: stays.map(toRow),
    candidates: stays.map((stay) => ({
      stayId: stay.id as string,
      guestNames: (rooms ?? [])
        .filter((room) => room.stay_id === stay.id)
        .map((room) => nameById.get(room.reservation_id as string) ?? "")
        .filter(Boolean),
    })),
  };
}

/** 예약 언어(Beds24 `lang`) — 찾은 뒤 화면을 그 언어로 바꾼다(FR-K01). */
export async function readStayLanguage(db: CheckinServiceClient, stayId: string) {
  const { data: rooms } = await db.from("stay_rooms").select("reservation_id").eq("stay_id", stayId).limit(1);
  const reservationId = rooms?.[0]?.reservation_id as string | undefined;
  if (!reservationId) return null;
  const { data } = await db
    .schema("public")
    .from("reservations")
    .select("lang:raw_payload->>lang")
    .eq("id", reservationId)
    .maybeSingle();
  return kioskLanguageOf((data?.lang as string | null) ?? null);
}

// 태블릿 진행 잠금(FR-K12 · K17): 무조작 240초 + 여유 → 5분. 화면이 움직일 때마다 늘린다.
export const SESSION_HOLD_MS = 5 * 60_000;

/** 이 기기의 세션을 잡는다 — 다른 기기가 잡고 있으면 null(「다른 기기에서 진행 중」). */
export async function holdSession(
  db: CheckinServiceClient,
  stay: { id: string; organizationId: string },
  deviceId: string,
  now: Date,
): Promise<string | null> {
  const { data: sessions, error } = await db
    .from("sessions")
    .select("id, device_id, locked_until, finished_at, abandoned_at, started_at")
    .eq("stay_id", stay.id)
    .is("finished_at", null)
    .is("abandoned_at", null)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`sessions 읽기 실패: ${error.message}`);
  if (heldByOther(sessions ?? [], deviceId, now)) return null;

  const lockedUntil = new Date(now.getTime() + SESSION_HOLD_MS).toISOString();
  const mine = (sessions ?? []).find((session) => session.device_id === deviceId);
  if (mine) {
    const { error: updateError } = await db.from("sessions").update({ locked_until: lockedUntil }).eq("id", mine.id);
    if (updateError) throw new Error(`sessions 갱신 실패: ${updateError.message}`);
    return mine.id as string;
  }
  const { data: created, error: insertError } = await db
    .from("sessions")
    .insert({ organization_id: stay.organizationId, stay_id: stay.id, device_id: deviceId, last_step: "found", locked_until: lockedUntil })
    .select("id")
    .single();
  if (insertError) throw new Error(`sessions 만들기 실패: ${insertError.message}`);
  return created.id as string;
}

/** 이 기기 · 아직 안 끝난 세션인지 확인하고 잠금을 늘린다. 맞으면 stay id. */
export async function touchSession(db: CheckinServiceClient, sessionId: string, deviceId: string, now: Date): Promise<string | null> {
  const { data, error } = await db
    .from("sessions")
    .update({ locked_until: new Date(now.getTime() + SESSION_HOLD_MS).toISOString() })
    .eq("id", sessionId)
    .eq("device_id", deviceId)
    .is("finished_at", null)
    .is("abandoned_at", null)
    .select("stay_id")
    .maybeSingle();
  if (error) throw new Error(`sessions 갱신 실패: ${error.message}`);
  return (data?.stay_id as string | undefined) ?? null;
}

/** 이 기기 세션의 stay — 세션이 끝났거나 · 다른 건물 · 막힌 기간이면 null(`session_gone`). */
export async function openKioskStay(db: CheckinServiceClient, sessionId: string, device: DeviceRow, now: Date): Promise<StayView | null> {
  const stayId = await touchSession(db, sessionId, device.id, now);
  if (!stayId) return null;
  const stay = await loadStayById(db, stayId);
  if (!stay || stay.propertyKey !== device.property_key || kioskGate(stay, now).kind === "blocked") return null;
  return stay;
}

/** 저장 뒤 다시 읽고, 미리 끝났던 예약이 덜 된 상태가 되면 pending 으로 내린다(태블릿은 올리지 않는다). */
export async function reloadKioskStay(db: CheckinServiceClient, stayId: string): Promise<StayView | null> {
  const stay = await loadStayById(db, stayId);
  if (!stay) return null;
  const next = kioskStatusAfterSave(stay);
  if (next) {
    const { error } = await db
      .from("stays")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", stay.id)
      .eq("status", "pre_registered");
    if (error) throw new Error(`stays 갱신 실패: ${error.message}`);
    stay.status = next;
  }
  return stay;
}

export type KioskGuest = {
  id: string;
  name: string | null;
  isRepresentative: boolean;
  isChild: boolean;
  hasPassportPhoto: boolean;
  hasFaceVideo: boolean;
  missing: string[];
  hasJapanAddress: boolean;
  /** 대표자만 — 확인 화면에서 주소 · 연락처를 미리 채우려고. */
  address?: string | null;
  contact?: string | null;
};

/** 태블릿에 넘기는 예약 모양(시안 T2). 여권 번호 같은 칸 값은 넘기지 않는다 — 주소만 대표자 것 하나. */
export function kioskStayOf(stay: StayView) {
  const nights = Math.round((Date.parse(stay.checkOutDate) - Date.parse(stay.checkInDate)) / 86_400_000);
  return {
    stayId: stay.id,
    rooms: stay.rooms,
    checkInDate: stay.checkInDate,
    checkOutDate: stay.checkOutDate,
    nights,
    partySize: stay.partySize,
    guestCountExpected: stay.guestCountExpected,
    consented: stay.consented,
    guests: stay.guests.map(
      (guest): KioskGuest => ({
        id: guest.id,
        name: guest.name_roman,
        isRepresentative: guest.is_representative,
        isChild: guest.guest_type === "child",
        hasPassportPhoto: guest.hasPassportPhoto,
        hasFaceVideo: guest.hasFaceVideo,
        missing: guest.missing,
        hasJapanAddress: guest.has_japan_address === true,
        ...(guest.is_representative ? { address: guest.address, contact: guest.contact } : {}),
      }),
    ),
  };
}
