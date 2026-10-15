/**
 * 가동률 요약 — 모바일 가동률(`/mobile/ops/occupancy`)이 쓰는 숫자. **순수하다.**
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「가동률 화면」 · 「모바일 가동률」
 *
 * 식은 PC 가동률 화면(`ops-occupancy-console.tsx`)과 **같다** — 같은 칸(`getOpsRevenueData`)을 합계 건물만 골라 더하고
 * 비율은 합을 다시 나눈다(판매 박 ÷ 전체 박, 문 열기 전 달은 서버가 분모 0). PC 콘솔은 같은 계산을 컴포넌트 안에 두고 있어
 * (다른 작업이 고치는 중이라 손대지 않았다) 여기 순수 함수로 다시 적었다 — 숫자 6개 중 모바일에 쓰는 것 · 건물별 · 앞으로 ·
 * 월별 추이. 나중에 PC 콘솔이 이 모듈을 쓰게 바꾸면 한 벌이 된다.
 *
 * 서버가 부르고 결과만 클라이언트로 넘긴다(칸 전부를 넘기지 않는다 — 폰에 보낼 양을 줄이려고).
 */

import { OCCUPANCY_LINE } from "@/lib/ops-occupancy";
import { lastDayOfMonth, monthPhase, sumMetrics, type MonthPhase, type RevenueCell } from "@/lib/ops-revenue";
import type { OpsRevenueData } from "@/lib/ops-revenue-server";

export type OccupancySummaryMonth = {
  month: string;
  /** 0~100. 분모가 0 이면 `null`(문 열기 전 · 자료 없음). */
  pct: number | null;
  phase: MonthPhase;
};

export type OccupancySummary = {
  today: string;
  /** 고른 달 `YYYY-MM`. */
  month: string;
  /** 합계에 넣은 건물 수 · 뺀 건물 이름(기본 제외 — 오쿠보A · 사노). */
  includedCount: number;
  excluded: string[];
  hasProperties: boolean;
  occupied: number;
  available: number;
  vacant: number;
  pct: number | null;
  /** 전년 같은 달. 분모가 0 이면 `null`(비교 불가). */
  previousPct: number | null;
  /** 60% 아래 객실 수(합계 건물, 그 달 문 연 방만). */
  underLine: number;
  /** 이번 달 잡힌 가동률(오늘까지의 예약 · 분모 = 객실 수 × 일수). */
  thisMonth: { month: string; pct: number | null } | null;
  /** 합계 건물 중 그 달 문 연 곳 — 높은 순. */
  buildings: Array<{ name: string; pct: number }>;
  /** 이번 달부터 앞으로(서버가 읽은 만큼) — 잡힌 가동률 · 팔 빈 박. */
  forward: Array<{ month: string; pct: number | null; vacant: number }>;
  /** 월별 추이(기준 달 앞 11 ~ 뒤 3). 진행 중인 달은 `donePct` = 지난 날 비율. */
  trend: Array<OccupancySummaryMonth & { donePct: number }>;
};

/** 합계에 기본으로 넣는 건물 — PC 화면의 칩 기본값과 같다(`defaultExcluded` 가 아닌 곳). */
export function defaultIncludedProperties(data: Pick<OpsRevenueData, "properties">): string[] {
  return data.properties.filter((property) => !property.defaultExcluded).map((property) => property.name);
}

const pctOf = (occupied: number, available: number): number | null => (available > 0 ? (occupied / available) * 100 : null);

export function buildOccupancySummary(data: OpsRevenueData, included: readonly string[]): OccupancySummary {
  const inSet = new Set(included);
  const inProps = data.properties.filter((property) => inSet.has(property.name));
  const inNames = inProps.map((property) => property.name);
  const totalOf = (cells: Record<string, RevenueCell> | undefined) => sumMetrics(inNames.map((name) => cells?.[name]));

  const current = totalOf(data.rangeCells);
  const previous = totalOf(data.previousRangeCells);

  const underLine = inProps
    .flatMap((property) => property.rooms)
    .filter((room) => {
      const cell = data.rangeRoomCells[room.key];
      return !!cell && cell.availableNights > 0 && (cell.occupiedNights / cell.availableNights) * 100 < OCCUPANCY_LINE;
    }).length;

  const thisMonthKey = data.forwardMonths[0];
  const thisMonthTotal = thisMonthKey ? totalOf(data.forwardCells[thisMonthKey]) : null;

  const buildings = inProps
    .map((property) => {
      const cell = data.rangeCells[property.name];
      return { name: property.name, pct: cell ? pctOf(cell.occupiedNights, cell.availableNights) : null };
    })
    .filter((row): row is { name: string; pct: number } => row.pct !== null)
    .sort((a, b) => b.pct - a.pct);

  const forward = data.forwardMonths.map((month) => {
    const total = totalOf(data.forwardCells[month]);
    return {
      month,
      pct: pctOf(total.occupiedNights, total.availableNights),
      vacant: Math.max(0, total.availableNights - total.occupiedNights),
    };
  });

  const todayDay = Number(data.today.slice(8, 10));
  const trend = data.months.map((month) => {
    const total = totalOf(data.monthCells[month]);
    const phase = monthPhase(month, data.today);
    const days = Number(lastDayOfMonth(month).slice(8, 10));
    return {
      donePct: phase === "current" ? Math.round((todayDay / days) * 100) : phase === "past" ? 100 : 0,
      month,
      pct: pctOf(total.occupiedNights, total.availableNights),
      phase,
    };
  });

  return {
    available: current.availableNights,
    buildings,
    excluded: data.properties.filter((property) => !inSet.has(property.name)).map((property) => property.name),
    forward,
    hasProperties: data.properties.length > 0,
    includedCount: inNames.length,
    month: data.range.from.slice(0, 7),
    occupied: current.occupiedNights,
    pct: pctOf(current.occupiedNights, current.availableNights),
    previousPct: pctOf(previous.occupiedNights, previous.availableNights),
    thisMonth: thisMonthKey && thisMonthTotal
      ? { month: thisMonthKey, pct: pctOf(thisMonthTotal.occupiedNights, thisMonthTotal.availableNights) }
      : null,
    today: data.today,
    trend,
    underLine,
    vacant: Math.max(0, current.availableNights - current.occupiedNights),
  };
}
