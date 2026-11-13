import { describe, expect, it } from "vitest";
import {
  anchorMonth,
  chartMonths,
  defaultRange,
  emptyCell,
  fiscalPeriodNumber,
  normalizeRange,
  previousYearRange,
  quintileCuts,
  quintileLevel,
  shiftRange,
  wholeShares,
  splitByMonth,
  sumMetrics,
  weekStart,
  yoyLevel,
} from "@/lib/ops-revenue";

const cell = (patch: Partial<ReturnType<typeof emptyCell>>) => ({ ...emptyCell(), ...patch });

describe("sumMetrics", () => {
  it("re-divides sums instead of averaging ratios", () => {
    const a = cell({ availableNights: 300, commission: 100, occupiedNights: 270, revenue: 9000 });
    const b = cell({ availableNights: 30, commission: 0, occupiedNights: 15, revenue: 3000 });
    const m = sumMetrics([a, b, undefined]);
    expect(m.revenue).toBe(12000);
    expect(m.net).toBe(11900);
    expect(m.occupancyPct).toBeCloseTo((285 / 330) * 100);
    expect(m.adr).toBeCloseTo(12000 / 285);
    expect(m.revpar).toBeCloseTo(12000 / 330);
  });
  it("is zero-safe", () => {
    const m = sumMetrics([]);
    expect(m.occupancyPct).toBe(0);
    expect(m.adr).toBe(0);
    expect(m.revpar).toBe(0);
  });
});

describe("ranges", () => {
  it("defaults per mode around today", () => {
    expect(defaultRange("month", "2026-10-06")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(defaultRange("fiscal", "2026-10-06")).toEqual({ from: "2026-07-01", to: "2027-06-30" });
    expect(defaultRange("fiscal", "2026-03-06")).toEqual({ from: "2025-07-01", to: "2026-06-30" });
    expect(defaultRange("year", "2026-10-06")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(defaultRange("week", "2026-10-06")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
  });
  it("normalizes untrusted params", () => {
    expect(normalizeRange("month", { ym: "2026-02" }, "2026-10-06")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(normalizeRange("month", { ym: "2026-13" }, "2026-10-06")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(normalizeRange("fiscal", { from: "2026-03-15" }, "2026-10-06")).toEqual({ from: "2025-07-01", to: "2026-06-30" });
    expect(normalizeRange("custom", { from: "2026-09-30", to: "2026-09-01" }, "2026-10-06")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(normalizeRange("custom", { from: "2020-01-01", to: "2026-01-01" }, "2026-10-06").to).toBe("2022-12-31");
  });
  it("shifts by the mode unit (months via month keys, not Date)", () => {
    expect(shiftRange("month", { from: "2026-01-01", to: "2026-01-31" }, 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftRange("month", { from: "2026-03-01", to: "2026-03-31" }, -1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftRange("fiscal", { from: "2026-07-01", to: "2027-06-30" }, -1)).toEqual({ from: "2025-07-01", to: "2026-06-30" });
    expect(shiftRange("week", { from: "2026-10-05", to: "2026-10-11" }, 1)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(shiftRange("custom", { from: "2026-09-01", to: "2026-09-10" }, 1)).toEqual({ from: "2026-09-11", to: "2026-09-20" });
  });
  it("compares with the same dates one year earlier", () => {
    expect(previousYearRange({ from: "2028-02-01", to: "2028-02-29" })).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });
  it("splits a range at month borders (exclusive ends)", () => {
    expect(splitByMonth({ from: "2026-09-28", to: "2026-10-04" })).toEqual([
      { endExclusive: "2026-10-01", month: "2026-09", start: "2026-09-28" },
      { endExclusive: "2026-10-05", month: "2026-10", start: "2026-10-01" },
    ]);
    expect(splitByMonth({ from: "2026-07-01", to: "2027-06-30" })).toHaveLength(12);
  });
  it("anchors the 15-month chart at the range end, capped at this month", () => {
    expect(anchorMonth({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-06")).toBe("2026-09");
    expect(anchorMonth({ from: "2026-07-01", to: "2027-06-30" }, "2026-10-06")).toBe("2026-10");
    const months = chartMonths("2026-09");
    expect(months[0]).toBe("2025-10");
    expect(months[11]).toBe("2026-09");
    expect(months[14]).toBe("2026-12");
  });
  it("numbers fiscal periods like the old app (7기 = 2025-07)", () => {
    expect(fiscalPeriodNumber(2025)).toBe(7);
    expect(fiscalPeriodNumber(2026)).toBe(8);
  });
});

describe("matrix levels", () => {
  it("cuts five steps at quintiles", () => {
    const cuts = quintileCuts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cuts).toEqual([3, 5, 7, 9]);
    expect(quintileLevel(1, cuts)).toBe(0);
    expect(quintileLevel(5, cuts)).toBe(2);
    expect(quintileLevel(10, cuts)).toBe(4);
  });
  it("buckets year-over-year change", () => {
    expect(yoyLevel(null)).toBe(-1);
    expect(yoyLevel(-20)).toBe(0);
    expect(yoyLevel(-6)).toBe(1);
    expect(yoyLevel(0)).toBe(2);
    expect(yoyLevel(10)).toBe(3);
    expect(yoyLevel(40)).toBe(4);
  });
});

describe("wholeShares — 비율 합이 100", () => {
  it("나머지 큰 순서로 1씩", () => {
    const out = wholeShares([1, 1, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
    expect(out).toEqual([34, 33, 33]);
    expect(wholeShares([50.5, 30.2, 19.3]).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("입력이 많아도 합이 100", () => {
    const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
    expect(sum(wholeShares(Array(7).fill(1)))).toBe(100);
    expect(sum(wholeShares(Array(13).fill(1)))).toBe(100);
    expect(sum(wholeShares([12.34, 23.45, 19.99, 30.01, 14.21]))).toBe(100);
    expect(sum(wholeShares([0, 0, 0, 0, 0, 0, 0]))).toBe(0);
  });
  it("0 건 · 하나뿐 · 동률", () => {
    expect(wholeShares([0, 0])).toEqual([0, 0]);
    expect(wholeShares([])).toEqual([]);
    expect(wholeShares([7])).toEqual([100]);
    expect(wholeShares([1, 1])).toEqual([50, 50]);
    expect(wholeShares([2, 1, 0])).toEqual([67, 33, 0]);
  });
});
