import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBeds24AccessToken } from "@/lib/beds24/access-token";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import { detectExternalRateChanges, type RateSnapshot } from "@/lib/beds24/external-price-changes";
import type { Database, Json } from "@/types/database";
import { signalBeds24Change } from "@/lib/beds24/live-signal";
import { tokyoDateOf, ymdShift } from "@/lib/tokyo-date";
import { findRowsContradictingRecentWrites, type RecentWrite } from "@/lib/beds24/recent-write-guard";

/**
 * Beds24 객실 × 날짜별 요금·재고를 `room_daily_rates` 로 가져온다.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md
 * 표 설계: supabase/migrations/202609170002_room_daily_rates.sql
 *
 * ## 응답은 날짜별이 아니라 **구간별**이다
 *
 * ```json
 * {"from":"2026-09-23","to":"2026-09-24","numAvail":0,"minStay":2,"maxStay":50,
 *  "override":"none","price1":23671}
 * ```
 *
 * 값이 같은 날이 이어지면 한 덩어리로 온다(2026-09-17 실측: 59구간 중 26구간이 이틀 이상).
 * **여기서 날짜 단위로 펼친다** — 캘린더 격자가 날짜 칸으로 그려지기 때문이다.
 *
 * ## `includeLinkedPrices` 가 있어야 값이 다 온다
 *
 * `includePrices=true` 만 붙이면 **그 유닛에 직접 박아 둔 값만** 온다. Beds24 에서 가격은
 * 연결(link)로 퍼지는데 — 같은 물리적 방의 다른 유닛, 그리고 채널별 파생가 — 그 연결분은
 * 별도 파라미터를 켜야 나온다. 저쪽 원본은 처음부터 둘 다 보낸다.
 *
 * 2026-09-17 실측(오쿠보C · 10/1):
 *
 * ```
 * includeLinkedPrices 없이   648399(판매 중) p1=—            450096 p1=79000 p2=— p3=—
 * includeLinkedPrices 켜고   648399(판매 중) p1=79000        450096 p1=79000 p2=116920 p3=102700
 * ```
 *
 * 없이 받으면 두 가지가 동시에 빈다 — **파생가로 파는 유닛의 가격 전부**(오쿠보C 는 10/1 에
 * 판매 유닛이 450096 → 648399 로 바뀌어서 그날부터 화면이 통째로 비었다), 그리고 **모든 방의
 * price2(부킹닷컴)·price3(대체가)** — 33,306행 전부 비어 있었다.
 *
 * ## 읽기 전용이다
 *
 * 이 모듈은 **Beds24 에 쓰지 않는다.** 병행 기간에는 쓰기를 켜지 않는다는 전체 원칙 그대로다
 * (docs/product/33-calendar-write-features.md → 「켜기 전까지 쓰지 않는다」).
 */

type JsonRecord = Record<string, unknown>;

export type RoomRatesSyncResult = {
  /** 펼쳐서 저장한 날짜 행 수. */
  rows: number;
  /** 응답에서 읽은 구간 수. */
  segments: number;
  /** 값을 받은 객실 수(우리 `rooms` 에 매칭된 것만). */
  matchedRooms: number;
  /** Beds24 는 줬지만 우리 방 마스터에 없어 버린 roomId. */
  unmatchedRoomIds: string[];
  properties: number;
  skipped: string[];
  window: { from: string; to: string };
  /** Beds24 쪽에서 바뀌어 이력에 남긴 칸 수 — 가격 · 최소숙박 · 차단(`external-price-changes.ts`). */
  externalPriceChanges: number;
};

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

