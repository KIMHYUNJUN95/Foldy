import type { SupabaseClient } from "@supabase/supabase-js";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import { classifyBeds24Room } from "@/lib/beds24/room-sync";
import { acquireBeds24Lock } from "@/lib/beds24/sync-locks";
import type { Database } from "@/types/database";

type JsonRecord = Record<string, unknown>;

type InventoryRoomMinimumStay = {
  externalRoomId: string;
  minimumStay: number;
};

type Beds24AccessTokenState =
  | {
      ok: true;
      token: string;
    }
  | {
      ok: false;
      skipped: string;
    };

type InventoryFetchResult = {
  endpointTried: string | null;
  rows: InventoryRoomMinimumStay[];
  skippedReason: string | null;
};

export type Beds24InventorySyncResult = {
  attempted: boolean;
  endpointTried: string | null;
  matchedRooms: number;
  updatedRooms: number;
  skipped: string[];
};

export type Beds24InventoryBackfillPropertyResult = {
  organizationId: string;
  propertyId: string;
  propertyName: string;
  externalPropertyId: string;
  inventorySync: Beds24InventorySyncResult;
};

export type Beds24InventoryBackfillResult = {
  targetCount: number;
  syncedCount: number;
  matchedRooms: number;
  updatedRooms: number;
  skippedTargets: number;
  properties: Beds24InventoryBackfillPropertyResult[];
};

let cachedBeds24AccessToken: { token: string; expiresAt: number } | null = null;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function readString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function readNumber(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

function toJstDateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * 캘린더 최소숙박일수 URL.
 *
 * 파라미터 이름은 Beds24 스펙(`/inventory/rooms/calendar`)을 그대로 따른다:
 * `propertyId` / `startDate` / `endDate`, 그리고 **`includeMinStay=true`가 없으면 minStay가
 * 응답에 아예 담기지 않는다**("By default no data will be returned").
 *
 * 2026-08-05 이전에는 `propId` / `from` / `to` 같은 존재하지 않는 이름을 쓰고 있어서 이 경로가
 * 한 번도 값을 돌려준 적이 없었다.
 */
function buildInventoryUrls(baseUrl: string, propId: string, date: string) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  return [
    `${normalizedBase}/inventory/rooms/calendar?propertyId=${encodeURIComponent(propId)}` +
      `&startDate=${date}&endDate=${date}&includeMinStay=true`,
  ];
}

function buildPropertiesUrl(baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  return `${normalizedBase}/properties?includeAllRooms=true`;
}

function extractInventoryRows(value: unknown, inheritedRoomId?: string): InventoryRoomMinimumStay[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractInventoryRows(item, inheritedRoomId));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const roomId = readString(record, ["unitId", "unit_id", "roomId", "room_id"]) ?? inheritedRoomId;
  const directMinimumStay = readNumber(record, [
    "minimumStay",
    "minimum_stay",
    "minStay",
    "min_stay",
    "minNights",
    "min_nights",
    "minstay",
  ]);

  const results: InventoryRoomMinimumStay[] = [];
  if (roomId && directMinimumStay !== null) {
    results.push({ externalRoomId: roomId, minimumStay: directMinimumStay });
  }

  for (const nestedKey of ["calendar", "rooms", "data", "items", "dates", "values"]) {
    if (record[nestedKey] !== undefined) {
      results.push(...extractInventoryRows(record[nestedKey], roomId));
    }
  }

  return results;
}

function extractPropertyRows(value: unknown, targetPropertyId: string): InventoryRoomMinimumStay[] {
  const root = asRecord(value);
  if (!root) {
    return [];
  }

  const data = root.data;
  if (!Array.isArray(data)) {
    return [];
  }

  const matches: InventoryRoomMinimumStay[] = [];
  for (const propertyCandidate of data) {
    const property = asRecord(propertyCandidate);
    if (!property) continue;

    const propertyId = readString(property, ["id", "propertyId", "property_id"]);
    if (propertyId !== targetPropertyId) {
      continue;
    }

    const roomTypes = property.roomTypes;
    if (!Array.isArray(roomTypes)) {
      continue;
    }

    for (const roomTypeCandidate of roomTypes) {
      const roomType = asRecord(roomTypeCandidate);
      if (!roomType) continue;
      const roomId = readString(roomType, ["id", "roomId", "room_id"]);
      const minimumStay = readNumber(roomType, [
        "minStay",
        "minimumStay",
        "minimum_stay",
        "min_stay",
        "minNights",
        "min_nights",
      ]);

      if (roomId && minimumStay !== null) {
        matches.push({ externalRoomId: roomId, minimumStay });
      }
    }
  }

  return matches;
}

