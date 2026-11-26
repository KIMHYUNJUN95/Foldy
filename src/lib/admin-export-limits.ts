/** 내보내기 액션이 클라이언트가 보낸 표를 그대로 만들기 전에 거는 크기 상한 — 거대한 입력으로 서버를 붙잡지 못하게. */
export const EXPORT_MAX_ROWS = 20000;
export const EXPORT_MAX_COLUMNS = 60;

/** 줄 목록마다 길이 ≤ 20000, 칸 수 ≤ 60 이고 모두 배열이어야 true. */
export function exportSizeWithinLimits(rowLists: readonly unknown[], columnCounts: readonly number[]): boolean {
  for (const list of rowLists) {
    if (!Array.isArray(list) || list.length > EXPORT_MAX_ROWS) return false;
  }
  return columnCounts.every((count) => Number.isFinite(count) && count <= EXPORT_MAX_COLUMNS);
}

/** 줄마다 안쪽 배열(`values` · `cells`)의 가장 긴 길이. 배열이 아니면 무한대로 보아 거절되게 한다. */
export function widestInner(rows: unknown, key: string): number {
  if (!Array.isArray(rows)) return Infinity;
  let widest = 0;
  for (const row of rows) {
    const inner = (row as Record<string, unknown> | null)?.[key];
    if (!Array.isArray(inner)) return Infinity;
    widest = Math.max(widest, inner.length);
  }
  return widest;
}

// 판매 캘린더 ops 내보내기 3곳(가동률 · 매출 · 두 기간 비교) — 입력 모양별 판정.
type Loose = Record<string, unknown>;

export function opsOccupancyPayloadFits(p: Loose): boolean {
  return exportSizeWithinLimits(
    [p.rows, p.rooms, p.forward, p.forwardTotal, p.roomMonthLabels, p.forwardMonthLabels],
    [
      (p.roomMonthLabels as unknown[])?.length,
      (p.forwardMonthLabels as unknown[])?.length,
      widestInner(p.rooms, "values"),
      widestInner(p.forward, "cells"),
      (p.forwardTotal as unknown[])?.length,
    ],
  );
}

export function opsRevenuePayloadFits(p: Loose): boolean {
  return exportSizeWithinLimits(
    [p.rows, p.monthly, p.monthLabels, p.monthlyTotal],
    [(p.monthLabels as unknown[])?.length, widestInner(p.monthly, "values"), (p.monthlyTotal as unknown[])?.length],
  );
}

export function opsComparePayloadFits(p: Loose): boolean {
  return exportSizeWithinLimits([p.rows], []);
}
