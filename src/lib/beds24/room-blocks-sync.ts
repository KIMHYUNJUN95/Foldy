import type { SupabaseClient } from "@supabase/supabase-js";
import { beds24Fetch } from "@/lib/beds24/credit-ledger";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import type { Database } from "@/types/database";
import { signalBeds24Change } from "@/lib/beds24/live-signal";
import { tokyoDateOf } from "@/lib/tokyo-date";

/**
 * Beds24 캘린더 「블락」을 가져온다 (2026-09-11).
 *
 * ## 블락은 예약이 아니다
 *
 * Beds24 캘린더에서 객실을 막으면 채널 판매가 멈춘다. 그 표현은 **인벤토리 오버라이드**다 —
 * `GET /inventory/rooms/calendar?includeOverride=true` 의 `override` 가 `blackout` 이 된다.
 * 명세 enum: `none | blackout | exception | noCheckIn | noCheckOut | noCheckInOrCheckOut`.
 *
 * Beds24 에는 `status: "black"` 예약으로 막는 길도 있지만 이 계정은 쓰지 않는다(전 기간 조회
 * 0건). 그래서 블락은 `/bookings` 로 **절대 들어오지 않는다** — 우리 캘린더에 안 보이던 이유다.
 *
 * ## `numAvail` 로는 안 된다
 *
 * 같은 응답의 `numAvail: 0` 은 「팔 수 없음」이라 **예약이 차 있어도 0** 이다. 실측으로 확인했다
 * (O103 2026-09월: 빈 밤 15·23·24 만 `numAvail: 1`, 나머지는 전부 예약분). 그래서 판별은
 * `override === "blackout"` 하나로만 한다.
 *
 * ## 끝이 열린 blackout 은 버린다
 *
 * 조회 구간 끝까지 이어지는 blackout 은 「차단」이 아니라 **판매를 아직 안 연 기간**인 경우가
 * 많다. 실제로 2026-09-11 기준 여러 건물이 2027-03-01 부터 같은 모양으로 잡혀 있었다. 그것까지
 * 그리면 그 달이 통째로 빗금이 되어 진짜 차단이 묻힌다. 그래서 **구간의 끝이 조회 끝에 닿으면
 * 건너뛴다.** 판매 기간을 늘리면 자연히 사라질 값이지 운영자가 알아야 할 차단이 아니다.
 *
 * ## 예약과 겹치는 것은 정상이다
 *
 * 채널 판매를 막아 두고(blackout) 그 자리에 수기 예약을 넣는 운영이 실제로 쓰인다(2026-09-23
 * O202·O203). 겹친다고 해서 블락이 아닌 게 아니므로 예약과 대조해 걸러내지 않는다.
 *
 * 도메인 계약: docs/product/15-reservation-calendar.md
 */

type JsonRecord = Record<string, unknown>;

type Beds24AccessTokenState = { ok: true; token: string } | { ok: false; skipped: string };

export type RoomBlockSyncResult = {
  /** Beds24 에서 읽은 건물 수. */
  properties: number;
  /** `override === "blackout"` 로 잡힌 구간 수(열린 꼬리 제외 후). */
  blocks: number;
  /** 판매 미오픈으로 보고 버린 열린 꼬리 구간 수. */
  openEndedSkipped: number;
  /** 방 마스터에서 방 이름을 못 찾아 버린 구간 수. */
  unresolvedRooms: number;
  /** 이번 창에서 사라져 삭제한 기존 구간 수. */
  removed: number;
  skipped: string[];
};

let cachedBeds24AccessToken: { token: string; expiresAt: number } | null = null;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
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

