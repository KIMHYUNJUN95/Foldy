import { describe, expect, it } from "vitest";
import { resolveDateRangeParams } from "@/lib/iso-date-param";

const fallback = { from: "2026-08-12", to: "2026-11-10" };

describe("resolveDateRangeParams", () => {
  it("실제 날짜면 그대로 쓴다", () => {
    expect(resolveDateRangeParams("2026-09-01", "2026-09-30", fallback)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("없는 날짜(2월 30일 · 13월)는 기본값으로 돌린다", () => {
    expect(resolveDateRangeParams("2026-02-30", "2026-13-01", fallback)).toEqual(fallback);
  });
  it("형식이 틀리면 기본값", () => {
    expect(resolveDateRangeParams("abc", undefined, fallback)).toEqual(fallback);
  });
  it("한쪽만 틀리면 그쪽만 기본값", () => {
    expect(resolveDateRangeParams("2026-09-01", "zzz", fallback)).toEqual({ from: "2026-09-01", to: "2026-11-10" });
  });
  it("시작이 끝보다 늦으면 둘 다 기본값", () => {
    expect(resolveDateRangeParams("2026-10-01", "2026-09-01", fallback)).toEqual(fallback);
  });
});

// 근태 화면 주소 값(2026-11-11) — 모양만 보던 ?ym · ?date 를 실제 달 · 날짜로. 규칙은 이 파일 하나.
import { isRealYm, resolveDayParam, resolveYmParam } from "@/lib/iso-date-param";

describe("isRealYm", () => {
  it("01~12 만", () => {
    expect(isRealYm("2026-09")).toBe(true);
    expect(isRealYm("2025-00")).toBe(false);
    expect(isRealYm("2025-13")).toBe(false);
    expect(isRealYm("2025-1")).toBe(false);
    expect(isRealYm(undefined)).toBe(false);
  });
});

describe("resolveYmParam", () => {
  it("틀린 달 · 범위 밖은 지금 달", () => {
    expect(resolveYmParam("2025-00", "2026-11")).toBe("2026-11");
    expect(resolveYmParam("2026-12", "2026-11")).toBe("2026-11");
    expect(resolveYmParam("2026-03", "2026-11")).toBe("2026-03");
  });
  it("앞뒤 범위를 줄 수 있다(교통비: 3년 전 ~ 다음 달)", () => {
    const o = { maxMonthsBack: 36, maxMonthsAhead: 1 };
    expect(resolveYmParam("2026-12", "2026-11", o)).toBe("2026-12");
    expect(resolveYmParam("2027-01", "2026-11", o)).toBe("2026-11");
    expect(resolveYmParam("2023-11", "2026-11", o)).toBe("2023-11");
    expect(resolveYmParam("2023-10", "2026-11", o)).toBe("2026-11");
  });
});

describe("resolveDayParam", () => {
  it("실제 날짜이고 오늘 ~ 90일 전 안일 때만", () => {
    expect(resolveDayParam("2026-11-01", "2026-11-11", 90)).toBe("2026-11-01");
    expect(resolveDayParam("2026-02-30", "2026-11-11", 90)).toBe("2026-11-11");
    expect(resolveDayParam("2026-11-12", "2026-11-11", 90)).toBe("2026-11-11");
    expect(resolveDayParam("2026-08-13", "2026-11-11", 90)).toBe("2026-08-13");
    expect(resolveDayParam("2026-08-12", "2026-11-11", 90)).toBe("2026-11-11");
    expect(resolveDayParam(undefined, "2026-11-11", 90)).toBe("2026-11-11");
  });
});