async function resolveBeds24AccessToken(): Promise<Beds24AccessTokenState> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    return { ok: false, skipped: "inventory:missing-env" };
  }

  if (env.accessToken) {
    return { ok: true, token: env.accessToken };
  }

  if (!env.refreshToken) {
    return { ok: false, skipped: "inventory:missing-token" };
  }

  if (cachedBeds24AccessToken && cachedBeds24AccessToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cachedBeds24AccessToken.token };
  }

  try {
    const response = await fetch(`${env.baseUrl.replace(/\/$/, "")}/authentication/token`, {
      method: "GET",
      headers: {
        accept: "application/json",
        refreshToken: env.refreshToken,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn("[beds24/inventory] access token refresh failed", { status: response.status });
      return {
        ok: false,
        skipped:
          response.status === 401 || response.status === 403
            ? "inventory:refresh-token-invalid"
            : `inventory:refresh-http-${response.status}`,
      };
    }

    const json = (await response.json()) as { token?: unknown; expiresIn?: unknown };
    const token = typeof json.token === "string" && json.token.trim().length > 0 ? json.token.trim() : null;
    const expiresIn = typeof json.expiresIn === "number" && Number.isFinite(json.expiresIn) ? json.expiresIn : 3600;

    if (!token) {
      return { ok: false, skipped: "inventory:refresh-missing-token" };
    }

    cachedBeds24AccessToken = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return { ok: true, token };
  } catch (error) {
    console.warn("[beds24/inventory] access token refresh request error", error);
    return { ok: false, skipped: "inventory:refresh-request-error" };
  }
}

async function fetchInventoryMinimumStays(propId: string): Promise<InventoryFetchResult> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    return { endpointTried: null, rows: [], skippedReason: "inventory:missing-env" };
  }

  const accessTokenState = await resolveBeds24AccessToken();
  if (!accessTokenState.ok) {
    return { endpointTried: null, rows: [], skippedReason: accessTokenState.skipped };
  }

  const date = toJstDateString(new Date());
  const propertiesUrl = buildPropertiesUrl(env.baseUrl);
  const urls = buildInventoryUrls(env.baseUrl, propId, date);

  let lastEndpoint: string | null = propertiesUrl;
  let lastSkippedReason: string | null = null;

  // ── 1) 캘린더가 우선이다 ────────────────────────────────────────────────
  // 회사 규칙(50박 이상 = 비활성 어카운트)에서 실제로 쓰는 값은 **캘린더에 날짜별로 설정한**
  // minStay다. `/properties` 가 돌려주는 건 객실 설정의 기본값이라 번갈아 쓰는 두 어카운트가
  // 똑같이 1로 보인다 — 그래서 활성/비활성 구분이 불가능했다.
  // 스펙도 같은 말을 한다: "if these are not set in the calendar then the minimum restrictions
  // from the room will be returned" → 캘린더가 상위 소스이고 객실 설정은 그 하위 폴백이다.
  for (const url of urls) {
    lastEndpoint = url;
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          token: accessTokenState.token,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        console.warn("[beds24/inventory] calendar request failed", { url, status: response.status });
        lastSkippedReason = `inventory:http-${response.status}`;
        continue;
      }

      const json = (await response.json()) as unknown;
      const rows = extractInventoryRows(json);
      if (rows.length > 0) {
        return { endpointTried: url, rows, skippedReason: null };
      }
      lastSkippedReason = "inventory:no-calendar-min-stay-rows";
    } catch (error) {
      console.warn("[beds24/inventory] calendar request error", { url, error });
      lastSkippedReason = "inventory:request-error";
    }
  }

  // ── 2) 폴백: 객실 설정 ──────────────────────────────────────────────────
  // 캘린더가 실패하거나 값을 주지 않으면 종전과 동일하게 `/properties` 를 읽는다. 이 경로를
  // 남겨두는 이유는 회귀 방지다 — 캘린더 호출이 막혀도 동기화가 종전 수준으로는 계속 돈다.
  try {
    const response = await fetch(propertiesUrl, {
      headers: {
        accept: "application/json",
        token: accessTokenState.token,
      },
      cache: "no-store",
    });

    if (response.ok) {
      const json = (await response.json()) as unknown;
      const rows = extractPropertyRows(json, propId);
      if (rows.length > 0) {
        return {
          endpointTried: propertiesUrl,
          rows,
          skippedReason: null,
        };
      }
      lastSkippedReason = "inventory:no-property-min-stay-rows";
    } else {
      console.warn("[beds24/inventory] properties request failed", { url: propertiesUrl, status: response.status });
      lastSkippedReason = `inventory:properties-http-${response.status}`;
    }
  } catch (error) {
    console.warn("[beds24/inventory] properties request error", { url: propertiesUrl, error });
    lastSkippedReason = "inventory:properties-request-error";
  }
  lastEndpoint = propertiesUrl;

  return {
    endpointTried: lastEndpoint,
    rows: [],
    skippedReason: lastSkippedReason ?? "inventory:no-minimum-stay-rows",
  };
}