function readInt(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Beds24 캘린더 응답의 쪽 수 상한. 한 건물 12개월이 여기까지 갈 일은 없지만, 없으면 응답이
 * 이상할 때 무한히 돈다.
 */
const CALENDAR_MAX_PAGES = 20;

class CalendarHttpError extends Error {
  constructor(readonly status: number) {
    super(`calendar http ${status}`);
  }
}

/**
 * `pages.nextPageExists` 를 따라 **끝까지** 읽는다.
 *
 * 저쪽 프로젝트는 이 처리가 가격 조회에만 빠져 있었고, 「잘린 뒤쪽은 조용히 사라져 영구
 * 미동기화」가 됐다고 주석에 적어 두었다. 우리는 건물 단위로 나눠 부르므로 아직 한 쪽에
 * 들어오지만, 객실이 늘면 같은 자리에서 같은 식으로 조용히 끊긴다.
 */
async function fetchCalendarPages(
  firstUrl: string,
  headers: Record<string, string>,
): Promise<JsonRecord[]> {
  const pages: JsonRecord[] = [];
  let url: string | null = firstUrl;
  while (url && pages.length < CALENDAR_MAX_PAGES) {
    const response: Response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) throw new CalendarHttpError(response.status);
    const root = asRecord(await response.json());
    if (!root) break;
    pages.push(root);
    const paging = asRecord(root.pages);
    url = paging?.nextPageExists === true ? readString(paging, ["nextPageLink"]) : null;
  }
  return pages;
}

/**
 * 기본 창 — **어제부터 12개월**.
 *
 * 가격은 몇 달 앞을 미리 잡는 일이라 판매 캘린더가 12개월 이상을 본다
 * (docs/product/32-ops-admin-area.md 「기간도 분리한다」). 어제를 포함하는 이유는 30일 뷰의
 * 시작일이 어제이기 때문이다.
 */
/** 이 시간 안에 우리 작업이 쓴 칸은 동기화 값과 어긋나면 다시 읽는다(`recent-write-guard.ts`). */
const RECENT_WRITE_GUARD_MS = 60 * 60 * 1000;

export function buildRoomRatesWindow(now = new Date()): { from: string; to: string } {
  const today = tokyoDateOf(now.toISOString()) as string;
  const [year, month, day] = today.split("-").map(Number);
  // 입력이 이미 도쿄 달력 날짜라 여기서의 UTC 는 시간대가 아니라 달력 계산용이다(`ymdShift` 와 같다).
  const to = new Date(Date.UTC(year, month - 1 + 12, day)).toISOString().slice(0, 10);
  return { from: ymdShift(today, -1), to };
}

function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const end = Date.UTC(ty, tm - 1, td);
  for (let cursor = Date.UTC(fy, fm - 1, fd); cursor <= end; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    // 한 구간이 비정상적으로 길면(응답 오류 등) 여기서 멈춘다 — 1년치를 한 구간으로 받는 일은 없다.
    if (dates.length > 400) break;
  }
  return dates;
}

/** 화면에 보이는 요금 칸의 값 — 바뀌었는지 비교하는 단위다. */
export type RateValues = {
  price1: number | null;
  price2: number | null;
  price3: number | null;
  min_stay: number | null;
  max_stay: number | null;
  num_avail: number | null;
  override_kind: string | null;
};

const RATE_VALUE_FIELDS = [
  "price1",
  "price2",
  "price3",
  "min_stay",
  "max_stay",
  "num_avail",
  "override_kind",
] as const satisfies ReadonlyArray<keyof RateValues>;

type RateRow = RateValues & {
  organization_id: string;
  room_id: string;
  stay_date: string;
  synced_at: string;
};

/**
 * 값이 **실제로 바뀐** 칸(`roomId|YYYY-MM-DD`) — **순수 함수**.
 *
 * 동기화는 같은 값을 다시 쓰는 일이 대부분이다. 쓴 행 수로 「바뀌었다」 신호를 보내면 판매 캘린더가
 * 신호 → 새로고침 → (낡았으니) 동기화 → 신호 로 끝없이 돈다. 전에 없던 칸은 바뀐 것으로 본다.
 */
export function findChangedRateCells(
  after: ReadonlyArray<RateValues & { room_id: string; stay_date: string }>,
  before: ReadonlyMap<string, RateValues>,
): Set<string> {
  const changed = new Set<string>();
  for (const row of after) {
    const key = `${row.room_id}|${row.stay_date}`;
    const previous = before.get(key);
    if (!previous || RATE_VALUE_FIELDS.some((field) => previous[field] !== row[field])) changed.add(key);
  }
  return changed;
}

export type RoomRatesSyncOptions = {
  /**
   * 이 건물만 동기화한다. 가격 웹훅이 한 건물을 가리킬 때 나머지 8곳까지 부르지 않기 위해서다.
   * 없으면 전 건물.
   */
  externalPropertyIds?: string[];
};

