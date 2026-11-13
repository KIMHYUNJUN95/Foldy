import { describe, expect, it } from "vitest";
import {
  OCCUPANCY_LINE,
  heatLevel,
  isLowOccupancy,
  occupancyPctText,
  isMostlyVacant,
  mostVacantCells,
  occupancyGrade,
  roomsBelowUsual,
  seriesAverage,
  vacancyLevel,
} from "@/lib/ops-occupancy";

describe("occupancyGrade — 저쪽 getRateGrade (80 · 60 · 40)", () => {
  it("경계값", () => {
    expect(occupancyGrade(80)).toBe("excellent");
    expect(occupancyGrade(79.9)).toBe("good");
    expect(occupancyGrade(60)).toBe("good");
    expect(occupancyGrade(59.9)).toBe("fair");
    expect(occupancyGrade(40)).toBe("fair");
    expect(occupancyGrade(39.9)).toBe("poor");
  });
});

describe("isMostlyVacant — 저쪽 「15일 넘게」를 비율로", () => {
  it("30일 달이면 15일 넘게 빈 방", () => {
    expect(isMostlyVacant(15, 30)).toBe(false);
    expect(isMostlyVacant(14, 30)).toBe(true);
  });
  it("분모 0 은 아니다", () => {
    expect(isMostlyVacant(0, 0)).toBe(false);
  });
});

describe("heatLevel · vacancyLevel", () => {
  it("5단계", () => {
    expect([50, 60, 74, 75, 84, 85, 94, 95, 100].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(vacancyLevel(0, 30)).toBe(0);
    expect(vacancyLevel(30, 30)).toBe(4);
    expect(vacancyLevel(10, 0)).toBe(0);
  });
});

describe("roomsBelowUsual", () => {
  const room = (label: string, values: Array<number | null>) => ({ key: label, label, property: "A", values });
  it("마지막 달이 앞 달 평균보다 10p 넘게 낮은 방만, 크게 떨어진 순", () => {
    const out = roomsBelowUsual([room("1", [90, 90, 90, 70]), room("2", [90, 90, 90, 85]), room("3", [95, 95, 95, 60])]);
    expect(out.map((r) => r.label)).toEqual(["3", "1"]);
    expect(out[1].usual).toBe(90);
  });
  it("문 열기 전(null)은 빼고, 앞 달이 셋 안 되는 새 방은 뺀다", () => {
    expect(roomsBelowUsual([room("new", [null, 30, 90, 90, 40])])).toHaveLength(1);
    expect(roomsBelowUsual([room("new", [null, null, null, 90, 40])])).toHaveLength(0);
    expect(roomsBelowUsual([room("closed", [90, 90, 90, null])])).toHaveLength(0);
  });
  it("seriesAverage 는 열린 달만", () => {
    expect(seriesAverage([null, 80, 100])).toBe(90);
    expect(seriesAverage([null, null])).toBeNull();
  });
});

describe("mostVacantCells", () => {
  it("방 수 대비 빈 박 비율 순, 빈 박 10 미만은 뺀다", () => {
    const cells = [
      { available: 330, id: "a", vacant: 187 },
      { available: 30, id: "tiny", vacant: 5 },
      { available: 780, id: "b", vacant: 210 },
      { available: 300, id: "c", vacant: 277 },
    ];
    expect(mostVacantCells(cells, 2).map((c) => c.id)).toEqual(["c", "a"]);
  });
});

describe("isLowOccupancy — 표시(정수) 60 미만만 빨강", () => {
  it("화면에 60% 로 보이면 빨강이 아니다", () => {
    expect(OCCUPANCY_LINE).toBe(60);
    expect(isLowOccupancy(66.7)).toBe(false);
    expect(isLowOccupancy(60)).toBe(false);
    expect(isLowOccupancy(59.5)).toBe(false);
    expect(isLowOccupancy(59.4)).toBe(true);
    expect(isLowOccupancy(Number.NaN)).toBe(false);
  });
});

describe("occupancyPctText — 가동률은 정수", () => {
  it("반올림 · NaN", () => {
    expect(occupancyPctText(71.1)).toBe("71%");
    expect(occupancyPctText(66.7)).toBe("67%");
    expect(occupancyPctText(0)).toBe("0%");
    expect(occupancyPctText(Number.NaN)).toBe("—");
  });
});
