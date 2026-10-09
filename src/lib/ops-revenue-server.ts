import "server-only";

import { toJstDateString } from "@/lib/admin-calendar-dashboard";
import { readOpsSalesInputs } from "@/lib/ops-calendar";
import {
  addCell,
  anchorMonth,
  chartMonths,
  emptyCell,
  lastDayOfMonth,
  previousYearRange,
  splitByMonth,
  type RevenueCell,
  type RevenueMode,
  type RevenueRange,
} from "@/lib/ops-revenue";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { buildOpsSalesSummary, defaultSalesExcluded, type SalesRawPayload } from "@/lib/ops-sales-summary";
import { ensureOpsStatsMonths, firstReservationMonth, readOpsStatsRows, type OpsStatsRow } from "@/lib/ops-stats";
import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 매출 화면의 읽기 — 판매 캘린더 「매출 요약」과 **같은 읽기(`readOpsSalesInputs`) · 같은 식(`buildOpsSalesSummary`)**.
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 화면」
 *
 * 달 조각마다 요약을 낸다 — **달 전체 조각은 객실 × 월 집계 표**(`ops-stats.ts`, 2026-10-08 속도)에서, 달 일부 조각(주 ·
 * 직접 기간의 끝)은 그 며칠만 바로 계산한다. 둘 다 같은 함수(`buildOpsSalesSummary`)의 결과다. 조각마다 그 달 판매가 없는
 * 건물은 분모(객실박)를 0 으로 둔다(「문 열기 전」 — `ops-revenue.ts`). 비율은 화면이 합을 다시 나눠 낸다.
 */

export type OpsRevenueRoom = { key: string; label: string };

export type OpsRevenueProperty = {
  name: string;
  /** 객실 목록(카탈로그)의 방 수. */
  roomCount: number;
  /** 합계에서 기본으로 빼는 건물(오쿠보A · 사노 — 판매 캘린더 매출 요약과 같다). */
  defaultExcluded: boolean;
  rooms: OpsRevenueRoom[];
};

export type OpsRevenueCells = Record<string, RevenueCell>;

export type OpsRevenueData = {
  today: string;
  mode: RevenueMode;
  range: RevenueRange;
  previousRange: RevenueRange;
  /** 그래프 · 매트릭스 15칸(기준 달 앞 11 ~ 뒤 3). */
  months: string[];
  properties: OpsRevenueProperty[];
  /** 달 → 건물 → 칸. 그래프 15달과 그 전년 15달. */
  monthCells: Record<string, OpsRevenueCells>;
  /** 달 → 객실 키 → 칸. 그래프 15달만(매트릭스 칸을 눌렀을 때의 객실 목록). */
  monthRoomCells: Record<string, OpsRevenueCells>;
  rangeCells: OpsRevenueCells;
  previousRangeCells: OpsRevenueCells;
  rangeRoomCells: OpsRevenueCells;
  previousRangeRoomCells: OpsRevenueCells;
  /**
   * 가동률 「앞으로」 탭(2026-10-07) — 이번 달부터 `forward` 달. 부를 때 `forward` 를 줄 때만 채운다.
   * **문 열기 전 규칙을 쓰지 않는다**(분모 = 객실 수 × 일수) — 앞날은 예약이 0 이어도 팔 방이다.
   */
  forwardMonths: string[];
  forwardCells: Record<string, OpsRevenueCells>;
  /** 앞으로 달의 전년 같은 달(끝난 값 · 문 열기 전 규칙 그대로). */
  forwardPreviousCells: Record<string, OpsRevenueCells>;
};

type Piece = { start: string; endExclusive: string };
type PieceResult = { properties: Map<string, RevenueCell>; rooms: Map<string, RevenueCell> };

