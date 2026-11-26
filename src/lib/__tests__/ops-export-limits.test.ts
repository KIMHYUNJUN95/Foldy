import { describe, expect, it } from "vitest";
import {
  EXPORT_MAX_COLUMNS,
  EXPORT_MAX_ROWS,
  exportSizeWithinLimits,
  opsComparePayloadFits,
  opsOccupancyPayloadFits,
  opsRevenuePayloadFits,
  widestInner,
} from "@/lib/admin-export-limits";

describe("내보내기 크기 상한", () => {
  it("줄 · 칸 상한", () => {
    expect(exportSizeWithinLimits([new Array(EXPORT_MAX_ROWS)], [EXPORT_MAX_COLUMNS])).toBe(true);
    expect(exportSizeWithinLimits([new Array(EXPORT_MAX_ROWS + 1)], [1])).toBe(false);
    expect(exportSizeWithinLimits([[]], [EXPORT_MAX_COLUMNS + 1])).toBe(false);
    expect(exportSizeWithinLimits(["x"], [1])).toBe(false);
  });
  it("widestInner", () => {
    expect(widestInner([{ v: [1, 2] }, { v: [1] }], "v")).toBe(2);
    expect(widestInner([{ v: 1 }], "v")).toBe(Infinity);
  });
  it("세 내보내기 입력", () => {
    const rows = new Array(EXPORT_MAX_ROWS + 1).fill({});
    expect(opsRevenuePayloadFits({ rows, monthLabels: [], monthly: [], monthlyTotal: [] } as never)).toBe(false);
    expect(opsRevenuePayloadFits({ rows: [], monthLabels: [], monthly: [{ values: new Array(61) }], monthlyTotal: [] } as never)).toBe(false);
    expect(opsRevenuePayloadFits({ rows: [], monthLabels: [], monthly: [], monthlyTotal: [] } as never)).toBe(true);
    expect(opsComparePayloadFits({ rows } as never)).toBe(false);
    expect(opsComparePayloadFits({ rows: [] } as never)).toBe(true);
    expect(
      opsOccupancyPayloadFits({ rows: [], roomMonthLabels: [], rooms: [], forwardMonthLabels: new Array(61), forward: [], forwardTotal: [] } as never),
    ).toBe(false);
    expect(
      opsOccupancyPayloadFits({ rows: [], roomMonthLabels: [], rooms: [], forwardMonthLabels: [], forward: [], forwardTotal: [] } as never),
    ).toBe(true);
  });
});
