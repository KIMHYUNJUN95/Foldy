import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
} from "@/lib/room-label-normalization";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type RawPayload = Database["public"]["Tables"]["reservations"]["Row"]["raw_payload"];

/** 예약 raw_payload 에서 `keys` 중 어느 이름으로든 처음 나오는 비어 있지 않은 문자열/숫자 값을 읽는다. */
export function getRawPayloadString(rawPayload: RawPayload, keys: string[]): string | null {
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

/** 예약을 활성 객실 정규 키로 풀어내는 데 필요한 카탈로그 행 모양. */
export type ReservationRoomResolveInput = {
  property_name: string;
  room_label: string;
  raw_payload: RawPayload;
};

/**
 * 건물 간 externalRoomId → 정규 키 맵을 만든다. property 이름 불일치를 처리한다
 * (예: Beds24 "荒木町A" 가 정규 "아라키초A" 로 정규화되지 않는 경우); externalRoomId 는 전역에서 고유하다.
 */
export function buildGlobalExternalRoomToCanonical(
  catalog: ActiveRoomCatalogItem[],
): Map<string, string> {
  return new Map(
    catalog
      .filter((item) => item.externalRoomId !== null)
      .map((item) => [item.externalRoomId as string, item.canonicalRoomLabel]),
  );
}

/**
 * 예약을 활성 객실의 **내부 정규 키**(예: "402_2")로 풀어낸다. 없으면 null.
 *
 * 예약 캘린더와 작업 컨텍스트 선택기가 공유하는 단일 진실 공급원으로, 둘이
 * 어긋나지 않게 한다. 캘린더의 해석 우선순위를 따른다:
 *   raw_payload 객실/유닛 id → raw_payload 유닛 이름 → 예약 room_label (정확 일치 후 정규화 일치).
 * 확정 모드(객실 마스터 분류됨)에서는 풀리지 않은 id/라벨이 예약을 제외하고,
 * 임시 모드에서는 정규화된 room_label 로 대체한다.
 *
 * 하위 호실을 합치려면 `getDisplayRoomLabel(canonicalProperty, <결과>)` 를 쓴다 (402 / 402_2 → 402).
 */
export function resolveReservationCanonicalRoomLabel(
  item: ReservationRoomResolveInput,
  opts: {
    lookups: PropertyRoomLookups;
    globalExternalRoomToCanonical: Map<string, string>;
    isAuthoritative: boolean;
  },
): string | null {
  const { lookups, globalExternalRoomToCanonical, isAuthoritative } = opts;
  const canonicalPropertyName = getCanonicalPropertyName(item.property_name);
  const allowed = lookups.allowedCanonicalByProperty[canonicalPropertyName] ?? new Set<string>();
  const rawLabelMap = lookups.canonicalByRawLabel[canonicalPropertyName] ?? {};
  const externalIdMap = lookups.canonicalByExternalId[canonicalPropertyName] ?? {};

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
      externalIdMap[payloadUnitId] ?? globalExternalRoomToCanonical.get(payloadUnitId) ?? null;
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
      externalIdMap[payloadUnitId] ?? globalExternalRoomToCanonical.get(payloadUnitId) ?? null;
    const resolved = acceptCanonical(fromExternal);
    if (resolved) return resolved;
  }

  return normalizedRoomLabel;
}

// 회사 내부 규칙: minimum_stay 가 이 기준 이상인 Beds24 객실 ID 는 그 기간 동안 비활성이며
// 객실 축, 오늘 빈 객실 수, 운영 목록에서 제외해야 한다.
// 전체 규칙 문서는 docs/engineering/01-beds24-integration.md 참고.
export const BEDS24_INACTIVE_MIN_STAY_THRESHOLD = 50;

export function isInactiveBeds24Room(minimumStay: number): boolean {
  return minimumStay >= BEDS24_INACTIVE_MIN_STAY_THRESHOLD;
}