/**
 * 어느 방을 써야 하나 — **순수 함수**. 우리 표에 있는 방(`matchedRooms`) 중 최소숙박이나 상태가 실제로 다른
 * 방만 고른다. 같은 `external_room_id` 행이 여럿이면 하나라도 다르면 쓴다(예전과 같은 조건으로 전부 갱신).
 */
export function planInventoryRoomUpdates(
  minimumStayByExternalRoomId: Map<string, number>,
  currentRows: Array<{ external_room_id: string | null; external_minimum_stay: number | null; status: string }>,
): {
  matchedRooms: number;
  updates: Array<{ externalRoomId: string; minimumStay: number; status: "active" | "inactive" }>;
} {
  const rowsByExternalId = new Map<string, Array<{ external_minimum_stay: number | null; status: string }>>();
  for (const row of currentRows) {
    if (!row.external_room_id) continue;
    rowsByExternalId.set(row.external_room_id, [...(rowsByExternalId.get(row.external_room_id) ?? []), row]);
  }
  let matchedRooms = 0;
  const updates: Array<{ externalRoomId: string; minimumStay: number; status: "active" | "inactive" }> = [];
  for (const [externalRoomId, minimumStay] of minimumStayByExternalRoomId) {
    const rows = rowsByExternalId.get(externalRoomId);
    if (!rows || rows.length === 0) continue;
    matchedRooms += 1;
    const status = classifyBeds24Room(minimumStay);
    if (rows.some((row) => row.external_minimum_stay !== minimumStay || row.status !== status)) {
      updates.push({ externalRoomId, minimumStay, status });
    }
  }
  return { matchedRooms, updates };
}

/**
 * 예약 웹훅이 부르는 최소숙박 동기화의 간격 — 건물마다 이 시간에 한 번만 돈다.
 *
 * 최소숙박은 예약과 무관한 값이라 웹훅마다(하루 400~540건) Beds24 를 부를 이유가 없다. 반영은 이 간격만큼
 * 늦어질 수 있다(그 건물에 다음 예약 웹훅이 들어오는 때까지 — 예전에도 이 경로만 최소숙박을 갱신했다).
 */
export const INVENTORY_WEBHOOK_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export function inventoryWebhookSyncLockName(organizationId: string, externalPropertyId: string) {
  return `inventory_min_stay:${organizationId}:${externalPropertyId}`;
}

/**
 * 웹훅용 — 건물별 간격 제한을 건 `syncBeds24InventoryMinimumStay`.
 *
 * 간격은 `beds24_sync_locks` 의 만료 시각으로 잰다(`beds24_try_lock`, DB 한 문장). **놓지 않는다** — 만료가
 * 곧 「다음에 돌아도 되는 시각」이다. 인스턴스가 여럿이어도 한 건물에 한 번만 돈다.
 */
