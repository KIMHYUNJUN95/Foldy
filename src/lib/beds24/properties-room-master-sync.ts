import type { SupabaseClient } from "@supabase/supabase-js";
import { beds24Fetch } from "@/lib/beds24/credit-ledger";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import {
  type Beds24PropertyRoomSnapshot,
  syncBeds24PropertyRoomSnapshotForOrganization,
} from "@/lib/beds24/room-sync";
import type { Database } from "@/types/database";

type JsonRecord = Record<string, unknown>;

type Beds24AccessTokenState =
  | { ok: true; token: string }
  | { ok: false; skipped: string };

export type Beds24RoomMasterBackfillOrgResult = {
  activeRooms: number;
  inactiveRooms: number;
  organizationId: string;
  processedProperties: number;
  processedRooms: number;
  skipped: string[];
};

export type Beds24RoomMasterBackfillResult = {
  organizations: Beds24RoomMasterBackfillOrgResult[];
  snapshotProperties: number;
  snapshotRooms: number;
  skipped: string[];
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

async function resolveBeds24AccessToken(): Promise<Beds24AccessTokenState> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    return { ok: false, skipped: "master-sync:missing-env" };
  }

  if (env.accessToken) {
    return { ok: true, token: env.accessToken };
  }

  if (!env.refreshToken) {
    return { ok: false, skipped: "master-sync:missing-token" };
  }

  if (cachedBeds24AccessToken && cachedBeds24AccessToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cachedBeds24AccessToken.token };
  }

  try {
    const response = await beds24Fetch(`${env.baseUrl.replace(/\/$/, "")}/authentication/token`, {
      method: "GET",
      headers: {
        accept: "application/json",
        refreshToken: env.refreshToken,
      },
      cache: "no-store",
    }, { feature: "auth", action: "token.refresh", job: "room_master_sync" });

    if (!response.ok) {
      return {
        ok: false,
        skipped:
          response.status === 401 || response.status === 403
            ? "master-sync:refresh-token-invalid"
            : `master-sync:refresh-http-${response.status}`,
      };
    }

    const json = (await response.json()) as { expiresIn?: unknown; token?: unknown };
    const token = typeof json.token === "string" && json.token.trim().length > 0 ? json.token.trim() : null;
    const expiresIn =
      typeof json.expiresIn === "number" && Number.isFinite(json.expiresIn) ? json.expiresIn : 3600;

    if (!token) {
      return { ok: false, skipped: "master-sync:refresh-missing-token" };
    }

    cachedBeds24AccessToken = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return { ok: true, token };
  } catch {
    return { ok: false, skipped: "master-sync:refresh-request-error" };
  }
}

/**
 * 그 방의 **가격 소스**(메인) Beds24 roomId. 자기가 소스면 `null`.
 *
 * Beds24 에서 가격은 요금제(priceRule)의 연결로 퍼진다. `priceLinking.roomId` 가 채워져
 * 있으면 **그 방의 가격은 저기서 온다**는 뜻이고, 가격을 쓸 때도 거기에 써야 한다.
 *
 * ```
 * 450096 오쿠보 2-1 (메인)  priceRules[0].priceLinking.roomId = null
 * 496532 1-13-1-2           priceRules[0].priceLinking.roomId = 450096
 * 648399 OkuboCC            priceRules[0].priceLinking.roomId = 450096
 * ```
 *
 * 저쪽은 이 표를 코드에 24줄로 박아 두었다(`BEDS24_PRICE_SOURCE_ROOM_ID`). 2026-09-24 에
 * 이 규칙으로 파생한 결과와 대조해 **24/24 일치**를 확인했으므로 박아 두지 않고 동기화한다 —
 * 박아 두면 Beds24 설정이 바뀌는 날부터 조용히 틀린 유닛에 쓴다.
 *
 * 요금제가 여럿이면 **가장 먼저 나오는 연결**을 쓴다(실측상 전부 하나뿐이고, 여럿이면
 * 경고를 남긴다).
 */
function readPriceSourceRoomId(room: JsonRecord, externalRoomId: string): string | null {
  const rules = Array.isArray(room.priceRules) ? room.priceRules : [];
  const linked = new Set<string>();
  for (const ruleValue of rules) {
    const rule = asRecord(ruleValue);
    const linking = rule ? asRecord(rule.priceLinking) : null;
    const roomId = linking ? readString(linking, ["roomId"]) : null;
    // 자기 자신을 가리키는 연결은 연결이 아니다.
    if (roomId && roomId !== externalRoomId) linked.add(roomId);
  }
  if (linked.size === 0) return null;
  if (linked.size > 1) {
    console.warn("[beds24/master-sync] multiple price links; using the first", {
      externalRoomId,
      linked: [...linked],
    });
  }
  return [...linked][0];
}

async function fetchBeds24PropertySnapshot(): Promise<
  { skipped: string[]; snapshot: Beds24PropertyRoomSnapshot[] } | { skipped: string[]; snapshot: null }
> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    return { skipped: ["master-sync:missing-env"], snapshot: null };
  }

  const tokenState = await resolveBeds24AccessToken();
  if (!tokenState.ok) {
    return { skipped: [tokenState.skipped], snapshot: null };
  }

  // `includePriceRules` 가 있어야 가격 소스 연결이 온다 — 아래 `readPriceSourceRoomId` 참고.
  const propertiesUrl =
    `${env.baseUrl.replace(/\/$/, "")}/properties?includeAllRooms=true&includePriceRules=true`;
  try {
    const response = await beds24Fetch(propertiesUrl, {
      headers: {
        accept: "application/json",
        token: tokenState.token,
      },
      cache: "no-store",
    }, { feature: "rooms_sync", action: "properties.get", job: "room_master_sync" });

    if (!response.ok) {
      return { skipped: [`master-sync:properties-http-${response.status}`], snapshot: null };
    }

    const json = (await response.json()) as unknown;
    const root = asRecord(json);
    if (!root || !Array.isArray(root.data)) {
      return { skipped: ["master-sync:invalid-properties-response"], snapshot: null };
    }

    const snapshot: Beds24PropertyRoomSnapshot[] = [];
    for (const propertyValue of root.data) {
      const property = asRecord(propertyValue);
      if (!property) continue;

      const externalPropertyId = readString(property, ["id", "propertyId", "property_id"]);
      const propertyName =
        readString(property, ["name", "propertyName", "property_name"]) ?? externalPropertyId;
      const roomTypes = Array.isArray(property.roomTypes) ? property.roomTypes : [];

      if (!externalPropertyId || !propertyName || roomTypes.length === 0) {
        continue;
      }

      const rooms: Beds24PropertyRoomSnapshot["rooms"] = [];
      for (const roomValue of roomTypes) {
        const room = asRecord(roomValue);
        if (!room) continue;

        const externalRoomId = readString(room, ["id", "roomId", "room_id"]);
        const roomLabel = readString(room, ["name", "unitName", "roomName"]) ?? externalRoomId;
        const minimumStay = readNumber(room, [
          "minStay",
          "minimumStay",
          "minimum_stay",
          "min_stay",
          "minNights",
          "min_nights",
        ]);

        if (!externalRoomId || !roomLabel) {
          continue;
        }

        rooms.push({
          externalRoomId,
          minimumStay,
          priceSourceRoomId: readPriceSourceRoomId(room, externalRoomId),
          roomLabel,
        });
      }

      snapshot.push({
        externalPropertyId,
        propertyName,
        rooms,
      });
    }

    return { skipped: [], snapshot };
  } catch {
    return { skipped: ["master-sync:properties-request-error"], snapshot: null };
  }
}

async function getTargetOrganizationIds(
  supabase: SupabaseClient<Database>,
  organizationId?: string,
) {
  if (organizationId) {
    return [organizationId];
  }

  const result = await supabase
    .from("organizations")
    .select("id")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (result.error) {
    throw new Error(`master sync org query failed: ${result.error.message}`);
  }

  return ((result.data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

export async function backfillBeds24RoomMaster(
  supabase: SupabaseClient<Database>,
  options?: { organizationId?: string; externalPropertyIds?: string[] },
): Promise<Beds24RoomMasterBackfillResult> {
  const fetched = await fetchBeds24PropertySnapshot();
  if (!fetched.snapshot) {
    return {
      organizations: [],
      skipped: fetched.skipped,
      snapshotProperties: 0,
      snapshotRooms: 0,
    };
  }

  // 건물을 지정하면 그것만 동기화한다.
  //
  // 새 건물 하나가 열렸을 때 전 건물을 훑으면 **의도하지 않은 변경이 함께 나간다** — 다른 건물의
  // 이름이 Beds24 쪽 값으로 덮이거나 객실이 늘어난다. 실제로 2026-09-11 에 스테이아리 한 곳만
  // 채우려는데 Arakicho A 객실이 하나 함께 늘어나는 상황이 있었다. 「이 건물만」이라고 말할 수
  // 있어야 한다.
  const only = options?.externalPropertyIds?.map((id) => id.trim()).filter(Boolean);
  const snapshot = only?.length
    ? fetched.snapshot.filter((property) => only.includes(String(property.externalPropertyId)))
    : fetched.snapshot;

  if (only?.length && snapshot.length === 0) {
    return {
      organizations: [],
      skipped: [...fetched.skipped, `master-sync:no-match:${only.join(",")}`],
      snapshotProperties: 0,
      snapshotRooms: 0,
    };
  }

  const targetOrgIds = await getTargetOrganizationIds(supabase, options?.organizationId);
  const organizations: Beds24RoomMasterBackfillOrgResult[] = [];

  for (const organizationId of targetOrgIds) {
    const result = await syncBeds24PropertyRoomSnapshotForOrganization(
      organizationId,
      snapshot,
      supabase,
    );

    organizations.push({
      activeRooms: result.activeRooms,
      inactiveRooms: result.inactiveRooms,
      organizationId,
      processedProperties: result.processedProperties,
      processedRooms: result.processedRooms,
      skipped: result.skipped,
    });
  }

  // 실제로 동기화한 범위를 보고한다. 필터를 걸었는데 전체 개수를 돌려주면 「26개 중 몇 개가
  // 들어갔나」를 확인할 수 없다.
  const snapshotProperties = snapshot.length;
  const snapshotRooms = snapshot.reduce((sum, property) => sum + property.rooms.length, 0);

  return {
    organizations,
    skipped: fetched.skipped,
    snapshotProperties,
    snapshotRooms,
  };
}
