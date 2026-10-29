import { describe, expect, it } from "vitest";
import {
  countOpsVacantGaps,
  filterOpsVacantGaps,
  opsVacantGapUrgency,
  opsVacantGaps,
  sortOpsVacantGaps,
} from "@/lib/ops-vacant-gaps";

const dates = ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];
const today = "2026-10-29";

function build(sold: Record<string, string[]>, blocked: Record<string, string[]> = {}) {
  return opsVacantGaps({
    dates,
    isBlocked: (roomKey, date) => (blocked[roomKey] ?? []).includes(date),
    isSold: (roomKey, date) => (sold[roomKey] ?? []).includes(date),
    minStayAt: () => 2,
    priceAt: (_roomKey, date) => (date === "2026-10-31" ? 12000 : 10000),
    roomKeys: ["A::201", "A::202"],
    today,
  });
}

describe("opsVacantGaps", () => {
  it("오늘 이전 밤은 세지 않고, 예약 · 차단 사이의 이어진 빈 밤을 묶는다", () => {
    const gaps = build({ "A::201": ["2026-10-31"] }, { "A::202": ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"] });
    expect(gaps.map((gap) => [gap.roomKey, gap.start, gap.checkOut, gap.nights, gap.openEnded])).toEqual([
      ["A::201", "2026-10-29", "2026-10-31", 2, false],
      ["A::201", "2026-11-01", "2026-11-03", 2, true],
      ["A::202", "2026-10-29", "2026-10-30", 1, false],
    ]);
  });

  it("요금이 있는 밤만 평균한다", () => {
    const [gap] = build({ "A::201": ["2026-11-01"], "A::202": dates });
    expect(gap.dates).toEqual(["2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(gap.averagePrice).toBe(10667);
  });

  it("길이로 거르고, 가까운 날 · 긴 구간 · 건물별로 정렬하고, 센다", () => {
    const gaps = build({ "A::201": ["2026-10-31"] }, { "A::202": ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"] });
    expect(filterOpsVacantGaps(gaps, "n1")).toHaveLength(1);
    expect(filterOpsVacantGaps(gaps, "n3")).toHaveLength(0);
    expect(sortOpsVacantGaps(gaps, "near", ["A::201", "A::202"]).map((gap) => gap.roomKey + gap.start)).toEqual([
      "A::2012026-10-29",
      "A::2022026-10-29",
      "A::2012026-11-01",
    ]);
    expect(sortOpsVacantGaps(gaps, "property", ["A::202", "A::201"])[0].roomKey).toBe("A::202");
    expect(countOpsVacantGaps(gaps)).toEqual({ all: 3, n1: 1, n2: 2, n3: 0, nights: 5 });
  });

  it("오늘 밤 · 내일 밤부터 비는 구간만 급하다", () => {
    const gaps = build({ "A::201": ["2026-10-29"], "A::202": ["2026-10-29", "2026-10-30"] });
    expect(gaps.map((gap) => opsVacantGapUrgency(gap, today))).toEqual(["tomorrow", null]);
  });
});
