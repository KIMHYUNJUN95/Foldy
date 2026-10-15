import "server-only";
import type { Locale } from "@/lib/i18n";
import { listPropertyMapMeta } from "@/lib/property-operation-info";
import { CALENDAR_BUILDING_ORDER } from "@/lib/room-label-normalization";
import { opsUnitRoomKey, ROOM_AXIS_SEPARATOR } from "@/lib/ops-room-key";
import {
  findDuplicateListingIds,
  groupRoomLinks,
  mergeManualRoomLinks,
  type RoomLinkChannel,
  ROOM_LINK_SELLING_WINDOW_DAYS,
  type RoomLinkRecord,
} from "@/lib/room-links-model";
import { isActiveUnitMinStay } from "@/lib/ops-gap-detection";
import { fetchRoomCatalogRows } from "@/lib/rooms";
import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { tokyoToday, ymdShift } from "@/lib/tokyo-date";

/**
 * 룸 링크 화면 읽기 — `/admin/ops/room-links`.
 *
 * 도메인 계약: docs/product/35-room-links.md
 *
 * **호출부가 `room_links.access` 를 먼저 확인한다**(`canAccessRoomLinks`). 여기서는 service-role 로 읽으므로
 * 조직을 직접 건다 — RLS 가 막아 주지 않는다. 표는 수백 줄 안쪽(객실 ~100 × 채널 2)이라 한 번에 읽는다.
 */

export type RoomLinkView = {
  listingId: string | null;
  hostUrl: string | null;
  guestUrl: string | null;
  memo: string | null;
  updatedAt: string | null;
};

export type RoomLinkUnitView = {
  /** Beds24 유닛이면 `rooms.id`, 직접 추가한 객실이면 `room_link_rooms.id`(`manual`). */
  roomId: string;
  unitLabel: string;
  selling: boolean;
  /** 룸 링크에서 직접 추가한 객실 — 판매 중 표시가 없고 「직접 추가」 표시가 붙는다. */
  manual: boolean;
  airbnb: RoomLinkView | null;
};

export type RoomLinkRowView = {
  key: string;
  label: string;
  /** 직접 추가한 객실이면 그 id — 이름 바꾸기 · 지우기에 쓴다. */
  manualRoomId: string | null;
  units: RoomLinkUnitView[];
};

export type RoomLinkBuildingView = {
  name: string;
  /** 직접 추가한 건물이면 그 id(`room_link_buildings.id`) — Beds24 건물은 `null`. */
  manualId: string | null;
  /** 건물 주소(사용자 언어). 건물 정보에 없으면 `null` — 화면이 「주소 미입력」. */
  address: string | null;
  mapUrl: string | null;
  /** Booking.com 은 건물 단위(`building_listing_links`) — 객실마다가 아니다. */
  booking: RoomLinkView | null;
  rows: RoomLinkRowView[];
};

export type RoomLinksPageData = {
  buildings: RoomLinkBuildingView[];
  /** 두 유닛 이상에 붙은 리스팅 ID — 화면이 경고한다. */
  duplicateListingIds: string[];
};

function toView(link: Omit<RoomLinkRecord, "roomId"> | undefined): RoomLinkView | null {
  if (!link) return null;
  return {
    guestUrl: link.guestUrl,
    hostUrl: link.hostUrl,
    listingId: link.listingId,
    memo: link.memo,
    updatedAt: link.updatedAt,
  };
}

