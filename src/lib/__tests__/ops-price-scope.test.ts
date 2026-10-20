import { describe, expect, it } from "vitest";
import {
  ALL_WEEKDAYS,
  datesBetween,
  expandPriceScope,
  priceScopeBounds,
  scopeFromCells,
  toggleWeekday,
  weekdayOf,
} from "@/lib/ops-price-scope";

const rooms = [{ key: "A::101" }, { key: "A::102" }, { key: "B::201" }];
const wide = { max: "2027-12-31", min: "2026-01-01" };

describe("ops-price-scope", () => {
  it("knows the Tokyo calendar weekday of a date key", () => {
    expect(weekdayOf("2026-10-20")).toBe(2); // 화요일
    expect(weekdayOf("2026-10-25")).toBe(0); // 일요일
  });

  it("lists dates across a month boundary, both ends included", () => {
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(datesBetween("2026-11-02", "2026-10-30")).toEqual([]);
  });

  it("starts from the grid selection — first to last date, all weekdays, rooms in pick order", () => {
    const scope = scopeFromCells([
      { date: "2026-11-03", roomKey: "A::102" },
      { date: "2026-11-01", roomKey: "A::101" },
      { date: "2026-11-05", roomKey: "A::102" },
    ]);
    expect(scope).toEqual({ from: "2026-11-01", roomKeys: ["A::102", "A::101"], to: "2026-11-05", weekdays: ALL_WEEKDAYS });
    expect(scopeFromCells([])).toBeNull();
  });

  it("expands rooms × dates in grid row order and keeps only picked weekdays", () => {
    const cells = expandPriceScope(
      { from: "2026-10-23", roomKeys: ["B::201", "A::101"], to: "2026-10-26", weekdays: [5, 6] },
      rooms,
      wide,
    );
    // 10/23 금 · 10/24 토만. 객실은 격자 순서(A::101 먼저).
    expect(cells).toEqual([
      { date: "2026-10-23", roomKey: "A::101" },
      { date: "2026-10-24", roomKey: "A::101" },
      { date: "2026-10-23", roomKey: "B::201" },
      { date: "2026-10-24", roomKey: "B::201" },
    ]);
  });

  it("clips to today … one year ahead and drops rooms that left the grid", () => {
    const bounds = priceScopeBounds("2026-10-20");
    expect(bounds).toEqual({ max: "2027-10-20", min: "2026-10-20" });
    const cells = expandPriceScope(
      { from: "2026-10-18", roomKeys: ["A::101", "Z::999"], to: "2026-10-21", weekdays: ALL_WEEKDAYS },
      rooms,
      bounds,
    );
    expect(cells.map((cell) => cell.date)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(new Set(cells.map((cell) => cell.roomKey))).toEqual(new Set(["A::101"]));
  });

  it("never turns off the last weekday", () => {
    expect(toggleWeekday([6], 6)).toEqual([6]);
    expect(toggleWeekday([5, 6], 6)).toEqual([5]);
    expect(toggleWeekday([6], 0)).toEqual([0, 6]);
  });
});
