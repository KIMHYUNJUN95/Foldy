import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { normalizeReservationSource } from "@/lib/beds24/source-normalization";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { loadPropertyMapMeta } from "@/lib/property-operation-info";
import { getReservationDisplayId } from "@/lib/reservation-display-id";
import { resolveRoomBlockRoom } from "@/lib/room-block-room";
import { listReservationInternalNotesInWindow, pickReservationNotes } from "@/lib/reservation-internal-notes";
import { CALENDAR_PAYLOAD_KEYS, slimPayloadOf, slimPayloadSelect } from "@/lib/reservation-payload-slim";
import {
  CALENDAR_BUILDING_ORDER,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
} from "@/lib/room-label-normalization";
import {
  buildGlobalExternalRoomToCanonical,
  buildPropertyRoomLookups,
  getActiveRoomCatalog,
  getRawPayloadString,
  resolveReservationCanonicalRoomLabel,
} from "@/lib/rooms";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { Database } from "@/types/database";
import { getReservationGuests, type ReservationGuests } from "@/lib/reservation-guests";

export function canEditPropertyOperationInfo(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("property_info.edit");
}

/** 예약 캘린더 인원 — 합계 + 성인 · 어린이(2026-10-05, `reservation-guests.ts`). */
function guestFields(guests: ReservationGuests) {
  return { adults: guests.adults, children: guests.children, guestCount: guests.total };
}

type ReservationStatus = Database["public"]["Enums"]["reservation_status"];

export type ReservationChannel = "airbnb" | "booking" | "manual";

type ReservationRow = Pick<
  Database["public"]["Tables"]["reservations"]["Row"],
  | "id"
  | "check_in_date"
  | "check_out_date"
  | "guest_name"
  | "property_name"
  | "raw_payload"
  | "room_label"
  | "source"
  | "source_reservation_id"
  | "status"
>;

const RESERVATION_SELECT = [
  "id, check_in_date, check_out_date, guest_name, property_name, room_label, source, source_reservation_id, status",
  slimPayloadSelect(CALENDAR_PAYLOAD_KEYS),
].join(", ");

function toReservationRow(raw: Record<string, unknown>): ReservationRow {
  return {
    check_in_date: raw.check_in_date as string,
    check_out_date: raw.check_out_date as string,
    guest_name: raw.guest_name as string,
    id: raw.id as string,
    property_name: raw.property_name as string,
    raw_payload: slimPayloadOf(raw, CALENDAR_PAYLOAD_KEYS) as ReservationRow["raw_payload"],
    room_label: raw.room_label as string,
    source: raw.source as ReservationRow["source"],
    source_reservation_id: raw.source_reservation_id as ReservationRow["source_reservation_id"],
    status: raw.status as ReservationStatus,
  };
}

export type AdminCalendarReservation = {
  beds24Id: string;
  channel: ReservationChannel;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number | null;
  /** 성인 · 어린이 — 성인 수를 모르면 `null`(합계만 보인다). */
  adults: number | null;
  children: number | null;
  guestName: string;
  id: string;
  phone: string | null;
  propertyName: string;
  roomKey: string;
  roomLabel: string;
  status: ReservationStatus;
};

/**
 * Beds24 캘린더에서 막아 둔 구간 (2026-09-11).
 *
 * 예약이 아니라 인벤토리 오버라이드(`override: "blackout"`)라서 별도 테이블에서 온다.
 * `startDate`~`endDate` 는 **막힌 밤의 범위이며 양끝을 포함한다** — 9/23~9/26 이면 네 밤이다.
 * 예약과 겹칠 수 있다(채널 판매를 막고 수기 예약을 넣는 운영이 실제로 쓰인다).
 */
export type AdminCalendarRoomBlock = {
  endDate: string;
  id: string;
  propertyName: string;
  roomKey: string;
  roomLabel: string;
  startDate: string;
};

export type AdminCalendarRoomAxisRow = {
  displayRoomLabel: string;
  key: string;
  propertyName: string;
};

// 건물 표시 순서 = 공용 property 맵의 정규 property 순서(단일 기준.
// 하드코딩 / 인코딩에 취약한 건물 이름 리터럴을 피한다).
// 순서의 근거는 `CALENDAR_BUILDING_ORDER` 하나다 — 어드민·모바일 캘린더가 같이 쓴다.
const BUILDING_DISPLAY_ORDER: readonly string[] = CALENDAR_BUILDING_ORDER;

const ROOM_AXIS_SEPARATOR = "::";

function toRoomAxisKey(propertyName: string, displayRoomLabel: string) {
  return `${propertyName}${ROOM_AXIS_SEPARATOR}${displayRoomLabel}`;
}