/**
 * @param window 없으면 `buildRoomRatesWindow()` (어제 ~ +12개월).
 */
export async function syncBeds24RoomRates(
  organizationId: string,
  supabase: SupabaseClient<Database>,
  window = buildRoomRatesWindow(),
  options: RoomRatesSyncOptions = {},
): Promise<RoomRatesSyncResult> {
  const propertyFilter = options.externalPropertyIds?.length
    ? new Set(options.externalPropertyIds.map(String))
    : null;
  const empty: RoomRatesSyncResult = {
    rows: 0,
    segments: 0,
    matchedRooms: 0,
    unmatchedRoomIds: [],
    properties: 0,
    skipped: [],
    window,
    externalPriceChanges: 0,
  };

  const env = getOptionalBeds24ApiEnv();
  if (!env) return { ...empty, skipped: ["room-rates:missing-env"] };
  // 토큰 캐시는 `access-token.ts` 가 프로세스 전체에서 하나만 들고 있다 — 모듈마다 따로 두면
  // 한 요청 안에서 갱신이 여러 번 일어나고 실패 지점이 그만큼 늘어난다.
  const tokenState = await resolveBeds24AccessToken("room-rates");
  if (!tokenState.ok) return { ...empty, skipped: [tokenState.skipped] };

  const base = env.baseUrl.replace(/\/$/, "");
  const headers = { accept: "application/json", token: tokenState.token };

  // 우리 방 마스터에 있는 roomId 만 저장한다. Beds24 가 준 방이 우리에게 없으면 **조용히 버리지
  // 않고** `unmatchedRoomIds` 에 남긴다 — 그게 곧 방 마스터가 뒤처졌다는 신호다.
  const roomsResult = await supabase
    .from("rooms")
    .select("id, external_room_id, external_price_source_room_id, room_label, properties(name)")
    .eq("organization_id", organizationId)
    .eq("external_provider", "beds24")
    .not("external_room_id", "is", null);
  if (roomsResult.error) {
    return { ...empty, skipped: [`room-rates:rooms-read-${roomsResult.error.code ?? "error"}`] };
  }
  const roomIdByExternal = new Map<string, string>();
  /** 가격 소스(링크 없는) 유닛 — 외부 가격 변경은 여기서만 센다. */
  const sourceRoomIds = new Set<string>();
  const unitById = new Map<
    string,
    { externalRoomId: string; roomLabel: string; propertyName: string | null }
  >();
  for (const row of (roomsResult.data ?? []) as Array<{
    id: string;
    external_room_id: string | null;
    external_price_source_room_id: string | null;
    room_label: string;
    properties: { name: string } | { name: string }[] | null;
  }>) {
    if (!row.external_room_id) continue;
    roomIdByExternal.set(String(row.external_room_id), row.id);
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    unitById.set(row.id, {
      externalRoomId: String(row.external_room_id),
      propertyName: property?.name ?? null,
      roomLabel: row.room_label,
    });
    if (!row.external_price_source_room_id) sourceRoomIds.add(row.id);
  }

  // **Beds24 를 읽기 전에** 잡는다. 그 뒤에 가격 작업이 쓴 칸은 이보다 늦은 `synced_at` 을 갖고,
  // `upsert_room_daily_rates_if_newer` 가 그 칸을 이번 (더 옛) 값으로 덮지 않는다.
  const syncedAt = new Date().toISOString();

  // 네트워크 예외를 **던지지 않는다.** 이 함수는 크론이 돌리는 안전망이라, 한 번의 순간적인
  // 실패로 500 을 내면 그 주기의 갱신이 통째로 사라진다(2026-09-17 실제로 한 번 겪었다).
  let propertiesRoot: JsonRecord | null = null;
  try {
    const propertiesResponse = await fetch(`${base}/properties?includeAllRooms=true`, {
      headers,
      cache: "no-store",
    });
    if (!propertiesResponse.ok) {
      return { ...empty, skipped: [`room-rates:properties-http-${propertiesResponse.status}`] };
    }
    propertiesRoot = asRecord(await propertiesResponse.json());
  } catch (error) {
    console.error("[beds24/rates] properties fetch failed", error);
    return { ...empty, skipped: ["room-rates:properties-request-error"] };
  }
  const propertyRows = Array.isArray(propertiesRoot?.data) ? propertiesRoot.data : [];

  const skipped: string[] = [];
  const unmatched = new Set<string>();
  const matched = new Set<string>();
  const rows: RateRow[] = [];
  let properties = 0;
  let segments = 0;

  for (const propertyValue of propertyRows) {
    const property = asRecord(propertyValue);
    const externalPropertyId = property ? readString(property, ["id", "propertyId"]) : null;
    if (!externalPropertyId) continue;
    if (propertyFilter && !propertyFilter.has(externalPropertyId)) continue;
    properties += 1;

    const url =
      `${base}/inventory/rooms/calendar?propertyId=${encodeURIComponent(externalPropertyId)}` +
      `&startDate=${window.from}&endDate=${window.to}` +
      `&includePrices=true&includeLinkedPrices=true` +
      `&includeNumAvail=true&includeMinStay=true&includeMaxStay=true` +
      `&includeOverride=true` +
      // **매번 다른 주소로** 읽는다(2026-09-30) — 같은 주소에 옛 응답이 돌아온 정황이 있었다
      // (`recent-write-guard.ts`). Beds24 는 모르는 파라미터를 무시한다(실측).
      `&_ts=${Date.now()}`;

    // 건물 하나가 실패해도 **나머지 여덟 곳은 갱신된다.** 실패한 건물은 `skipped` 로 남아
    // 다음 주기에 다시 시도된다 — 전부 upsert 라 재시도가 안전하다.
    let pages: JsonRecord[];
    try {
      pages = await fetchCalendarPages(url, headers);
    } catch (error) {
      if (error instanceof CalendarHttpError) {
        skipped.push(`room-rates:calendar-${externalPropertyId}-http-${error.status}`);
        continue;
      }
      console.error("[beds24/rates] calendar fetch failed", { externalPropertyId, error });
      skipped.push(`room-rates:calendar-${externalPropertyId}-request-error`);
      continue;
    }
    if (pages.length >= CALENDAR_MAX_PAGES) {
      // 조용히 넘기지 않는다 — 다음 쪽이 남아 있으면 그 날짜들은 옛 값으로 굳는다.
      console.warn("[beds24/rates] calendar paging hit the cap", { externalPropertyId });
      skipped.push(`room-rates:calendar-${externalPropertyId}-paging-capped`);
    }
    const data = pages.flatMap((page) => (Array.isArray(page.data) ? page.data : []));

    for (const roomValue of data) {
      const room = asRecord(roomValue);
      if (!room) continue;
      const externalRoomId = readString(room, ["roomId", "id"]);
      if (!externalRoomId) continue;
      const roomUuid = roomIdByExternal.get(externalRoomId);
      if (!roomUuid) {
        unmatched.add(externalRoomId);
        continue;
      }
      matched.add(externalRoomId);

      const calendar = Array.isArray(room.calendar) ? room.calendar : [];
      for (const segmentValue of calendar) {
        const segment = asRecord(segmentValue);
        if (!segment) continue;
        const from = readString(segment, ["from"]);
        const to = readString(segment, ["to"]);
        if (!from || !to) continue;
        segments += 1;

        const shared = {
          organization_id: organizationId,
          room_id: roomUuid,
          price1: readInt(segment, "price1"),
          price2: readInt(segment, "price2"),
          price3: readInt(segment, "price3"),
          min_stay: readInt(segment, "minStay"),
          max_stay: readInt(segment, "maxStay"),
          num_avail: readInt(segment, "numAvail"),
          override_kind: readString(segment, ["override"]),
          synced_at: syncedAt,
        };
        for (const stayDate of eachDate(from, to)) {
          rows.push({ ...shared, stay_date: stayDate });
        }
      }
    }
  }

  /*
   * ── 우리가 방금 쓴 값을 옛 값으로 되돌리지 않는다 (2026-09-30) ─────────────────
   *
   * 받은 값이 최근 우리 작업(가격 `price1` · 최소숙박)이 쓴 값과 다르면 그 칸은 **객실 단위로 다시
   * 읽어**(캐시 우회) 그 값을 쓴다. 다시 읽지 못하면 그 칸은 이번에 덮지 않는다. 판정: `recent-write-guard.ts`.
   */
  let recentWriteRechecked = 0;
  let recentWriteKept = 0;
  if (rows.length > 0) {
    const guardSince = new Date(Date.now() - RECENT_WRITE_GUARD_MS).toISOString();
    const roomIdsInRows = [...new Set(rows.map((row) => row.room_id))];
    const writes: RecentWrite[] = [];
    for (let offset = 0; ; offset += 1000) {
      const writesResult = await supabase
        .from("price_change_logs")
        .select("id, room_id, stay_date, field, new_value, created_at")
        .eq("organization_id", organizationId)
        .not("job_id", "is", null)
        .in("field", ["price1", "min_stay"])
        .gte("created_at", guardSince)
        .in("room_id", roomIdsInRows)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (writesResult.error) {
        // 최근 쓰기를 확인하지 못했다 — 어느 칸이 우리 값과 어긋나는지 모르므로 **이번에는 쓰지 않는다.**
        // 조용히 가드를 끄고 덮으면 방금 쓴 값을 옛 값으로 되돌리는 원래 사고로 돌아간다.
        console.error("[beds24/rates] recent-write guard read failed; sync aborted", writesResult.error);
        return {
          ...empty,
          matchedRooms: matched.size,
          properties,
          segments,
          skipped: [...skipped, `room-rates:guard-read-${writesResult.error.code ?? "error"}`],
          unmatchedRoomIds: [...unmatched],
        };
      }
      const page = (writesResult.data ?? []) as Array<{
        room_id: string | null;
        stay_date: string;
        field: string;
        new_value: number | null;
        created_at: string;
      }>;
      for (const row of page) {
        if (!row.room_id || row.new_value === null) continue;
        writes.push({
          at: row.created_at,
          field: row.field === "min_stay" ? "min_stay" : "price1",
          roomId: row.room_id,
          stayDate: row.stay_date,
          value: row.new_value,
        });
      }
      if (page.length < 1000) break;
    }
    const conflicts = findRowsContradictingRecentWrites(rows, writes);
    if (conflicts.size > 0) {
      const datesByRoom = new Map<string, string[]>();
      for (const key of conflicts) {
        const [roomId, date] = key.split("|");
        datesByRoom.set(roomId, [...(datesByRoom.get(roomId) ?? []), date]);
      }
      const fresh = new Map<string, Omit<RateRow, "organization_id" | "room_id" | "stay_date" | "synced_at">>();
      for (const [roomId, dates] of datesByRoom) {
        const externalRoomId = unitById.get(roomId)?.externalRoomId;
        if (!externalRoomId) continue;
        const sorted = [...dates].sort();
        const wanted = new Set(sorted);
        const url =
          `${base}/inventory/rooms/calendar?roomId=${encodeURIComponent(externalRoomId)}` +
          `&startDate=${sorted[0]}&endDate=${sorted[sorted.length - 1]}` +
          `&includePrices=true&includeLinkedPrices=true&includeNumAvail=true&includeMinStay=true` +
          `&includeMaxStay=true&includeOverride=true&_ts=${Date.now()}`;
        try {
          const recheckPages = await fetchCalendarPages(url, headers);
          for (const page of recheckPages) {
            for (const roomValue of Array.isArray(page.data) ? page.data : []) {
              const room = asRecord(roomValue);
              for (const segmentValue of Array.isArray(room?.calendar) ? room.calendar : []) {
                const segment = asRecord(segmentValue);
                const from = segment ? readString(segment, ["from"]) : null;
                const to = segment ? readString(segment, ["to"]) : null;
                if (!segment || !from || !to) continue;
                for (const stayDate of eachDate(from, to)) {
                  if (!wanted.has(stayDate)) continue;
                  fresh.set(`${roomId}|${stayDate}`, {
                    max_stay: readInt(segment, "maxStay"),
                    min_stay: readInt(segment, "minStay"),
                    num_avail: readInt(segment, "numAvail"),
                    override_kind: readString(segment, ["override"]),
                    price1: readInt(segment, "price1"),
                    price2: readInt(segment, "price2"),
                    price3: readInt(segment, "price3"),
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error("[beds24/rates] recent-write recheck failed", { externalRoomId, error });
        }
      }
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const key = `${rows[index].room_id}|${rows[index].stay_date}`;
        if (!conflicts.has(key)) continue;
        const values = fresh.get(key);
        if (values) {
          rows[index] = { ...rows[index], ...values };
          recentWriteRechecked += 1;
        } else {
          // 다시 읽지 못했다 — 이번에는 덮지 않는다(우리 표의 지금 값 = 우리가 쓰고 확인한 값을 둔다).
          rows.splice(index, 1);
          recentWriteKept += 1;
        }
      }
      console.warn("[beds24/rates] sync contradicted recent writes — rechecked", {
        conflicts: conflicts.size,
        kept: recentWriteKept,
        rechecked: recentWriteRechecked,
      });
    }
  }

  /*
   * ── Beds24 쪽에서 바뀐 가격 · 최소숙박 · 차단을 이력에 남긴다 (2026-09-29) ────────────────
   *
   * 덮기 **전에** 우리 표의 지금 값을 읽어 둔다. 재고 웹훅은 값 없이 「바뀌었다」 신호만 주므로 비교해야
   * 무엇이 바뀌었는지 안다. 가격 개입 전환은 이 중 `price1` 만 쓰고, 판매 캘린더 「이력」은 전부 보여준다.
   * 읽기에 실패하면 이력만 건너뛴다 — 요금 갱신은 막지 않는다.
   */
  // 가격은 소스 유닛만 보지만 최소숙박·차단은 **모든 유닛**을 본다(2026-09-29) — 그래서 쓴 유닛 전부를 읽는다.
  const before = new Map<string, RateSnapshot>();
  const beforeValues = new Map<string, RateValues>();
  const writtenRoomIds = [...new Set(rows.map((row) => row.room_id))];
  let beforeReadOk = writtenRoomIds.length > 0;
  for (let offset = 0; beforeReadOk; offset += 1000) {
    const page = await supabase
      .from("room_daily_rates")
      .select("room_id, stay_date, price1, price2, price3, min_stay, max_stay, num_avail, override_kind")
      .eq("organization_id", organizationId)
      .in("room_id", writtenRoomIds)
      .gte("stay_date", window.from)
      .lte("stay_date", window.to)
      .order("room_id", { ascending: true })
      .order("stay_date", { ascending: true })
      .range(offset, offset + 999);
    if (page.error) {
      console.error("[beds24/rates] before-read failed; skipping external change log", page.error);
      beforeReadOk = false;
      break;
    }
    const data = (page.data ?? []) as Array<RateValues & { room_id: string; stay_date: string }>;
    for (const row of data) {
      const key = `${row.room_id}|${row.stay_date}`;
      before.set(key, {
        minStay: row.min_stay,
        override: row.override_kind,
        price1: row.price1,
      });
      beforeValues.set(key, {
        max_stay: row.max_stay,
        min_stay: row.min_stay,
        num_avail: row.num_avail,
        override_kind: row.override_kind,
        price1: row.price1,
        price2: row.price2,
        price3: row.price3,
      });
    }
    if (data.length < 1000) break;
  }

  // 한 번에 다 넣으면 요청이 너무 커진다(90객실 × 366일 ≈ 33,000행).
  //
  // **이번 읽기보다 늦게 쓰인 칸은 건너뛴다**(`upsert_room_daily_rates_if_newer`). Beds24 를 읽은 뒤
  // 여기까지 여러 번 왕복하는 사이 가격 작업이 검증까지 끝낸 값을 쓸 수 있다 — 그 칸을 읽기 전 값으로
  // 되돌리면 안 된다. 실제로 쓴 칸만 돌아온다.
  //
  // **쓰기는 300행씩**(2026-10-16). 화면을 열 때 도는 이 경로는 로그인 사용자(8초 제한)로 쓴다 — 1,000행
  // 한 번은 웹훅이 몰려 DB 가 바쁜 순간 8초를 넘겨 통째 실패했다. 잘게 쪼개면 한 문장이 짧아 버틴다.
  const CHUNK = 1000;
  const UPSERT_CHUNK = 300;
  const writtenKeys = new Set<string>();
  let upsertFailed = false;
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK);
    const result = await supabase.rpc("upsert_room_daily_rates_if_newer", {
      p_rows: chunk as unknown as Json,
    });
    if (result.error) {
      skipped.push(`room-rates:upsert-${result.error.code ?? "error"}`);
      console.error("[beds24/rates] upsert failed", { at: index, error: result.error });
      upsertFailed = true;
      break;
    }
    for (const row of result.data ?? []) {
      writtenKeys.add(`${row.written_room_id}|${row.written_stay_date}`);
    }
  }
  const written = writtenKeys.size;
  const writtenRows = rows.filter((row) => writtenKeys.has(`${row.room_id}|${row.stay_date}`));
  if (written < rows.length && !upsertFailed) {
    console.log("[beds24/rates] newer local writes kept", { kept: rows.length - written });
  }

  // 우리 표를 끝까지 갱신했을 때만 남긴다 — 반만 쓴 채 이력을 남기면 다음 동기화가 같은 변경을
  // 또 잡는다.
  let externalPriceChanges = 0;
  if (beforeReadOk && !upsertFailed) {
    const today = tokyoDateOf(new Date().toISOString()) as string;
    // 건너뛴 칸(더 새 값이 이미 있음)은 대조하지 않는다 — 옛 값을 「Beds24 가 바꿨다」로 남기게 된다.
    const changes = detectExternalRateChanges({ after: writtenRows, before, sourceRoomIds, today });
    for (let index = 0; index < changes.length; index += CHUNK) {
      const logRows = changes.slice(index, index + CHUNK).map((change) => ({
        // 한 번의 동기화에서 잡힌 변경은 **같은 시각**으로 남긴다 — 가격 개입 판정이 이걸 한 번의
        // 개입으로 묶는다(`ops-calendar.ts`: `job_id` 가 없으면 시각으로 묶음).
        adjust_mode: "beds24",
        changed_by: null,
        changed_by_name: "Beds24",
        created_at: syncedAt,
        external_room_id: unitById.get(change.roomId)?.externalRoomId ?? null,
        field: change.field,
        job_id: null,
        new_value: change.newValue,
        old_value: change.oldValue,
        organization_id: organizationId,
        percent_value: null,
        room_id: change.roomId,
        room_label: unitById.get(change.roomId)?.roomLabel ?? null,
        stay_date: change.stayDate,
      }));
      const inserted = await supabase.from("price_change_logs").insert(logRows as never);
      if (inserted.error) {
        console.error("[beds24/rates] external change log failed", inserted.error);
        break;
      }
      externalPriceChanges += logRows.length;
    }
  }

  if (unmatched.size > 0) {
    console.warn("[beds24/rates] rooms missing from master", [...unmatched]);
  }

  // **값이 실제로 바뀐 칸이 있을 때만** 알린다. 이전 값을 못 읽었으면 쓴 칸 전부를 바뀐 것으로 본다.
  const changedKeys = beforeReadOk
    ? findChangedRateCells(writtenRows, beforeValues)
    : new Set(writtenRows.map((row) => `${row.room_id}|${row.stay_date}`));
  if (changedKeys.size > 0) {
    const propertyNames = new Set<string>();
    let changedFrom: string | null = null;
    let changedTo: string | null = null;
    for (const key of changedKeys) {
      const [roomId, stayDate] = key.split("|");
      const propertyName = unitById.get(roomId)?.propertyName;
      if (propertyName) propertyNames.add(propertyName);
      if (!changedFrom || stayDate < changedFrom) changedFrom = stayDate;
      if (!changedTo || stayDate > changedTo) changedTo = stayDate;
    }
    await signalBeds24Change(organizationId, "rates", {
      from: changedFrom,
      propertyNames: [...propertyNames],
      to: changedTo,
    });
  }

  return {
    rows: written,
    segments,
    matchedRooms: matched.size,
    unmatchedRoomIds: [...unmatched],
    properties,
    skipped,
    window,
    externalPriceChanges,
  };
}
