import { describe, expect, it } from "vitest";

import { isMonthEnded, isValidYm, resolveClockOutAfterClockIn, tokyoWallClockInstant } from "@/lib/attendance-clock";

/**
 * 출퇴근 시각 조합 (2026-10-01).
 *
 * 직원 정정 요청이 퇴근을 다음 날로 넘기지 않아, 22:00 → 06:00 요청이 「퇴근이 출근보다 앞선」 값으로
 * 저장되고 승인에서 `invalid` 로 떨어졌다. 관리자 수동 수정과 같은 함수를 쓰게 한 회귀 가드.
 */
describe("tokyoWallClockInstant", () => {
  it("도쿄 벽시계를 UTC 시각으로 바꾼다", () => {
    expect(tokyoWallClockInstant("2026-10-01", "09:00")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("형식이 틀리거나 비어 있으면 null", () => {
    expect(tokyoWallClockInstant("2026-10-01", null)).toBeNull();
    expect(tokyoWallClockInstant("2026-10-01", "9:00")).toBeNull();
  });
});

describe("resolveClockOutAfterClockIn", () => {
  it("출근 뒤면 같은 날", () => {
    const clockIn = tokyoWallClockInstant("2026-10-01", "09:00");
    expect(resolveClockOutAfterClockIn("2026-10-01", "18:00", clockIn)).toBe("2026-10-01T09:00:00.000Z");
  });

  it("출근보다 앞서면 다음 날(야간 근무)", () => {
    const clockIn = tokyoWallClockInstant("2026-10-01", "22:00");
    // 도쿄 10/2 06:00 = UTC 10/1 21:00
    expect(resolveClockOutAfterClockIn("2026-10-01", "06:00", clockIn)).toBe("2026-10-01T21:00:00.000Z");
  });

  it("출근과 같은 시각이면 다음 날로 본다(0분 근무는 만들지 않는다)", () => {
    const clockIn = tokyoWallClockInstant("2026-10-01", "09:00");
    expect(resolveClockOutAfterClockIn("2026-10-01", "09:00", clockIn)).toBe("2026-10-02T00:00:00.000Z");
  });

  it("비교할 출근이 없으면 같은 날 그대로", () => {
    expect(resolveClockOutAfterClockIn("2026-10-01", "06:00", null)).toBe("2026-09-30T21:00:00.000Z");
  });

  it("월말 → 다음 달로 넘어간다", () => {
    const clockIn = tokyoWallClockInstant("2026-10-31", "23:00");
    expect(resolveClockOutAfterClockIn("2026-10-31", "02:00", clockIn)).toBe("2026-10-31T17:00:00.000Z");
  });
});

describe("isValidYm", () => {
  it("accepts YYYY-MM with month 01-12 only", () => {
    expect(isValidYm("2026-10")).toBe(true);
    expect(isValidYm("2026-01")).toBe(true);
    expect(isValidYm("2026-12")).toBe(true);
    expect(isValidYm("2026-00")).toBe(false);
    expect(isValidYm("2026-13")).toBe(false);
    expect(isValidYm("2026-99")).toBe(false);
    expect(isValidYm("2026-1")).toBe(false);
    expect(isValidYm(undefined)).toBe(false);
  });
});

describe("isMonthEnded — 끝난 달만 마감", () => {
  it("the current Tokyo month and future months are not ended", () => {
    expect(isMonthEnded("2026-10", "2026-10-31")).toBe(false);
    expect(isMonthEnded("2026-11", "2026-10-26")).toBe(false);
  });
  it("earlier months are ended, including across a year boundary", () => {
    expect(isMonthEnded("2026-09", "2026-10-01")).toBe(true);
    expect(isMonthEnded("2025-12", "2026-01-01")).toBe(true);
  });
});
