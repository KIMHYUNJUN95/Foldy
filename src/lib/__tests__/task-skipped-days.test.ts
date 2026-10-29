import { describe, expect, it } from "vitest";
import { selectRecentSkippedDays, selectUpcomingSkippedDays } from "@/lib/task-skipped-days";

describe("selectRecentSkippedDays", () => {
  const today = "2026-10-28";

  it("건너뜀만 골라 최신순으로 돌려준다", () => {
    const states: Array<[string, string]> = [
      ["2026-10-20", "skipped"],
      ["2026-10-26", "skipped"],
      ["2026-10-22", "completed"],
      ["2026-10-24", "moved"],
      ["2026-10-23", "skipped"],
    ];
    expect(selectRecentSkippedDays(states, today)).toEqual(["2026-10-26", "2026-10-23", "2026-10-20"]);
  });

  it("30일 경계: 30일 전은 포함, 31일 전은 제외", () => {
    const states: Array<[string, string]> = [
      ["2026-09-28", "skipped"],
      ["2026-09-27", "skipped"],
    ];
    expect(selectRecentSkippedDays(states, today)).toEqual(["2026-09-28"]);
  });

  it("오늘은 포함, 미래는 제외", () => {
    const states: Array<[string, string]> = [
      ["2026-10-28", "skipped"],
      ["2026-10-29", "skipped"],
    ];
    expect(selectRecentSkippedDays(states, today)).toEqual(["2026-10-28"]);
  });

  it("Map 도 받는다", () => {
    expect(selectRecentSkippedDays(new Map([["2026-10-01", "skipped"]]), today)).toEqual(["2026-10-01"]);
  });

  it("없으면 빈 배열", () => {
    expect(selectRecentSkippedDays([], today)).toEqual([]);
  });
});

describe("selectUpcomingSkippedDays", () => {
  it("오늘 뒤의 건너뜀만, 가까운 날부터", () => {
    const states: Array<[string, string]> = [
      ["2026-11-05", "skipped"],
      ["2026-10-28", "skipped"],
      ["2026-10-30", "skipped"],
      ["2026-11-01", "moved"],
      ["2026-10-20", "skipped"],
    ];
    expect(selectUpcomingSkippedDays(states, "2026-10-28")).toEqual(["2026-10-30", "2026-11-05"]);
  });
});
