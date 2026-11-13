/**
 * 매출 화면(`/admin/ops/revenue`) — 기간 · 합산 · 색 단계. **순수하다.**
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 화면」
 *
 * 숫자의 식은 판매 캘린더 「매출 요약」(`ops-sales-summary.ts`)이 **그대로** 낸다 — 여기는 그 결과를 칸(건물 × 기간
 * 조각)으로 받아 더하고, 비율(가동률 · ADR · RevPAR)은 **합을 다시 나눠** 구한다(비율을 평균내지 않는다).
 *
 * ## 문 열기 전 달은 분모에서 뺀다 (2026-10-06)
 *
 * 저쪽 매출 분석(`SalesLogDashboard.jsx`)과 같다 — 그 달 판매 객실박이 0 인 건물은 객실 수를 0 으로 본다. 그러지
 * 않으면 2026-08 에 연 STAY ARI 26실이 지난 달 전부의 분모에 들어가 가동률을 끌어내린다(저쪽 매출 대시보드 ·
 * 가동률 화면의 「새 객실 소급」 문제). 기간이 여러 달이면 **달마다** 판정한다 — 그래서 서버는 기간을 달 경계로 잘라
 * 요약을 낸다(`splitByMonth`).
 */

import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";

// ── 칸 ──────────────────────────────────────────────────────────────────

/** 건물 하나 × 기간 조각 하나. 금액은 엔(반올림 전). `roomCount` 는 문 연 조각에서만 센다. */
export type RevenueCell = {
  revenue: number;
  commission: number;
  occupiedNights: number;
  /** 분모 = 객실 수 × 일수. 문 열기 전 조각은 0. */
  availableNights: number;
  airbnb: number;
  booking: number;
  direct: number;
  other: number;
};

export type RevenueMetrics = RevenueCell & {
  net: number;
  /** 0~100. 분모가 0 이면 0. */
  occupancyPct: number;
  adr: number;
  revpar: number;
};

export const emptyCell = (): RevenueCell => ({
  airbnb: 0,
  availableNights: 0,
  booking: 0,
  commission: 0,
  direct: 0,
  occupiedNights: 0,
  other: 0,
  revenue: 0,
});

export function addCell(target: RevenueCell, part: RevenueCell): RevenueCell {
  target.revenue += part.revenue;
  target.commission += part.commission;
  target.occupiedNights += part.occupiedNights;
  target.availableNights += part.availableNights;
  target.airbnb += part.airbnb;
  target.booking += part.booking;
  target.direct += part.direct;
  target.other += part.other;
  return target;
}

export function metricsOf(cell: RevenueCell): RevenueMetrics {
  return {
    ...cell,
    adr: cell.occupiedNights > 0 ? cell.revenue / cell.occupiedNights : 0,
    net: cell.revenue - cell.commission,
    occupancyPct: cell.availableNights > 0 ? (cell.occupiedNights / cell.availableNights) * 100 : 0,
    revpar: cell.availableNights > 0 ? cell.revenue / cell.availableNights : 0,
  };
}

/** 고른 칸들의 합 → 지표. */
export function sumMetrics(cells: readonly (RevenueCell | undefined)[]): RevenueMetrics {
  const total = emptyCell();
  for (const cell of cells) if (cell) addCell(total, cell);
  return metricsOf(total);
}

/** 문을 열었나 = 그 조각에 판매 객실박이 있다. 매출만 있고 점유가 없으면(목록 밖 방) 분모는 0 이다. */
export function isOpenCell(cell: RevenueCell | undefined): boolean {
  return !!cell && cell.occupiedNights > 0;
}

