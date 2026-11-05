import "server-only";

import type { DeviceRow } from "../device/auth";
import { loadStayById, type StayView } from "../guest/store";
import type { CheckinServiceClient } from "../supabase/service";
import { json } from "../guest/request";
import { finishedWithinWindow, freshProof, holdDecision, identityProven, type FoundBy } from "./complete";
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
  /** 여권 찾기용 — 이 날(도쿄 오늘)에 묵고 있는 체크인 끝난 stay 도 후보에 넣는다(여러 밤 손님이 3일째 다시 비출 때). */
  stayingOn?: string,
): Promise<{ stays: KioskStayRow[]; candidates: NameCandidate[] }> {
  const dates = Array.isArray(checkInDate) ? checkInDate : [checkInDate];
  let query = db.from("stays").select(STAY_COLUMNS).eq("organization_id", organizationId).eq("property_key", propertyKey);
  query = stayingOn
    ? query.or(`check_in_date.in.(${dates.join(",")}),and(status.eq.checked_in,check_in_date.lte.${stayingOn},check_out_date.gte.${stayingOn})`)
    : query.in("check_in_date", dates);
  const { data: stays, error } = await query;
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
  foundBy: FoundBy,
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
  const decision = holdDecision(sessions ?? [], deviceId, now, foundBy);
  if (decision.kind === "busy") return null;

  const lockedUntil = decision.lock ? new Date(now.getTime() + SESSION_HOLD_MS).toISOString() : null;
  const mine = (sessions ?? []).find((session) => session.device_id === deviceId);
  if (mine) {
    const { error: updateError } = await db.from("sessions").update({ locked_until: lockedUntil, step_payload: freshProof(foundBy) })
      .eq("id", mine.id);
    if (updateError) throw new Error(`sessions 갱신 실패: ${updateError.message}`);
    return mine.id as string;
  }
  const { data: created, error: insertError } = await db
    .from("sessions")
    .insert({ organization_id: stay.organizationId, stay_id: stay.id, device_id: deviceId, last_step: "found", locked_until: lockedUntil, step_payload: freshProof(foundBy) })
    .select("id")
    .single();
  if (insertError) throw new Error(`sessions 만들기 실패: ${insertError.message}`);
  return created.id as string;
}

async function touchSessionRow(
  db: CheckinServiceClient,
  sessionId: string,
  deviceId: string,
  now: Date,
): Promise<{ stayId: string; payload: unknown } | null> {
  const { data, error } = await db
    .from("sessions")
    .select("stay_id, step_payload")
    .eq("id", sessionId)
    .eq("device_id", deviceId)
    .is("finished_at", null)
    .is("abandoned_at", null)
    .maybeSingle();
  if (error) throw new Error(`sessions 읽기 실패: ${error.message}`);
  if (!data) return null;
  // 잠금은 증명된 세션만 늘린다 — 증명 없는 이름 찾기가 예약을 붙잡지 못하게.
  if (identityProven(data.step_payload)) {
    const { error: updateError } = await db
      .from("sessions")
      .update({ locked_until: new Date(now.getTime() + SESSION_HOLD_MS).toISOString() })
      .eq("id", sessionId);
    if (updateError) throw new Error(`sessions 갱신 실패: ${updateError.message}`);
  }
  return { stayId: data.stay_id as string, payload: data.step_payload };
}

/** 이 기기 · 아직 안 끝난 세션인지 확인하고 잠금을 늘린다. 맞으면 stay id. */
export async function touchSession(db: CheckinServiceClient, sessionId: string, deviceId: string, now: Date): Promise<string | null> {
  return (await touchSessionRow(db, sessionId, deviceId, now))?.stayId ?? null;
}

/** 세션의 stay 와 이 찾기의 증명(step_payload). 세션이 끝났거나 · 다른 건물 · 막힌 기간이면 null(`session_gone`). */
export async function openKioskStayWithProof(
  db: CheckinServiceClient,
  sessionId: string,
  device: DeviceRow,
  now: Date,
): Promise<{ stay: StayView; payload: unknown } | null> {
  const row = await touchSessionRow(db, sessionId, device.id, now);
  if (!row) return null;
  const stay = await loadStayById(db, row.stayId);
  if (!stay || stay.propertyKey !== device.property_key || kioskGate(stay, now).kind === "blocked") return null;
  return { stay, payload: row.payload };
}

/** `openKioskStay` 와 같되 증명이 없는 세션은 거절한다 — 명부를 쓰거나 예약 정보를 돌려주는 모든 태블릿 라우트가 이것을 쓴다. */
export async function openProvenKioskStay(
  db: CheckinServiceClient,
  sessionId: string,
  device: DeviceRow,
  now: Date,
): Promise<{ stay: StayView } | { error: "session_gone" | "verify_required" }> {
  const opened = await openKioskStayWithProof(db, sessionId, device, now);
  if (!opened) return { error: "session_gone" };
  if (!identityProven(opened.payload)) return { error: "verify_required" };
  return { stay: opened.stay };
}

/** `openProvenKioskStay` 가 거절했을 때의 응답. */
export function provenFailure(error: "session_gone" | "verify_required") {
  return json({ ok: false, error }, error === "session_gone" ? 409 : 403);
}

