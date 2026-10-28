import { normalizeReservationSource } from "@/lib/beds24/source-normalization";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalRoom,
  operationalRoomAliasOf,
} from "@/lib/room-label-normalization";
import {
  buildActiveRoomCatalog,
  buildGlobalExternalRoomToCanonical,
  buildPropertyRoomLookups,
  fetchRoomCatalogRows,
  getActiveRoomCatalog,
  resolveReservationCanonicalRoomLabel,
  type RoomCatalogRow,
} from "@/lib/rooms";
import { sortBuildings, toJstDateString } from "@/lib/admin-calendar-dashboard";
import {
  detectOneNightGaps,
  isActiveUnitMinStay,
  type OpsGapCellInput,
} from "@/lib/ops-gap-detection";
import {
  buildHistoryByCell,
  historyCellKey,
  type CellHistory,
  type PriceHistoryRow,
} from "@/lib/ops-price-history";
import { buildGridRowData, type OpsGridRowData } from "@/lib/ops-calendar-rows";
import { isAnyUnitBlackout, mergeOpsRateUnits, type OpsMergedRate } from "@/lib/ops-rate-merge";
import { buildBlockRanges } from "@/lib/ops-block-ranges";
import {
  attributePriceConversions,
  PRICE_ATTRIBUTION_WINDOW_HOURS,
  type AttributionCell,
  type AttributionReservation,
} from "@/lib/ops-price-attribution";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readAllPages, SUPABASE_PAGE_SIZE } from "@/lib/supabase/read-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveSelectedProperties } from "@/lib/ops-calendar-properties";
import { isSalesCountedReservation, legacyReservationAmount, type SalesRawPayload } from "@/lib/ops-sales-summary";
import { opsUnitRoomKey, ROOM_AXIS_SEPARATOR, toRoomAxisKey } from "@/lib/ops-room-key";

/**
 * 운영 관리자 「판매 캘린더」의 읽기 계층.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md
 *
 * ## 기존 예약 캘린더와 무엇이 다른가
 *
 * | | `/admin/calendar` (읽기) | 여기 |
 * | --- | --- | --- |
 * | 가로축 | 그 달 1일~말일 | **어제부터 30일** (또는 월간) |
 * | 범위 | 당월 + 2개월로 **막혀 있다** | 막지 않는다 |
 * | 목적 | 오늘 누가 어디 있나 | 몇 달 앞을 팔 준비 |
 *
 * 기존 화면의 3개월 제한은 실수가 아니라 **그 화면의 전제**다(현장 전원이 매일 보는 화면).
 * 그래서 넓히지 않고 이쪽을 따로 만든다 → docs/product/32-ops-admin-area.md
 *
 * ## 사노는 여기에 **있다**
 *
 * 청소·예약 캘린더는 사노를 뺀다(`isExcludedOperationalProperty`). 그건 **현장 운영 기준**이다.
 * 그런데 사노는 예약 338건에 2027-05-03 까지 잡혀 있는 **파는 건물**이라, 판매 캘린더에서
 * 빠지면 그 방은 가격을 고칠 방법이 없어진다(2026-09-17 사용자 결정).
 * 저쪽 프로젝트도 캘린더에는 사노를 두고 매출에서만 뺀다.
 *
 * **객실 단위 제외는 그대로다** — 다카다노바바 `401_2` 는 여기서도 숨긴다.
 *
 * ## 가격은 `room_daily_rates` 에서 온다
 *
 * 2026-09-17 에 저장소를 만들었다(마이그레이션 `202609170002_room_daily_rates`). Beds24 의
 * `GET /inventory/rooms/calendar` 는 **구간**으로 주지만 표에는 **날짜별로 펼쳐** 들어가 있어서
 * 여기서는 창 범위를 한 번에 집어 온다.
 *
 * **값이 없는 칸은 그대로 비운다.** 0원처럼 보이게 하면 그것이 곧 잘못된 가격표다 —
 * 비활성 유닛은 애초에 가격이 없고, 그건 「0원」이 아니라 「안 판다」는 뜻이다.
 */

// 1,000행 상한 — `readAllPages` / `SUPABASE_PAGE_SIZE` 는 `src/lib/supabase/read-all-pages.ts` 에 있다.

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
  | "status"
>;

/**
 * 예약 원본(`raw_payload`)에서 **이 화면이 읽는 키만** 받는다(2026-09-30 속도).
 *
 * 원본을 통째로 받으면 30일 창에 1.4MB, 가격 개입 판정 범위에 2.8MB 였다(실측) — 쓰는 것은 객실 매칭
 * 키(`resolveReservationCanonicalRoomLabel`)와 예약 시각(`bookingTime`)뿐이다. PostgREST 의 JSON 경로
 * 선택(`raw_payload->key`)으로 그 키만 받고, 받은 값으로 작은 `raw_payload` 를 다시 만든다 — 호출부는
 * 그대로 `raw_payload` 를 읽는다. **매칭에 새 키를 쓰게 되면 여기에도 넣어야 한다.**
 */
const SLIM_PAYLOAD_KEYS = [
  "roomId",
  "room_id",
  "unitId",
  "unit_id",
  "unitName",
  "unit_name",
  "roomName",
  "room_name",
  "roomLabel",
  "unitLabel",
  "unit_label",
  "room_label",
  "bookingTime",
] as const;

const RESERVATION_SELECT = [
  "id, check_in_date, check_out_date, guest_name, property_name, room_label, source, status",
  ...SLIM_PAYLOAD_KEYS.map((key) => `rp_${key}:raw_payload->${key}`),
].join(", ");

function toReservationRow(raw: Record<string, unknown>): ReservationRow {
  const payload: Record<string, unknown> = {};
  for (const key of SLIM_PAYLOAD_KEYS) {
    const value = raw[`rp_${key}`];
    if (value !== null && value !== undefined) payload[key] = value;
  }
  return {
    check_in_date: raw.check_in_date as string,
    check_out_date: raw.check_out_date as string,
    guest_name: raw.guest_name as string,
    id: raw.id as string,
    property_name: raw.property_name as string,
    raw_payload: payload as ReservationRow["raw_payload"],
    room_label: raw.room_label as string,
    source: raw.source as ReservationRow["source"],
    status: raw.status as ReservationRow["status"],
  };
}

/** JSON 경로 선택은 타입 추론이 안 된다 — 한 쪽의 모양을 직접 적는다. */
type SlimReservationPage = PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;

/** 쪽을 나눠 읽은 결과를 예약 행으로(원본은 필요한 키만 — `RESERVATION_SELECT`). */
function toReservationRows(result: {
  data: Record<string, unknown>[];
  error: { message: string } | null;
}): { data: ReservationRow[]; error: { message: string } | null } {
  return { data: result.data.map(toReservationRow), error: result.error };
}

type BlockRow = Pick<
  Database["public"]["Tables"]["room_blocks"]["Row"],
  "id" | "property_name" | "room_label" | "start_date" | "end_date" | "external_room_id"
>;

type HistoryLogRow = {
  room_label: string | null;
  stay_date: string;
  field: string;
  old_value: number | null;
  new_value: number | null;
  created_at: string;
  changed_by_name: string | null;
  adjust_mode: string | null;
  percent_value: number | null;
  room_id: string | null;
};

/** 「이 칸에 이력이 있다」만 가리는 데 필요한 열. */
type HistoryFlagRow = Pick<HistoryLogRow, "room_id" | "stay_date">;

type RateRow = Pick<
  Database["public"]["Tables"]["room_daily_rates"]["Row"],
  | "room_id"
  | "stay_date"
  | "price1"
  | "price2"
  | "price3"
  | "min_stay"
  | "max_stay"
  | "num_avail"
  | "override_kind"
>;

export type OpsCalendarChannel = "airbnb" | "booking" | "manual";

/** 가로축 한 칸. `key` 는 `YYYY-MM-DD`. */
export type OpsCalendarDay = {
  /** 도쿄 기준 오늘인가. 30일 뷰에서는 보통 두 번째 칸이다. */
  isToday: boolean;
  /**
   * 사내 기준 주말 = **금·토·일**. 일반적인 토·일이 아니다 —
   * 요금 체계가 그 기준으로 짜여 있다(저쪽 원본 주석: 「금·토·일(사내 주말가) / 월~목」).
   */
  isWeekend: boolean;
  /** 이 칸에서 달이 바뀌는가. 30일 뷰는 달을 넘어가므로 경계를 표시해야 한다. */
  startsMonth: boolean;
  date: string;
  day: number;
  /** 0=일 ~ 6=토. */
  weekday: number;
};

export type OpsCalendarRoom = {
  displayRoomLabel: string;
  key: string;
  propertyName: string;
  /**
   * 이 행 뒤에 있는 우리 `rooms.id` 전부. **한 행에 Beds24 유닛이 여럿일 수 있다.**
   *
   * 쓰기에서 필요하다 — 가격은 소스 유닛으로, 최소숙박은 그 날짜에 운영 중인 유닛으로
   * 가는데, 그 판정을 하려면 후보를 전부 넘겨야 한다(`price-job-queue.ts`).
   * 비어 있으면 그 행은 **고칠 수 없다**(Beds24 에 대응하는 유닛이 없다는 뜻).
   */
  roomIds: string[];
};

/**
 * 격자에 그릴 막대 하나.
 *
 * **`checkIn`~`checkOut` 은 날짜이고, 묵는 밤은 그 사이다.** 화면에서는 체크인 날짜 칸의
 * *가운데*에서 시작해 체크아웃 날짜 칸의 *가운데*에서 끝난다 — 같은 날 나가는 예약과 들어오는
 * 예약이 그 칸 가운데에서 만나야 하루에 둘이 보인다.
 */
/**
 * 가격 개입 전환 한 건 — 격자 토글(막대 강조)과 목록 패널이 같이 쓴다.
 * 판정은 `ops-price-attribution.ts`. 표시용 값만 담는다(원본 예약 JSON 은 안 싣는다).
 */
export type OpsPriceConversion = {
  reservationId: string;
  roomKey: string;
  roomLabel: string;
  propertyName: string;
  guestName: string;
  channel: OpsCalendarChannel;
  checkIn: string;
  checkOut: string;
  /** ISO(UTC). 화면이 도쿄로 바꾼다. */
  appliedAt: string;
  bookedAt: string;
  hoursToBooking: number;
  oldAverage: number | null;
  newAverage: number | null;
  delta: number | null;
  percent: number | null;
  nights: number;
  changedBy: string | null;
};

export type OpsCalendarBar = {
  channel: OpsCalendarChannel;
  checkIn: string;
  checkOut: string;
  guestName: string;
  id: string;
  isCancelled: boolean;
  roomKey: string;
};