/** 증감률(%) — 전년이 0 이면 `null`(비교 불가 = 「신규」). */
export function changePct(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

/** 몫(%)을 정수로 — 내림 뒤 나머지가 큰 순서로 1씩 더해 합이 100 이 되게 한다. 합이 0 이면 전부 0. */
export function wholeShares(values: readonly number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  const rest = 100 - out.reduce((sum, v) => sum + v, 0);
  for (let k = 0; k < rest; k += 1) out[order[k].i] += 1;
  return out;
}

// ── 기간 ────────────────────────────────────────────────────────────────

export type RevenueMode = "month" | "fiscal" | "year" | "week" | "custom";

export const REVENUE_MODES: readonly RevenueMode[] = ["fiscal", "year", "month", "week", "custom"];

/** 양끝 포함 기간. */
export type RevenueRange = { from: string; to: string };

const DAY_MS = 86_400_000;
const isDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isMonth = (value: string | undefined): value is string => !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

export function daysBetweenInclusive(range: RevenueRange): number {
  return dayNumber(range.to) - dayNumber(range.from) + 1;
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** 기수는 7월에 시작한다(저쪽 `FISCAL_PERIODS` — 7기 = 2025.07 ~ 2026.06). */
export const FISCAL_START_MONTH = 7;

/** 날짜가 속한 기수의 시작 연도. */
export function fiscalStartYear(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m >= FISCAL_START_MONTH ? y : y - 1;
}

/** 기수 번호 — 7기 = 2025년 7월 시작. */
export function fiscalPeriodNumber(startYear: number): number {
  return startYear - 2018;
}

/** 월요일 시작 주. */
export function weekStart(date: string): string {
  const day = dayNumber(date);
  // 1970-01-01 은 목요일 — (day + 3) % 7 이 월요일 0.
  return fromDayNumber(day - ((day + 3) % 7));
}

/** 모드의 「지금」 기간. */
export function defaultRange(mode: RevenueMode, today: string): RevenueRange {
  const month = today.slice(0, 7);
  switch (mode) {
    case "fiscal": {
      const y = fiscalStartYear(today);
      return { from: `${y}-07-01`, to: `${y + 1}-06-30` };
    }
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case "week": {
      const from = weekStart(today);
      return { from, to: addDays(from, 6) };
    }
    case "custom":
    case "month":
    default:
      return { from: `${month}-01`, to: lastDayOfMonth(month) };
  }
}

/** 주소의 값을 믿지 않는다 — 모드마다 모양을 바로잡고, 못 읽으면 「지금」. 직접 기간은 최대 3년. */
export function normalizeRange(
  mode: RevenueMode,
  params: { ym?: string; from?: string; to?: string },
  today: string,
): RevenueRange {
  switch (mode) {
    case "month":
      return isMonth(params.ym) ? { from: `${params.ym}-01`, to: lastDayOfMonth(params.ym) } : defaultRange("month", today);
    case "fiscal": {
      if (!isDate(params.from)) return defaultRange("fiscal", today);
      const y = fiscalStartYear(params.from);
      return { from: `${y}-07-01`, to: `${y + 1}-06-30` };
    }
    case "year":
      return isDate(params.from)
        ? { from: `${params.from.slice(0, 4)}-01-01`, to: `${params.from.slice(0, 4)}-12-31` }
        : defaultRange("year", today);
    case "week": {
      if (!isDate(params.from)) return defaultRange("week", today);
      const from = weekStart(params.from);
      return { from, to: addDays(from, 6) };
    }
    case "custom": {
      if (!isDate(params.from) || !isDate(params.to)) return defaultRange("month", today);
      const [from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
      const maxTo = addDays(from, 365 * 3);
      return { from, to: to > maxTo ? maxTo : to };
    }
  }
}

/** 앞/뒤 한 칸. 직접 기간은 같은 길이만큼 민다. */
export function shiftRange(mode: RevenueMode, range: RevenueRange, direction: -1 | 1): RevenueRange {
  switch (mode) {
    case "month": {
      const month = shiftMonthKey(range.from.slice(0, 7), direction);
      return { from: `${month}-01`, to: lastDayOfMonth(month) };
    }
    case "fiscal":
    case "year": {
      const y = Number(range.from.slice(0, 4)) + direction;
      return { from: `${y}${range.from.slice(4)}`, to: `${mode === "fiscal" ? y + 1 : y}${range.to.slice(4)}` };
    }
    case "week":
      return { from: addDays(range.from, 7 * direction), to: addDays(range.to, 7 * direction) };
    case "custom": {
      const length = daysBetweenInclusive(range);
      return { from: addDays(range.from, length * direction), to: addDays(range.to, length * direction) };
    }
  }
}

/** 같은 날짜 1년 전. 2/29 → 2/28. */
export function shiftDateYearBack(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function previousYearRange(range: RevenueRange): RevenueRange {
  return { from: shiftDateYearBack(range.from), to: shiftDateYearBack(range.to) };
}

/**
 * 기간을 **달 경계로** 자른다(양끝 포함 → 각 조각은 `[start, endExclusive)`). 문 열기 전 판정을 달마다 하려고.
 */
export function splitByMonth(range: RevenueRange): Array<{ month: string; start: string; endExclusive: string }> {
  const pieces: Array<{ month: string; start: string; endExclusive: string }> = [];
  let start = range.from;
  while (start <= range.to) {
    const month = start.slice(0, 7);
    const monthEnd = lastDayOfMonth(month);
    const end = monthEnd < range.to ? monthEnd : range.to;
    pieces.push({ endExclusive: addDays(end, 1), month, start });
    start = addDays(end, 1);
  }
  return pieces;
}

/**
 * 월별 그래프 · 매트릭스의 기준 달 — 기간의 마지막 달. 단 이번 달보다 뒤면 이번 달(앞으로 3칸은 늘 보인다).
 */
export function anchorMonth(range: RevenueRange, today: string): string {
  const end = range.to.slice(0, 7);
  const current = today.slice(0, 7);
  return end > current ? current : end;
}

/** 기준 달 앞 11개월 ~ 뒤 3개월 = 15칸. */
export function chartMonths(anchor: string): string[] {
  return Array.from({ length: 15 }, (_, index) => shiftMonthKey(anchor, index - 11));
}

export type MonthPhase = "past" | "current" | "future";

export function monthPhase(month: string, today: string): MonthPhase {
  const current = today.slice(0, 7);
  return month < current ? "past" : month === current ? "current" : "future";
}

// ── 매트릭스 색 단계 ───────────────────────────────────────────────────────

/**
 * 5단계 경계(하위 20 · 40 · 60 · 80% 지점). 연속 그라데이션 대신 단계로 — 칸 글자를 늘 검정으로 둘 수 있게
 * (2026-10-06 사용자 지적 「잘 안 보여」). 끝난 달만 넣는다 — 잡힌 예약 달이 기준을 흔들지 않게.
 */
export function quintileCuts(values: readonly number[]): [number, number, number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

/** 0(하위) ~ 4(상위). */
export function quintileLevel(value: number, cuts: readonly number[]): number {
  return cuts.filter((cut) => value >= cut).length;
}

/** 전년 대비 5단계: ≤ −15 · ≤ −5 · ±5 · < +15 · ≥ +15. 비교 불가는 −1. */
export function yoyLevel(delta: number | null): number {
  if (delta === null) return -1;
  if (delta <= -15) return 0;
  if (delta <= -5) return 1;
  if (delta < 5) return 2;
  if (delta < 15) return 3;
  return 4;
}
