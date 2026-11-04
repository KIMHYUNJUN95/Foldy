import "server-only";

import { normalizeReservationSource } from "@/lib/beds24/source-normalization";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import {
  arrivalGroup,
  checkinPropertyName,
  isPartyMismatch,
  isRosterFilled,
  maskPassportNumber,
  missingFields,
  needsStaffCheck,
  sortArrivalRows,
  summarizeArrivals,
  type CheckinArrivalRow,
  type CheckinArrivalSummary,
  type CheckinChannel,
  type MissingField,
} from "./model";
import { checkinDb, throwOnCheckinError } from "./server";

// 도착 목록(FR-S01) · 한 건 상세(FR-S02) 읽기. 권한은 부르는 액션이 본다.
// 체크인 코드 · 여권 번호 원문 · mrz_raw · storage_path 는 select 하지 않는다 — 응답에 섞일 길을 처음부터 없앤다.

const STAY_COLUMNS =
  "id, status, reservation_group_key, property_key, check_in_date, check_out_date, guest_count_expected, party_size, checked_in_at, verified_at, verified_by";
const GUEST_COLUMNS =
  "id, stay_id, stay_room_id, is_representative, guest_type, name_roman, nationality, has_japan_address, address, contact, age, gender, passport_number, prev_stay, next_dest, source, mrz_valid, no_passport_reason";
const DOCUMENT_COLUMNS = "id, guest_id, kind, captured_at, captured_on, byte_size, width, height, duration_s";

const LISTED_STATUSES = ["pending", "pre_registered", "in_progress", "checked_in", "expired"] as const;