/** Beds24 `override: "blackout"`. 양끝 포함이라 9/23~9/26 이면 네 밤이다. */
export type OpsCalendarBlock = {
  endDate: string;
  id: string;
  roomKey: string;
  startDate: string;
  /**
   * 우리가 걸 때 남긴 사유(`beds24_block_logs.purpose` · `memo`, 2026-10-01). Beds24 에서 건 차단이나
   * 사유 없이 건 차단은 없다. 구간과 겹치는 **가장 최근** 차단 기록을 쓴다.
   */
  purpose?: string | null;
  memo?: string | null;
  by?: string | null;
  at?: string | null;
};

/** 한 칸의 요금·재고. 값이 없으면 `null` 이고, 그건 0 이 아니다. */
/** 한 칸의 최종 값. 유닛 병합 규칙은 `src/lib/ops-rate-merge.ts` 에 있다. */
export type OpsCalendarRate = OpsMergedRate;

export type OpsCalendarViewMode = "rolling" | "monthly";

export const OPS_CALENDAR_ROLLING_DAYS = 30;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/**
 * 30일 뷰의 시작일 = **도쿄 기준 어제**.
 *
 * 저쪽 원본은 `new Date(); setDate(getDate() - 1)` 로 **브라우저 로컬 기준**이라 밤에 열면 하루
 * 어긋난다. 우리는 도쿄 운영일에서 하루를 뺀다 — 이 저장소는 UTC 자정 기준으로 날짜를 잘랐다가
 * 9시간 밀린 사고를 이미 겪었다(CLAUDE.md §7).
 */
export function opsRollingStartDate(todayJst: string): string {
  return addDays(todayJst, -1);
}

export function opsCalendarWindow(args: {
  mode: OpsCalendarViewMode;
  /** 30일 뷰의 시작일. 월간 뷰에서는 무시된다. */
  start: string;
  /** 월간 뷰의 대상 달(`YYYY-MM`). */
  month: string;
}): { start: string; endExclusive: string } {
  if (args.mode === "monthly") {
    const [y, m] = args.month.split("-").map(Number);
    const start = `${args.month}-01`;
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    return { start, endExclusive: next };
  }
  return { start: args.start, endExclusive: addDays(args.start, OPS_CALENDAR_ROLLING_DAYS) };
}