async function resolveBeds24AccessToken(): Promise<Beds24AccessTokenState> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) return { ok: false, skipped: "room-blocks:missing-env" };
  if (env.accessToken) return { ok: true, token: env.accessToken };
  if (!env.refreshToken) return { ok: false, skipped: "room-blocks:missing-token" };

  if (cachedBeds24AccessToken && cachedBeds24AccessToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cachedBeds24AccessToken.token };
  }

  try {
    const response = await beds24Fetch(`${env.baseUrl.replace(/\/$/, "")}/authentication/token`, {
      headers: { accept: "application/json", refreshToken: env.refreshToken },
      cache: "no-store",
    }, { feature: "auth", action: "token.refresh", job: "room_blocks_sync" });
    if (!response.ok) {
      return {
        ok: false,
        skipped:
          response.status === 401 || response.status === 403
            ? "room-blocks:refresh-token-invalid"
            : `room-blocks:refresh-http-${response.status}`,
      };
    }
    const json = (await response.json()) as { token?: unknown; expiresIn?: unknown };
    const token = typeof json.token === "string" && json.token.trim().length > 0 ? json.token.trim() : null;
    if (!token) return { ok: false, skipped: "room-blocks:refresh-missing-token" };
    const expiresIn = typeof json.expiresIn === "number" && Number.isFinite(json.expiresIn) ? json.expiresIn : 3600;
    cachedBeds24AccessToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return { ok: true, token };
  } catch {
    return { ok: false, skipped: "room-blocks:refresh-request-error" };
  }
}