export function toJstDateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isValidMonth(value: string | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** 달 키 이동 — 공용 `shiftMonthKey`(CLAUDE.md §4a, `Date` 로 달을 더하지 않는다). */
export function shiftMonth(month: string, diff: number) {
  return shiftMonthKey(month, diff);
}

export function buildDates(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const dayCount = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return Array.from({ length: dayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${month}-${day}`;
  });
}

export function buildMonthLabel(month: string, locale: "ko" | "ja" | "en") {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function sortBuildings(values: string[]) {
  return [...values].sort((a, b) => {
    const left = BUILDING_DISPLAY_ORDER.indexOf(a as (typeof BUILDING_DISPLAY_ORDER)[number]);
    const right = BUILDING_DISPLAY_ORDER.indexOf(b as (typeof BUILDING_DISPLAY_ORDER)[number]);
    if (left !== right) {
      if (left !== -1 && right !== -1) return left - right;
      if (left !== -1) return -1;
      if (right !== -1) return 1;
    }
    return a.localeCompare(b, "ko");
  });
}

function sortRoomRows(rows: AdminCalendarRoomAxisRow[]) {
  return [...rows].sort((a, b) => {
    const propertyCompare = sortBuildings([a.propertyName, b.propertyName]);
    if (propertyCompare[0] !== propertyCompare[1]) {
      return propertyCompare[0] === a.propertyName ? -1 : 1;
    }
    return a.displayRoomLabel.localeCompare(b.displayRoomLabel, "ko", { numeric: true });
  });
}

function normalizePropertyParam(value: string | undefined) {
  if (!value) return null;
  const canonicalName = getCanonicalPropertyName(value.trim());
  return canonicalName.length > 0 ? canonicalName : null;
}

function getPhone(
  rawPayload: Database["public"]["Tables"]["reservations"]["Row"]["raw_payload"],
) {
  return getRawPayloadString(rawPayload, ["phone", "mobile", "guest_phone", "guestPhone"]);
}

function toReservationChannel(source: string | null | undefined): ReservationChannel {
  const normalized = normalizeReservationSource(source);
  if (normalized === "Airbnb") return "airbnb";
  if (normalized === "Booking.com") return "booking";
  return "manual";
}

export async function getAdminCalendarDashboardData(
  session: AppSession,
  filters: { month?: string; property?: string },
) {
  const today = toJstDateString(new Date());
  const locale = session.user.preferredLanguage;
  const selectedProperty = normalizePropertyParam(filters.property);
  const currentMonth = today.slice(0, 7);
  const selectedMonth = isValidMonth(filters.month) ? filters.month : currentMonth;
  const prevMonth = shiftMonth(selectedMonth, -1);
  const nextMonth = shiftMonth(selectedMonth, 1);
  const dates = buildDates(selectedMonth);
  const nextOperationalMonth = shiftMonth(currentMonth, 1);
  const isOutOfWindow =
    selectedMonth !== currentMonth && selectedMonth !== nextOperationalMonth;

  const operationalWindowStart = `${currentMonth}-01`;
  const operationalWindowEnd = `${shiftMonth(currentMonth, 2)}-01`;

  const supabase = await getSupabaseServerClient();
  const [roomCatalog, buildingInfoResult, reservationsResult, roomBlocksResult, notesInWindow] = await Promise.all([
    getActiveRoomCatalog(session.organization.id, supabase),
    loadPropertyMapMeta(session),
    // 1,000행 상한을 넘으면 조용히 잘린다 — 페이지로 끝까지 읽는다(`read-all-pages.ts`).
    // `raw_payload` 는 쓰는 키만(`reservation-payload-slim.ts`) — 통째면 954행에 약 2MB 였다.
    readAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("reservations")
        .select(RESERVATION_SELECT)
        .eq("organization_id", session.organization.id)
        .lt("check_in_date", operationalWindowEnd)
        .gte("check_out_date", operationalWindowStart)
        .neq("status", "cancelled")
        .neq("status", "no_show")
        .order("check_in_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
    ),
    readAllPages((from, to) =>
      supabase
        .from("room_blocks")
        .select("id, property_name, room_label, external_room_id, start_date, end_date")
        .eq("organization_id", session.organization.id)
        // 「이 창에 걸치는」 구간. 창 밖에서 시작해 안으로 들어오는 블락도 잡아야 한다.
        .lt("start_date", operationalWindowEnd)
        .gte("end_date", operationalWindowStart)
        .order("start_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    listReservationInternalNotesInWindow(session, {
      checkInBefore: operationalWindowEnd,
      checkOutFrom: operationalWindowStart,
    }),
  ]);

  if (reservationsResult.error) {
    throw new Error(reservationsResult.error.message);
  }

  const roomLookups = buildPropertyRoomLookups(roomCatalog ?? []);
  const globalExternalRoomToCanonical = buildGlobalExternalRoomToCanonical(roomCatalog ?? []);
  const reservations: AdminCalendarReservation[] = [];
  const roomRowsByKey = new Map<string, AdminCalendarRoomAxisRow>();

  for (const entry of roomCatalog ?? []) {
    const key = toRoomAxisKey(entry.propertyName, entry.displayRoomLabel);
    roomRowsByKey.set(key, {
      displayRoomLabel: entry.displayRoomLabel,
      key,
      propertyName: entry.propertyName,
    });
  }

  for (const row of reservationsResult.data.map(toReservationRow)) {
    if (isExcludedOperationalProperty(row.property_name)) continue;
    if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;

    const propertyName = getCanonicalPropertyName(row.property_name);
    const resolvedRoomKey = resolveReservationCanonicalRoomLabel(
      {
        property_name: row.property_name,
        raw_payload: row.raw_payload,
        room_label: row.room_label,
      },
      {
        globalExternalRoomToCanonical,
        isAuthoritative: roomCatalog !== undefined,
        lookups: roomLookups,
      },
    );
    const canonicalRoomKey =
      resolvedRoomKey ??
      getCanonicalRoomLabel(propertyName, row.room_label) ??
      row.room_label.trim();
    const displayRoomLabel =
      getDisplayRoomLabel(propertyName, canonicalRoomKey) || canonicalRoomKey;
    const roomKey = toRoomAxisKey(propertyName, displayRoomLabel);

    roomRowsByKey.set(roomKey, {
      displayRoomLabel,
      key: roomKey,
      propertyName,
    });

    reservations.push({
      beds24Id: getReservationDisplayId(row),
      channel: toReservationChannel(row.source),
      checkInDate: row.check_in_date,
      checkOutDate: row.check_out_date,
      ...guestFields(getReservationGuests(row.raw_payload)),
      guestName: row.guest_name,
      id: row.id,
      phone: getPhone(row.raw_payload),
      propertyName,
      roomKey,
      roomLabel: displayRoomLabel,
      status: row.status,
    });
  }

  const buildingInfos = buildingInfoResult.items;
  // 블락을 캘린더 행에 붙인다. 방 이름은 예약과 같은 축(`건물::표시방이름`)으로 맞춘다 —
  // 안 맞으면 그릴 행이 없으므로 조용히 버린다(로그만 남기는 편이 캘린더를 깨뜨리는 것보다 낫다).
  const roomBlocks: AdminCalendarRoomBlock[] = [];
  // 읽다 실패하면 앞 페이지만 남는다 — 반쪽 블록은 그리지 않고, 화면에 「차단 정보를 못 불러왔다」를 띄운다(2026-11-12, 예전엔 로그만 → 빈 방 수가 조용히 틀렸다).
  const blocksLoadFailed = Boolean(roomBlocksResult.error);
  if (roomBlocksResult.error) {
    console.error("[admin-calendar] room block read failed", { message: roomBlocksResult.error.message });
  } else {
    for (const row of roomBlocksResult.data) {
      if (isExcludedOperationalProperty(row.property_name)) continue;
      if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
      // 모바일과 같은 해석기(`room-block-room.ts`) — Beds24 객실 id 먼저, 그다음 방 이름.
      const { displayRoomLabel, propertyName } = resolveRoomBlockRoom(row, {
        globalExternalRoomToCanonical,
        isAuthoritative: roomCatalog !== undefined,
        lookups: roomLookups,
      });
      const roomKey = toRoomAxisKey(propertyName, displayRoomLabel);
      if (!roomRowsByKey.has(roomKey)) {
        // 맞는 행이 없으면 캘린더에서 조용히 사라진다 — 어떤 블락인지 로그를 남긴다(개인정보 없음).
        console.warn("[admin-calendar] room block has no matching row", {
          blockId: row.id,
          propertyName: row.property_name,
          roomLabel: row.room_label,
        });
        continue;
      }
      roomBlocks.push({
        endDate: row.end_date,
        id: row.id,
        propertyName,
        roomKey,
        roomLabel: displayRoomLabel,
        startDate: row.start_date,
      });
    }
  }

  const filteredBuildingInfos = buildingInfos.filter(
    (item) => !isExcludedOperationalProperty(item.canonicalName),
  );
  const propertyOptions = sortBuildings(
    [
      ...new Set([
        ...filteredBuildingInfos.map((item) => item.canonicalName),
        ...(roomCatalog ?? []).map((item) => item.propertyName),
        ...reservations.map((item) => item.propertyName),
      ]),
    ].filter((name) => name.trim().length > 0),
  );

  const effectiveSelectedProperty =
    selectedProperty && propertyOptions.includes(selectedProperty) ? selectedProperty : null;
  const roomRows = sortRoomRows([...roomRowsByKey.values()]);
  const reservationNotes = pickReservationNotes(
    notesInWindow,
    reservations.map((reservation) => reservation.id),
  );

  return {
    beds24SyncPaused: isBeds24SyncPaused(),
    blocksLoadFailed,
    buildingInfoLoadFailed: buildingInfoResult.loadFailed,
    buildingInfos: filteredBuildingInfos,
    currentMonth,
    dates,
    isOutOfWindow,
    locale,
    nextMonth,
    prevMonth,
    propertyOptions,
    reservationNotes,
    reservations,
    roomBlocks,
    roomRows,
    selectedMonth,
    selectedProperty: effectiveSelectedProperty,
    today,
  };
}