export function buildOpsCalendarDays(args: {
  start: string;
  endExclusive: string;
  today: string;
}): OpsCalendarDay[] {
  const days: OpsCalendarDay[] = [];
  let cursor = args.start;
  let previousMonth = "";
  while (cursor < args.endExclusive) {
    const [y, m, d] = cursor.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const month = cursor.slice(0, 7);
    days.push({
      date: cursor,
      day: d,
      isToday: cursor === args.today,
      // 금(5) · 토(6) · 일(0) — 사내 주말가 기준.
      isWeekend: weekday === 5 || weekday === 6 || weekday === 0,
      startsMonth: previousMonth !== "" && month !== previousMonth,
      weekday,
    });
    previousMonth = month;
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** 예약 출처 → 격자의 채널 칸. 예약 수정이 「채널 예약인가」를 가를 때도 쓴다. */
export function opsChannelOf(source: string | null | undefined): OpsCalendarChannel {
  const normalized = normalizeReservationSource(source);
  if (normalized === "Airbnb") return "airbnb";
  if (normalized === "Booking.com") return "booking";
  return "manual";
}

function sortRooms(rooms: OpsCalendarRoom[]): OpsCalendarRoom[] {
  const order = sortBuildings([...new Set(rooms.map((room) => room.propertyName))]);
  const rank = new Map(order.map((name, index) => [name, index]));
  return [...rooms].sort((a, b) => {
    const byBuilding = (rank.get(a.propertyName) ?? 0) - (rank.get(b.propertyName) ?? 0);
    if (byBuilding !== 0) return byBuilding;
    return a.displayRoomLabel.localeCompare(b.displayRoomLabel, "ko", { numeric: true });
  });
}

/**
 * 예약 한 건 → 캘린더의 **객실 행**.
 *
 * 격자와 수동 예약의 겹침 검사가 **같은 함수**를 쓴다 — 둘이 다르게 매칭하면 격자에는 빈
 * 칸인데 서버는 막거나, 그 반대로 격자에는 찬 칸에 예약이 들어간다.
 */
function makeReservationRoomAxis(roomCatalog: Awaited<ReturnType<typeof getActiveRoomCatalog>>) {
  const lookups = buildPropertyRoomLookups(roomCatalog ?? []);
  const globalExternalRoomToCanonical = buildGlobalExternalRoomToCanonical(roomCatalog ?? []);
  return (row: Pick<ReservationRow, "property_name" | "raw_payload" | "room_label">) => {
    const propertyName = getCanonicalPropertyName(row.property_name);
    const resolved = resolveReservationCanonicalRoomLabel(
      {
        property_name: row.property_name,
        raw_payload: row.raw_payload,
        room_label: row.room_label,
      },
      { globalExternalRoomToCanonical, isAuthoritative: roomCatalog !== undefined, lookups },
    );
    const canonicalRoomKey =
      resolved ?? getCanonicalRoomLabel(propertyName, row.room_label) ?? row.room_label.trim();
    const displayRoomLabel =
      getDisplayRoomLabel(propertyName, canonicalRoomKey) || canonicalRoomKey;
    return { displayRoomLabel, propertyName, roomKey: toRoomAxisKey(propertyName, displayRoomLabel) };
  };
}

/** 블록 한 건 → 객실 행 키(이름으로). `readBlockRoomKeyResolver` 가 Beds24 방 번호로 못 찾을 때만 쓴다. */
function blockRoomAxisKey(row: Pick<BlockRow, "property_name" | "room_label">): string {
  const propertyName = getCanonicalPropertyName(row.property_name);
  const canonicalRoomKey =
    getCanonicalRoomLabel(propertyName, row.room_label) || row.room_label.trim();
  const displayRoomLabel = getDisplayRoomLabel(propertyName, canonicalRoomKey) || canonicalRoomKey;
  return toRoomAxisKey(propertyName, displayRoomLabel);
}

type BlockRoomKeyResolver = (row: Pick<BlockRow, "property_name" | "room_label" | "external_room_id">) => string;

/**
 * 블록 → 객실 행 키를 **예약처럼 Beds24 방 번호로** 찾는다(2026-10-05).
 *
 * 예약은 원본의 방 번호로 행을 찾는데 블록은 이름(`property_name` · `room_label`)으로만 찾아서, 이름이 객실 마스터와
 * 어긋나면(객실 이름을 바꾼 뒤 등) 그 블록이 캘린더에서 **조용히 빠졌다** — 막힌 방이 빈방으로 보이면 초과예약이다.
 * `room_blocks.external_room_id` → 우리 유닛 → `opsUnitRoomKey`(격자 행 키와 같은 계산). 방 번호가 없거나 모르는
 * 번호 · 두 행에 걸친 번호면 이름으로 돌아간다. 객실 표를 못 읽어도 이름으로 돌아간다.
 */
async function readBlockRoomKeyResolver(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<BlockRoomKeyResolver> {
  const byExternal = new Map<string, string | null>();
  const result = await supabase
    .from("rooms")
    .select("external_room_id, room_label, properties(name)")
    .eq("organization_id", organizationId)
    .not("external_room_id", "is", null);
  if (result.error) {
    console.error("[ops-calendar] block room lookup failed; matching by name", result.error);
  } else {
    for (const unit of (result.data ?? []) as Array<{
      external_room_id: string | null;
      room_label: string;
      properties: { name: string } | { name: string }[] | null;
    }>) {
      const property = Array.isArray(unit.properties) ? unit.properties[0] : unit.properties;
      const key = opsUnitRoomKey({ propertyName: property?.name, roomLabel: unit.room_label });
      const id = String(unit.external_room_id);
      if (!key) continue;
      byExternal.set(id, byExternal.has(id) && byExternal.get(id) !== key ? null : key);
    }
  }
  return (row) => {
    const key = row.external_room_id ? byExternal.get(String(row.external_room_id)) : undefined;
    return key ?? blockRoomAxisKey(row);
  };
}

/**
 * 한 객실 행에서 **팔 수 없는 밤**(`from` 이상 `toExclusive` 미만).
 *
 * 수동 예약 패널의 날짜 피커가 회색으로 칠할 날, 그리고 서버가 만들기 직전에 겹침을 막는
 * 근거다. 두 가지를 합친다 —
 *
 * - **이미 찬 밤**: 살아 있는 예약(취소·노쇼 제외). **차단(블록 · blackout)은 찬 밤이 아니다**(2026-10-06 사용자 결정 —
 *   「차단한 날도 수기 예약을 만들 수 있어야 한다, Beds24 에선 된다」). 차단은 채널 판매를 막는 것이지 우리가 직접 넣는
 *   예약까지 막는 것이 아니다 — 차단한 방에 손님을 옮겨 넣는 일(702 → 302)이 실제로 있다.
 * - **파는 유닛이 없는 밤**: 그 행의 유닛이 하나도 활성(`1 ≤ minStay < 50`)이 아니다. 만들어도
 *   Beds24 가 받지 않거나 잠긴 유닛에 붙는다 — 서버가 어차피 거절하는 밤이다. 요금 행이
 *   없는 밤도 여기에 든다(모르는 밤은 팔 수 있다고 하지 않는다).
 *
 * `booked` 와 `unsellable` 을 나눠 돌려준다 — 겹침 검사는 앞의 것만 본다(뒤의 것은 유닛 결정이
 * 더 자세한 사유와 함께 막는다).
 */
export async function readOpsRoomUnavailableNights(args: {
  organizationId: string;
  supabase: SupabaseClient<Database>;
  roomKey: string;
  /** 이 행의 우리 `rooms.id`. 호출부가 조직 소속을 확인한 값이어야 한다. */
  roomIds: string[];
  from: string;
  toExclusive: string;
  /** 이 예약은 세지 않는다 — 예약 수정에서 **자기 자신과 겹친다**고 막으면 안 된다. */
  excludeReservationId?: string;
}): Promise<{ booked: string[]; unsellable: string[] }> {
  const { organizationId, supabase } = args;
  const [roomCatalog, reservationsResult, ratesResult] = await Promise.all([
    getActiveRoomCatalog(organizationId, supabase, { includeNonOperationalProperties: true }),
    readAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("reservations")
        .select(RESERVATION_SELECT)
        .eq("organization_id", organizationId)
        .lt("check_in_date", args.toExclusive)
        // 체크아웃 날은 밤이 아니다 — `from` 에 나가는 손님은 겹치지 않는다.
        .gt("check_out_date", args.from)
        .order("check_in_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as SlimReservationPage,
    ).then(toReservationRows),
    args.roomIds.length === 0
      ? Promise.resolve({
          data: [] as Array<Pick<RateRow, "room_id" | "stay_date" | "min_stay" | "override_kind">>,
          error: null,
        })
      : readAllPages<Pick<RateRow, "room_id" | "stay_date" | "min_stay" | "override_kind">>((from, to) =>
          supabase
            .from("room_daily_rates")
            .select("room_id, stay_date, min_stay, override_kind")
            .eq("organization_id", organizationId)
            .in("room_id", args.roomIds)
            .gte("stay_date", args.from)
            .lt("stay_date", args.toExclusive)
            .order("room_id", { ascending: true })
            .order("stay_date", { ascending: true })
            .range(from, to),
        ),
  ]);
  // 모르면 막는다 — 읽기에 실패했는데 「비어 있다」고 하면 그대로 초과예약이 된다.
  if (reservationsResult.error) throw new Error(reservationsResult.error.message);
  if (ratesResult.error) throw new Error(ratesResult.error.message);

  const nights: string[] = [];
  for (let cursor = args.from; cursor < args.toExclusive; cursor = addDays(cursor, 1)) {
    nights.push(cursor);
  }

  const booked = new Set<string>();
  const reservationRoomAxis = makeReservationRoomAxis(roomCatalog);
  for (const row of reservationsResult.data) {
    if (row.status === "cancelled" || row.status === "no_show") continue;
    if (row.id === args.excludeReservationId) continue;
    if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
    if (reservationRoomAxis(row).roomKey !== args.roomKey) continue;
    for (const night of nights) {
      if (night >= row.check_in_date && night < row.check_out_date) booked.add(night);
    }
  }
  const activeNights = new Set<string>();
  for (const row of ratesResult.data) {
    if (!isActiveUnitMinStay(row.min_stay)) continue;
    activeNights.add(row.stay_date);
  }
  const unsellable = nights.filter((night) => !booked.has(night) && !activeNights.has(night));

  return { booked: nights.filter((night) => booked.has(night)), unsellable };
}

/**
 * 예약 옮기기 후보 — 여러 줄의 겹침을 **한 번 읽어** 줄마다 센다(2026-10-19). `readOpsRoomUnavailableNights` 를 줄마다
 * 부르면 같은 예약 표를 줄 수만큼 다시 읽는다. 같은 매칭(`makeReservationRoomAxis`)을 쓴다. 겹친 예약의 손님 이름을 하나
 * 돌려줘 화면이 「겹침 · 누구」로 적는다. 판매 안 함(최소숙박 50↑) 밤도 센다 — 그 줄은 고를 수 없다.
 */
export async function readOpsMoveTargets(args: {
  organizationId: string;
  supabase: SupabaseClient<Database>;
  rows: Array<{ roomKey: string; roomIds: string[] }>;
  from: string;
  toExclusive: string;
  excludeReservationId: string;
}): Promise<Map<string, { booked: string[]; unsellable: string[]; clashGuest: string | null }>> {
  const { organizationId, supabase } = args;
  const allRoomIds = [...new Set(args.rows.flatMap((row) => row.roomIds))];
  const [roomCatalog, reservationsResult, ratesResult] = await Promise.all([
    getActiveRoomCatalog(organizationId, supabase, { includeNonOperationalProperties: true }),
    readAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("reservations")
        .select(RESERVATION_SELECT)
        .eq("organization_id", organizationId)
        .lt("check_in_date", args.toExclusive)
        .gt("check_out_date", args.from)
        .order("check_in_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as SlimReservationPage,
    ).then(toReservationRows),
    allRoomIds.length === 0
      ? Promise.resolve({ data: [] as Array<Pick<RateRow, "room_id" | "stay_date" | "min_stay" | "override_kind">>, error: null })
      : readAllPages<Pick<RateRow, "room_id" | "stay_date" | "min_stay" | "override_kind">>((from, to) =>
          supabase
            .from("room_daily_rates")
            .select("room_id, stay_date, min_stay, override_kind")
            .eq("organization_id", organizationId)
            .in("room_id", allRoomIds)
            .gte("stay_date", args.from)
            .lt("stay_date", args.toExclusive)
            .order("room_id", { ascending: true })
            .order("stay_date", { ascending: true })
            .range(from, to),
        ),
  ]);
  if (reservationsResult.error) throw new Error(reservationsResult.error.message);
  if (ratesResult.error) throw new Error(ratesResult.error.message);

  const nights: string[] = [];
  for (let cursor = args.from; cursor < args.toExclusive; cursor = addDays(cursor, 1)) nights.push(cursor);
  const axis = makeReservationRoomAxis(roomCatalog);
  const out = new Map<string, { booked: string[]; unsellable: string[]; clashGuest: string | null }>();
  for (const target of args.rows) {
    const booked = new Set<string>();
    let clashGuest: string | null = null;
    for (const row of reservationsResult.data) {
      if (row.status === "cancelled" || row.status === "no_show") continue;
      if (row.id === args.excludeReservationId) continue;
      if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
      if (axis(row).roomKey !== target.roomKey) continue;
      for (const night of nights) {
        if (night >= row.check_in_date && night < row.check_out_date) {
          booked.add(night);
          clashGuest ??= row.guest_name;
        }
      }
    }
    const ids = new Set(target.roomIds);
    const activeNights = new Set(
      ratesResult.data.filter((rate) => ids.has(rate.room_id) && isActiveUnitMinStay(rate.min_stay)).map((rate) => rate.stay_date),
    );
    out.set(target.roomKey, {
      booked: nights.filter((night) => booked.has(night)),
      clashGuest,
      unsellable: nights.filter((night) => !booked.has(night) && !activeNights.has(night)),
    });
  }
  return out;
}

/**
 * `rooms` 행 → 「우리 `rooms.id` → 캘린더 행 키」 등. 캘린더와 가격 개입 판정이 같은 매핑을 쓴다.
 * 운영 종료 유닛도 넣는다 — 한 행 뒤의 유닛 후보 전부가 필요하다(쓰기·이력·판정).
 */
function mapRoomUnits(rows: RoomCatalogRow[]) {
  const roomKeyByUuid = new Map<string, string>();
  /** 우리 `rooms.id` → Beds24 유닛 이름(`802#` · `K802`). 유닛마다 최소숙박이 다를 때 화면이 적는다. */
  const unitLabelById = new Map<string, string>();
  /** Beds24 요금 동기화가 실제로 다시 쓰는 유닛 — 운영 중 + Beds24 에 매핑됨(`room-rates-sync.ts` 와 같은 기준). */
  const syncableRoomIds = new Set<string>();
  for (const row of rows) {
    const propertyRow = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const roomKey = opsUnitRoomKey({ propertyName: propertyRow?.name, roomLabel: row.room_label });
    if (!roomKey) continue;
    roomKeyByUuid.set(row.id, roomKey);
    unitLabelById.set(row.id, row.room_label);
    if (row.status === "active" && row.external_provider === "beds24" && row.external_room_id) {
      syncableRoomIds.add(row.id);
    }
  }
  return { roomKeyByUuid, syncableRoomIds, unitLabelById };
}

/**
 * 건물을 골랐으면 **그 건물(들) 객실의 유닛만**. 건물 이름이 하나도 맞지 않으면(없는 건물) 전부 — 화면이
 * 전체로 떨어지므로. 여러 건물(2026-09-30 다중 선택)은 그중 하나에라도 속하면 넣는다.
 */
function scopeRoomUuids(roomKeyByUuid: Map<string, string>, properties: readonly string[] | undefined): string[] {
  const prefixes = (properties ?? []).map((name) => `${name}${ROOM_AXIS_SEPARATOR}`);
  const scoped = [...roomKeyByUuid]
    .filter(([, roomKey]) => prefixes.length === 0 || prefixes.some((prefix) => roomKey.startsWith(prefix)))
    .map(([roomUuid]) => roomUuid);
  return scoped.length > 0 ? scoped : [...roomKeyByUuid.keys()];
}

export async function getOpsCalendarData(
  session: AppSession,
  filters: {
    mode?: string;
    month?: string;
    /** 고른 건물(들). 빈 목록 = 전체. 없는 이름은 버린다(`resolveSelectedProperties`). */
    properties?: readonly string[];
    start?: string;
    /** 취소된 예약도 함께 볼 것인가. 기본은 꺼짐 — 저쪽 `showCancelled` 와 같다. */
    showCancelled?: boolean;
  },
) {
  const today = toJstDateString(new Date());
  const mode: OpsCalendarViewMode = filters.mode === "monthly" ? "monthly" : "rolling";
  const start =
    filters.start && /^\d{4}-\d{2}-\d{2}$/.test(filters.start)
      ? filters.start
      : opsRollingStartDate(today);
  const month =
    filters.month && /^\d{4}-\d{2}$/.test(filters.month) ? filters.month : today.slice(0, 7);
  const window = opsCalendarWindow({ mode, start, month });
  const days = buildOpsCalendarDays({ ...window, today });

  const supabase = await getSupabaseServerClient();
  /*
   * **서로 기다릴 필요 없는 조회는 한꺼번에 시작한다**(2026-09-30 속도). 요금·이력·신선도만 객실 목록이
   * 있어야 해서 `rooms` 가 오는 즉시 뒤따라 시작한다 — 예약·블록을 기다리지 않는다.
   *
   * **`rooms` 는 한 번만 읽는다**(2026-09-30) — 예전에는 카탈로그(`getActiveRoomCatalog`)와 유닛 매핑이
   * 같은 표를 따로 읽었다. 이제 같은 행에서 둘 다 만든다(`buildActiveRoomCatalog`).
   *
   * 가격 개입 판정(최근 90일 조직 전체 로그 + 예약 재조회)은 **여기서 하지 않는다** — 창과 무관하고
   * 가장 느린 단계였다. 격자가 그린 뒤 따로 받는다(`getOpsPriceConversions`).
   */
  const roomRowsPromise = fetchRoomCatalogRows(session.organization.id, supabase);
  const propertyIdPromise = Promise.resolve(supabase
    .from("properties")
    .select("name, external_property_id")
    .eq("organization_id", session.organization.id)
    .not("external_property_id", "is", null));
  // 쪽을 나눠 읽으므로 **정렬이 유일해야 한다** — 같은 값이 여럿이면 쪽 경계에서 어떤 행은
  // 두 번, 어떤 행은 한 번도 안 온다. `id` 를 마지막 기준으로 붙여 순서를 못 박는다.
  const reservationsPromise = readAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("reservations")
      .select(RESERVATION_SELECT)
      .eq("organization_id", session.organization.id)
      .lt("check_in_date", window.endExclusive)
      .gte("check_out_date", window.start)
      .order("check_in_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as SlimReservationPage,
  ).then(toReservationRows);
  // 차단 사유 — 우리가 걸며 남긴 기록. 사유나 메모가 있는 것만(2026-10-01).
  const blockNotesPromise = Promise.resolve(
    supabase
      .from("beds24_block_logs")
      .select("external_room_ids, start_date, end_date, purpose, memo, requested_by_name, created_at")
      .eq("organization_id", session.organization.id)
      .eq("action", "block")
      .eq("status", "succeeded")
      .or("purpose.not.is.null,memo.not.is.null")
      .lt("start_date", window.endExclusive)
      .gte("end_date", window.start)
      .order("created_at", { ascending: false })
      .limit(2000),
  );
  const blocksPromise = readAllPages<BlockRow>((from, to) =>
    supabase
      .from("room_blocks")
      .select("id, property_name, room_label, start_date, end_date, external_room_id")
      .eq("organization_id", session.organization.id)
      // 창 밖에서 시작해 안으로 들어오는 블락도 잡아야 한다.
      .lt("start_date", window.endExclusive)
      .gte("end_date", window.start)
      .order("start_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const roomRowsResult = await roomRowsPromise;
  if (roomRowsResult.error) {
    console.error("[ops-calendar] room read failed", roomRowsResult.error);
  }
  // 사노 포함. 객실 단위 제외(다카다노바바 401_2)는 카탈로그 안에서 그대로 걸린다.
  // 읽기에 실패하면 예전 `getActiveRoomCatalog` 처럼 「판정 전」(`undefined`)으로 둔다.
  const roomCatalog = roomRowsResult.error
    ? undefined
    : buildActiveRoomCatalog(roomRowsResult.data, { includeNonOperationalProperties: true });
  // 요금은 **그 행의 유닛 전부**에서 읽는다. 한 캘린더 행에 Beds24 유닛이 둘일 수 있고
  // (예: 401 + 401_2_2), 저쪽 원본은 그럴 때 「하나라도 팔 수 있으면 팔 수 있다」로 본다
  // (`getDualRoomPhysicalStatus` — 물리적으로 같은 방이면 이어진 것이다).
  const { roomKeyByUuid, syncableRoomIds, unitLabelById } = mapRoomUnits(
    roomRowsResult.error ? [] : roomRowsResult.data,
  );

  // 창의 **하루 바깥까지** 읽는다. 갭 판정이 어제·내일을 보기 때문에, 가장자리에서 데이터가
  // 끊기면 실제 갭을 「모른다」로 흘려보낸다.
  const rateFrom = addDays(window.start, -1);
  const rateToExclusive = addDays(window.endExclusive, 1);
  /*
   * 건물을 골랐으면 **그 건물 객실의 요금만** 읽는다(2026-09-30 속도). 전에는 건물 하나를 봐도 91실 전부
   * (2,912행)를 읽고 마지막에 걸렀다.
   */
  const rateRoomIds = scopeRoomUuids(roomKeyByUuid, filters.properties);

  /*
   * 신선도는 **이 화면이 그리는 객실 중 동기화가 다시 쓰는 유닛**만으로 잰다(2026-09-30). 예전에는 조직
   * 전체의 가장 오래된 값이라, 건물 하나만 당겨 오는 `after()` 가 다른 건물의 옛 값을 영영 못 고쳐
   * 「낡음 → 당김 → 신호 → 새로고침 → 낡음」 무한 루프가 돌았다. 운영 종료·매핑 없는 유닛은 Beds24 가
   * 돌려주지 않아 그 행은 영원히 옛 값이다 — 그것도 뺀다.
   */
  const freshnessRoomIds = rateRoomIds.filter((roomUuid) => syncableRoomIds.has(roomUuid));
  /*
   * 신선도는 **오늘 이후** 칸으로 잰다(2026-10-01). 30일 보기는 어제부터 시작하는데, 지난 날짜는 Beds24 동기화가
   * 다시 쓰지 않아 그 칸이 늘 「가장 오래된 값」이 됐다 — 가격 대부분이 몇 분 전 값인데 「가격 7시간 전 기준」이라고
   * 적혔다(사용자 지적). 팔 수 없는 날의 가격이 낡은 것은 위험이 아니다. 창 전체가 지난 날짜면 예전처럼 창 시작부터.
   */
  const freshnessFrom = today > window.start && today < window.endExclusive ? today : window.start;
  // Supabase 빌더는 `then` 이 불려야 요청을 보낸다 — `Promise.resolve` 로 감싸야 **지금** 시작한다.
  const freshnessPromise =
    freshnessRoomIds.length === 0
      ? Promise.resolve({ data: null })
      : Promise.resolve(
          supabase
            .from("room_daily_rates")
            .select("synced_at")
            .eq("organization_id", session.organization.id)
            .in("room_id", freshnessRoomIds)
            .gte("stay_date", freshnessFrom)
            .lt("stay_date", window.endExclusive)
            .order("synced_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        );
  /*
   * 이력은 **「이 칸에 이력이 있다」만** 읽는다(2026-09-30 속도). 목록(누가·언제·얼마)은 호버 카드가 뜰 때
   * 그 칸 것만 따로 받는다(`readOpsCellHistory`). 예전에는 칸마다 최대 5줄을 전부 실어 보냈다.
   */
  const historyPromise =
    rateRoomIds.length === 0
      ? Promise.resolve({ data: [] as HistoryFlagRow[], error: null })
      : readAllPages<HistoryFlagRow>((from, to) =>
          supabase
            .from("price_change_logs")
            .select("room_id, stay_date")
            .eq("organization_id", session.organization.id)
            .in("room_id", rateRoomIds)
            .gte("stay_date", window.start)
            .lt("stay_date", window.endExclusive)
            .order("id", { ascending: true })
            .range(from, to),
        );
  /*
   * 객실 91 × 32일 = 2,912행. **한 번에 못 온다.** 예전에는 1,000행씩 차례로 세 번 읽었다 — 이제
   * **유닛을 한 쪽(1,000행)에 들어갈 만큼씩 나눠 동시에** 읽는다(2026-09-30 속도). 한 유닛은 창의
   * 날짜 수만큼만 행이 있으므로(`(room_id, stay_date)` 유니크) 묶음마다 대개 한 쪽이면 끝난다 —
   * 그래도 넘치면 각 묶음이 쪽을 나눠 마저 읽는다. 정렬이 유니크라 쪽 경계가 흔들리지 않는다.
   */
  const rateDaySpan = days.length + 2;
  const rateChunkSize = Math.max(1, Math.floor(SUPABASE_PAGE_SIZE / Math.max(1, rateDaySpan)));
  const rateChunks: string[][] = [];
  for (let index = 0; index < rateRoomIds.length; index += rateChunkSize) {
    rateChunks.push(rateRoomIds.slice(index, index + rateChunkSize));
  }
  const ratesPromise = Promise.all(
    rateChunks.map((chunkRoomIds) =>
      readAllPages<RateRow>((from, to) =>
        supabase
          .from("room_daily_rates")
          .select(
            "room_id, stay_date, price1, price2, price3, min_stay, max_stay, num_avail, override_kind",
          )
          .eq("organization_id", session.organization.id)
          .in("room_id", chunkRoomIds)
          .gte("stay_date", rateFrom)
          .lt("stay_date", rateToExclusive)
          .order("room_id", { ascending: true })
          .order("stay_date", { ascending: true })
          .range(from, to),
      ),
    ),
  ).then((results) => ({
    data: results.flatMap((result) => result.data),
    error: results.find((result) => result.error)?.error ?? null,
  }));

  const [reservationsResult, blocksResult, blockRoomKey] = await Promise.all([
    reservationsPromise,
    blocksPromise,
    readBlockRoomKeyResolver(supabase, session.organization.id),
  ]);
  if (reservationsResult.error) throw new Error(reservationsResult.error.message);

  const reservationRoomAxis = makeReservationRoomAxis(roomCatalog);
  const roomsByKey = new Map<string, OpsCalendarRoom>();

  for (const entry of roomCatalog ?? []) {
    const key = toRoomAxisKey(entry.propertyName, entry.displayRoomLabel);
    roomsByKey.set(key, {
      displayRoomLabel: entry.displayRoomLabel,
      key,
      propertyName: entry.propertyName,
      roomIds: [],
    });
  }

  const bars: OpsCalendarBar[] = [];
  for (const row of reservationsResult.data) {
    // 건물 단위 제외는 여기서 하지 않는다(사노가 보여야 한다). 객실 단위는 그대로 건다.
    if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;

    const isCancelled = row.status === "cancelled" || row.status === "no_show";
    if (isCancelled && !filters.showCancelled) continue;

    const { displayRoomLabel, propertyName, roomKey } = reservationRoomAxis(row);

    if (!roomsByKey.has(roomKey)) {
      roomsByKey.set(roomKey, { displayRoomLabel, key: roomKey, propertyName, roomIds: [] });
    }
    bars.push({
      channel: opsChannelOf(row.source),
      checkIn: row.check_in_date,
      checkOut: row.check_out_date,
      guestName: row.guest_name,
      id: row.id,
      isCancelled,
      roomKey,
    });
  }

  let blocks: OpsCalendarBlock[] = [];
  if (blocksResult.error) {
    console.error("[ops-calendar] room block read failed", blocksResult.error);
  } else {
    for (const row of blocksResult.data) {
      if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
      const roomKey = blockRoomKey(row);
      // 그릴 행이 없으면 조용히 버린다 — 캘린더를 깨뜨리는 것보다 낫다.
      if (!roomsByKey.has(roomKey)) continue;
      blocks.push({ endDate: row.end_date, id: row.id, roomKey, startDate: row.start_date });
    }
  }

  // 쓰기에 필요하다 — 한 행 뒤의 유닛 후보 전부를 행에 달아 둔다.
  for (const [roomUuid, roomKey] of roomKeyByUuid) {
    const room = roomsByKey.get(roomKey);
    if (room && !room.roomIds.includes(roomUuid)) room.roomIds.push(roomUuid);
  }

  const rates = new Map<string, OpsCalendarRate>();
  /** 유닛 요금 칸이 **하나라도** 있는 칸 / 그중 어느 유닛이든 blackout 인 칸 — BLOCK 판정(`isAnyUnitBlackout`). */
  const unitRateCells = new Set<string>();
  const unitBlackoutCells = new Set<string>();
  const ratesResult = await ratesPromise;
  if (ratesResult.error) {
    console.error("[ops-calendar] rate read failed", ratesResult.error);
  } else {
    const unitsByCell = new Map<string, RateRow[]>();
    for (const row of ratesResult.data) {
      const roomKey = roomKeyByUuid.get(row.room_id);
      if (!roomKey) continue;
      const cellKey = `${roomKey}|${row.stay_date}`;
      const unit = { ...row, label: unitLabelById.get(row.room_id) };
      const bucket = unitsByCell.get(cellKey);
      if (bucket) bucket.push(unit);
      else unitsByCell.set(cellKey, [unit]);
    }
    // 유닛 병합 규칙은 순수 모듈에 있다 — 두 번 틀렸고 둘 다 화면에서는 「안 파는 날」처럼
    // 보여 눈으로 못 잡는다(`src/lib/ops-rate-merge.ts`).
    for (const [cellKey, units] of unitsByCell) {
      const merged = mergeOpsRateUnits(units);
      if (merged) rates.set(cellKey, merged);
      unitRateCells.add(cellKey);
      if (isAnyUnitBlackout(units)) unitBlackoutCells.add(cellKey);
    }
  }

  /*
   * ── 이 창의 요금이 얼마나 오래됐나 ───────────────────────────────────
   *
   * **가장 오래된 값**이 기준이다. 한 칸이라도 낡았으면 그 화면은 낡은 것이다 — 평균이나
   * 최신값으로 재면 「3분 전」이라고 적어 놓고 실제로는 5시간 된 칸을 보여주게 된다.
   *
   * 얼마나 오래된 값인지 모르는 채로 가격을 조정하는 것이 이 화면에서 제일 위험하다.
   */
  const freshness = await freshnessPromise;
  const ratesSyncedAt = (freshness.data as { synced_at: string } | null)?.synced_at ?? null;
  /**
   * 몇 분 전 값인가. **여기서 센다** — 화면은 렌더 중에 시계를 읽으면 안 된다
   * (React 컴파일러가 막는다). 분 단위로만 센다: 초까지 재면 새로고침마다 숫자가 달라져
   * **값이 바뀐 것처럼** 보인다.
   */
  const ratesAgeMinutes = ratesSyncedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(ratesSyncedAt).getTime()) / 60_000))
    : null;

  /*
   * ── 가격 변경 이력(있는 칸만) ────────────────────────────────────────
   *
   * **행 키(건물::표시 라벨)로 붙인다**(2026-09-29). 로그에 적힌 라벨은 Beds24 유닛 라벨일 수 있어
   * (STAY ARI `O302` · 가부키초 `203#`) `room_id` → 행 키로 잇는다. 방을 모르는 줄은 건너뛴다.
   */
  const historyResult = await historyPromise;
  if (historyResult.error) {
    console.error("[ops-calendar] price history read failed", historyResult.error);
  }
  const historyCells = new Set<string>();
  for (const row of historyResult.data) {
    const roomKey = row.room_id ? roomKeyByUuid.get(row.room_id) : undefined;
    if (roomKey) historyCells.add(historyCellKey(roomKey, row.stay_date));
  }

  // ── 1박 갭 감지 ───────────────────────────────────────────────────────
  //
  // 「하루만 비어 있는데 최소 2박이라 아무도 살 수 없는 날」. 판정식은 순수 모듈에 있다
  // (`ops-gap-detection.ts`) — 규칙이 곧 돈이라 테스트로 고정해 둔다.
  //
  // 점유 여부는 **예약·블락에서 직접** 본다. `numAvail` 은 요금 동기화 시점의 값이라 그 뒤에
  // 들어온 예약을 모른다(예약은 웹훅으로 실시간, 요금은 주기 동기화).
  /*
   * ── BLOCK 막대는 **12개월 전부** (2026-09-29) ─────────────────────────
   *
   * `room_blocks` 는 현장 예약 캘린더용 동기화라 **이번 달 + 2개월**만 채운다. 그 너머의 Beds24
   * 차단은 빈 칸처럼 보였다. 이미 읽은 요금 칸의 blackout(**어느 유닛이든** — `isAnyUnitBlackout`, 2026-10-01)과
   * `room_blocks`(앱이 방금 건 차단은 요금 표보다 먼저 들어간다)를 **합쳐** 구간으로 다시 묶는다.
   * 끝이 열린 「판매 전」 차단도 숨기지 않는다(사용자 결정 — 전부 보이게).
   */
  {
    const fromRoomBlocks = new Set<string>();
    for (const block of blocks) {
      for (const day of days) {
        if (day.date >= block.startDate && day.date <= block.endDate) {
          fromRoomBlocks.add(`${block.roomKey}|${day.date}`);
        }
      }
    }
    blocks = buildBlockRanges({
      dates: days.map((day) => day.date),
      // **요금 칸이 있으면 그게 정답이다** — 걸고 풀 때 바로 고쳐 두므로(`block-write.ts`
      // `patchLocalOverride`) 가장 최신이다. `room_blocks` 는 요금 칸이 없는 날에만 쓴다: 구간의
      // 일부만 풀면 `room_blocks` 의 원래 행이 남아, 합집합이면 푼 날도 막힌 채 보인다.
      // 유닛이 **잠겨 있어도**(활성 유닛 0 → `rates` 에 칸이 없어도) 그 유닛의 요금 칸은 있다 — 그걸로 본다.
      // 어느 유닛이든 blackout 이면 막힘(2026-10-01, `isAnyUnitBlackout`).
      isBlocked: (roomKey, date) => {
        const cell = `${roomKey}|${date}`;
        return unitRateCells.has(cell) ? unitBlackoutCells.has(cell) : fromRoomBlocks.has(cell);
      },
      roomKeys: [...roomsByKey.keys()],
    });
  }

  // 차단 사유를 구간에 붙인다 — 같은 행 · 겹치는 구간의 **가장 최근** 기록(이미 최신순).
  {
    const notes = await blockNotesPromise;
    if (notes.error) {
      console.error("[ops-calendar] block note read failed", notes.error);
    } else if ((notes.data ?? []).length > 0) {
      const roomKeyByExternal = new Map<string, string>();
      for (const row of roomRowsResult.error ? [] : roomRowsResult.data) {
        const roomKey = roomKeyByUuid.get(row.id);
        if (roomKey && row.external_room_id) roomKeyByExternal.set(String(row.external_room_id), roomKey);
      }
      const noteRows = (notes.data ?? []).map((note) => ({
        ...note,
        roomKeys: new Set(
          (note.external_room_ids ?? [])
            .map((id) => roomKeyByExternal.get(String(id)))
            .filter((key): key is string => !!key),
        ),
      }));
      blocks = blocks.map((block) => {
        const note = noteRows.find(
          (row) =>
            row.roomKeys.has(block.roomKey) && row.start_date <= block.endDate && row.end_date >= block.startDate,
        );
        return note
          ? { ...block, at: note.created_at, by: note.requested_by_name, memo: note.memo, purpose: note.purpose }
          : block;
      });
    }
  }

  const occupiedCells = new Set<string>();
  for (const bar of bars) {
    if (bar.isCancelled) continue;
    for (let date = bar.checkIn; date < bar.checkOut; date = addDays(date, 1)) {
      occupiedCells.add(`${bar.roomKey}|${date}`);
      if (occupiedCells.size > 200_000) break;
    }
  }
  for (const block of blocks) {
    for (let date = block.startDate; date <= block.endDate; date = addDays(date, 1)) {
      occupiedCells.add(`${block.roomKey}|${date}`);
      if (occupiedCells.size > 200_000) break;
    }
  }

  const windowDates = days.map((day) => day.date);
  const gapCells = new Set<string>();
  for (const roomKey of new Set(days.length > 0 ? [...roomsByKey.keys()] : [])) {
    const cellAt = (date: string): OpsGapCellInput | null => {
      const rate = rates.get(`${roomKey}|${date}`);
      if (!rate) return null;
      return {
        // **가장 긴 값**으로 본다(2026-09-30) — 운영 중 유닛 하나라도 2박이면 그 유닛의 채널은 1박을 못
        // 판다. 짧은 값으로 보면 802#(1)·K802(2) 같은 칸이 갭에서 빠져, 「1박으로」가 K802 를 고치지 않는다.
        minStay: rate.minStayMax ?? rate.minStay,
        numAvail: rate.numAvail,
        overrideKind: rate.overrideKind,
        occupied: occupiedCells.has(`${roomKey}|${date}`),
      };
    };
    for (const date of detectOneNightGaps({ dates: windowDates, cellAt, today })) {
      gapCells.add(`${roomKey}|${date}`);
    }
  }

  const allRooms = sortRooms([...roomsByKey.values()]);
  const propertyOptions = sortBuildings([
    ...new Set(allRooms.map((room) => room.propertyName)),
  ]);
  /*
   * 표시 이름 → Beds24 `propertyId`.
   *
   * 건물 하나만 당겨 오려면 필요하다 — 우리 이름(`아라키초A`)과 Beds24 이름(`Arakicho A`)이
   * 달라서 이름으로는 못 찾는다.
   */
  const propertyIdResult = await propertyIdPromise;
  const propertyExternalIds: Record<string, string> = {};
  for (const row of (propertyIdResult.data ?? []) as Array<{
    name: string;
    external_property_id: string;
  }>) {
    propertyExternalIds[getCanonicalPropertyName(row.name.trim())] = String(
      row.external_property_id,
    );
  }
  // 탭 순서로 정렬된 고른 건물 — 빈 목록이면 전체. 격자는 `allRooms` 순서(= 탭 순서)를 그대로 따른다.
  const selectedProperties = resolveSelectedProperties(filters.properties ?? [], propertyOptions);
  const selectedSet = new Set(selectedProperties);
  const rooms =
    selectedProperties.length > 0 ? allRooms.filter((room) => selectedSet.has(room.propertyName)) : allRooms;

  /*
   * ── 웹훅이 아직 못 반영한 건물이 있나 (2026-10-01) ──────────────────────────
   *
   * 가격은 **재고 웹훅**으로 들어온다 — Beds24 에서 무엇이든 바뀌면 그 건물 12개월을 통째로 다시 읽는다. 그래서
   * `synced_at` 이 9시간 전이어도 그사이 바뀐 게 없으면 **맞는 값**이다. 화면이 「가장 오래 전에 받은 시각」을
   * 낡음으로 적던 탓에, 바뀐 것 없는 먼 달로 넘기면 「가격 9시간 전 기준」이 떴다(사용자 지적).
   *
   * 실제로 틀릴 수 있는 것은 **웹훅을 받았는데 아직 못 읽은 건물**이다(쿨다운 · 가격 작업에 물러남 · 읽기 실패) —
   * `beds24_deferred_refreshes` 에 남는다. 보이는 건물 중 하나라도 있으면 「반영 대기」로 적는다. 서비스 롤 전용 표다.
   */
  const visibleExternalIds = (selectedProperties.length > 0 ? selectedProperties : propertyOptions)
    .map((name) => propertyExternalIds[name])
    .filter((id): id is string => Boolean(id));
  const pendingResult =
    visibleExternalIds.length === 0
      ? null
      : await getSupabaseServiceClient()
          .from("beds24_deferred_refreshes")
          .select("external_property_id")
          .eq("organization_id", session.organization.id)
          .in("external_property_id", visibleExternalIds)
          .limit(1);
  // 확인을 못 했으면 「반영 대기」로 본다 — 모르는데 「실시간」이라고 적지 않는다.
  const ratesPendingRefresh = pendingResult ? Boolean(pendingResult.error) || (pendingResult.data ?? []).length > 0 : false;

  /*
   * ── 화면으로 보내는 것은 **보이는 객실의 행**뿐이다(2026-09-30 속도) ──────────
   *
   * 행마다 요금(날짜 순 배열)·이력 표시·갭·막대·블록을 묶고 내용 해시(`sig`)를 붙인다
   * (`ops-calendar-rows.ts`). 격자는 해시가 같은 행을 직전 객체로 바꿔 끼워, 새로고침이 와도 안 바뀐
   * 행은 다시 그리지 않는다.
   */
  const barsByRoom = new Map<string, OpsCalendarBar[]>();
  for (const bar of bars) {
    const list = barsByRoom.get(bar.roomKey);
    if (list) list.push(bar);
    else barsByRoom.set(bar.roomKey, [bar]);
  }
  const blocksByRoom = new Map<string, OpsCalendarBlock[]>();
  for (const block of blocks) {
    const list = blocksByRoom.get(block.roomKey);
    if (list) list.push(block);
    else blocksByRoom.set(block.roomKey, [block]);
  }
  const rows: OpsGridRowData[] = rooms.map((room) =>
    buildGridRowData({
      bars: barsByRoom.get(room.key) ?? [],
      blocks: blocksByRoom.get(room.key) ?? [],
      dates: windowDates,
      hasHistory: (date) => historyCells.has(historyCellKey(room.key, date)),
      isGap: (date) => gapCells.has(`${room.key}|${date}`),
      rateAt: (date) => rates.get(`${room.key}|${date}`),
      room,
    }),
  );
  const visibleRoomKeys = new Set(rooms.map((room) => room.key));

  return {
    /** 요금이 한 칸이라도 있는가. 하나도 없으면 화면이 「아직 안 들어옴」을 알린다. */
    hasRates: rates.size > 0,
    /**
     * 격자가 **고를 수 있는** 갭 칸 수 — 보이는 객실 + 오늘 이후. 「1박 갭 N」 배지가 이 수를 쓴다
     * (갭 칸에는 지난 날짜도 들어 있어 눌러도 그만큼 골라지지 않았다).
     */
    selectableGapCount: [...gapCells].filter(
      (key) => visibleRoomKeys.has(key.split("|")[0]) && key.slice(key.lastIndexOf("|") + 1) >= today,
    ).length,
    /** 이 창에서 **가장 오래된** 요금 동기화가 몇 분 전인가. `null` 이면 요금이 아예 없다. */
    ratesAgeMinutes,
    /** 보이는 건물 중 웹훅을 받았는데 아직 못 읽은 곳이 있는가(`beds24_deferred_refreshes`). */
    ratesPendingRefresh,
    /** 이 창에서 **가장 오래된** 요금 동기화 시각. `null` 이면 요금이 아예 없다. */
    ratesSyncedAt,
    /** 이 화면의 객실 중 Beds24 동기화가 다시 쓰는 유닛이 있는가. 없으면 당겨 와도 신선도가 안 바뀐다. */
    ratesRefreshable: freshnessRoomIds.length > 0,
    /** 보이는 객실의 격자 행(격자 순서). */
    rows,
    days,
    mode,
    month,
    propertyExternalIds,
    propertyOptions,
    /** **보이는** 객실 수(고른 건물만) — 오른쪽 위 「객실 N」. */
    roomTotal: rooms.length,
    /** 고른 건물(탭 순서). 빈 목록 = 전체. */
    selectedProperties,
    start,
    today,
    window,
  };
}

export type OpsCalendarData = Awaited<ReturnType<typeof getOpsCalendarData>>;

/** 매출 요약이 원본(`raw_payload`)에서 읽는 키 — 금액·수수료·채널·원본 상태만(`SalesRawPayload`). */
const SALES_PAYLOAD_KEYS = [
  "status",
  "price",
  "amount",
  "commission",
  "invoiceItems",
  "referer",
  "referrer",
  "channel",
  "apiSource",
  "subSource",
  "source",
] as const;

const SALES_RESERVATION_SELECT = [
  "id, check_in_date, check_out_date, guest_name, property_name, room_label, source, status",
  ...SLIM_PAYLOAD_KEYS.map((key) => `rp_${key}:raw_payload->${key}`),
  ...SALES_PAYLOAD_KEYS.map((key) => `sp_${key}:raw_payload->${key}`),
].join(", ");

/**
 * 「매출 요약」의 입력 — **격자와 같은 객실 축 · 같은 차단 판정**으로, 요약에 필요한 것만 읽는다(2026-09-30).
 *
 * 격자 읽기(`getOpsCalendarData`)를 통째로 부르면 가격·이력·신선도·건물 id 까지 읽는다(요약에는 필요 없다).
 * 여기서는 **서로 기다리지 않는 조회 넷을 한꺼번에** 시작한다 — 객실 목록 · 예약(매칭 키 + 금액 키만) ·
 * `room_blocks` · 요금 표의 blackout 칸. 차단 판정은 격자와 같다(`isBlocked`): 유닛 요금 칸이 있으면
 * 어느 유닛이든 blackout 인가, 없으면 `room_blocks`. 뒤의 경우를 가리려고 `room_blocks` 가 덮는 칸만 요금
 * 표를 한 번 더 본다(대개 몇 줄).
 *
 * 순수 계산은 `ops-sales-summary.ts`. 반환 모양이 그 입력 그대로다.
 */
export async function readOpsSalesInputs(args: {
  organizationId: string;
  supabase: SupabaseClient<Database>;
  window: { start: string; endExclusive: string };
  properties: readonly string[];
  /**
   * `false` 면 차단(요금 표 blackout · `room_blocks`)을 읽지 않는다 — `blocks` 는 빈 배열. 매출 · 가동률 · 비교 화면은 차단을
   * 계산에 쓰지 않는다(「오늘 이후 빈방」에만 쓰인다, 2026-10-08 속도). 기본 `true`(판매 캘린더 매출 요약).
   */
  withBlocks?: boolean;
  /** 예약 쪽 읽기를 몇 장씩 한꺼번에 — `readAllPages` 의 `concurrency`. 기본 1. */
  concurrency?: number;
}) {
  const { organizationId, supabase, window } = args;
  const withBlocks = args.withBlocks ?? true;
  const roomRowsPromise = fetchRoomCatalogRows(organizationId, supabase);
  const reservationsPromise = readAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("reservations")
      .select(SALES_RESERVATION_SELECT)
      .eq("organization_id", organizationId)
      .lt("check_in_date", window.endExclusive)
      // 창 첫날에 나가는 손님은 창 안에 밤이 없다 — 체크인 수에도 안 든다.
      .gt("check_out_date", window.start)
      .order("check_in_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as SlimReservationPage,
    { concurrency: args.concurrency },
  );
  const none = <Row,>() => Promise.resolve({ data: [] as Row[], error: null as { message: string } | null });
  const blocksPromise = !withBlocks ? none<BlockRow>() : readAllPages<BlockRow>((from, to) =>
    supabase
      .from("room_blocks")
      .select("id, property_name, room_label, start_date, end_date, external_room_id")
      .eq("organization_id", organizationId)
      .lt("start_date", window.endExclusive)
      .gte("end_date", window.start)
      .order("start_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const blackoutPromise = !withBlocks ? none<Pick<RateRow, "room_id" | "stay_date" | "min_stay">>() : readAllPages<Pick<RateRow, "room_id" | "stay_date" | "min_stay">>((from, to) =>
    supabase
      .from("room_daily_rates")
      .select("room_id, stay_date, min_stay")
      .eq("organization_id", organizationId)
      .ilike("override_kind", "blackout")
      .gte("stay_date", window.start)
      .lt("stay_date", window.endExclusive)
      .order("room_id", { ascending: true })
      .order("stay_date", { ascending: true })
      .range(from, to),
  );

  const roomRowsResult = await roomRowsPromise;
  if (roomRowsResult.error) throw new Error(roomRowsResult.error.message);
  const roomCatalog = buildActiveRoomCatalog(roomRowsResult.data, { includeNonOperationalProperties: true });
  const { roomKeyByUuid } = mapRoomUnits(roomRowsResult.data);
  const reservationRoomAxis = makeReservationRoomAxis(roomCatalog);

  const catalogKeys = new Set<string>();
  const propertyOfRoom = new Map<string, string>();
  /** 행 키 → 캘린더 행에 보이는 이름(듀얼 유닛은 한 행 — 격자와 같은 `toRoomAxisKey`). */
  const labelOfRoom = new Map<string, string>();
  for (const entry of roomCatalog ?? []) {
    const key = toRoomAxisKey(entry.propertyName, entry.displayRoomLabel);
    catalogKeys.add(key);
    propertyOfRoom.set(key, entry.propertyName);
    labelOfRoom.set(key, entry.displayRoomLabel);
  }

  const [reservationsResult, blocksResult, blackoutResult, blockRoomKey] = await Promise.all([
    reservationsPromise,
    blocksPromise,
    blackoutPromise,
    withBlocks ? readBlockRoomKeyResolver(supabase, organizationId) : Promise.resolve(blockRoomAxisKey),
  ]);
  if (reservationsResult.error) throw new Error(reservationsResult.error.message);
  if (blocksResult.error) throw new Error(blocksResult.error.message);
  if (blackoutResult.error) throw new Error(blackoutResult.error.message);

  const reservations: Array<{
    id: string;
    roomKey: string;
    propertyName: string;
    checkIn: string;
    checkOut: string;
    status: string;
    raw: Record<string, unknown>;
  }> = [];
  for (const raw of reservationsResult.data) {
    const stored = toReservationRow(raw);
    // 운영에서 뺀 유닛이 같은 방이면(다카다노바바 401_2 → 401호) 그 방으로 센다 — 지난 매출이 빠지지 않게(2026-10-07).
    // Beds24 방 번호는 뗀다: 뺀 유닛의 번호는 객실 목록에 없어서 이름 매칭을 막는다.
    const alias = operationalRoomAliasOf(stored.property_name, stored.room_label);
    const row = alias
      ? { ...stored, raw_payload: { ...(stored.raw_payload as Record<string, unknown>), roomId: undefined } as ReservationRow["raw_payload"], room_label: alias }
      : stored;
    const { displayRoomLabel, propertyName, roomKey } = reservationRoomAxis(row);
    const sales: Record<string, unknown> = {};
    for (const key of SALES_PAYLOAD_KEYS) {
      const value = raw[`sp_${key}`];
      if (value !== null && value !== undefined) sales[key] = value;
    }
    // 목록 밖 방은 격자처럼 살아 있는 예약이 있을 때만 행이 된다(가동률에는 안 들어간다).
    if (!propertyOfRoom.has(roomKey) && row.status !== "cancelled" && row.status !== "no_show") {
      propertyOfRoom.set(roomKey, propertyName);
      labelOfRoom.set(roomKey, displayRoomLabel);
    }
    reservations.push({
      checkIn: row.check_in_date,
      checkOut: row.check_out_date,
      id: row.id,
      propertyName,
      raw: sales,
      roomKey,
      status: row.status,
    });
  }

  // 건물 선택 — 격자와 같이 탭 순서, 없는 이름은 버리고 하나도 안 맞으면 전체.
  const propertyOptions = sortBuildings([...new Set(propertyOfRoom.values())]);
  const selected = resolveSelectedProperties(args.properties, propertyOptions);
  const inView = (propertyName: string) => selected.length === 0 || selected.includes(propertyName);

  // ── 차단 칸(격자 `isBlocked` 와 같은 규칙) ──
  const blocked = new Set<string>();
  for (const row of blackoutResult.data) {
    // 어느 유닛이든 blackout 이면 막힌 칸 — 격자와 같다(2026-10-01, `isAnyUnitBlackout`).
    const roomKey = roomKeyByUuid.get(row.room_id);
    if (roomKey && catalogKeys.has(roomKey) && inView(propertyOfRoom.get(roomKey) ?? "")) {
      blocked.add(`${roomKey}|${row.stay_date}`);
    }
  }
  const roomBlockCells = new Map<string, { roomKey: string; date: string }>();
  for (const row of blocksResult.data) {
    if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
    const roomKey = blockRoomKey(row);
    if (!catalogKeys.has(roomKey) || !inView(propertyOfRoom.get(roomKey) ?? "")) continue;
    for (let date = row.start_date < window.start ? window.start : row.start_date; date <= row.end_date && date < window.endExclusive; date = addDays(date, 1)) {
      const cell = `${roomKey}|${date}`;
      if (!blocked.has(cell)) roomBlockCells.set(cell, { date, roomKey });
    }
  }
  if (roomBlockCells.size > 0) {
    // `room_blocks` 가 덮는 칸 중 **유닛 요금 칸이 하나도 없는 것**만 차단이다(있으면 그 칸이 정답 —
    // 위에서 어느 유닛도 blackout 이 아니었으니 풀린 칸이다). 격자의 `isBlocked` 와 같다.
    const cellRoomKeys = new Set([...roomBlockCells.values()].map((cell) => cell.roomKey));
    const unitIds = [...roomKeyByUuid].filter(([, key]) => cellRoomKeys.has(key)).map(([uuid]) => uuid);
    const dates = [...roomBlockCells.values()].map((cell) => cell.date).sort();
    const activeResult =
      unitIds.length === 0
        ? { data: [] as Array<Pick<RateRow, "room_id" | "stay_date" | "min_stay">>, error: null }
        : await readAllPages<Pick<RateRow, "room_id" | "stay_date" | "min_stay">>((from, to) =>
            supabase
              .from("room_daily_rates")
              .select("room_id, stay_date, min_stay")
              .eq("organization_id", organizationId)
              .in("room_id", unitIds)
              .gte("stay_date", dates[0])
              .lte("stay_date", dates[dates.length - 1])
              .order("room_id", { ascending: true })
              .order("stay_date", { ascending: true })
              .range(from, to),
          );
    if (activeResult.error) throw new Error(activeResult.error.message);
    const hasActiveRate = new Set<string>();
    for (const row of activeResult.data) {
      const roomKey = roomKeyByUuid.get(row.room_id);
      if (roomKey) hasActiveRate.add(`${roomKey}|${row.stay_date}`);
    }
    for (const cell of roomBlockCells.keys()) if (!hasActiveRate.has(cell)) blocked.add(cell);
  }

  // 캘린더 행 순서(건물 탭 순 → 객실 이름 숫자 순) — 격자의 `sortRooms` 그대로.
  const rooms = sortRooms(
    [...propertyOfRoom]
      .filter(([, propertyName]) => inView(propertyName))
      .map(([key, propertyName]) => ({
        displayRoomLabel: labelOfRoom.get(key) ?? key,
        key,
        propertyName,
        roomIds: [],
      })),
  ).map((room) => ({
    inCatalog: catalogKeys.has(room.key),
    key: room.key,
    label: room.displayRoomLabel,
    propertyName: room.propertyName,
  }));
  const properties = selected.length > 0 ? selected : propertyOptions;

  return {
    blocks: [...blocked].map((cell) => {
      const [roomKey, date] = [cell.slice(0, cell.lastIndexOf("|")), cell.slice(cell.lastIndexOf("|") + 1)];
      return { endDate: date, roomKey, startDate: date };
    }),
    properties,
    reservations: reservations.filter((reservation) => inView(reservation.propertyName)),
    rooms,
  };
}

/**
 * 칸 하나의 가격·최소숙박·차단 변경 이력(최신순, 최대 `HISTORY_PER_CELL` 줄 + 전체 횟수).
 *
 * 호버 카드가 뜰 때 그 칸 것만 읽는다(2026-09-30 속도 — 예전에는 창 전체 이력을 페이지와 함께 보냈다).
 * 부르는 쪽이 **조직 권한을 확인한** 뒤 `roomIds`(그 행 뒤의 유닛 전부)를 넘긴다. 조회는 조직으로도
 * 거르므로 다른 조직의 유닛 id 는 아무것도 돌려주지 않는다.
 */
export async function readOpsCellHistory(args: {
  organizationId: string;
  supabase: SupabaseClient<Database>;
  roomIds: string[];
  date: string;
}): Promise<CellHistory | null> {
  if (args.roomIds.length === 0) return null;
  const result = await readAllPages<HistoryLogRow>((from, to) =>
    args.supabase
      .from("price_change_logs")
      .select(
        "room_id, room_label, stay_date, field, old_value, new_value, created_at, changed_by_name, adjust_mode, percent_value",
      )
      .eq("organization_id", args.organizationId)
      .in("room_id", args.roomIds)
      .eq("stay_date", args.date)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (result.error) throw new Error(result.error.message);
  const rows: PriceHistoryRow[] = result.data.map((row) => ({
    at: row.created_at,
    by: row.changed_by_name,
    field: row.field,
    mode: row.adjust_mode,
    newValue: row.new_value,
    oldValue: row.old_value,
    percent: row.percent_value,
    // 한 칸만 읽으므로 칸 키는 하나다 — 행 키 대신 고정값으로 묶는다.
    roomLabel: "cell",
    stayDate: args.date,
  }));
  return buildHistoryByCell(rows).get(historyCellKey("cell", args.date)) ?? null;
}

/**
 * ── 가격 개입 전환 ────────────────────────────────────────────────────
 *
 * 「가격을 바꾼 뒤 48시간 안에 그 방·그 날짜로 들어온 예약」. 판정은 순수 모듈
 * (`ops-price-attribution.ts`, 저쪽 `priceAttribution.js` 와 같은 규칙).
 *
 * **보고 있는 창 × 고른 건물만** 판정한다(2026-10-02 사용자 지시 — 예전엔 「가격을 바꾼 시각 기준 최근 90일 전체」라
 * 달을 넘겨도 · 「전체」로 봐도 같은 목록이 남아 지금 보는 캘린더와 맞지 않았다). 창 안의 **숙박 날짜**에 걸린 가격
 * 변경만 읽으므로 과거 달로 가도 그 달 것이 나온다. 그 예약의 「바꾼 밤」도 창 안의 밤만 센다.
 *
 * **캘린더 본 데이터와 따로 받는다**(2026-09-30 속도). 90일 조직 전체 로그 + 예약 재조회라 가장 느린
 * 단계였는데 창과 무관하다 — 격자가 먼저 그려지고 이 목록은 서버 액션으로 뒤따라 온다.
 * 건물을 고르면 그 건물 객실의 판정만 돌려준다(격자가 보이는 객실로 한 번 더 거른다).
 */
export async function getOpsPriceConversions(
  session: AppSession,
  filters: { properties?: readonly string[]; start: string; end: string },
): Promise<OpsPriceConversion[]> {
  const supabase = await getSupabaseServerClient();
  const [roomRowsResult, logsResult] = await Promise.all([
    fetchRoomCatalogRows(session.organization.id, supabase),
    readAllPages<{
      id: string;
      job_id: string | null;
      room_id: string | null;
      stay_date: string;
      old_value: number | null;
      new_value: number | null;
      created_at: string;
      changed_by_name: string | null;
    }>((from, to) =>
      supabase
        .from("price_change_logs")
        .select("id, job_id, room_id, stay_date, old_value, new_value, created_at, changed_by_name")
        .eq("organization_id", session.organization.id)
        .eq("field", "price1")
        .gte("stay_date", filters.start)
        .lte("stay_date", filters.end)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (roomRowsResult.error) {
    console.error("[ops-calendar] room read failed", roomRowsResult.error);
  }
  if (logsResult.error) {
    console.error("[ops-calendar] price attribution log read failed", logsResult.error);
  }
  const roomCatalog = roomRowsResult.error
    ? undefined
    : buildActiveRoomCatalog(roomRowsResult.data, { includeNonOperationalProperties: true });
  const reservationRoomAxis = makeReservationRoomAxis(roomCatalog);
  const { roomKeyByUuid } = mapRoomUnits(roomRowsResult.error ? [] : roomRowsResult.data);

  const cells: AttributionCell[] = [];
  // 우리 작업이 쓴 칸(방·날짜·값 → 시각). 워커가 Beds24 에 쓰고 **우리 표를 고치기 전 몇 초 사이**에
  // 요금 동기화가 돌면 같은 변경이 「Beds24」로 한 번 더 남는다 — 그건 우리 개입이다.
  const jobWrites = new Map<string, number[]>();
  for (const row of logsResult.data ?? []) {
    if (!row.job_id || !row.room_id) continue;
    const key = `${row.room_id}|${row.stay_date}|${row.new_value}`;
    jobWrites.set(key, [...(jobWrites.get(key) ?? []), Date.parse(row.created_at)]);
  }
  const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
  for (const row of logsResult.data ?? []) {
    const roomKey = row.room_id ? roomKeyByUuid.get(row.room_id) : undefined;
    if (!roomKey) continue;
    if (!row.job_id) {
      const ours = jobWrites.get(`${row.room_id}|${row.stay_date}|${row.new_value}`) ?? [];
      const at = Date.parse(row.created_at);
      if (ours.some((jobAt) => at >= jobAt && at - jobAt < DUPLICATE_WINDOW_MS)) continue;
    }
    cells.push({
      appliedAtMs: Date.parse(row.created_at),
      changedBy: row.changed_by_name,
      // 우리 앱 변경은 작업(job) 단위, Beds24 쪽 변경은 **한 번의 동기화가 같은 시각으로 남긴다**
      // (`room-rates-sync.ts`) — 시각으로 묶어 한 번의 개입으로 본다.
      groupId: row.job_id ?? `beds24:${row.created_at}`,
      newValue: row.new_value,
      oldValue: row.old_value,
      roomKey,
      stayDate: row.stay_date,
    });
  }

  /*
   * 개입 묶음의 적용 시각은 **모든 객실의 칸**으로 정한다(한 작업이 여러 건물에 걸칠 수 있다) — 그래서
   * 로그는 조직 전체를 읽는다. 예약은 보이는 객실의 칸만 판정되므로 **그 칸들의 날짜**만 덮으면 된다.
   */
  const scopedRoomKeys =
    filters.properties && filters.properties.length > 0
      ? new Set(scopeRoomUuids(roomKeyByUuid, filters.properties).map((roomUuid) => roomKeyByUuid.get(roomUuid)))
      : null;
  const visibleCells = scopedRoomKeys ? cells.filter((cell) => scopedRoomKeys.has(cell.roomKey)) : cells;
  if (visibleCells.length === 0) return [];

  const stayDates = visibleCells.map((cell) => cell.stayDate).sort();
  // 바꾼 날짜를 덮는 확정 예약 전부 — 「그때 비어 있었나」를 재려면 창 밖 예약도 필요하다.
  const bookingsResult = await readAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("reservations")
      .select(RESERVATION_SELECT)
      .eq("organization_id", session.organization.id)
      .lte("check_in_date", stayDates[stayDates.length - 1])
      .gt("check_out_date", stayDates[0])
      .order("check_in_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as SlimReservationPage,
  ).then(toReservationRows);
  if (bookingsResult.error) {
    console.error("[ops-calendar] price attribution booking read failed", bookingsResult.error);
  }
  const attributionBookings: AttributionReservation[] = [];
  const shown = new Map<string, { row: ReservationRow; roomKey: string; propertyName: string; label: string }>();
  for (const row of bookingsResult.data ?? []) {
    if (row.status === "cancelled" || row.status === "no_show") continue;
    if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
    const axis = reservationRoomAxis(row);
    const raw =
      row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
        ? (row.raw_payload as Record<string, unknown>)
        : {};
    const bookedAt = typeof raw.bookingTime === "string" ? Date.parse(raw.bookingTime) : NaN;
    attributionBookings.push({
      checkIn: row.check_in_date,
      checkOut: row.check_out_date,
      createdAtMs: Number.isFinite(bookedAt) ? bookedAt : null,
      id: row.id,
      roomKey: axis.roomKey,
    });
    shown.set(row.id, {
      label: axis.displayRoomLabel,
      propertyName: axis.propertyName,
      roomKey: axis.roomKey,
      row,
    });
  }

  const priceConversions: OpsPriceConversion[] = [];
  for (const conversion of attributePriceConversions({
    cells,
    reservations: attributionBookings,
    windowHours: PRICE_ATTRIBUTION_WINDOW_HOURS,
  })) {
    const booking = shown.get(conversion.reservationId);
    if (!booking) continue;
    // 건물을 골랐으면 그 건물(들) 객실 것만 보낸다 — 격자가 보이는 객실로 한 번 더 거른다.
    if (scopedRoomKeys && !scopedRoomKeys.has(booking.roomKey)) continue;
    priceConversions.push({
      appliedAt: new Date(conversion.appliedAtMs).toISOString(),
      bookedAt: new Date(conversion.bookingCreatedAtMs).toISOString(),
      changedBy: conversion.changedBy,
      channel: opsChannelOf(booking.row.source),
      checkIn: booking.row.check_in_date,
      checkOut: booking.row.check_out_date,
      delta: conversion.delta,
      guestName: booking.row.guest_name,
      hoursToBooking: conversion.hoursToBooking,
      newAverage: conversion.newAverage,
      nights: conversion.nights.length,
      oldAverage: conversion.oldAverage,
      percent: conversion.percent,
      propertyName: booking.propertyName,
      reservationId: conversion.reservationId,
      roomKey: booking.roomKey,
      roomLabel: booking.label,
    });
  }
  return priceConversions;
}

/** 최근 들어온 예약 한 건(2026-10-05 「최근 예약」 — 가격 개입 성공의 반대). */
export type OpsRecentBooking = {
  reservationId: string;
  roomKey: string;
  roomLabel: string;
  propertyName: string;
  guestName: string;
  channel: OpsCalendarChannel;
  checkIn: string;
  checkOut: string;
  /** Beds24 `bookingTime`(UTC ISO). 화면이 도쿄로 바꾼다. */
  bookedAt: string;
  /** 예약 금액(매출 요약과 같은 읽기 — `invoiceItems` 합 → `price` → `amount`). 모르면 0. */
  amount: number;
  /**
   * 가격 개입 성공에도 잡혔으면 그 판정(2026-10-28 — 예전엔 목록에서 뺐다, 이제 표시만 붙인다). 아니면 `null`.
   * 이전 → 이후는 그 예약의 바꾼 밤 평균.
   */
  priceWin: { oldAverage: number | null; newAverage: number | null; percent: number | null; hoursToBooking: number } | null;
};

/**
 * **최근 예약** — 정한 시간대(`fromMs` ≤ 예약 시각 < `toMs`)에 들어온 확정 예약 **전부**. 가격 개입 성공에도 잡힌
 * 예약은 빼지 않고 `priceWin` 을 붙인다(2026-10-28 사용자 결정 — 예전 2026-10-05 「뺀다」를 바꿈: 빼면 건수가 Beds24 와
 * 어긋나고, 가격 개입은 추정이라 실제 예약을 숨기면 안 된다). 화면은 「손대지 않음 N · 가격 개입 N」으로 나눠 보여 준다.
 *
 * 범위는 가격 개입 성공과 같다 — **보고 있는 창에 숙박이 걸친 예약 × 고른 건물**. 예약 시각은 Beds24 `bookingTime`
 * (격자 · 가격 개입 판정과 같은 값), 없으면 넣지 않는다. 표시를 붙이려고 같은 창의 가격 개입 판정을 함께 돌린다.
 */
function priceWinOf(conversion: OpsPriceConversion | undefined): OpsRecentBooking["priceWin"] {
  if (!conversion) return null;
  return {
    hoursToBooking: conversion.hoursToBooking,
    newAverage: conversion.newAverage,
    oldAverage: conversion.oldAverage,
    percent: conversion.percent,
  };
}

export async function getOpsRecentBookings(
  session: AppSession,
  filters: { properties?: readonly string[]; start: string; end: string; fromMs: number; toMs: number },
): Promise<OpsRecentBooking[]> {
  const supabase = await getSupabaseServerClient();
  const endExclusive = addDays(filters.end, 1);
  const [roomRowsResult, bookingsResult, conversions] = await Promise.all([
    fetchRoomCatalogRows(session.organization.id, supabase),
    readAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("reservations")
        .select(SALES_RESERVATION_SELECT)
        .eq("organization_id", session.organization.id)
        .lt("check_in_date", endExclusive)
        .gt("check_out_date", filters.start)
        .order("check_in_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as SlimReservationPage,
    ),
    getOpsPriceConversions(session, { end: filters.end, properties: filters.properties, start: filters.start }),
  ]);
  if (roomRowsResult.error) throw new Error(roomRowsResult.error.message);
  if (bookingsResult.error) throw new Error(bookingsResult.error.message);
  const roomCatalog = buildActiveRoomCatalog(roomRowsResult.data, { includeNonOperationalProperties: true });
  const reservationRoomAxis = makeReservationRoomAxis(roomCatalog);
  const priceWon = new Map(conversions.map((conversion) => [conversion.reservationId, conversion]));
  const wanted = new Set(filters.properties ?? []);

  const result: OpsRecentBooking[] = [];
  for (const raw of bookingsResult.data) {
    const row = toReservationRow(raw);
    if (row.status === "cancelled" || row.status === "no_show") continue;
    if (isExcludedOperationalRoom(row.property_name, row.room_label)) continue;
    const bookingTime = (row.raw_payload as Record<string, unknown> | null)?.bookingTime;
    const bookedAtMs = typeof bookingTime === "string" ? Date.parse(bookingTime) : NaN;
    if (!Number.isFinite(bookedAtMs) || bookedAtMs < filters.fromMs || bookedAtMs >= filters.toMs) continue;
    // 문의 · 차단 예약(원본 `request` · `black` …)은 우리 표에서 `confirmed` 로 적혀도 예약이 아니다.
    const sales: SalesRawPayload = {};
    for (const key of SALES_PAYLOAD_KEYS) {
      const value = raw[`sp_${key}`];
      if (value !== null && value !== undefined) (sales as Record<string, unknown>)[key] = value;
    }
    if (!isSalesCountedReservation({ raw: sales, status: row.status })) continue;
    const axis = reservationRoomAxis(row);
    if (wanted.size > 0 && !wanted.has(axis.propertyName)) continue;
    result.push({
      amount: legacyReservationAmount(sales),
      bookedAt: new Date(bookedAtMs).toISOString(),
      channel: opsChannelOf(row.source),
      checkIn: row.check_in_date,
      checkOut: row.check_out_date,
      guestName: row.guest_name,
      priceWin: priceWinOf(priceWon.get(row.id)),
      propertyName: axis.propertyName,
      reservationId: row.id,
      roomKey: axis.roomKey,
      roomLabel: axis.displayRoomLabel,
    });
  }
  // 최근 것부터.
  return result.sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
}

/** 캘린더 밖에서 예약 한 건을 열 때 — 상세 패널이 격자에서 연 것과 같은 값을 받게 한다. */
export type OpsReservationPlacement = {
  bar: OpsCalendarBar;
  propertyName: string;
  /** 그 행의 우리 `rooms.id` 전부 — 예약 수정의 겹침 검사가 쓴다. */
  roomIds: string[];
  roomLabel: string;
};

/**
 * 예약 행 → 판매 캘린더의 막대 + 객실 행.
 *
 * 격자와 **같은 매핑**(`makeReservationRoomAxis` · `mapRoomUnits`)을 쓴다 — 검색에서 연 패널과
 * 막대를 눌러 연 패널이 다른 방을 가리키면 수정이 엉뚱한 유닛에 붙는다.
 */
export async function resolveOpsReservationPlacements(
  organizationId: string,
  supabase: SupabaseClient<Database>,
  rows: Pick<
    ReservationRow,
    "check_in_date" | "check_out_date" | "guest_name" | "id" | "property_name" | "raw_payload" | "room_label" | "source" | "status"
  >[],
): Promise<OpsReservationPlacement[]> {
  if (rows.length === 0) return [];
  const roomRowsResult = await fetchRoomCatalogRows(organizationId, supabase);
  const roomCatalog = roomRowsResult.error
    ? undefined
    : buildActiveRoomCatalog(roomRowsResult.data, { includeNonOperationalProperties: true });
  const reservationRoomAxis = makeReservationRoomAxis(roomCatalog);
  const { roomKeyByUuid } = mapRoomUnits(roomRowsResult.error ? [] : roomRowsResult.data);

  return rows.map((row) => {
    const { displayRoomLabel, propertyName, roomKey } = reservationRoomAxis(row);
    return {
      bar: {
        channel: opsChannelOf(row.source),
        checkIn: row.check_in_date,
        checkOut: row.check_out_date,
        guestName: row.guest_name,
        id: row.id,
        isCancelled: row.status === "cancelled" || row.status === "no_show",
        roomKey,
      },
      propertyName,
      roomIds: [...roomKeyByUuid].filter(([, key]) => key === roomKey).map(([uuid]) => uuid),
      roomLabel: displayRoomLabel,
    };
  });
}
