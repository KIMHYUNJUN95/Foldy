import "server-only";

import type { CheckinServiceClient } from "../supabase/service";
import { missingFields, type MissingField, type StoredGuest } from "./fields";
import { guestLinkOpen, maskPassportNumber } from "./link";
import type { ClaimCandidate } from "./match";
import { hashGuestToken, isTokenShaped } from "./token";

// 사전 등록 웹의 읽기 · 쓰기(서비스 롤). 손님 화면에는 이 파일이 만든 값만 넘긴다 — 다른 예약 · 원문 payload 는 넘기지 않는다.

export const PASSPORT_BUCKET = "checkin-documents";

// 사전 등록이 열려 있는 상태. 체크인 뒤에는 읽기 전용(W5), 취소 · 기간 지남은 「못 찾음」과 같게 둔다.
const CLAIMABLE = ["pending", "pre_registered", "in_progress", "checked_in"] as const;
const EDITABLE = new Set(["pending", "pre_registered", "in_progress"]);

const GUEST_COLUMNS =
  "id, is_representative, guest_type, name_roman, has_japan_address, nationality, passport_number, age, gender, contact, no_passport_reason, address, prev_stay, next_dest, source, created_at";

export type GuestRow = StoredGuest & { id: string; source: string; created_at: string };

/** 지금 쓰는 여권 사진 경로(대체된 것 제외). */
export async function currentPassportPath(db: CheckinServiceClient, guestId: string): Promise<string | null> {
  const { data } = await db
    .from("guest_documents")
    .select("storage_path")
    .eq("guest_id", guestId)
    .eq("kind", "passport")
    .is("replaced_by", null)
    .order("captured_at", { ascending: false })
    .limit(1);
  return (data?.[0]?.storage_path as string | undefined) ?? null;
}

export type StayView = {
  id: string;
  organizationId: string;
  propertyKey: string;
  checkInDate: string;
  checkOutDate: string;
  guestCountExpected: number;
  /** 손님이 말한 인원 — 없으면 예약 인원. 명부 빈 자리 수의 기준. */
  partySize: number;
  status: string;
  checkinCode: string | null;
  checkedInAt: string | null;
  retainUntil: string | null;
  editable: boolean;
  rooms: string[];
  guests: (GuestRow & { hasPassportPhoto: boolean; hasFaceVideo: boolean; missing: MissingField[] })[];
  consented: boolean;
};

type Phoneish = { phone: string | null; mobile: string | null; guest_phone: string | null; guestPhone: string | null };

function firstPhone(row: Phoneish): string | null {
  return row.phone || row.mobile || row.guest_phone || row.guestPhone || null;
}

/** 「예약 찾기」 후보 — 그 건물 · 그 날짜에 체크인하는 열린 stay 와 예약 줄(이름 · 번호 · 전화만). */
export async function readClaimCandidates(
  db: CheckinServiceClient,
  propertyKey: string,
  checkInDate: string,
): Promise<ClaimCandidate[]> {
  const { data: stays, error } = await db
    .from("stays")
    .select("id, check_in_date")
    .eq("property_key", propertyKey)
    .eq("check_in_date", checkInDate)
    .in("status", [...CLAIMABLE]);
  if (error) throw new Error(`stays 읽기 실패: ${error.message}`);
  if (!stays?.length) return [];

  const { data: rooms, error: roomError } = await db
    .from("stay_rooms")
    .select("stay_id, reservation_id")
    .in("stay_id", stays.map((stay) => stay.id));
  if (roomError) throw new Error(`stay_rooms 읽기 실패: ${roomError.message}`);
  const reservationIds = (rooms ?? []).map((room) => room.reservation_id as string);
  if (reservationIds.length === 0) return [];

  const { data: reservations, error: resError } = await db
    .schema("public")
    .from("reservations")
    .select(
      "id, guest_name, api_reference:raw_payload->>apiReference, phone:raw_payload->>phone, mobile:raw_payload->>mobile, guest_phone:raw_payload->>guest_phone, guestPhone:raw_payload->>guestPhone",
    )
    .in("id", reservationIds);
  if (resError) throw new Error(`reservations 읽기 실패: ${resError.message}`);

  const byId = new Map((reservations ?? []).map((row) => [row.id as string, row]));
  return stays.map((stay) => ({
    stayId: stay.id as string,
    checkInDate: stay.check_in_date as string,
    rows: (rooms ?? [])
      .filter((room) => room.stay_id === stay.id)
      .map((room) => byId.get(room.reservation_id as string))
      .filter((row) => !!row)
      .map((row) => ({
        guestName: (row!.guest_name as string) ?? "",
        apiReference: (row!.api_reference as string | null) ?? null,
        phone: firstPhone(row as unknown as Phoneish),
      })),
  }));
}

/** 처음 열 때 대표자 줄을 만든다 — 이름 · 연락처는 예약 값(44 FR-W02 「연락처는 대표자 것 하나」). */
async function ensureRepresentative(db: CheckinServiceClient, stay: { id: string; organization_id: string }) {
  const { data: rooms } = await db.from("stay_rooms").select("reservation_id").eq("stay_id", stay.id).limit(1);
  const reservationId = rooms?.[0]?.reservation_id as string | undefined;
  let name: string | null = null;
  let phone: string | null = null;
  if (reservationId) {
    const { data } = await db
      .schema("public")
      .from("reservations")
      .select("guest_name, phone:raw_payload->>phone, mobile:raw_payload->>mobile, guest_phone:raw_payload->>guest_phone, guestPhone:raw_payload->>guestPhone")
      .eq("id", reservationId)
      .maybeSingle();
    if (data) {
      name = ((data.guest_name as string) || "").trim().toUpperCase() || null;
      phone = firstPhone(data as unknown as Phoneish);
    }
  }
  const { error } = await db.from("guests").insert({
    organization_id: stay.organization_id,
    stay_id: stay.id,
    is_representative: true,
    name_roman: name,
    contact: phone,
    source: "beds24",
  });
  // 동시에 두 번 열면 한쪽은 unique(대표자 하나) 에 걸린다 — 이미 있으니 괜찮다.
  if (error && error.code !== "23505") throw new Error(`대표자 만들기 실패: ${error.message}`);
}