export type ActiveRoomCatalogItem = {
  /** 예약 매칭에 쓰는 내부 키. 서로 다른 물리 객실을 절대 합치지 않는다. */
  canonicalRoomLabel: string;
  /** 캘린더 행의 표시 라벨. 아라키초 하위 호실은 _N 접미사를 뗀다. */
  displayRoomLabel: string;
  externalRoomId: string | null;
  propertyName: string;
  roomLabel: string;
  /** rooms.id — 물리 객실 행의 UUID (컨텍스트 연결용). */
  roomId: string;
  /** rooms.property_id — 소유 property 의 UUID (컨텍스트 연결용). */
  propertyId: string;
};

export type PropertyRoomLookups = {
  allowedCanonicalByProperty: Record<string, Set<string>>;
  canonicalByExternalId: Record<string, Record<string, string>>;
  canonicalByRawLabel: Record<string, Record<string, string>>;
};

export function buildPropertyRoomLookups(
  catalog: ActiveRoomCatalogItem[],
): PropertyRoomLookups {
  const allowedCanonicalByProperty: Record<string, Set<string>> = {};
  const canonicalByExternalId: Record<string, Record<string, string>> = {};
  const canonicalByRawLabel: Record<string, Record<string, string>> = {};

  for (const item of catalog) {
    const { canonicalRoomLabel, propertyName, roomLabel } = item;

    if (!allowedCanonicalByProperty[propertyName]) {
      allowedCanonicalByProperty[propertyName] = new Set<string>();
    }
    allowedCanonicalByProperty[propertyName].add(canonicalRoomLabel);

    if (!canonicalByRawLabel[propertyName]) {
      canonicalByRawLabel[propertyName] = {};
    }
    const labelMap = canonicalByRawLabel[propertyName];
    labelMap[roomLabel] = canonicalRoomLabel;

    const normalizedLabel = getCanonicalRoomLabel(propertyName, roomLabel);
    if (normalizedLabel) {
      labelMap[normalizedLabel] = canonicalRoomLabel;
    }
  }

  for (const item of catalog) {
    if (!item.externalRoomId) continue;
    if (!canonicalByExternalId[item.propertyName]) {
      canonicalByExternalId[item.propertyName] = {};
    }
    canonicalByExternalId[item.propertyName][item.externalRoomId] = item.canonicalRoomLabel;
  }

  return {
    allowedCanonicalByProperty,
    canonicalByExternalId,
    canonicalByRawLabel,
  };
}

function warnDuplicateCanonicalRoomKeys(catalog: ActiveRoomCatalogItem[]) {
  if (process.env.NODE_ENV !== "development") return;

  const seen = new Map<string, string>();
  for (const item of catalog) {
    const dedupeKey = `${item.propertyName}::${item.canonicalRoomLabel}`;
    const previous = seen.get(dedupeKey);
    if (previous && previous !== item.roomLabel) {
      console.warn("[rooms] duplicate canonical room key from different room_label rows", {
        dedupeKey,
        previousRoomLabel: previous,
        nextRoomLabel: item.roomLabel,
        externalRoomId: item.externalRoomId,
      });
    }
    seen.set(dedupeKey, item.roomLabel);
  }
}

// 조직의 모든 활성 객실의 room_label 목록을 반환한다.
// "활성" = status='active' AND:
//   - Beds24 가 아닌 객실, 또는
//   - 최소 숙박 값이 비활성 기준 미만으로 명시된 Beds24 객실.
//
// external_minimum_stay = null 인 Beds24 행은 의도적으로 제외한다.
// 우리 회사 규칙은 활성/비활성 객실 ID 를 가르려면 minimum_stay 가 필요하므로
// "알 수 없음" 을 활성 재고로 취급해서는 안 된다.
//
// 조직에 분류된 객실 마스터 행이 아직 없으면 undefined 를 반환한다.
// "분류됨" 의 의미:
//   - Beds24 가 아닌 객실 행, 또는
//   - external_minimum_stay 가 있는 Beds24 객실 행.
// 분류된 객실 마스터 행이 있으면 string[] (빈 배열 포함)을 반환한다.
// 캘린더 컴포넌트는 undefined 와 string[] 로 임시/확정 모드를 전환한다.
export async function getActiveRoomLabels(
  organizationId: string,
  supabase: SupabaseClient<Database>,
): Promise<string[] | undefined> {
  const catalog = await getActiveRoomCatalog(organizationId, supabase);
  if (catalog === undefined) {
    return undefined;
  }

  return [...new Set(catalog.map((item) => item.roomLabel))];
}