export async function getOpsRevenueData(
  session: AppSession,
  args: { mode: RevenueMode; range: RevenueRange; forward?: number },
): Promise<OpsRevenueData> {
  const today = toJstDateString(new Date());
  const { mode, range } = args;
  const previousRange = previousYearRange(range);
  const months = chartMonths(anchorMonth(range, today));
  const forwardMonths = Array.from({ length: args.forward ?? 0 }, (_, index) => shiftMonthKey(today.slice(0, 7), index));
  const allMonths = [
    ...months.map((month) => shiftMonthKey(month, -12)),
    ...months,
    ...forwardMonths,
    ...forwardMonths.map((month) => shiftMonthKey(month, -12)),
  ];

  const monthPiece = (month: string): Piece => ({ endExclusive: nextDay(lastDayOfMonth(month)), start: `${month}-01` });
  const rangePieces = splitByMonth(range);
  const previousPieces = splitByMonth(previousRange);
  const everything: Piece[] = [...allMonths.map(monthPiece), ...rangePieces, ...previousPieces];

  const { cache, inputs, summarize } = await createRevenueSummarizer(session.organization.id, everything, today);

  const toRecord = (map: Map<string, RevenueCell>): OpsRevenueCells => Object.fromEntries(map);
  const sumPieces = (pieces: Piece[]) => {
    const properties = new Map<string, RevenueCell>();
    const rooms = new Map<string, RevenueCell>();
    for (const piece of pieces) {
      const result = summarize(piece);
      for (const [key, cell] of result.properties) addCell(properties.get(key) ?? setNew(properties, key), cell);
      for (const [key, cell] of result.rooms) addCell(rooms.get(key) ?? setNew(rooms, key), cell);
    }
    return { properties: toRecord(properties), rooms: toRecord(rooms) };
  };

  const monthCells: Record<string, OpsRevenueCells> = {};
  for (const month of allMonths) monthCells[month] = toRecord(summarize(monthPiece(month)).properties);
  const monthRoomCells: Record<string, OpsRevenueCells> = {};
  for (const month of months) monthRoomCells[month] = toRecord(summarize(monthPiece(month)).rooms);
  const forwardCells: Record<string, OpsRevenueCells> = {};
  const forwardPreviousCells: Record<string, OpsRevenueCells> = {};
  for (const month of forwardMonths) {
    forwardCells[month] = toRecord(summarize(monthPiece(month), true).properties);
    forwardPreviousCells[month] = toRecord(summarize(monthPiece(shiftMonthKey(month, -12))).properties);
  }
  const current = sumPieces(rangePieces);
  const previous = sumPieces(previousPieces);

  // 건물 · 객실 목록 — 캘린더 행 순서. 목록 밖 방은 이 창 어딘가에 매출이 있을 때만(빈 줄은 소음이다).
  const withRevenue = new Set<string>();
  for (const [cacheKey, result] of cache) {
    if (cacheKey.endsWith("|raw")) continue;
    for (const [key, cell] of result.rooms) if (cell.revenue > 0) withRevenue.add(key);
  }
  const excluded = new Set(defaultSalesExcluded(inputs.properties));
  const properties: OpsRevenueProperty[] = inputs.properties.map((name) => {
    const rooms = inputs.rooms.filter((room) => room.propertyName === name && (room.inCatalog || withRevenue.has(room.key)));
    return {
      defaultExcluded: excluded.has(name),
      name,
      roomCount: rooms.filter((room) => room.inCatalog).length,
      rooms: rooms.map((room) => ({ key: room.key, label: room.label ?? room.key })),
    };
  });

  return {
    forwardCells,
    forwardMonths,
    forwardPreviousCells,
    mode,
    monthCells,
    monthRoomCells,
    months,
    previousRange,
    previousRangeCells: previous.properties,
    previousRangeRoomCells: previous.rooms,
    properties,
    range,
    rangeCells: current.properties,
    rangeRoomCells: current.rooms,
    today,
  };
}

// ── 비교(A vs B) ─────────────────────────────────────────────────────────

export type OpsRevenueComparePeriod = { mode: RevenueMode; range: RevenueRange };

