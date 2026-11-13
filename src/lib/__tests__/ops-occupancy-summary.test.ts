import { describe, expect, it } from "vitest";
import { buildOccupancySummary } from "@/lib/ops-occupancy-summary";
import type { OpsRevenueData } from "@/lib/ops-revenue-server";

const cell = (occupiedNights: number, availableNights: number) => ({ occupiedNights, availableNights });

// 객실 둘: 59.6%(화면 「60%」 — 빨강 아님) · 59.0%(화면 「59%」 — 빨강)
const data = {
  properties: [{ name: "A", defaultExcluded: false, rooms: [{ key: "A-1" }, { key: "A-2" }] }],
  rangeCells: {},
  previousRangeCells: {},
  rangeRoomCells: { "A-1": cell(298, 500), "A-2": cell(295, 500) },
  forwardMonths: [],
  forwardCells: {},
  months: [],
  monthCells: {},
  today: "2026-11-13",
  range: { from: "2026-11-01", to: "2026-11-30" },
} as unknown as OpsRevenueData;

describe("buildOccupancySummary underLine — 화면 빨강 판정(정수 60 미만)과 같다", () => {
  it("59.6% 는 세지 않고 59.0% 만 센다", () => {
    expect(buildOccupancySummary(data, ["A"]).underLine).toBe(1);
  });
});
