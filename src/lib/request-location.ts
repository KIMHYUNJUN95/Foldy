import { localizeBuildingName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";
import type { ActiveRoomCatalogItem } from "@/lib/rooms";

export type RequestLocationDisplay = {
  buildingLabel: string | null;
  roomLabel: string;
};

export type RequestCatalogLocation = {
  buildingLabel: string | null;
  buildingName: string | null;
  canonicalRoomLabel: string;
  item: ActiveRoomCatalogItem | null;
  roomLabel: string;
};

/**
 * 건물 이름을 보는 사람 언어로 — 공용 `localizeBuildingName`(2026-10-23). 예전엔 이 파일만의 표가 있었는데 스테이아리 ·
 * 사노가 빠져 있어 수리 · 분실물 · 주문 위치에 사노가 한국어로 남았다.
 */
const localizePropertyName = localizeBuildingName;

/** 표시용 객실 라벨 — 독채(오쿠보 · 사노)는 객실 이름이 곧 한국어 건물 이름이라 같이 바꾼다. */
function displayRoom(roomLabel: string, buildingLabels: Record<string, string>): string {
  return localizeRoomPlaceLabel(roomLabel, buildingLabels);
}

/**
 * 건물명이 앞에 붙어 저장된 객실 라벨에서 그 접두어를 떼어낸다.
 *
 * 분실물 등록은 `room_label`을 `"{propertyName} {room}"` 결합 형식으로 저장한다
 * (src/app/mobile/lost-found/new/actions.ts — `property_name`이 없던 시절 카탈로그 역추적을 위한
 * 형식). 그런데 같은 행이 `property_name`도 함께 저장하므로, 건물 라벨과 객실 라벨을 나란히 찍는
 * 화면에서는 "아라키초 A · 아라키초A 201"처럼 건물명이 두 번 나온다.
 *
 * 이미 저장된 데이터가 전부 결합 형식이라 저장 형식을 바꾸면 신·구 두 형식이 공존하게 되고,
 * 어드민 검색(`room_label` ilike)도 결합 문자열을 대상으로 한다. 그래서 저장은 그대로 두고
 * 표시 단계에서만 중복을 제거한다 — 구 데이터·신 데이터 모두 같은 결과가 된다.
 */
function stripBuildingPrefix(roomLabel: string, propertyName: string): string {
  const prefix = `${propertyName.trim()} `;
  if (!roomLabel.startsWith(prefix)) return roomLabel;
  const rest = roomLabel.slice(prefix.length).trim();
  return rest || roomLabel;
}

function fromCatalogItem(
  item: ActiveRoomCatalogItem,
  buildingLabels: Record<string, string>,
): RequestLocationDisplay {
  return {
    buildingLabel: localizePropertyName(item.propertyName, buildingLabels),
    // Display the collapsed room (Arakicho 201_2 → 201), never the raw sub-unit.
    roomLabel: displayRoom(item.displayRoomLabel, buildingLabels),
  };
}

function isSessionLabelMatch(item: ActiveRoomCatalogItem, trimmed: string) {
  const combos = [item.canonicalRoomLabel, item.roomLabel, item.displayRoomLabel].map((room) =>
    room === item.propertyName ? item.propertyName : `${item.propertyName} ${room}`,
  );
  return combos.includes(trimmed);
}

export function resolveRequestCatalogLocation(
  roomLabel: string,
  catalog: readonly ActiveRoomCatalogItem[] | undefined,
  buildingLabels: Record<string, string>,
): RequestCatalogLocation {
  const trimmed = roomLabel.trim();
  if (!trimmed || !catalog || catalog.length === 0) {
    return {
      buildingLabel: null,
      buildingName: null,
      canonicalRoomLabel: trimmed,
      item: null,
      roomLabel: trimmed,
    };
  }

  const combinedMatch = catalog.find((item) => isSessionLabelMatch(item, trimmed));
  if (combinedMatch) {
    return {
      buildingLabel: localizePropertyName(combinedMatch.propertyName, buildingLabels),
      buildingName: combinedMatch.propertyName,
      canonicalRoomLabel: combinedMatch.canonicalRoomLabel,
      item: combinedMatch,
      roomLabel: combinedMatch.displayRoomLabel,
    };
  }

  const exactMatches = catalog.filter(
    (item) =>
      item.canonicalRoomLabel === trimmed ||
      item.roomLabel === trimmed ||
      item.displayRoomLabel === trimmed,
  );
  // Sub-units (201, 201_2) map to one physical room, so 1+ matches that all resolve to the same
  // building+display room is unambiguous — take the first. (displayRoomLabel matching also recovers
  // the building for newer records stored as the collapsed "201".)
  const samePhysical = new Set(exactMatches.map((m) => `${m.propertyName}::${m.displayRoomLabel}`));
  if (exactMatches.length >= 1 && samePhysical.size === 1) {
    const match = exactMatches[0];
    return {
      buildingLabel: localizePropertyName(match.propertyName, buildingLabels),
      buildingName: match.propertyName,
      canonicalRoomLabel: match.canonicalRoomLabel,
      item: match,
      roomLabel: match.displayRoomLabel,
    };
  }

  return {
    buildingLabel: null,
    buildingName: null,
    canonicalRoomLabel: trimmed,
    item: null,
    roomLabel: trimmed,
  };
}

export function resolveRequestLocation(
  roomLabel: string,
  catalog: readonly ActiveRoomCatalogItem[] | undefined,
  buildingLabels: Record<string, string>,
  propertyName?: string | null,
): RequestLocationDisplay {
  const trimmed = roomLabel.trim();

  // When property_name is stored directly, use it — no catalog lookup needed.
  if (propertyName) {
    return {
      buildingLabel: localizePropertyName(propertyName, buildingLabels),
      // 건물명이 객실 라벨 앞에 이미 붙어 있으면(분실물 결합 형식) 떼어낸다 — 안 그러면
      // "아라키초 A · 아라키초A 201"처럼 건물명이 중복 표시된다.
      roomLabel: displayRoom(stripBuildingPrefix(trimmed, propertyName), buildingLabels),
    };
  }

  if (!trimmed || !catalog || catalog.length === 0) {
    return { buildingLabel: null, roomLabel: trimmed };
  }

  const combinedMatch = catalog.find((item) => isSessionLabelMatch(item, trimmed));
  if (combinedMatch) {
    return fromCatalogItem(combinedMatch, buildingLabels);
  }

  const exactMatches = catalog.filter(
    (item) =>
      item.canonicalRoomLabel === trimmed ||
      item.roomLabel === trimmed ||
      item.displayRoomLabel === trimmed,
  );
  const samePhysical = new Set(exactMatches.map((m) => `${m.propertyName}::${m.displayRoomLabel}`));
  if (exactMatches.length >= 1 && samePhysical.size === 1) {
    return fromCatalogItem(exactMatches[0], buildingLabels);
  }

  return { buildingLabel: null, roomLabel: trimmed };
}
