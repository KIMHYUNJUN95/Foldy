import { redirect } from "next/navigation";
import type { CalendarReservationItem } from "@/components/calendar/mobile-calendar-view";
import { MobileCalendarLiveView } from "@/components/calendar/mobile-calendar-live-view";
import { toOriginalReservationId } from "@/lib/beds24/reservation-id";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { listPropertyMapMeta } from "@/lib/property-operation-info";
import { listReservationInternalNotes } from "@/lib/reservation-internal-notes";
import {
  CALENDAR_BUILDING_ORDER,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
} from "@/lib/room-label-normalization";
import {
  type ActiveRoomCatalogItem,
  buildPropertyRoomLookups,
  getActiveRoomCatalog,
  getActiveRoomLabels,
} from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { Database } from "@/types/database";
import { getReservationGuests, type ReservationGuests } from "@/lib/reservation-guests";

/** 예약 캘린더 인원 — 합계 + 성인 · 어린이(2026-10-05, `reservation-guests.ts`). */
function guestFields(guests: ReservationGuests) {
  return { adults: guests.adults, children: guests.children, guestCount: guests.total };
}

type ReservationRow = Pick<
  Database["public"]["Tables"]["reservations"]["Row"],
  | "id"
  | "check_in_date"
  | "check_out_date"
  | "guest_name"
  | "property_name"
  | "room_label"
  | "source"
  | "source_reservation_id"
  | "status"
  | "raw_payload"
>;

function toJstDateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isValidMonth(value: string | undefined): value is string {
  if (!value) return false;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getCurrentJstMonth() {
  return toJstDateString(new Date()).slice(0, 7);
}

function resolveMonth(value: string | undefined): string {
  return isValidMonth(value) ? value : getCurrentJstMonth();
}

function getPhone(rawPayload: Database["public"]["Tables"]["reservations"]["Row"]["raw_payload"]) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const keys = ["phone", "mobile", "guest_phone", "guestPhone"];
  for (const key of keys) {
    const value = (rawPayload as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getDisplayReservationId(item: ReservationRow) {
  const fromPayload = getRawPayloadString(item.raw_payload, [
    "apiReference",
    "api_reference",
    "bookId",
    "book_id",
    "reservationId",
    "reservation_id",
    "bookingId",
    "booking_id",
    "id",
  ]);
  if (fromPayload) {
    return fromPayload;
  }
  return toOriginalReservationId(item.source_reservation_id);
}

function getRawPayloadString(
  rawPayload: Database["public"]["Tables"]["reservations"]["Row"]["raw_payload"],
  keys: string[],
) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }
  const record = rawPayload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return null;
}

type MobileCalendarPageProps = {
  searchParams: Promise<{
    debug?: string;
    month?: string;
    property?: string;
    reservationId?: string;
  }>;
};

// 건물 순서는 어드민 캘린더와 **같은 목록**을 쓴다 — 두 화면이 다른 순서로 보이면
// 같은 건물을 찾는 데 매번 다시 훑어야 한다.
const BUILDING_DISPLAY_ORDER = CALENDAR_BUILDING_ORDER;

function normalizePropertyParam(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = getCanonicalPropertyName(value.trim());
  return trimmed.length > 0 ? trimmed : null;
}

function localizePropertyName(
  canonicalPropertyName: string,
  locale: "en" | "ja" | "ko",
) {
  const labels: Record<string, { en: string; ja: string; ko: string }> = {
    "아라키초A": { en: "ArakichoA", ja: "荒木町A", ko: "아라키초A" },
    "아라키초B": { en: "ArakichoB", ja: "荒木町B", ko: "아라키초B" },
    "가부키초": { en: "Kabukicho", ja: "歌舞伎町", ko: "가부키초" },
    "다카다노바바": { en: "Takadanobaba", ja: "高田馬場", ko: "다카다노바바" },
    "오쿠보A": { en: "OkuboA", ja: "大久保A", ko: "오쿠보A" },
    "오쿠보B": { en: "OkuboB", ja: "大久保B", ko: "오쿠보B" },
    "오쿠보C": { en: "OkuboC", ja: "大久保C", ko: "오쿠보C" },
  };
  const entry = labels[canonicalPropertyName];
  if (!entry) return canonicalPropertyName;
  return entry[locale] ?? canonicalPropertyName;
}

function sortBuildings(values: string[]) {
  return values.sort((a, b) => {
    const aIndex = BUILDING_DISPLAY_ORDER.indexOf(a);
    const bIndex = BUILDING_DISPLAY_ORDER.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b, "ko");
  });
}

