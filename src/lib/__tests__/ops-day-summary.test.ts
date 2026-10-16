import { describe, expect, it } from "vitest";
import { buildOpsDaySummaries } from "@/lib/ops-day-summary";

describe("buildOpsDaySummaries", () => {
  const sold = new Set(["a|2026-10-10"]);
  const blocked = new Set(["b|2026-10-11"]);
  const prices: Record<string, number | null> = {
    "a|2026-10-10": 40000,
    "b|2026-10-10": 50000,
    "c|2026-10-10": null,
    "a|2026-10-11": 30001,
  };
  const summaries = buildOpsDaySummaries({
    dates: ["2026-10-10", "2026-10-11", "2026-10-12"],
    isBlocked: (room, date) => blocked.has(`${room}|${date}`),
    isSold: (room, date) => sold.has(`${room}|${date}`),
    priceAt: (room, date) => prices[`${room}|${date}`],
    roomKeys: ["a", "b", "c"],
  });

  it("빈 방 = 예약 · 차단 없는 객실 수", () => {
    expect(summaries.map((day) => day.vacant)).toEqual([2, 2, 3]);
  });

  it("평균가 = 가격 있는 칸만, 없으면 null", () => {
    expect(summaries.map((day) => day.avgPrice)).toEqual([45000, 30001, null]);
  });
});