// 이미 클라이언트를 가지고 있지 않은 RSC/서버 액션 컨텍스트용 편의 래퍼.
export async function getActiveRoomCatalogServer(
  organizationId: string,
): Promise<ActiveRoomCatalogItem[] | undefined> {
  const supabase = await getSupabaseServerClient();
  return getActiveRoomCatalog(organizationId, supabase);
}

export type ActiveRoomCatalogOptions = {
  /**
   * 현장 운영에서 빠진 건물(`isExcludedOperationalProperty` — 현재 **사노**)도 포함한다.
   *
   * 청소·예약 캘린더가 사노를 빼는 것은 **현장 운영 기준**이다. 그런데 사노는 예약 338건에
   * 2027-05-03 까지 잡혀 있는 **파는 건물**이라, 판매 캘린더에서 빠지면 그 방은 가격을 고칠
   * 방법이 없어진다(2026-09-17 사용자 결정). 저쪽 프로젝트도 캘린더에는 사노를 두고 매출에서만
   * 뺀다.
   *
   * **객실 단위 제외(`isExcludedOperationalRoom`)는 이 옵션과 무관하게 계속 적용된다** —
   * 다카다노바바 `401_2` 는 숨긴 채로 둔다(같은 날 결정).
   */
  includeNonOperationalProperties?: boolean;
};

/** `rooms` 한 행 — 카탈로그 판정과 판매 캘린더(유닛 → 행 매핑)가 같이 쓰는 모양. */
export type RoomCatalogRow = {
  id: string;
  property_id: string;
  properties: { name: string } | { name: string }[] | null;
  external_room_id: string | null;
  room_label: string;
  status: Database["public"]["Enums"]["room_status"];
  external_provider: string | null;
  external_minimum_stay: number | null;
};

const ROOM_CATALOG_SELECT =
  "id, property_id, room_label, external_room_id, status, external_provider, external_minimum_stay, properties(name)";
const ROOM_CATALOG_PAGE_SIZE = 1000;

/**
 * 조직의 `rooms` 전부(운영 종료 포함)를 읽는다. **판정은 하지 않는다** — `buildActiveRoomCatalog` 가 한다.
 *
 * 판매 캘린더는 같은 행으로 카탈로그와 「유닛 → 캘린더 행」 매핑을 둘 다 만든다 — 예전에는 `rooms` 를
 * 두 번 읽었다(2026-09-30 속도). PostgREST 1,000행 제한에 걸리지 않게 쪽을 나눠 읽는다.
 */
export function fetchRoomCatalogRows(
  organizationId: string,
  supabase: SupabaseClient<Database>,
): Promise<RoomCatalogRowsResult> {
  const slot = roomCatalogRowsSlot(organizationId);
  slot.current ??= readRoomCatalogRows(organizationId, supabase);
  return slot.current;
}

type RoomCatalogRowsResult = { data: RoomCatalogRow[]; error: { message: string } | null };

// 한 렌더 안에서 여러 화면 조각(카탈로그 · 라벨 · 판매 캘린더 매핑 · 링크)이 같은 조직의 `rooms` 를 각자 읽는다 —
// 요청당 한 번으로 접는다. 키는 조직 id 하나다: 호출하는 쪽이 모두 세션 조직(구성원이라 RLS 로도 조직 전체가
// 보인다)이라 사용자 · service 클라이언트 결과가 같다. 렌더 밖(cron · 웹훅)에서는 `cache()` 가 매번 새로 읽는다.
// 돌려준 행 배열은 읽기만 한다(공유된다).
const roomCatalogRowsSlot = cache(
  (organizationId: string): { organizationId: string; current: Promise<RoomCatalogRowsResult> | null } => ({
    organizationId,
    current: null,
  }),
);