export type OpsRevenueCompareData = {
  today: string;
  a: OpsRevenueComparePeriod;
  b: OpsRevenueComparePeriod;
  properties: Array<{ name: string; roomCount: number; defaultExcluded: boolean }>;
  /** 건물 → 칸. 기간을 달로 잘라 요약한 합(문 열기 전 규칙은 달마다). */
  aCells: OpsRevenueCells;
  bCells: OpsRevenueCells;
  /** 객실 행 키 → 칸(같은 식). 「기존 건물의 새 객실」을 떼어 내는 데만 쓴다 — 건물 숫자는 `aCells` · `bCells` 그대로. */
  aRoomCells: OpsRevenueCells;
  bRoomCells: OpsRevenueCells;
  /** 건물 → 객실 행(캘린더 행 키 · 이름, 듀얼 유닛 = 한 행). */
  rooms: Record<string, Array<{ key: string; label: string }>>;
  /**
   * 객실 행 키 → 첫 판매일(그 방의 확정 예약 중 가장 이른 체크인). 우리 예약 기록이 시작된 2024-05 보다 앞서 연 방은
   * 그 시작 무렵 날짜다 — 「처음부터 있던 방」으로 읽힌다.
   */
  roomFirstSale: Record<string, string>;
};


/**
 * 매출 비교 — 두 기간 A · B 를 같은 읽기 · 같은 식으로(2026-10-08, 시안 「매출 비교」 1번 v4).
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 비교」
 */
export async function getOpsRevenueCompareData(
  session: AppSession,
  args: { a: OpsRevenueComparePeriod; b: OpsRevenueComparePeriod },
): Promise<OpsRevenueCompareData> {
  const today = toJstDateString(new Date());
  const aPieces = splitByMonth(args.a.range);
  const bPieces = splitByMonth(args.b.range);
  const everything: Piece[] = [...aPieces, ...bPieces];
  const organizationId = session.organization.id;
  const { inputs, summarize, supabase } = await createRevenueSummarizer(organizationId, everything, today);
  const sum = (pieces: Piece[], level: "properties" | "rooms") => {
    const out = new Map<string, RevenueCell>();
    for (const piece of pieces) for (const [key, cell] of summarize(piece)[level]) addCell(out.get(key) ?? setNew(out, key), cell);
    return Object.fromEntries(out) as OpsRevenueCells;
  };
  // 객실 첫 판매일 = 집계 표 모든 달의 「그 달 첫 체크인」 최솟값 — 예약 기록 첫 달부터 늦은 쪽 기간까지 표를 최신으로 맞춘 뒤.
  const roomFirstSale: Record<string, string> = {};
  const firstMonth = await firstReservationMonth(supabase, organizationId);
  const lastMonth = [args.a.range.to, args.b.range.to].sort()[1].slice(0, 7);
  if (firstMonth && firstMonth <= lastMonth) {
    const history: string[] = [];
    for (let month = firstMonth; month <= lastMonth; month = shiftMonthKey(month, 1)) history.push(month);
    await ensureOpsStatsMonths(supabase, organizationId, history);
    for (const row of await readOpsStatsRows(supabase, organizationId, history)) {
      if (!row.firstCheckIn) continue;
      const seen = roomFirstSale[row.roomKey];
      if (!seen || row.firstCheckIn < seen) roomFirstSale[row.roomKey] = row.firstCheckIn;
    }
  }
  const rooms: Record<string, Array<{ key: string; label: string }>> = {};
  for (const room of inputs.rooms) {
    if (!room.inCatalog) continue;
    (rooms[room.propertyName] ??= []).push({ key: room.key, label: room.label ?? room.key });
  }
  const excluded = new Set(defaultSalesExcluded(inputs.properties));
  return {
    a: args.a,
    aCells: sum(aPieces, "properties"),
    aRoomCells: sum(aPieces, "rooms"),
    b: args.b,
    bCells: sum(bPieces, "properties"),
    bRoomCells: sum(bPieces, "rooms"),
    roomFirstSale,
    rooms,
    properties: inputs.properties.map((name) => ({
      defaultExcluded: excluded.has(name),
      name,
      roomCount: inputs.rooms.filter((room) => room.propertyName === name && room.inCatalog).length,
    })),
    today,
  };
}

// ── 대시보드 홈(화이트 리디자인 2026-10-09) ───────────────────────────────

