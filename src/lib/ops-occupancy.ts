/**
 * 가동률 화면(`/admin/ops/occupancy`) — 등급 · 색 단계 · 목록 고르기. **순수하다.**
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「가동률 화면」
 *
 * 숫자(판매 박 · 전체 박)는 매출 화면과 같은 칸(`RevenueCell`)이다 — 식은 저쪽 가동률 화면
 * (`OccupancyRateDashboard.jsx`)과 같고 2026-10-07 대조로 맞췄다. 여기는 그 칸을 보여 주는 규칙만 둔다.
 */

/** 저쪽 `getRateGrade` 그대로 — 80 · 60 · 40. */
export type OccupancyGrade = "excellent" | "good" | "fair" | "poor";

export function occupancyGrade(pct: number): OccupancyGrade {
  if (pct >= 80) return "excellent";
  if (pct >= 60) return "good";
  if (pct >= 40) return "fair";
  return "poor";
}

/** 저쪽 비수기 판정 · 화면 기준선. */
export const OCCUPANCY_LINE = 60;

/** 「낮다(빨강)」 판정 — 화면에 보이는 정수 값이 60 미만일 때만. 히트맵 농도 단계와는 별개다. */
export function isLowOccupancy(pct: number): boolean {
  return Number.isFinite(pct) && Math.round(pct) < OCCUPANCY_LINE;
}

/** 가동률 표기 — 화면 어디서나 정수. */
export function occupancyPctText(pct: number): string {
  return Number.isFinite(pct) ? `${Math.round(pct)}%` : "—";
}

/**
 * 「많이 빈 객실」 — 기간의 **절반 넘게** 빈 방(빨강). 저쪽은 한 달 기준 「15일 넘게」(`vacantDays > 15`)였다 —
 * 우리 기간은 주 · 연 · 직접도 되므로 같은 뜻을 비율로 쓴다(30일 달이면 15일 넘게와 같다).
 */
export function isMostlyVacant(occupied: number, available: number): boolean {
  return available > 0 && available - occupied > available / 2;
}

/** 히트맵 5단계: < 60 · < 75 · < 85 · < 95 · 그 위. 글자는 늘 검정이라 밝은 단계만 쓴다. */
export function heatLevel(pct: number): number {
  if (pct < 60) return 0;
  if (pct < 75) return 1;
  if (pct < 85) return 2;
  if (pct < 95) return 3;
  return 4;
}

/** 「앞으로」 칸 — 방 수 대비 빈 박 비율의 5단계(0 = 거의 다 팔림 · 4 = 거의 다 빔). */
export function vacancyLevel(vacant: number, available: number): number {
  if (available <= 0) return 0;
  const share = vacant / available;
  if (share > 0.8) return 4;
  if (share > 0.55) return 3;
  if (share > 0.3) return 2;
  if (share > 0.12) return 1;
  return 0;
}

export type RoomSeries = {
  key: string;
  property: string;
  label: string;
  /** 달마다 가동률(%) — 문 열기 전은 `null`. */
  values: Array<number | null>;
};

/** 열린 달만의 평균. 하나도 없으면 `null`. */
export function seriesAverage(values: readonly (number | null)[]): number | null {
  const open = values.filter((value): value is number => value !== null);
  return open.length > 0 ? open.reduce((sum, value) => sum + value, 0) / open.length : null;
}

/**
 * 「평소보다 낮은 객실」 — 마지막 달이 그 방 **앞 달들 평균**보다 `gap`p 넘게 낮다. 앞 달이 셋도 안 되면(새로 연 방) 뺀다 —
 * 연 지 얼마 안 된 방의 첫 달은 「평소」가 없다.
 */
export function roomsBelowUsual(series: readonly RoomSeries[], gap = 10): Array<RoomSeries & { now: number; usual: number }> {
  const out: Array<RoomSeries & { now: number; usual: number }> = [];
  for (const room of series) {
    const now = room.values.at(-1);
    if (now === null || now === undefined) continue;
    const before = room.values.slice(0, -1).filter((value): value is number => value !== null);
    if (before.length < 3) continue;
    const usual = before.reduce((sum, value) => sum + value, 0) / before.length;
    if (usual - now > gap) out.push({ ...room, now, usual });
  }
  return out.sort((a, b) => b.usual - b.now - (a.usual - a.now));
}

/**
 * 「빈 박 많은 곳」 — (건물 × 달) 칸 중 방 수 대비 빈 박이 많은 순. 빈 박이 `minVacant` 보다 적은 칸은 뺀다
 * (방 하나짜리 건물의 「1박 남음 = 100%」 같은 소음).
 */
export function mostVacantCells<T extends { vacant: number; available: number }>(cells: readonly T[], limit = 4, minVacant = 10): T[] {
  return cells
    .filter((cell) => cell.available > 0 && cell.vacant >= minVacant)
    .map((cell, index) => ({ cell, index, share: cell.vacant / cell.available }))
    .sort((a, b) => b.share - a.share || b.cell.vacant - a.cell.vacant || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.cell);
}