async function readRoomCatalogRows(
  organizationId: string,
  supabase: SupabaseClient<Database>,
): Promise<RoomCatalogRowsResult> {
  const rows: RoomCatalogRow[] = [];
  for (let offset = 0; ; offset += ROOM_CATALOG_PAGE_SIZE) {
    const page = await supabase
      .from("rooms")
      .select(ROOM_CATALOG_SELECT)
      .eq("organization_id", organizationId)
      .order("id", { ascending: true })
      .range(offset, offset + ROOM_CATALOG_PAGE_SIZE - 1);
    if (page.error) return { data: rows, error: page.error };
    const batch = (page.data ?? []) as unknown as RoomCatalogRow[];
    rows.push(...batch);
    if (batch.length < ROOM_CATALOG_PAGE_SIZE) return { data: rows, error: null };
  }
}

export async function getActiveRoomCatalog(
  organizationId: string,
  supabase: SupabaseClient<Database>,
  options: ActiveRoomCatalogOptions = {},
): Promise<ActiveRoomCatalogItem[] | undefined> {
  const result = await fetchRoomCatalogRows(organizationId, supabase);

  if (result.error) {
    console.error("[rooms] getActiveRoomLabels query error", result.error);
    return undefined;
  }

  return buildActiveRoomCatalog(result.data, options);
}

/** 읽어 온 `rooms` 행 → 활성 객실 카탈로그. 행이 하나도 없으면 `undefined`(판정 전 상태). */
export function buildActiveRoomCatalog(
  rows: RoomCatalogRow[],
  options: ActiveRoomCatalogOptions = {},
): ActiveRoomCatalogItem[] | undefined {
  // 객실 행이 존재하기만 하면 "분류됨" (조직에 쓸 수 있는 객실 마스터가 있음)으로 센다.
  // minStay = null 이라도 더는 beds24 객실을 탈락시키지 않는다 — 알 수 없는 최소 숙박이 실제
  // 객실을 숨겨서는 안 된다. 명시적으로 >= 50 일 때만 비활성으로 본다 (아래 활성 필터에서 적용).
  const classifiedRows = rows;

  if (classifiedRows.length === 0) {
    return undefined;
  }

  const catalog = classifiedRows
    .filter((row) => {
      if (row.status !== "active") {
        return false;
      }
      const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
      const propertyName = getCanonicalPropertyName(property?.name?.trim() || "Unknown");
      if (!options.includeNonOperationalProperties && isExcludedOperationalProperty(propertyName)) {
        return false;
      }
      if (isExcludedOperationalRoom(propertyName, row.room_label)) {
        return false;
      }
      if (row.external_provider !== "beds24") {
        return true;
      }
      // null minStay → 활성 (알 수 없음, 아직 재고 동기화 전). 명시적으로
      // >= 50 일 때만 비활성으로 본다 (room-sync.ts 의 classifyBeds24Room 과 같음).
      return (
        row.external_minimum_stay === null ||
        !isInactiveBeds24Room(row.external_minimum_stay)
      );
    })
    .map((row) => {
      const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
      const propertyName = getCanonicalPropertyName(property?.name?.trim() || "Unknown");
      const canonicalRoomLabel = getCanonicalRoomLabel(propertyName, row.room_label);
      return {
        canonicalRoomLabel,
        displayRoomLabel: getDisplayRoomLabel(propertyName, canonicalRoomLabel),
        externalRoomId: row.external_room_id,
        propertyName,
        roomLabel: row.room_label,
        roomId: row.id,
        propertyId: row.property_id,
      };
    });

  warnDuplicateCanonicalRoomKeys(catalog);
  return catalog;
}