/**
 * 손님 링크로 stay 를 읽는다. 체크아웃 다음 날(도쿄)이 지나면 닫힌 링크(null — 없는 링크와 같게).
 * 체크인 뒤(고칠 수 없음)에는 여권 번호를 가린 값으로 바꾼다 — 사진은 `hasPassportPhoto` 표시만 남고 화면이 서명 URL 을 만들지 않는다.
 */
export async function loadStayByToken(db: CheckinServiceClient, rawToken: string, now: Date = new Date()): Promise<StayView | null> {
  if (!isTokenShaped(rawToken)) return null;
  const { data: link, error: linkError } = await db
    .from("stay_tokens")
    .select("stay_id")
    .eq("token_hash", hashGuestToken(rawToken))
    .maybeSingle();
  if (linkError) throw new Error(`stay_tokens 읽기 실패: ${linkError.message}`);
  if (!link) return null;
  const stay = await loadStayById(db, link.stay_id as string);
  if (!stay || !guestLinkOpen(stay.checkOutDate, now)) return null;
  if (stay.editable) return stay;
  return { ...stay, guests: stay.guests.map((guest) => ({ ...guest, passport_number: maskPassportNumber(guest.passport_number) })) };
}

/** stay 하나를 명부까지 읽는다(사전 등록 웹 · 태블릿 공용). 취소 · 기간 지남은 null. */
export async function loadStayById(db: CheckinServiceClient, stayId: string): Promise<StayView | null> {
  const { data: stay, error } = await db
    .from("stays")
    .select("id, organization_id, property_key, check_in_date, check_out_date, guest_count_expected, party_size, status, checkin_code, checked_in_at, retain_until")
    .eq("id", stayId)
    .maybeSingle();
  if (error) throw new Error(`stays 읽기 실패: ${error.message}`);
  if (!stay || !(CLAIMABLE as readonly string[]).includes(stay.status as string)) return null;

  let { data: guests } = await db.from("guests").select(GUEST_COLUMNS).eq("stay_id", stay.id).order("created_at");
  if (!guests?.length) {
    await ensureRepresentative(db, stay as { id: string; organization_id: string });
    ({ data: guests } = await db.from("guests").select(GUEST_COLUMNS).eq("stay_id", stay.id).order("created_at"));
  }
  const guestRows = ((guests ?? []) as GuestRow[]).sort(
    (a, b) => Number(b.is_representative) - Number(a.is_representative) || a.created_at.localeCompare(b.created_at),
  );

  const [{ data: docs }, { data: consents }, { data: rooms }] = await Promise.all([
    guestRows.length
      ? db
          .from("guest_documents")
          .select("guest_id, kind")
          .in("kind", ["passport", "face_video"])
          .is("replaced_by", null)
          .in("guest_id", guestRows.map((guest) => guest.id))
      : Promise.resolve({ data: [] as { guest_id: string; kind: string }[] }),
    db.from("consents").select("id").eq("stay_id", stay.id).limit(1),
    db.from("stay_rooms").select("room_label").eq("stay_id", stay.id).order("room_label"),
  ]);
  const withPhoto = new Set((docs ?? []).filter((doc) => doc.kind === "passport").map((doc) => doc.guest_id as string));
  const withFaceVideo = new Set((docs ?? []).filter((doc) => doc.kind === "face_video").map((doc) => doc.guest_id as string));

  return {
    id: stay.id as string,
    organizationId: stay.organization_id as string,
    propertyKey: stay.property_key as string,
    checkInDate: stay.check_in_date as string,
    checkOutDate: stay.check_out_date as string,
    guestCountExpected: stay.guest_count_expected as number,
    partySize: (stay.party_size as number | null) ?? (stay.guest_count_expected as number),
    status: stay.status as string,
    checkinCode: (stay.checkin_code as string | null) ?? null,
    checkedInAt: (stay.checked_in_at as string | null) ?? null,
    retainUntil: (stay.retain_until as string | null) ?? null,
    editable: EDITABLE.has(stay.status as string),
    rooms: (rooms ?? []).map((room) => room.room_label as string),
    guests: guestRows.map((guest) => ({
      ...guest,
      hasPassportPhoto: withPhoto.has(guest.id),
      hasFaceVideo: withFaceVideo.has(guest.id),
      missing: missingFields(guest, withPhoto.has(guest.id)),
    })),
    consented: (consents ?? []).length > 0,
  };
}

/** 모두 다 됐고 동의도 했으면 「미리 체크인 끝」(pre_registered), 아니면 pending 으로 맞춘다. */
export async function refreshPreRegStatus(db: CheckinServiceClient, rawToken: string) {
  const stay = await loadStayByToken(db, rawToken);
  if (!stay || !stay.editable || stay.status === "in_progress") return stay;
  const done =
    stay.consented &&
    stay.guests.length >= Math.max(1, stay.partySize) &&
    stay.guests.every((guest) => guest.missing.length === 0);
  const next = done ? "pre_registered" : "pending";
  if (next !== stay.status) {
    const { error } = await db
      .from("stays")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", stay.id)
      .in("status", ["pending", "pre_registered"]);
    if (error) throw new Error(`stays 갱신 실패: ${error.message}`);
    stay.status = next;
  }
  return stay;
}