export type DashboardOpsSummary = {
  month: string;
  today: string;
  /** 고른 달 매출 합계(지난 날 실적 + 남은 날 예약 확정). 기본 제외 건물(오쿠보A · 사노)은 매출 화면처럼 뺀다. */
  revenue: number;
  /** 오늘(이번 달일 때)까지 실적 · 그 날짜. 지난 달이면 달 전체, 앞날이면 0 · null. */
  actualToDate: number;
  actualThroughDay: number | null;
  /** 전월 같은 기간(1일 ~ 같은 날) 실적 대비 % — 비교 불가면 null. */
  changePct: number | null;
  daily: Array<{ day: number; revenue: number; actual: boolean; today: boolean }>;
  occupancyPct: number;
  occupiedNights: number;
  availableNights: number;
  previousOccupancyPct: number;
  buildings: Array<{ name: string; pct: number }>;
  months: Array<{ month: string; revenue: number; occupancyPct: number }>;
};

/**
 * 관리자 대시보드 홈의 「매출 · 가동률」 · 「최근 6개월」 — 매출 · 가동률 화면과 **같은 요약기(`createRevenueSummarizer`)**.
 * 날짜별 막대는 그 달 예약을 한 번 읽고 하루씩 같은 식(`buildOpsSalesSummary`)으로 나눈다(31번 읽지 않는다).
 * 운영 관리자 게이트를 지난 뒤에만 부른다(`canAccessOpsAdmin`).
 */
export async function getDashboardOpsSummary(session: AppSession, monthArg?: string): Promise<DashboardOpsSummary> {
  const today = toJstDateString(new Date());
  const thisMonth = today.slice(0, 7);
  const month = monthArg && /^\d{4}-\d{2}$/.test(monthArg) ? monthArg : thisMonth;
  const prevMonth = shiftMonthKey(month, -1);
  const months6 = Array.from({ length: 6 }, (_, index) => shiftMonthKey(month, index - 5));
  const monthPiece = (key: string): Piece => ({ endExclusive: nextDay(lastDayOfMonth(key)), start: `${key}-01` });

  const lastDay = Number(lastDayOfMonth(month).slice(8, 10));
  const throughDay = month === thisMonth ? Number(today.slice(8, 10)) : month < thisMonth ? lastDay : null;
  const prevLastDay = Number(lastDayOfMonth(prevMonth).slice(8, 10));
  const toDatePiece: Piece | null = throughDay ? { endExclusive: nextDay(`${month}-${String(throughDay).padStart(2, "0")}`), start: `${month}-01` } : null;
  const prevToDatePiece: Piece | null = throughDay
    ? { endExclusive: nextDay(`${prevMonth}-${String(Math.min(throughDay, prevLastDay)).padStart(2, "0")}`), start: `${prevMonth}-01` }
    : null;

  const pieces: Piece[] = [...months6.map(monthPiece), monthPiece(prevMonth)];
  if (toDatePiece) pieces.push(toDatePiece);
  if (prevToDatePiece) pieces.push(prevToDatePiece);
  const organizationId = session.organization.id;
  const { inputs, summarize, supabase } = await createRevenueSummarizer(organizationId, pieces, today);
  const excluded = new Set(defaultSalesExcluded(inputs.properties));
  const included = inputs.properties.filter((name) => !excluded.has(name));
  const total = (piece: Piece | null) => {
    const cell = emptyCell();
    if (!piece) return cell;
    const result = summarize(piece);
    for (const name of included) {
      const part = result.properties.get(name);
      if (part) addCell(cell, part);
    }
    return cell;
  };

  const current = total(monthPiece(month));
  const previous = total(monthPiece(prevMonth));
  const actual = total(toDatePiece);
  const prevActual = total(prevToDatePiece);
  const pct = (cell: RevenueCell) => (cell.availableNights > 0 ? (cell.occupiedNights / cell.availableNights) * 100 : 0);
  const currentResult = summarize(monthPiece(month));

  // 날짜별 매출 — 그 달 예약을 한 번만 읽는다.
  const monthWindow = monthPiece(month);
  const raw = await readOpsSalesInputs({ concurrency: 4, organizationId, properties: [], supabase, window: monthWindow, withBlocks: false });
  const reservations = raw.reservations.map((r) => ({ ...r, raw: r.raw as SalesRawPayload }));
  const daily: DashboardOpsSummary["daily"] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const start = `${month}-${String(day).padStart(2, "0")}`;
    const summary = buildOpsSalesSummary({
      blocks: [],
      endExclusive: nextDay(start),
      negativeAmounts: "include",
      properties: raw.properties,
      reservations,
      rooms: raw.rooms,
      start,
      today,
    });
    const revenue = summary.byProperty.filter((row) => !excluded.has(row.propertyName)).reduce((sum, row) => sum + row.revenue, 0);
    daily.push({ actual: throughDay !== null && day <= throughDay, day, revenue, today: month === thisMonth && day === throughDay });
  }

  return {
    actualThroughDay: throughDay,
    actualToDate: actual.revenue,
    availableNights: current.availableNights,
    buildings: included
      .map((name) => ({ name, pct: pct(currentResult.properties.get(name) ?? emptyCell()) }))
      .filter((row) => (currentResult.properties.get(row.name)?.availableNights ?? 0) > 0),
    changePct: prevActual.revenue > 0 ? ((actual.revenue - prevActual.revenue) / prevActual.revenue) * 100 : null,
    daily,
    month,
    months: months6.map((key) => {
      const cell = total(monthPiece(key));
      return { month: key, occupancyPct: pct(cell), revenue: cell.revenue };
    }),
    occupancyPct: pct(current),
    occupiedNights: current.occupiedNights,
    previousOccupancyPct: pct(previous),
    revenue: current.revenue,
    today,
  };
}