export async function getRoomLinksPageData(session: AppSession, locale: Locale): Promise<RoomLinksPageData> {
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const today = tokyoToday();
  const [roomsResult, linksResult, buildingLinksResult, manualBuildingsResult, manualRoomsResult, metas, rates] = await Promise.all([
    fetchRoomCatalogRows(organizationId, supabase),
    supabase
      .from("room_listing_links")
      .select("room_id, manual_room_id, channel, listing_id, host_url, guest_url, memo, updated_at")
      .eq("organization_id", organizationId)
      .eq("channel", "airbnb"),
    supabase
      .from("building_listing_links")
      .select("canonical_name, manual_building_id, channel, listing_id, host_url, guest_url, memo, updated_at")
      .eq("organization_id", organizationId)
      .eq("channel", "booking"),
    // 룸 링크에서 직접 추가한 건물 · 객실(2026-10-15) — 이 화면에만 보인다.
    supabase
      .from("room_link_buildings")
      .select("id, name, sort_order, created_at")
      .eq("organization_id", organizationId),
    supabase
      .from("room_link_rooms")
      .select("id, name, canonical_name, manual_building_id")
      .eq("organization_id", organizationId),
    listPropertyMapMeta(session).catch(() => []),
    // 「지금 판매 중」은 판매 캘린더와 같은 **날짜별 최소숙박**(활성 1~49)으로, 오늘부터 30일을 본다
    // (`pickSellingUnits`). `rooms.external_minimum_stay` 는 한 시점의 값이라 계정이 바뀌는 날을 못 따라간다.
    // 객실 ~100 × 30일 = 1,000행을 넘으므로 페이지로 읽는다.
    readAllPages<{ room_id: string; stay_date: string; min_stay: number | null }>((from, to) =>
      supabase
        .from("room_daily_rates")
        .select("room_id, stay_date, min_stay")
        .eq("organization_id", organizationId)
        .gte("stay_date", today)
        .lt("stay_date", ymdShift(today, ROOM_LINK_SELLING_WINDOW_DAYS))
        .order("room_id", { ascending: true })
        .order("stay_date", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (roomsResult.error) throw new Error(roomsResult.error.message);
  if (linksResult.error) throw new Error(linksResult.error.message);
  if (buildingLinksResult.error) throw new Error(buildingLinksResult.error.message);
  if (manualBuildingsResult.error) throw new Error(manualBuildingsResult.error.message);
  if (manualRoomsResult.error) throw new Error(manualRoomsResult.error.message);
  // Booking.com 줄 — Beds24 건물은 이름으로, 직접 추가한 건물은 id 로(이름을 바꿔도 따라간다).
  const bookingByBuilding = new Map(
    (buildingLinksResult.data ?? []).map((row) => [
      row.manual_building_id ? `manual:${row.manual_building_id}` : `name:${row.canonical_name}`,
      {
        channel: "booking" as const,
        guestUrl: row.guest_url,
        hostUrl: row.host_url,
        listingId: row.listing_id,
        memo: row.memo,
        updatedAt: row.updated_at,
      },
    ]),
  );
  // 읽기에 실패하면 객실 표 값으로 대신한다(링크 화면이 판매 표시 때문에 죽지 않게).
  const activeNights = new Map<string, number>();
  for (const row of rates.error ? [] : (rates.data ?? [])) {
    activeNights.set(row.room_id, (activeNights.get(row.room_id) ?? 0) + (isActiveUnitMinStay(row.min_stay) ? 1 : 0));
  }

  // 한 줄은 Beds24 유닛(`room_id`) 또는 직접 추가한 객실(`manual_room_id`) 중 하나에 붙는다(체크 제약).
  const toRecord = (row: NonNullable<typeof linksResult.data>[number], roomId: string): RoomLinkRecord => ({
    channel: row.channel as RoomLinkChannel,
    guestUrl: row.guest_url,
    hostUrl: row.host_url,
    listingId: row.listing_id,
    memo: row.memo,
    roomId,
    updatedAt: row.updated_at,
  });
  const links: RoomLinkRecord[] = [];
  const manualLinks: RoomLinkRecord[] = [];
  for (const row of linksResult.data ?? []) {
    if (row.room_id) links.push(toRecord(row, row.room_id));
    else if (row.manual_room_id) manualLinks.push(toRecord(row, row.manual_room_id));
  }

  const beds24Grouped = groupRoomLinks({
    buildingOrder: CALENDAR_BUILDING_ORDER,
    links,
    units: roomsResult.data.map((row) => {
      const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
      return {
        activeNights: activeNights.get(row.id) ?? null,
        externalMinimumStay: row.external_minimum_stay,
        id: row.id,
        propertyName: property?.name,
        roomLabel: row.room_label,
        status: row.status,
      };
    }),
  });
  const grouped = mergeManualRoomLinks({
    buildingOrder: CALENDAR_BUILDING_ORDER,
    buildings: beds24Grouped,
    links: manualLinks,
    manualBuildings: (manualBuildingsResult.data ?? []).map((row) => ({
      createdAt: row.created_at,
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
    })),
    manualRooms: (manualRoomsResult.data ?? []).map((row) => ({
      canonicalName: row.canonical_name,
      id: row.id,
      manualBuildingId: row.manual_building_id,
      name: row.name,
    })),
  });

  const metaByName = new Map(metas.map((meta) => [meta.canonicalName, meta]));
  return {
    buildings: grouped.map((building) => {
      // 직접 추가한 건물은 건물 정보(주소 · 지도)가 없다 — 이름이 우연히 같아도 붙이지 않는다.
      const meta = building.manualId ? undefined : metaByName.get(building.name);
      const address = meta ? meta.address[locale] || meta.address.ko || null : null;
      return {
        address,
        booking: toView(
          bookingByBuilding.get(building.manualId ? `manual:${building.manualId}` : `name:${building.name}`),
        ),
        manualId: building.manualId,
        mapUrl: meta?.googleMapsUrl || null,
        name: building.name,
        rows: building.rows.map((row) => ({
          key: row.key,
          label: row.label,
          manualRoomId: row.manualRoomId,
          units: row.units.map((unit) => ({
            airbnb: toView(unit.links.airbnb),
            manual: unit.manual,
            roomId: unit.roomId,
            selling: unit.selling,
            unitLabel: unit.unitLabel,
          })),
        })),
      };
    }),
    duplicateListingIds: [...findDuplicateListingIds([...links, ...manualLinks])],
  };
}

/**
 * 직접 추가할 때 이름이 겹치면 안 되는 Beds24 쪽 이름들 — 건물 이름과 건물별 객실(행) 이름.
 * 화면과 같은 행 키(`opsUnitRoomKey`)로 계산한다. 운영 종료 유닛도 넣는다(겹치면 헷갈리므로 더 엄격하게).
 * 호출부(서버 액션)가 `room_links.access` 를 먼저 확인한다.
 */
export async function loadBeds24RoomLinkNames(organizationId: string): Promise<Map<string, Set<string>>> {
  const supabase = getSupabaseServiceClient();
  const result = await fetchRoomCatalogRows(organizationId, supabase);
  if (result.error) throw new Error(result.error.message);
  const names = new Map<string, Set<string>>(CALENDAR_BUILDING_ORDER.map((name) => [name, new Set<string>()]));
  for (const row of result.data) {
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const key = opsUnitRoomKey({ propertyName: property?.name, roomLabel: row.room_label });
    if (!key) continue;
    const separator = key.indexOf(ROOM_AXIS_SEPARATOR);
    const building = key.slice(0, separator);
    const labels = names.get(building) ?? new Set<string>();
    labels.add(key.slice(separator + ROOM_AXIS_SEPARATOR.length));
    names.set(building, labels);
  }
  return names;
}