/** 예약 백필과 같은 운영 창을 쓴다 — 당월 1일부터 2개월 뒤 1일 전날까지. */
export function buildRoomBlockWindow(now = new Date()): { from: string; to: string } {
  const [year, monthNumber] = (tokyoDateOf(now.toISOString()) as string).split("-").map(Number);
  const month = monthNumber - 1;
  // 도쿄 달력의 연·월을 받은 뒤의 UTC 는 시간대가 아니라 달력 계산용이다.
  const from = new Date(Date.UTC(year, month, 1));
  // 2개월 뒤 1일의 전날 = 창의 마지막 날(포함).
  const to = new Date(Date.UTC(year, month + 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

type FetchedBlock = {
  externalPropertyId: string;
  externalRoomId: string;
  beds24RoomName: string;
  startDate: string;
  endDate: string;
};

type FetchOutcome = {
  blocks: FetchedBlock[];
  properties: number;
  openEndedSkipped: number;
  skipped: string[];
  /** 끝까지 읽은 건물(Beds24 `propertyId`). 지우고 다시 넣는 범위는 **이 건물들로만** 한정한다. */
  fetchedPropertyIds: string[];
};

export type BlockIdentity = {
  organization_id: string;
  property_name: string;
  external_room_id: string | null;
  start_date: string;
  end_date: string;
};

/** 지운 것과 넣은 것 중 **한쪽에만 있는** 블락 — **순수 함수**. 비면 아무것도 안 바뀌었다. */
export function diffBlockSets(
  removed: ReadonlyArray<BlockIdentity>,
  inserted: ReadonlyArray<BlockIdentity>,
): BlockIdentity[] {
  const keyOf = (block: BlockIdentity) =>
    [block.organization_id, block.property_name, block.external_room_id ?? "", block.start_date, block.end_date].join("|");
  const removedKeys = new Set(removed.map(keyOf));
  const insertedKeys = new Set(inserted.map(keyOf));
  return [
    ...removed.filter((block) => !insertedKeys.has(keyOf(block))),
    ...inserted.filter((block) => !removedKeys.has(keyOf(block))),
  ];
}

/** 캘린더 응답 쪽 수 상한 — `room-rates-sync.ts` 와 같다. 넘으면 그 건물은 못 읽은 것으로 본다. */
const CALENDAR_MAX_PAGES = 20;

/**
 * 지워도 되는 건물 이름 — **순수 함수**.
 *
 * 창 안의 블락을 지우고 다시 넣으므로, 끝까지 읽지 못한 건물을 지우면 그 건물의 차단 표시가 다시
 * 들어오지 않고 사라진다. 끝까지 읽은 건물의 이름만 돌려준다. 좁힌 건물(`only`)이 있으면 그 안에서만.
 */
export function resolveBlockDeleteScope(args: {
  fetchedPropertyIds: ReadonlyArray<string>;
  propertyNameByExternalId: ReadonlyMap<string, string>;
  only?: ReadonlySet<string>;
}): string[] {
  const names = new Set<string>();
  for (const id of args.fetchedPropertyIds) {
    if (args.only && !args.only.has(id)) continue;
    const name = args.propertyNameByExternalId.get(id);
    if (name) names.add(name);
  }
  return [...names];
}

async function fetchBlackoutSegments(
  window: { from: string; to: string },
  onlyPropertyIds?: ReadonlySet<string>,
): Promise<FetchOutcome> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    return {
      blocks: [],
      fetchedPropertyIds: [],
      openEndedSkipped: 0,
      properties: 0,
      skipped: ["room-blocks:missing-env"],
    };
  }

  const tokenState = await resolveBeds24AccessToken();
  if (!tokenState.ok) {
    return { blocks: [], fetchedPropertyIds: [], openEndedSkipped: 0, properties: 0, skipped: [tokenState.skipped] };
  }

  const base = env.baseUrl.replace(/\/$/, "");
  const headers = { accept: "application/json", token: tokenState.token };

  // 건물 목록을 먼저 받는다. 캘린더는 건물 단위로만 물어볼 수 있어서, 방을 하나씩 도는 것보다
  // 요청 수가 훨씬 적다(= Beds24 크레딧을 덜 쓴다). **건물이 정해져 있으면(웹훅) 목록을 건너뛴다.**
  let propertyRows: unknown[];
  if (onlyPropertyIds && onlyPropertyIds.size > 0) {
    propertyRows = [...onlyPropertyIds].map((id) => ({ id }));
  } else {
    const propertiesResponse = await beds24Fetch(`${base}/properties?includeAllRooms=false`, {
      headers,
      cache: "no-store",
    }, { feature: "rooms_sync", action: "properties.get", job: "room_blocks_sync" });
    if (!propertiesResponse.ok) {
      return {
        blocks: [],
        fetchedPropertyIds: [],
        openEndedSkipped: 0,
        properties: 0,
        skipped: [`room-blocks:properties-http-${propertiesResponse.status}`],
      };
    }
    const propertiesRoot = asRecord(await propertiesResponse.json());
    propertyRows = Array.isArray(propertiesRoot?.data) ? propertiesRoot.data : [];
  }

  const blocks: FetchedBlock[] = [];
  const skipped: string[] = [];
  const fetchedPropertyIds: string[] = [];
  let openEndedSkipped = 0;
  let properties = 0;

  for (const propertyValue of propertyRows) {
    const property = asRecord(propertyValue);
    const externalPropertyId = property ? readString(property, ["id", "propertyId"]) : null;
    if (!externalPropertyId) continue;
    properties++;

    const url =
      `${base}/inventory/rooms/calendar?propertyId=${externalPropertyId}` +
      `&startDate=${window.from}&endDate=${window.to}&includeNumAvail=true&includeOverride=true` +
      // 매번 다른 주소로 — 같은 주소에 옛 응답이 돌아온 정황(2026-09-30, `recent-write-guard.ts`).
      `&_ts=${Date.now()}`;

    // `pages.nextPageExists` 를 끝까지 따라간다. 도중에 실패하거나 상한에 걸리면 **그 건물 전체를**
    // 못 읽은 것으로 본다 — 반만 읽고 지우면 뒤쪽 블락이 사라진다.
    const rooms: unknown[] = [];
    let nextUrl: string | null = url;
    let pageCount = 0;
    let failure: string | null = null;
    try {
      while (nextUrl) {
        if (pageCount >= CALENDAR_MAX_PAGES) {
          failure = "paging-capped";
          break;
        }
        const response: Response = await beds24Fetch(nextUrl, { headers, cache: "no-store" }, { feature: "rates_read", action: "calendar.get", job: "room_blocks_sync" });
        if (!response.ok) {
          failure = `http-${response.status}`;
          break;
        }
        const root = asRecord(await response.json());
        pageCount++;
        if (Array.isArray(root?.data)) rooms.push(...root.data);
        const paging = root ? asRecord(root.pages) : null;
        nextUrl = paging?.nextPageExists === true ? readString(paging, ["nextPageLink"]) : null;
        if (paging?.nextPageExists === true && !nextUrl) failure = "paging-no-link";
      }
    } catch (error) {
      console.error("[beds24/room-blocks] calendar fetch failed", { externalPropertyId, error });
      failure = "request-error";
    }
    if (failure) {
      skipped.push(`room-blocks:calendar-${externalPropertyId}-${failure}`);
      continue;
    }
    fetchedPropertyIds.push(externalPropertyId);

    for (const roomValue of rooms) {
      const room = asRecord(roomValue);
      if (!room) continue;
      const externalRoomId = readString(room, ["roomId", "id"]);
      const beds24RoomName = readString(room, ["name", "roomName"]) ?? externalRoomId ?? "";
      if (!externalRoomId) continue;

      const calendar = Array.isArray(room.calendar) ? room.calendar : [];
      for (const segmentValue of calendar) {
        const segment = asRecord(segmentValue);
        if (!segment) continue;
        if (readString(segment, ["override"]) !== "blackout") continue;

        const startDate = readString(segment, ["from"]);
        const endDate = readString(segment, ["to"]);
        if (!startDate || !endDate) continue;

        // 조회 끝에 닿는 구간은 「판매 미오픈」이지 차단이 아니다. 위 주석 참고.
        if (endDate >= window.to) {
          openEndedSkipped++;
          continue;
        }

        blocks.push({ externalPropertyId, externalRoomId, beds24RoomName, startDate, endDate });
      }
    }
  }

  return { blocks, fetchedPropertyIds, properties, openEndedSkipped, skipped };
}

/**
 * Beds24 블락을 `room_blocks` 에 반영한다.
 *
 * 창 안의 기존 행을 **전부 지우고 다시 넣는다.** 블락은 예약과 달리 「취소」 이벤트가 없다 —
 * Beds24 에서 풀면 응답에서 그냥 사라진다. 그래서 upsert 만 하면 **한번 생긴 블락이 영원히 남는다.**
 * 창 단위 교체가 그 문제를 원천적으로 없앤다(행 수가 적어 비용도 무시할 만하다).
 */
export async function syncBeds24RoomBlocks(
  supabase: SupabaseClient<Database>,
  options?: {
    organizationId?: string;
    now?: Date;
    /**
     * 이 건물만 — 재고 웹훅이 한 건물을 가리킬 때(2026-09-29). 지우고 다시 넣는 범위도 이 건물로
     * 좁힌다. 없으면 전 건물(정합성 크론).
     */
    externalPropertyIds?: string[];
  },
): Promise<RoomBlockSyncResult> {
  const window = buildRoomBlockWindow(options?.now);
  const only = options?.externalPropertyIds?.length
    ? new Set(options.externalPropertyIds.map(String))
    : undefined;
  const fetched = await fetchBlackoutSegments(window, only);

  const result: RoomBlockSyncResult = {
    properties: fetched.properties,
    blocks: 0,
    openEndedSkipped: fetched.openEndedSkipped,
    unresolvedRooms: 0,
    removed: 0,
    skipped: [...fetched.skipped],
  };

  // Beds24 roomId → (organization, property_name, room_label). 방 마스터가 유일한 기준이다 —
  // 여기서 못 찾는 방은 애초에 우리 캘린더에 행이 없으므로 블락을 그릴 자리도 없다.
  let roomQuery = supabase
    .from("rooms")
    .select("organization_id, external_room_id, room_label, properties(name, external_property_id)")
    .eq("external_provider", "beds24")
    .not("external_room_id", "is", null);
  if (options?.organizationId) {
    roomQuery = roomQuery.eq("organization_id", options.organizationId);
  }
  const roomResult = await roomQuery;
  if (roomResult.error) {
    result.skipped.push(`room-blocks:rooms-${roomResult.error.message}`);
    return result;
  }

  type RoomRow = {
    organization_id: string;
    external_room_id: string | null;
    room_label: string;
    properties:
      | { name: string; external_property_id: string | null }
      | { name: string; external_property_id: string | null }[]
      | null;
  };
  const roomMap = new Map<string, { organizationId: string; propertyName: string; roomLabel: string }>();
  /** 지울 범위를 정할 때 쓴다 — `room_blocks` 는 건물 **이름**으로 저장돼 있다. */
  const propertyNameByExternalId = new Map<string, string>();
  for (const row of (roomResult.data ?? []) as RoomRow[]) {
    if (!row.external_room_id) continue;
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    if (!property?.name) continue;
    if (property.external_property_id) {
      propertyNameByExternalId.set(String(property.external_property_id), property.name);
    }
    roomMap.set(row.external_room_id, {
      organizationId: row.organization_id,
      propertyName: property.name,
      roomLabel: row.room_label,
    });
  }

  const deletePropertyNames = resolveBlockDeleteScope({
    fetchedPropertyIds: fetched.fetchedPropertyIds,
    only,
    propertyNameByExternalId,
  });
  const deletable = new Set(deletePropertyNames);

  const rows: Database["public"]["Tables"]["room_blocks"]["Insert"][] = [];
  for (const block of fetched.blocks) {
    const room = roomMap.get(block.externalRoomId);
    if (!room) {
      result.unresolvedRooms++;
      continue;
    }
    // 지우지 않는 건물에 넣으면 같은 블락이 겹겹이 쌓인다.
    if (!deletable.has(room.propertyName)) continue;
    rows.push({
      organization_id: room.organizationId,
      source: "beds24",
      property_name: room.propertyName,
      room_label: room.roomLabel,
      external_room_id: block.externalRoomId,
      start_date: block.startDate,
      end_date: block.endDate,
      override_kind: "blackout",
      synced_at: new Date().toISOString(),
    });
  }
  result.blocks = rows.length;

  // 끝까지 읽은 건물만 지우고 다시 넣는다. 못 읽은 건물(토큰·HTTP·쪽 넘김 실패)의 기존 블락은
  // 그대로 둔다 — 빈 결과와 「못 읽음」을 구분하지 않으면 장애 한 번에 차단 표시가 사라진다.
  // 이름을 하나도 못 찾았으면 **아무것도 지우지 않는다**(조건 없이 지우면 전 건물이 지워진다).
  if (deletePropertyNames.length === 0) return result;

  let deleteQuery = supabase
    .from("room_blocks")
    .delete()
    .eq("source", "beds24")
    .gte("start_date", window.from)
    .lte("start_date", window.to)
    .in("property_name", deletePropertyNames);
  if (options?.organizationId) {
    deleteQuery = deleteQuery.eq("organization_id", options.organizationId);
  }
  const deleteResult = await deleteQuery.select(
    "organization_id, property_name, external_room_id, start_date, end_date",
  );
  if (deleteResult.error) {
    result.skipped.push(`room-blocks:delete-${deleteResult.error.message}`);
    return result;
  }
  result.removed = (deleteResult.data ?? []).length;

  if (rows.length > 0) {
    const insertResult = await supabase.from("room_blocks").insert(rows);
    if (insertResult.error) {
      result.skipped.push(`room-blocks:insert-${insertResult.error.message}`);
      result.blocks = 0;
    }
  }

  // 지우고 다시 넣으므로 행 수로는 바뀌었는지 모른다. **구간이 달라진 블락이 있을 때만** 알린다 —
  // 매번 알리면 열려 있는 화면이 동기화마다 괜히 다시 읽는다.
  const changed = diffBlockSets(
    (deleteResult.data ?? []) as BlockIdentity[],
    result.blocks > 0 ? (rows as BlockIdentity[]) : [],
  );
  if (changed.length > 0) {
    await signalBeds24Change(new Set(changed.map((block) => block.organization_id)), "blocks", {
      from: changed.reduce((min, block) => (block.start_date < min ? block.start_date : min), changed[0].start_date),
      propertyNames: [...new Set(changed.map((block) => block.property_name))],
      to: changed.reduce((max, block) => (block.end_date > max ? block.end_date : max), changed[0].end_date),
    });
  }

  return result;
}