/**
 * 조각들의 매출 요약을 미리 모아 두고 꺼내 주는 함수 — 매출 화면 · 가동률 · 비교가 같이 쓴다(2026-10-08 집계 표).
 *
 * - **달 전체 조각**: 집계 표(`ops_room_month_stats`)에서. 없거나 dirty 인 달은 먼저 계산한다(`ensureOpsStatsMonths`).
 * - **달 일부 조각**: 그 조각만 바로 계산한다(창이 며칠이라 빠르다).
 *
 * 조각마다 그 달 판매가 없는 건물은 분모(객실박)를 0 으로 둔다(「문 열기 전」). `raw` 면 그 규칙 없이(「앞으로」 탭).
 * 화면 게이트(`requireOpsAdminPage`)를 지난 뒤에만 부른다 — 서버 전용 service role 로 읽는다(집계 표는 RLS 정책이 없다).
 */
async function createRevenueSummarizer(organizationId: string, pieces: readonly Piece[], today: string) {
  const supabase = getSupabaseServiceClient();
  const isFullMonth = (piece: Piece) => piece.start.endsWith("-01") && piece.endExclusive === `${shiftMonthKey(piece.start.slice(0, 7), 1)}-01`;
  const fullMonths = [...new Set(pieces.filter(isFullMonth).map((piece) => piece.start.slice(0, 7)))];
  const partial = [...new Map(pieces.filter((piece) => !isFullMonth(piece)).map((piece) => [`${piece.start}|${piece.endExclusive}`, piece])).values()];

  // 객실 목록(건물 · 객실 행 순서) — 예약은 창 0일(오늘)만이라 거의 안 읽는다.
  const catalogPromise = readOpsSalesInputs({ organizationId, properties: [], supabase, window: { endExclusive: today, start: today }, withBlocks: false });
  const statsPromise = (async () => {
    await ensureOpsStatsMonths(supabase, organizationId, fullMonths);
    return readOpsStatsRows(supabase, organizationId, fullMonths);
  })();
  const livePromise = Promise.all(
    partial.map(async (piece) => {
      const inputs = await readOpsSalesInputs({ concurrency: 4, organizationId, properties: [], supabase, window: piece, withBlocks: false });
      const summary = buildOpsSalesSummary({
        blocks: [],
        endExclusive: piece.endExclusive,
        // 저쪽 매출 화면(`RevenueDashboard`)은 마이너스 금액 예약도 그대로 더한다 — 그 화면과 숫자를 맞춘다(2026-10-07).
        negativeAmounts: "include",
        properties: inputs.properties,
        reservations: inputs.reservations.map((r) => ({ ...r, raw: r.raw as SalesRawPayload })),
        rooms: inputs.rooms,
        start: piece.start,
        today,
      });
      const rows: OpsStatsRow[] = [];
      for (const property of summary.byProperty) {
        for (const room of property.rooms) {
          if (!room.inCatalog && room.revenue === 0 && room.occupiedNights === 0) continue;
          rows.push({
            airbnb: room.channelRevenue.airbnb,
            availableNights: room.availableNights,
            booking: room.channelRevenue.booking,
            commission: room.commission,
            direct: room.channelRevenue.direct,
            firstCheckIn: null,
            inCatalog: room.inCatalog,
            month: piece.start.slice(0, 7),
            occupiedNights: room.occupiedNights,
            other: room.channelRevenue.other,
            propertyName: property.propertyName,
            revenue: room.revenue,
            roomKey: room.key,
            roomLabel: room.label,
          });
        }
      }
      return [`${piece.start}|${piece.endExclusive}`, rows] as const;
    }),
  );
  const [catalog, statsRows, live] = await Promise.all([catalogPromise, statsPromise, livePromise]);

  const rowsByPiece = new Map<string, OpsStatsRow[]>();
  for (const row of statsRows) {
    const key = `${row.month}-01|${shiftMonthKey(row.month, 1)}-01`;
    const list = rowsByPiece.get(key) ?? [];
    list.push(row);
    rowsByPiece.set(key, list);
  }
  for (const [key, rows] of live) rowsByPiece.set(key, rows);

  // 건물 · 객실 목록: 객실 목록 + 표에만 있는 목록 밖 방(이름은 표에서).
  const properties = [...catalog.properties];
  const rooms = [...catalog.rooms];
  const knownRooms = new Set(rooms.map((room) => room.key));
  for (const rows of rowsByPiece.values()) {
    for (const row of rows) {
      if (!properties.includes(row.propertyName)) properties.push(row.propertyName);
      if (!knownRooms.has(row.roomKey)) {
        knownRooms.add(row.roomKey);
        rooms.push({ inCatalog: row.inCatalog, key: row.roomKey, label: row.roomLabel, propertyName: row.propertyName });
      }
    }
  }

  const cache = new Map<string, PieceResult>();
  const summarize = (piece: Piece, raw = false): PieceResult => {
    const cacheKey = `${piece.start}|${piece.endExclusive}|${raw ? "raw" : "open"}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const rows = rowsByPiece.get(`${piece.start}|${piece.endExclusive}`) ?? [];
    const result: PieceResult = { properties: new Map(), rooms: new Map() };
    for (const name of properties) result.properties.set(name, emptyCell());
    for (const row of rows) {
      const cell = result.properties.get(row.propertyName) ?? setNew(result.properties, row.propertyName);
      cell.revenue += row.revenue;
      cell.commission += row.commission;
      cell.occupiedNights += row.occupiedNights;
      cell.availableNights += row.availableNights;
      cell.airbnb += row.airbnb;
      cell.booking += row.booking;
      cell.direct += row.direct;
      cell.other += row.other;
    }
    const open = new Map<string, boolean>();
    for (const [name, cell] of result.properties) {
      open.set(name, raw || cell.occupiedNights > 0);
      if (!open.get(name)) cell.availableNights = 0;
    }
    for (const row of rows) {
      result.rooms.set(row.roomKey, {
        airbnb: row.airbnb,
        availableNights: open.get(row.propertyName) ? row.availableNights : 0,
        booking: row.booking,
        commission: row.commission,
        direct: row.direct,
        occupiedNights: row.occupiedNights,
        other: row.other,
        revenue: row.revenue,
      });
    }
    cache.set(cacheKey, result);
    return result;
  };

  return { cache, inputs: { properties, rooms }, summarize, supabase };
}

function setNew(map: Map<string, RevenueCell>, key: string): RevenueCell {
  const cell = emptyCell();
  map.set(key, cell);
  return cell;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