export default async function MobileCalendarPage({ searchParams }: MobileCalendarPageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  const rawMonth = params.month;
  const selectedProperty = normalizePropertyParam(params.property);
  const initialReservationId = params.reservationId ?? null;
  const roomDebugEnabled =
    process.env.NODE_ENV === "development" && params.debug === "rooms";
  const nextPathParams = new URLSearchParams();
  if (isValidMonth(rawMonth)) {
    nextPathParams.set("month", rawMonth);
  }
  if (selectedProperty) {
    nextPathParams.set("property", selectedProperty);
  }
  const nextPath = nextPathParams.size > 0 ? `/mobile/calendar?${nextPathParams.toString()}` : "/mobile/calendar";

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (state.status !== "ready" || !session) {
    const onboardingUrl = isValidMonth(rawMonth)
      ? `/onboarding?next=${encodeURIComponent(nextPath)}`
      : "/onboarding";
    redirect(onboardingUrl);
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const dictionary = getDictionary(session.user.preferredLanguage);
  const selectedMonth = resolveMonth(rawMonth);
  const monthStart = `${selectedMonth}-01`;
  const selectedMonthLabel = new Intl.DateTimeFormat(session.user.preferredLanguage, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${monthStart}T00:00:00.000Z`));

  const today = toJstDateString(new Date());

  // Operational fetch window: always current month (today's month) + next month.
  // Fixed relative to TODAY, not to selectedMonth (UI navigation).
  const currentJstMonth = today.slice(0, 7); // e.g., "2026-05"
  const [opYear, opMonth] = currentJstMonth.split("-").map(Number);
  const operationalMonthStart = `${currentJstMonth}-01`; // e.g., "2026-05-01"
  // Exclusive upper bound: first day of the month after next (2 months from now)
  const operationalWindowEnd = new Date(Date.UTC(opYear, opMonth + 1, 1)).toISOString().slice(0, 10); // e.g., "2026-07-01"

  // Server-side out-of-window check: skip the reservations query entirely when
  // selectedMonth is outside the 2-month operational window. No DB read needed
  // for a result we already know is empty.
  // getActiveRoomLabels is always fetched for debug consistency and room-source display.
  const nextJstMonth = new Date(Date.UTC(opYear, opMonth, 1)).toISOString().slice(0, 7);
  const isOutOfWindow = selectedMonth !== currentJstMonth && selectedMonth !== nextJstMonth;

  const supabase = await getSupabaseServerClient();

  let reservations: CalendarReservationItem[] = [];
  let roomMasterRooms: string[] | undefined;
  let roomCatalog: ActiveRoomCatalogItem[] | undefined;

  if (isOutOfWindow) {
    const [rooms, catalog] = await Promise.all([
      getActiveRoomLabels(session.organization.id, supabase),
      getActiveRoomCatalog(session.organization.id, supabase),
    ]);
    roomMasterRooms = rooms;
    roomCatalog = catalog;
  } else {
    const [{ data, error }, rooms, catalog] = await Promise.all([
      // 1,000행 상한을 넘으면 조용히 잘린다 — 페이지로 끝까지 읽는다(`read-all-pages.ts`).
      readAllPages<ReservationRow>((from, to) =>
        supabase
          .from("reservations")
          .select(
            "id, check_in_date, check_out_date, guest_name, property_name, room_label, source, source_reservation_id, status, raw_payload",
          )
          .eq("organization_id", session.organization.id)
          .lt("check_in_date", operationalWindowEnd)
          .gte("check_out_date", operationalMonthStart)
          .neq("status", "cancelled")
          .neq("status", "no_show")
          .order("check_in_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      getActiveRoomLabels(session.organization.id, supabase),
      getActiveRoomCatalog(session.organization.id, supabase),
    ]);

    if (error) {
      throw new Error(error.message);
    }

    roomMasterRooms = rooms;
    roomCatalog = catalog;
    const roomLookups = buildPropertyRoomLookups(roomCatalog ?? []);

    // Cross-property externalRoomId lookup: handles property-name mismatch (e.g., Beds24
    // sends Japanese "荒木町A" which may not normalize to canonical "아라키초A" depending on
    // the normalizer's alias coverage). externalRoomId is unique across the rooms table.
    const globalExternalRoomToCanonical = new Map<string, string>(
      (roomCatalog ?? [])
        .filter((item) => item.externalRoomId !== null)
        .map((item) => [item.externalRoomId as string, item.canonicalRoomLabel]),
    );

    const resolveReservationCanonicalRoomLabel = (item: ReservationRow) => {
      const canonicalPropertyName = getCanonicalPropertyName(item.property_name);
      const allowed =
        roomLookups.allowedCanonicalByProperty[canonicalPropertyName] ?? new Set<string>();
      const rawLabelMap = roomLookups.canonicalByRawLabel[canonicalPropertyName] ?? {};
      const externalIdMap = roomLookups.canonicalByExternalId[canonicalPropertyName] ?? {};
      const isAuthoritative = roomMasterRooms !== undefined;

      const acceptCanonical = (key: string | null | undefined): string | null => {
        if (!key || !allowed.has(key)) return null;
        return key;
      };

      const payloadUnitId = getRawPayloadString(item.raw_payload, [
        "roomId",
        "room_id",
        "unitId",
        "unit_id",
      ]);
      if (payloadUnitId) {
        const fromExternal =
          externalIdMap[payloadUnitId] ??
          globalExternalRoomToCanonical.get(payloadUnitId) ??
          null;
        const resolved = acceptCanonical(fromExternal);
        if (resolved) return resolved;
        if (isAuthoritative) return null;
      }

      const payloadUnitName = getRawPayloadString(item.raw_payload, [
        "unitName",
        "unit_name",
        "roomName",
        "room_name",
        "roomLabel",
        "unitLabel",
        "unit_label",
        "room_label",
      ]);
      if (payloadUnitName) {
        const exactPayload = acceptCanonical(rawLabelMap[payloadUnitName]);
        if (exactPayload) return exactPayload;
        const normalizedPayload = acceptCanonical(
          getCanonicalRoomLabel(canonicalPropertyName, payloadUnitName),
        );
        if (normalizedPayload) return normalizedPayload;
      }

      const exactRoomLabel = acceptCanonical(rawLabelMap[item.room_label]);
      if (exactRoomLabel) return exactRoomLabel;

      const normalizedRoomLabel = acceptCanonical(
        getCanonicalRoomLabel(canonicalPropertyName, item.room_label),
      );
      if (normalizedRoomLabel) return normalizedRoomLabel;

      if (isAuthoritative) {
        return null;
      }

      if (payloadUnitId) {
        const fromExternal =
          externalIdMap[payloadUnitId] ??
          globalExternalRoomToCanonical.get(payloadUnitId) ??
          null;
        const resolved = acceptCanonical(fromExternal);
        if (resolved) return resolved;
      }

      return normalizedRoomLabel;
    };

    const filteredRows = ((data ?? []) as ReservationRow[]).filter(
      (item) =>
        !isExcludedOperationalProperty(item.property_name) &&
        !isExcludedOperationalRoom(item.property_name, item.room_label),
    );

    const mapToCalendarItem = (item: ReservationRow): CalendarReservationItem => {
      const canonicalProperty = getCanonicalPropertyName(item.property_name);
      // Never drop a reservation. Resolve to the active-catalog room when possible; if it
      // does not map (unknown/inactive room), fall back to the normalized room label so the
      // booking still renders on a (fallback) row — mirrors the in-house reference system,
      // which always assigns a room and never discards a booking. Orphan rooms are added to
      // the room axis below so the bar has a row to sit on.
      const internalRoomKey =
        resolveReservationCanonicalRoomLabel(item) ||
        getCanonicalRoomLabel(canonicalProperty, item.room_label) ||
        item.room_label.trim();
      // Convert internal key → display label so 402 and 402_2 share one calendar row.
      const roomLabel = getDisplayRoomLabel(canonicalProperty, internalRoomKey) || internalRoomKey;
      return {
        checkInDate: item.check_in_date,
        checkOutDate: item.check_out_date,
        ...guestFields(getReservationGuests(item.raw_payload)),
        guestName: item.guest_name,
        id: item.id,
        internalNote: null,
        phone: getPhone(item.raw_payload),
        propertyName: canonicalProperty,
        roomLabel,
        source: item.source,
        sourceReservationId: getDisplayReservationId(item),
        status: item.status,
      };
    };

    // Authoritative mode: render only reservations that belong to active room-master rows.
    // Company rule is already reflected in room master classification:
    // external_minimum_stay >= 50 => inactive room (excluded).
    // Never drop: map every reservation. Orphan rooms (room not in the active catalog) are
    // added to the room axis (canonicalRoomMasterRooms / propertyRoomsMap) below so their
    // bars still render instead of silently disappearing.
    reservations = filteredRows.map(mapToCalendarItem);
  }

  if (reservations.length > 0) {
    const reservationNotes = await listReservationInternalNotes(
      session,
      reservations.map((item) => item.id),
    );
    reservations = reservations.map((item) => ({
      ...item,
      internalNote: reservationNotes[item.id]?.trim() || null,
    }));
  }

  const propertyOptionsFromCatalog = roomCatalog
    ? [...new Set(roomCatalog.map((item) => item.propertyName))]
    : [];
  const propertyOptionsFromReservations = [...new Set(reservations.map((item) => item.propertyName))];
  const propertyOptions = sortBuildings(
    [...new Set([...propertyOptionsFromCatalog, ...propertyOptionsFromReservations])].filter(
      (name) => name.trim().length > 0 && !isExcludedOperationalProperty(name),
    ),
  );
  const propertyLabelMap = Object.fromEntries(
    propertyOptions.map((property) => [
      property,
      localizePropertyName(property, session.user.preferredLanguage),
    ]),
  );
  const effectiveSelectedProperty =
    selectedProperty && propertyOptions.includes(selectedProperty)
      ? selectedProperty
      : null;
  let propertyRoomsMap =
    roomCatalog === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(
            roomCatalog.reduce<Record<string, string[]>>((acc, item) => {
              if (!acc[item.propertyName]) {
                acc[item.propertyName] = [];
              }
              // Use displayRoomLabel so sub-units (402, 402_2) share one calendar row per property.
              acc[item.propertyName].push(item.displayRoomLabel);
              return acc;
            }, {}),
          ).map(([property, labels]) => [property, [...new Set(labels)].sort()]),
        );
  // Beds24 캘린더 블락. 예약이 아니라 인벤토리 오버라이드라 별도 테이블에서 온다.
  // 방 축은 예약과 같은 표시 라벨을 쓴다 — 어긋나면 그릴 행이 없다.
  const roomBlocksResult = await readAllPages((from, to) =>
    supabase
      .from("room_blocks")
      .select("id, property_name, room_label, start_date, end_date")
      .eq("organization_id", session.organization.id)
      .lt("start_date", operationalWindowEnd)
      .gte("end_date", operationalMonthStart)
      .order("start_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (roomBlocksResult.error) {
    console.error("[mobile/calendar] room block read failed", roomBlocksResult.error);
  }
  // 읽다 실패하면 앞 페이지만 남는다 — 반쪽 블록은 그리지 않는다(관리자 캘린더와 같다).
  const roomBlocks = (roomBlocksResult.error ? [] : roomBlocksResult.data)
    .filter(
      (row) =>
        !isExcludedOperationalProperty(row.property_name) &&
        !isExcludedOperationalRoom(row.property_name, row.room_label),
    )
    .map((row) => {
      const propertyName = getCanonicalPropertyName(row.property_name);
      const canonicalRoomLabel =
        getCanonicalRoomLabel(propertyName, row.room_label) || row.room_label.trim();
      return {
        endDate: row.end_date,
        id: row.id,
        roomLabel: getDisplayRoomLabel(propertyName, canonicalRoomLabel) || canonicalRoomLabel,
        startDate: row.start_date,
      };
    });

  let canonicalRoomMasterRooms =
    roomCatalog === undefined
      ? roomMasterRooms
      : [...new Set(roomCatalog.map((item) => item.displayRoomLabel))];

  // Fallback axis rows: add any reservation room that is not already in the catalog axis so
  // no booking is hidden for lack of a row (we no longer drop unmapped reservations). Orphan
  // rooms are rare — mostly brand-new or fully long-stay (>=50) physical rooms.
  if (canonicalRoomMasterRooms !== undefined) {
    const masterSet = new Set(canonicalRoomMasterRooms);
    for (const r of reservations) {
      if (r.roomLabel && getCanonicalPropertyName(r.roomLabel) !== r.propertyName)
        masterSet.add(r.roomLabel);
    }
    canonicalRoomMasterRooms = [...masterSet];
  }
  if (propertyRoomsMap !== undefined) {
    const augmented: Record<string, string[]> = { ...propertyRoomsMap };
    for (const r of reservations) {
      if (!r.roomLabel || getCanonicalPropertyName(r.roomLabel) === r.propertyName) continue;
      const list = augmented[r.propertyName] ? [...augmented[r.propertyName]] : [];
      if (!list.includes(r.roomLabel)) {
        list.push(r.roomLabel);
        list.sort();
      }
      augmented[r.propertyName] = list;
    }
    propertyRoomsMap = augmented;
  }

  const roomSourceDebug = roomDebugEnabled
    ? {
        activeRoomLabels: roomMasterRooms ?? [],
        fetchWindow: { from: operationalMonthStart, to: operationalWindowEnd },
        mode:
          roomMasterRooms === undefined
            ? ("provisional" as const)
            : roomMasterRooms.length === 0
              ? ("authoritative_zero" as const)
              : ("authoritative_active" as const),
        reservationsQuery: isOutOfWindow ? ("skipped" as const) : ("executed" as const),
      }
    : null;

  const [navBadges, buildingInfos] = await Promise.all([
    getMobileNavBadges(),
    listPropertyMapMeta(session),
  ]);

  return (
    // 넓은 화면(2026-10-05): 폭 전부(`wide`) — 격자는 날짜 칸이 고정 폭이라 넓을수록 더 많은 날을 한 번에 본다. 목록 · 건물
    // 정보는 폴드 2열 · 태블릿 가로 3열(`MobileCalendarView`).
    <MobileShell
      activeItem="calendar"
      appearance="cleaning"
      badges={navBadges}
      title={dictionary.navigation.mobile.calendar}
      wide
    >
      <MobileCalendarLiveView
        copy={{
          calendar: dictionary.navigation.mobile.calendar,
          calendarBuildingChange: dictionary.mobile.calendarBuildingChange,
          calendarBuildingHotelLabel: dictionary.mobile.calendarBuildingHotelLabel,
          calendarBuildingHouseLabel: dictionary.mobile.calendarBuildingHouseLabel,
          calendarBuildingPickerBody: dictionary.mobile.calendarBuildingPickerBody,
          calendarBuildingPickerQuestion: dictionary.mobile.calendarBuildingPickerQuestion,
          calendarTokyoNowLabel: dictionary.mobile.calendarTokyoNowLabel,
          calendarMapBuildingCount: dictionary.mobile.calendarMapBuildingCount,
          legendDirect: dictionary.mobile.calendarLegendDirect,
          calendarBuildingPickerTitle: dictionary.mobile.calendarBuildingPickerTitle,
          call: dictionary.mobile.calendarCall,
          checkInLabel: dictionary.mobile.calendarCheckInLabel,
          checkOutLabel: dictionary.mobile.calendarCheckOutLabel,
          checkIns: dictionary.admin.stats.checkIns,
          checkOuts: dictionary.admin.stats.checkOuts,
          close: dictionary.mobile.calendarClose,
          copied: dictionary.mobile.calendarCopied,
          copyNumber: dictionary.mobile.calendarCopyNumber,
          emptyAccuracyHint: dictionary.mobile.calendarEmptyAccuracyHint,
          calendarOutOfWindowBody: dictionary.mobile.calendarOutOfWindowBody,
          calendarOutOfWindowTitle: dictionary.mobile.calendarOutOfWindowTitle,
          emptyToday: dictionary.admin.stats.emptyToday,
          filterAll: dictionary.mobile.filterAll,
          listView: dictionary.mobile.calendarListView,
          mapTab: dictionary.mobile.calendarMapTab,
          mapAccessSheetTitle: dictionary.mobile.calendarMapAccessSheetTitle,
          mapAddressLabel: dictionary.mobile.calendarMapAddressLabel,
          mapAddressCopy: dictionary.mobile.calendarMapAddressCopy,
          mapAddressMissing: dictionary.mobile.calendarMapAddressMissing,
          mapAccessFloor1: dictionary.mobile.calendarMapAccessFloor1,
          mapAccessKindDoorPassword: dictionary.mobile.calendarMapAccessKindDoorPassword,
          mapAccessKindKeyBox: dictionary.mobile.calendarMapAccessKindKeyBox,
          mapAccessKindKeyBoxPassword: dictionary.mobile.calendarMapAccessKindKeyBoxPassword,
          mapAccessKindLinenStorageEntrancePassword: dictionary.mobile.calendarMapAccessKindLinenStorageEntrancePassword,
          mapAccessKindRoomPassword: dictionary.mobile.calendarMapAccessKindRoomPassword,
          mapAccessKindStorage: dictionary.mobile.calendarMapAccessKindStorage,
          mapAccessKindStoragePassword: dictionary.mobile.calendarMapAccessKindStoragePassword,
          mapAccessNoteAllRoomsSame: dictionary.mobile.calendarMapAccessNoteAllRoomsSame,
          mapCopiedAddress: dictionary.mobile.calendarMapCopiedAddress,
          mapCopiedCode: dictionary.mobile.calendarMapCopiedCode,
          mapOpenAccess: dictionary.mobile.calendarMapOpenAccess,
          mapOpenInMaps: dictionary.mobile.calendarMapOpenInMaps,
          mapOpenRoomAccess: dictionary.mobile.calendarMapOpenRoomAccess,
          mapOpenSharedAccess: dictionary.mobile.calendarMapOpenSharedAccess,
          mapRoomAccessLabel: dictionary.mobile.calendarMapRoomAccessLabel,
          mapSharedAccessLabel: dictionary.mobile.calendarMapSharedAccessLabel,
          mapNoAccessData: dictionary.mobile.calendarMapNoAccessData,
          noFilterResults: dictionary.mobile.noFilterResults,
          noEmptyRooms: dictionary.mobile.calendarNoEmptyRooms,
          blockedRoom: dictionary.admin.calendar.blockedRoom,
          internalNote: dictionary.admin.calendar.internalNote,
          internalNoteEmpty: dictionary.admin.calendar.opsNotePlaceholder,
          opsNote: dictionary.admin.calendar.opsNote,
          opsNoteEmpty: dictionary.admin.calendar.opsNotePlaceholder,
          listReferenceDate: dictionary.mobile.calendarListReferenceDate,
          emptyRoomsModalTitle: dictionary.mobile.calendarEmptyRoomsModalTitle,
          guestCountLabel: dictionary.mobile.calendarGuestCountLabel,
          guestCountUnit: dictionary.mobile.calendarGuestCountUnit,
          guestCountUnknown: dictionary.mobile.calendarGuestCountUnknown,
          guestBreakdown: dictionary.mobile.calendarGuestBreakdown,
          phone: dictionary.admin.users.phone,
          phoneMissing: dictionary.mobile.calendarPhoneMissing,
          propertyLabel: dictionary.mobile.calendarPropertyLabel,
          reservationId: dictionary.mobile.calendarReservationId,
          roomLabel: dictionary.mobile.calendarRoomLabel,
          stayingToday: dictionary.admin.stats.stayingToday,
          today: dictionary.mobile.today,
        }}
        wcopy={dictionary.mobile.calendarW}
        isOutOfWindow={isOutOfWindow}
        buildingInfos={buildingInfos}
        locale={session.user.preferredLanguage}
        organizationId={session.organization.id}
        reservations={reservations}
        roomBlocks={roomBlocks}
        roomMasterRooms={canonicalRoomMasterRooms}
        roomSourceDebug={roomSourceDebug}
        selectedMonth={selectedMonth}
        selectedMonthLabel={selectedMonthLabel}
        propertyOptions={propertyOptions}
        propertyLabelMap={propertyLabelMap}
        propertyRoomsMap={propertyRoomsMap}
        selectedProperty={effectiveSelectedProperty}
        statusLabels={dictionary.admin.reservationStatusLabels}
        today={today}
        initialReservationId={initialReservationId}
      />
    </MobileShell>
  );
}