export type CheckinGuestDocument = {
  id: string;
  kind: string;
  capturedAt: string;
  capturedOn: string;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

export type CheckinGuestDetail = {
  id: string;
  isRepresentative: boolean;
  guestType: string;
  nameRoman: string | null;
  /** ISO 3166-1 alpha-3. */
  nationality: string | null;
  hasJapanAddress: boolean | null;
  address: string | null;
  contact: string | null;
  age: number | null;
  gender: string | null;
  /** 늘 가린 값. */
  passportNumberMasked: string | null;
  prevStay: string | null;
  nextDest: string | null;
  source: string;
  roomLabel: string | null;
  /** MRZ 검사 숫자 결과 — null 은 읽은 적 없음. */
  mrzValid: boolean | null;
  noPassportReason: string | null;
  missing: MissingField[];
  needsStaffCheck: boolean;
  hasPassportPhoto: boolean;
  hasFaceVideo: boolean;
  /** `checkin.documents` 가 있을 때만 있는 칸. 파일 주소는 `openCheckinDocument` 로 따로 받는다. */
  documents?: CheckinGuestDocument[];
};

export type CheckinConsent = {
  guestId: string | null;
  termsVersion: number;
  agreedAt: string;
  locale: string;
  via: "tablet" | "pre_registered";
};

export type CheckinStayDetail = {
  stay: CheckinArrivalRow;
  guests: CheckinGuestDetail[];
  consents: CheckinConsent[];
};

type StayRow = {
  id: string;
  status: string;
  reservation_group_key: string;
  property_key: string;
  check_in_date: string;
  check_out_date: string;
  guest_count_expected: number;
  party_size: number | null;
  checked_in_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
};

function channelOf(source: string | null | undefined): CheckinChannel {
  const normalized = normalizeReservationSource(source);
  if (normalized === "Airbnb") return "airbnb";
  if (normalized === "Booking.com") return "booking";
  return "manual";
}

async function loadBundle(organizationId: string, stays: StayRow[]) {
  const db = checkinDb();
  const stayIds = stays.map((stay) => stay.id);
  const [rooms, guests, consents, sessions] = await Promise.all([
    db.from("stay_rooms").select("id, stay_id, reservation_id, room_label").eq("organization_id", organizationId).in("stay_id", stayIds),
    db.from("guests").select(GUEST_COLUMNS).eq("organization_id", organizationId).in("stay_id", stayIds),
    db.from("consents").select("stay_id, guest_id, terms_version, agreed_at, locale, device_id").eq("organization_id", organizationId).in("stay_id", stayIds),
    db.from("sessions").select("stay_id, started_at, finished_at, abandoned_at").eq("organization_id", organizationId).in("stay_id", stayIds),
  ]);
  throwOnCheckinError(rooms.error, "stay_rooms");
  throwOnCheckinError(guests.error, "guests");
  throwOnCheckinError(consents.error, "consents");
  throwOnCheckinError(sessions.error, "sessions");

  const guestRows = guests.data ?? [];
  const documents = guestRows.length
    ? await db
        .from("guest_documents")
        .select(DOCUMENT_COLUMNS)
        .eq("organization_id", organizationId)
        .in("guest_id", guestRows.map((guest) => guest.id))
        .is("replaced_by", null)
    : { data: [], error: null };
  throwOnCheckinError(documents.error, "guest_documents");

  const service = getSupabaseServiceClient();
  const reservationIds = (rooms.data ?? []).map((room) => room.reservation_id);
  const reservations = reservationIds.length
    ? await service.from("reservations").select("id, guest_name, source").eq("organization_id", organizationId).in("id", reservationIds)
    : { data: [], error: null };
  if (reservations.error) throw new Error(`reservations: ${reservations.error.code}`);

  const verifierIds = [...new Set(stays.flatMap((stay) => (stay.verified_by ? [stay.verified_by] : [])))];
  const profiles = verifierIds.length ? await service.from("profiles").select("id, name").in("id", verifierIds) : { data: [] };

  return {
    rooms: rooms.data ?? [],
    guests: guestRows,
    consents: consents.data ?? [],
    sessions: sessions.data ?? [],
    documents: documents.data ?? [],
    reservationById: new Map((reservations.data ?? []).map((row) => [row.id, row])),
    verifierNameById: new Map((profiles.data ?? []).map((row) => [row.id, row.name])),
  };
}

type Bundle = Awaited<ReturnType<typeof loadBundle>>;

function guestFacts(bundle: Bundle, guest: Bundle["guests"][number]) {
  const docs = bundle.documents.filter((doc) => doc.guest_id === guest.id);
  const hasPassportPhoto = docs.some((doc) => doc.kind === "passport");
  const hasFaceVideo = docs.some((doc) => doc.kind === "face_video");
  const missing = missingFields(guest, hasPassportPhoto);
  return {
    docs,
    hasPassportPhoto,
    hasFaceVideo,
    missing,
    staffCheck: needsStaffCheck({ hasFaceVideo, noPassportReason: guest.no_passport_reason, mrzValid: guest.mrz_valid, missing }),
  };
}

function toArrivalRow(stay: StayRow, bundle: Bundle): CheckinArrivalRow {
  const rooms = bundle.rooms.filter((room) => room.stay_id === stay.id);
  const guests = bundle.guests.filter((guest) => guest.stay_id === stay.id);
  const facts = guests.map((guest) => guestFacts(bundle, guest));
  const reservation = rooms.map((room) => bundle.reservationById.get(room.reservation_id)).find(Boolean);
  const consents = bundle.consents.filter((consent) => consent.stay_id === stay.id);
  const openSession = bundle.sessions
    .filter((session) => session.stay_id === stay.id && !session.finished_at && !session.abandoned_at)
    .map((session) => session.started_at)
    .sort()
    .at(-1);

  const status = stay.status as CheckinArrivalRow["status"];
  const partySize = stay.party_size ?? stay.guest_count_expected;
  const partyMismatch = isPartyMismatch({ status, guestCountExpected: stay.guest_count_expected, partySize, rosterCount: guests.length });
  // 영상은 태블릿에서 찍는다 — 체크인이 끝나기 전 사람에게는 「직원 확인」을 걸지 않는다.
  const staffCheckCount = status === "checked_in" ? facts.filter((fact) => fact.staffCheck).length : 0;
  const preRegistered = consents.some((consent) => !consent.device_id);

  return {
    stayId: stay.id,
    status,
    group: arrivalGroup({ status, verifiedAt: stay.verified_at, partyMismatch, staffCheckCount }),
    leadName: guests.find((guest) => guest.is_representative)?.name_roman ?? reservation?.guest_name ?? null,
    channel: channelOf(reservation?.source),
    reservationNumber: stay.reservation_group_key,
    propertyKey: stay.property_key,
    propertyName: checkinPropertyName(stay.property_key) ?? stay.property_key,
    roomLabels: rooms.map((room) => room.room_label),
    checkInDate: stay.check_in_date,
    checkOutDate: stay.check_out_date,
    guestCountExpected: stay.guest_count_expected,
    partySize,
    rosterCount: guests.length,
    rosterFilled: facts.filter((fact) => isRosterFilled(fact.missing)).length,
    partyMismatch,
    staffCheckCount,
    checkedInAt: stay.checked_in_at,
    startedAt: status === "in_progress" ? (openSession ?? null) : null,
    route: status === "checked_in" || status === "in_progress" ? (preRegistered ? "pre_registered" : "tablet") : null,
    verifiedAt: stay.verified_at,
    verifiedByName: stay.verified_by ? (bundle.verifierNameById.get(stay.verified_by) ?? null) : null,
  };
}

export async function loadCheckinArrivals(
  organizationId: string,
  filter: { date: string; propertyKey?: string | null },
): Promise<{ rows: CheckinArrivalRow[]; summary: CheckinArrivalSummary }> {
  let query = checkinDb()
    .from("stays")
    .select(STAY_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("check_in_date", filter.date)
    .in("status", [...LISTED_STATUSES]);
  if (filter.propertyKey) query = query.eq("property_key", filter.propertyKey);
  const { data, error } = await query;
  throwOnCheckinError(error, "stays");
  const stays = data ?? [];
  if (stays.length === 0) return { rows: [], summary: summarizeArrivals([]) };

  const bundle = await loadBundle(organizationId, stays);
  const rows = sortArrivalRows(stays.map((stay) => toArrivalRow(stay, bundle)));
  return { rows, summary: summarizeArrivals(rows) };
}

/** 다른 조직 · 없는 줄 · 취소된 줄은 null. */
export async function loadCheckinStayDetail(
  organizationId: string,
  stayId: string,
  options: { includeDocuments: boolean },
): Promise<CheckinStayDetail | null> {
  const { data: stay, error } = await checkinDb()
    .from("stays")
    .select(STAY_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", stayId)
    .in("status", [...LISTED_STATUSES])
    .maybeSingle();
  throwOnCheckinError(error, "stays");
  if (!stay) return null;

  const bundle = await loadBundle(organizationId, [stay]);
  const roomLabelById = new Map(bundle.rooms.map((room) => [room.id, room.room_label]));
  const guests = [...bundle.guests]
    .sort((a, b) => Number(b.is_representative) - Number(a.is_representative))
    .map((guest): CheckinGuestDetail => {
      const facts = guestFacts(bundle, guest);
      return {
        id: guest.id,
        isRepresentative: guest.is_representative,
        guestType: guest.guest_type,
        nameRoman: guest.name_roman,
        nationality: guest.nationality,
        hasJapanAddress: guest.has_japan_address,
        address: guest.address,
        contact: guest.contact,
        age: guest.age,
        gender: guest.gender,
        passportNumberMasked: maskPassportNumber(guest.passport_number),
        prevStay: guest.prev_stay,
        nextDest: guest.next_dest,
        source: guest.source,
        roomLabel: guest.stay_room_id ? (roomLabelById.get(guest.stay_room_id) ?? null) : null,
        mrzValid: guest.mrz_valid,
        noPassportReason: guest.no_passport_reason,
        missing: facts.missing,
        needsStaffCheck: facts.staffCheck,
        hasPassportPhoto: facts.hasPassportPhoto,
        hasFaceVideo: facts.hasFaceVideo,
        ...(options.includeDocuments
          ? {
              documents: facts.docs.map((doc) => ({
                id: doc.id,
                kind: doc.kind,
                capturedAt: doc.captured_at,
                capturedOn: doc.captured_on,
                byteSize: doc.byte_size,
                width: doc.width,
                height: doc.height,
                durationSeconds: doc.duration_s,
              })),
            }
          : {}),
      };
    });

  return {
    stay: toArrivalRow(stay, bundle),
    guests,
    consents: bundle.consents.map((consent) => ({
      guestId: consent.guest_id,
      termsVersion: consent.terms_version,
      agreedAt: consent.agreed_at,
      locale: consent.locale,
      via: consent.device_id ? "tablet" : "pre_registered",
    })),
  };
}
