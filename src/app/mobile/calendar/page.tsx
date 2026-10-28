import { redirect } from "next/navigation";
import type { CalendarReservationItem } from "@/components/calendar/mobile-calendar-view";
import { MobileCalendarLiveView } from "@/components/calendar/mobile-calendar-live-view";
import { toOriginalReservationId } from "@/lib/beds24/reservation-id";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { listPropertyMapMeta } from "@/lib/property-operation-info";
import { listReservationInternalNotesInWindow, pickReservationNotes } from "@/lib/reservation-internal-notes";
import { CALENDAR_PAYLOAD_KEYS, slimPayloadOf, slimPayloadSelect } from "@/lib/reservation-payload-slim";
import {
  CALENDAR_BUILDING_ORDER,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
  localizeBuildingName,
} from "@/lib/room-label-normalization";
import {
  type ActiveRoomCatalogItem,
  buildPropertyRoomLookups,
  getActiveRoomCatalog,
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

// `raw_payload` 는 쓰는 키만(`reservation-payload-slim.ts`) — 통째면 두 달 창 954행에 약 2MB 였다.
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
    status: raw.status as ReservationRow["status"],
  };
}

/** `getActiveRoomLabels`(rooms.ts)와 같은 값 — 이미 받은 카탈로그에서 만든다(`rooms` 를 두 번 읽지 않게). */
function roomLabelsOf(catalog: ActiveRoomCatalogItem[] | undefined): string[] | undefined {
  return catalog === undefined ? undefined : [...new Set(catalog.map((item) => item.roomLabel))];
}

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

  // 운영 조회 구간: 항상 이번 달(오늘이 속한 달) + 다음 달.
  // UI 에서 이동하는 selectedMonth 가 아니라 오늘 기준으로 고정한다.
  const currentJstMonth = today.slice(0, 7); // 예: "2026-05"
  const [opYear, opMonth] = currentJstMonth.split("-").map(Number);
  const operationalMonthStart = `${currentJstMonth}-01`; // 예: "2026-05-01"
  // 배타적 상한: 다음 달의 다음 달 1일(지금부터 2개월 뒤)
  const operationalWindowEnd = new Date(Date.UTC(opYear, opMonth + 1, 1)).toISOString().slice(0, 10); // 예: "2026-07-01"

  // 서버 측 구간 밖 확인: selectedMonth 가 2개월 운영 구간 밖이면
  // 예약 쿼리를 아예 건너뛴다. 이미 비어 있는 걸 아는 결과를 위해
  // DB 를 읽을 필요가 없다.
  // getActiveRoomLabels 는 디버그 일관성과 방 출처 표시를 위해 항상 가져온다.
  const nextJstMonth = new Date(Date.UTC(opYear, opMonth, 1)).toISOString().slice(0, 7);
  const isOutOfWindow = selectedMonth !== currentJstMonth && selectedMonth !== nextJstMonth;

  const supabase = await getSupabaseServerClient();

  let reservations: CalendarReservationItem[] = [];
  let roomMasterRooms: string[] | undefined;
  let roomCatalog: ActiveRoomCatalogItem[] | undefined;

  // 서로 기다릴 필요 없는 읽기(객실 · 예약 · 메모 · 차단 · 건물 정보 · 배지)는 한 번에 시작한다(2026-10-19 속도 — 전에는
  // 메모 5번 · 차단 · 배지가 차례로 붙어 약 13단계였다).
  const roomBlocksPromise = readAllPages((from, to) =>
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
  const sidePromise = Promise.all([getMobileNavBadges(), listPropertyMapMeta(session)]);
  // 첫 await 전에 거절돼도 처리되지 않은 거절로 남지 않게 — 실제 오류는 아래 await 가 그대로 던진다.
  roomBlocksPromise.catch(() => undefined);
  sidePromise.catch(() => undefined);

  if (isOutOfWindow) {
    const catalog = await getActiveRoomCatalog(session.organization.id, supabase);
    roomMasterRooms = roomLabelsOf(catalog);
    roomCatalog = catalog;
  } else {
    const [{ data, error }, catalog, notesInWindow] = await Promise.all([
      // 1,000행 상한을 넘으면 조용히 잘린다 — 페이지로 끝까지 읽는다(`read-all-pages.ts`).
      readAllPages<Record<string, unknown>>((from, to) =>
        supabase
          .from("reservations")
          .select(RESERVATION_SELECT)
          .eq("organization_id", session.organization.id)
          .lt("check_in_date", operationalWindowEnd)
          .gte("check_out_date", operationalMonthStart)
          .neq("status", "cancelled")
          .neq("status", "no_show")
          .order("check_in_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
      ),
      getActiveRoomCatalog(session.organization.id, supabase),
      listReservationInternalNotesInWindow(session, {
        checkInBefore: operationalWindowEnd,
        checkOutFrom: operationalMonthStart,
      }),
    ]);

    if (error) {
      throw new Error(error.message);
    }

    const rooms = roomLabelsOf(catalog);
    roomMasterRooms = rooms;
    roomCatalog = catalog;
    const roomLookups = buildPropertyRoomLookups(roomCatalog ?? []);

    // property 교차 externalRoomId 조회: 건물 이름 불일치를 처리한다(예: Beds24가
    // 일본어 "荒木町A" 를 보내서 정규화기의 별칭 범위에 따라 정규 "아라키초A" 로
    // 정규화되지 않을 수 있는 경우). externalRoomId 는 rooms 테이블 전체에서 유일하다.
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

    // 화면이 쓰는 예약만 넘긴다(2026-10-19 — HTML 약 470KB 의 대부분이 두 달 창 예약 목록이었다). 격자 · 빈 방 줄 ·
    // 예약 시트는 **보고 있는 달**, 목록 탭 · 건물 고르기의 「오늘 빈 방」은 **오늘** 만 본다. 다른 달은 그 달로 넘어가면
    // 서버가 다시 읽는다. 작업의 예약 딥링크는 체크인 달(`month`)을 같이 실어 보내 보고 있는 달에 들어 있다.
    const [selYear, selMonthNumber] = selectedMonth.split("-").map(Number);
    const selectedMonthEndExclusive = new Date(Date.UTC(selYear, selMonthNumber, 1)).toISOString().slice(0, 10);
    const filteredRows = data.map(toReservationRow).filter(
      (item) =>
        !isExcludedOperationalProperty(item.property_name) &&
        !isExcludedOperationalRoom(item.property_name, item.room_label) &&
        // 체크아웃이 1일인 예약도 넘긴다(`>=`) — 목록이 고른 날 기준이 되어(2026-10-28) 1일을 고르면 그 체크아웃이 보여야 한다.
        // 격자는 따로 `checkOut > 달 첫날` 로 거르므로 막대는 그려지지 않는다.
        ((item.check_in_date < selectedMonthEndExclusive && item.check_out_date >= monthStart) ||
          (item.check_in_date <= today && item.check_out_date >= today)),
    );

    const mapToCalendarItem = (item: ReservationRow): CalendarReservationItem => {
      const canonicalProperty = getCanonicalPropertyName(item.property_name);
      // 예약을 절대 버리지 않는다. 가능하면 활성 카탈로그 방으로 풀고, 매핑되지
      // 않으면(알 수 없거나 비활성 방) 정규화된 방 라벨로 대체해서
      // (대체) 행에라도 예약이 그려지게 한다 — 항상 방을 배정하고 예약을 버리지 않는
      // 사내 기준 시스템과 같다. 고아 방은 아래에서
      // 방 축에 추가되어 막대가 놓일 행이 생긴다.
      const internalRoomKey =
        resolveReservationCanonicalRoomLabel(item) ||
        getCanonicalRoomLabel(canonicalProperty, item.room_label) ||
        item.room_label.trim();
      // 내부 키 → 표시 라벨로 바꿔서 402 와 402_2 가 한 캘린더 행을 공유한다.
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

    // 권위 모드: 활성 방 마스터 행에 속한 예약만 그린다.
    // 회사 규칙은 이미 방 마스터 분류에 반영되어 있다:
    // external_minimum_stay >= 50 => 비활성 방(제외).
    // 절대 버리지 않는다: 모든 예약을 매핑한다. 고아 방(활성 카탈로그에 없는 방)은
    // 아래에서 방 축(canonicalRoomMasterRooms / propertyRoomsMap)에 추가해 그 막대가
    // 조용히 사라지지 않고 계속 그려지게 한다.
    reservations = filteredRows.map(mapToCalendarItem);
    const reservationNotes = pickReservationNotes(
      notesInWindow,
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
      // 건물 이름은 앱 공용 표(`cleaning.buildingLabels`) — 전엔 이 파일만의 표라 스테이아리 · 사노가 빠져 한국어로 남았다(2026-10-22).
      localizeBuildingName(property, dictionary.cleaning.buildingLabels),
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
              // displayRoomLabel 을 써서 하위 호실(402, 402_2)이 property 당 한 캘린더 행을 공유한다.
              acc[item.propertyName].push(item.displayRoomLabel);
              return acc;
            }, {}),
          ).map(([property, labels]) => [property, [...new Set(labels)].sort()]),
        );
  // Beds24 캘린더 블락. 예약이 아니라 인벤토리 오버라이드라 별도 테이블에서 온다.
  // 방 축은 예약과 같은 표시 라벨을 쓴다 — 어긋나면 그릴 행이 없다.
  const roomBlocksResult = await roomBlocksPromise;
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
        // 건물도 넘긴다 — 화면이 고른 건물의 블락만 그린다(다른 건물 같은 번호 방에 그려지던 버그, 2026-10-26).
        propertyName,
        roomLabel: getDisplayRoomLabel(propertyName, canonicalRoomLabel) || canonicalRoomLabel,
        startDate: row.start_date,
      };
    });

  let canonicalRoomMasterRooms =
    roomCatalog === undefined
      ? roomMasterRooms
      : [...new Set(roomCatalog.map((item) => item.displayRoomLabel))];

  // 대체 축 행: 카탈로그 축에 아직 없는 예약 방을 추가해서
  // 행이 없다는 이유로 숨겨지는 예약이 없게 한다(매핑 안 된 예약을 더는 버리지 않음). 고아
  // 방은 드물다 — 대부분 새로 생겼거나 전부 장기 숙박(>=50)인 물리적 방이다.
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

  const [navBadges, buildingInfos] = await sidePromise;

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