export async function syncBeds24InventoryMinimumStayThrottled(
  organizationId: string,
  externalPropertyId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<Beds24InventorySyncResult | null> {
  if (!externalPropertyId || !getOptionalBeds24ApiEnv()) {
    return syncBeds24InventoryMinimumStay(organizationId, externalPropertyId, supabase);
  }
  const lock = await acquireBeds24Lock(
    supabase,
    inventoryWebhookSyncLockName(organizationId, externalPropertyId),
    "beds24-webhook",
    INVENTORY_WEBHOOK_SYNC_INTERVAL_MS,
  );
  if (!lock.acquired) return null;
  return syncBeds24InventoryMinimumStay(organizationId, externalPropertyId, supabase);
}

export async function syncBeds24InventoryMinimumStay(
  organizationId: string,
  externalPropertyId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<Beds24InventorySyncResult> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    return {
      attempted: false,
      endpointTried: null,
      matchedRooms: 0,
      updatedRooms: 0,
      skipped: ["inventory:missing-env"],
    };
  }

  if (!externalPropertyId) {
    return {
      attempted: false,
      endpointTried: null,
      matchedRooms: 0,
      updatedRooms: 0,
      skipped: ["inventory:no-external-property-id"],
    };
  }

  const { endpointTried, rows, skippedReason } = await fetchInventoryMinimumStays(externalPropertyId);
  if (rows.length === 0) {
    return {
      attempted: skippedReason !== "inventory:missing-env",
      endpointTried,
      matchedRooms: 0,
      updatedRooms: 0,
      skipped: [skippedReason ?? "inventory:no-minimum-stay-rows"],
    };
  }

  const deduped = new Map<string, number>();
  for (const row of rows) {
    deduped.set(row.externalRoomId, row.minimumStay);
  }

  // 지금 값을 한 번에 읽고 **바뀐 방만** 쓴다(2026-10-19). 예전엔 웹훅마다 그 건물 방 전부(평균 10, 최대 26)를
  // 값이 같아도 하나씩 UPDATE 해서 rooms 96행에 49만 번 갱신이 쌓였다.
  const currentResult = await supabase
    .from("rooms")
    .select("external_room_id, external_minimum_stay, status")
    .eq("organization_id", organizationId)
    .eq("external_provider", "beds24")
    .in("external_room_id", [...deduped.keys()]);
  if (currentResult.error) {
    console.error("[beds24/inventory] room read failed", { error: currentResult.error });
    return {
      attempted: true,
      endpointTried,
      matchedRooms: 0,
      updatedRooms: 0,
      skipped: ["inventory:room-read-failed"],
    };
  }
  const currentRows = (currentResult.data ?? []) as Array<{
    external_room_id: string | null;
    external_minimum_stay: number | null;
    status: string;
  }>;

  const changes = planInventoryRoomUpdates(deduped, currentRows);
  const matchedRooms = changes.matchedRooms;
  let updatedRooms = 0;
  for (const { externalRoomId, minimumStay, status } of changes.updates) {
    const result = await supabase
      .from("rooms")
      .update({ external_minimum_stay: minimumStay, status })
      .eq("organization_id", organizationId)
      .eq("external_provider", "beds24")
      .eq("external_room_id", externalRoomId)
      .select("id");

    if (result.error) {
      console.error("[beds24/inventory] room update failed", { externalRoomId, minimumStay, error: result.error });
      continue;
    }
    updatedRooms += (result.data ?? []).length;
  }

  return {
    attempted: true,
    endpointTried,
    matchedRooms,
    updatedRooms,
    skipped: matchedRooms > 0 ? [] : ["inventory:no-room-match"],
  };
}

export async function backfillBeds24InventoryMinimumStay(
  supabase: SupabaseClient<Database>,
  options?: {
    organizationId?: string;
  },
): Promise<Beds24InventoryBackfillResult> {
  let query = supabase
    .from("properties")
    .select("id, organization_id, name, external_property_id")
    .eq("external_provider", "beds24")
    .not("external_property_id", "is", null)
    .order("organization_id", { ascending: true })
    .order("name", { ascending: true });

  if (options?.organizationId) {
    query = query.eq("organization_id", options.organizationId);
  }

  const propertiesResult = await query;
  if (propertiesResult.error) {
    throw new Error(`beds24 property backfill query failed: ${propertiesResult.error.message}`);
  }

  const properties = (propertiesResult.data ?? []) as Array<{
    id: string;
    organization_id: string;
    name: string;
    external_property_id: string | null;
  }>;

  const results: Beds24InventoryBackfillPropertyResult[] = [];
  let syncedCount = 0;
  let matchedRooms = 0;
  let updatedRooms = 0;
  let skippedTargets = 0;

  for (const property of properties) {
    const externalPropertyId = property.external_property_id?.trim();
    if (!externalPropertyId) {
      skippedTargets += 1;
      continue;
    }

    const inventorySync = await syncBeds24InventoryMinimumStay(
      property.organization_id,
      externalPropertyId,
      supabase,
    );

    if (inventorySync.attempted) {
      syncedCount += 1;
    }
    matchedRooms += inventorySync.matchedRooms;
    updatedRooms += inventorySync.updatedRooms;
    if (inventorySync.skipped.length > 0) {
      skippedTargets += 1;
    }

    results.push({
      organizationId: property.organization_id,
      propertyId: property.id,
      propertyName: property.name,
      externalPropertyId,
      inventorySync,
    });
  }

  return {
    targetCount: properties.length,
    syncedCount,
    matchedRooms,
    updatedRooms,
    skippedTargets,
    properties: results,
  };
}