/** 이 예약(stay)의 예약 이름들 — 본인 확인에서 여권 이름과 맞춘다. */
export async function readReservationNames(db: CheckinServiceClient, organizationId: string, stayId: string): Promise<string[]> {
  const { data: rooms, error } = await db.from("stay_rooms").select("reservation_id").eq("organization_id", organizationId).eq("stay_id", stayId);
  if (error) throw new Error(`stay_rooms 읽기 실패: ${error.message}`);
  const ids = (rooms ?? []).map((room) => room.reservation_id as string);
  if (!ids.length) return [];
  const { data, error: resError } = await db
    .schema("public")
    .from("reservations")
    .select("guest_name")
    .eq("organization_id", organizationId)
    .in("id", ids);
  if (resError) throw new Error(`reservations 읽기 실패: ${resError.message}`);
  return (data ?? []).map((row) => (row.guest_name as string | null) ?? "").filter(Boolean);
}

/** 증명 직후 잠금을 건다 — 다른 기기가 이미 잡고 있으면 false(busy). */
export async function takeSessionLock(
  db: CheckinServiceClient,
  stay: { id: string; organizationId: string },
  sessionId: string,
  deviceId: string,
  now: Date,
): Promise<boolean> {
  const { data: sessions, error } = await db
    .from("sessions")
    .select("id, device_id, locked_until, finished_at, abandoned_at")
    .eq("stay_id", stay.id)
    .eq("organization_id", stay.organizationId)
    .is("finished_at", null)
    .is("abandoned_at", null)
    .limit(20);
  if (error) throw new Error(`sessions 읽기 실패: ${error.message}`);
  if (heldByOther(sessions ?? [], deviceId, now)) return false;
  const { error: updateError } = await db
    .from("sessions")
    .update({ locked_until: new Date(now.getTime() + SESSION_HOLD_MS).toISOString() })
    .eq("id", sessionId)
    .eq("organization_id", stay.organizationId);
  if (updateError) throw new Error(`sessions 갱신 실패: ${updateError.message}`);
  return true;
}

/** 증명을 건다 — `prove` 라우트만 쓴다. */
export async function markPassportProof(db: CheckinServiceClient, sessionId: string, organizationId: string, payload: unknown) {
  const { error } = await db
    .from("sessions")
    .update({ step_payload: { ...((payload as Record<string, unknown> | null) ?? {}), passport_proof: true } })
    .eq("id", sessionId)
    .eq("organization_id", organizationId);
  if (error) throw new Error(`sessions 갱신 실패: ${error.message}`);
}

/** 이 기기 세션의 stay — 세션이 끝났거나 · 다른 건물 · 막힌 기간이면 null(`session_gone`). 증명은 보지 않는다(`openProvenKioskStay` 참고). */
export async function openKioskStay(db: CheckinServiceClient, sessionId: string, device: DeviceRow, now: Date): Promise<StayView | null> {
  return (await openKioskStayWithProof(db, sessionId, device, now))?.stay ?? null;
}

/**
 * 완료 라우트 전용 — `openKioskStay` 와 같되, 이 기기가 방금(10분 안) 끝낸 세션도 받는다(응답을 못 받은 손님의 재시도).
 * 끝난 세션은 이미 체크인된 예약일 때만. `touchSession` 은 그대로 둔다(다른 라우트는 끝난 세션을 계속 거절).
 */
export async function openKioskStayForComplete(
  db: CheckinServiceClient,
  sessionId: string,
  device: DeviceRow,
  now: Date,
): Promise<{ stay: StayView; proof: unknown } | null> {
  const { data: session, error } = await db
    .from("sessions")
    .select("stay_id, finished_at, abandoned_at, step_payload")
    .eq("id", sessionId)
    .eq("device_id", device.id)
    .eq("organization_id", device.organization_id)
    .maybeSingle();
  if (error) throw new Error(`sessions 읽기 실패: ${error.message}`);
  if (!session || session.abandoned_at) return null;
  const proof = session.step_payload;

  if (!session.finished_at) {
    const stay = await openKioskStay(db, sessionId, device, now);
    return stay ? { stay, proof } : null;
  }
  if (!finishedWithinWindow(session.finished_at as string, now)) return null;
  const stay = await loadStayById(db, session.stay_id as string);
  if (!stay || stay.organizationId !== device.organization_id || stay.propertyKey !== device.property_key) return null;
  if (stay.status !== "checked_in" || kioskGate(stay, now).kind === "blocked") return null;
  return { stay, proof };
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
  /**
   * 사람마다 지금 저장된 집 주소(없으면 null) — 「다른 분」 목록을 미리 채우고, `POST /api/kiosk/address` 가 미리 등록된 동행자의
   * 주소를 대표자 글로 덮지 않게 `others` 로 되돌려 보내려고(2026-11-06). 증명(본인 확인)이 끝난 세션의 응답에만 실린다.
   */
  address: string | null;
  /** 대표자만 — 확인 화면에서 연락처를 미리 채우려고. */
  contact?: string | null;
};

/**
 * 태블릿에 넘기는 예약 모양(시안 T2). 여권 번호 같은 칸 값은 넘기지 않는다 — 주소는 사람마다, 연락처는 대표자 것만.
 * 부르는 곳은 모두 증명된 세션 뒤다: 쓰기 라우트는 `openProvenKioskStay`, `find` 는 코드 · 여권으로 찾았을 때만(이름은 `proof_needed` 로
 * 예약 내용 없이 답함), `prove` 는 `proven`/`already` 일 때만. 증명 전에 부르는 곳이 생기면 이 모양을 나눈다.
 */
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
        address: guest.address,
        ...(guest.is_representative ? { contact: guest.contact } : {}),
      }),
    ),
  };
}
