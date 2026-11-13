import { describe, expect, it } from "vitest";
import { niceMax, splitMonthRevenue } from "@/lib/chart-scale";

describe("niceMax — 차트 축 맨 위 눈금", () => {
  it("60만 조금 넘는 최대 막대는 70만으로 올린다(예전엔 100만까지 비었다)", () => {
    expect(niceMax(612_000)).toBe(700_000);
    expect(niceMax(600_000)).toBe(600_000);
  });

  it("1.5 · 2.5 단계를 쓴다", () => {
    expect(niceMax(110_000)).toBe(150_000);
    expect(niceMax(210_000)).toBe(250_000);
    expect(niceMax(1_100_000)).toBe(1_500_000);
  });

  it("항상 값 이상이고, 값의 2배를 넘지 않는다", () => {
    for (const v of [1, 7, 99, 1234, 45_678, 380_500, 2_950_000, 9_999_999]) {
      const max = niceMax(v);
      expect(max).toBeGreaterThanOrEqual(v);
      expect(max).toBeLessThanOrEqual(v * 2);
    }
  });

  it("10의 거듭제곱 경계", () => {
    expect(niceMax(100_000)).toBe(100_000);
    expect(niceMax(900_000)).toBe(1_000_000);
  });

  it("0 이하 · 숫자가 아닌 값은 기본 1만", () => {
    expect(niceMax(0)).toBe(10_000);
    expect(niceMax(-5)).toBe(10_000);
    expect(niceMax(Number.NaN)).toBe(10_000);
  });
});

describe("splitMonthRevenue — 고른 달과 상관없이 이번 달만 쌓는다", () => {
  const now = "2026-11";
  const actual = 4_000_000;
  const split = (m: string, rev: number) => splitMonthRevenue(m, rev, now, actual);

  it("지난달을 골라 6개월이 5월~10월이어도 전부 실적(이번 달은 범위 밖)", () => {
    expect(split("2026-10", 9_000_000)).toEqual({ actual: 9_000_000, booked: 0 });
  });

  it("이번 달을 고르면 이번 달은 실적 + 예약 확정", () => {
    expect(split("2026-11", 10_000_000)).toEqual({ actual: 4_000_000, booked: 6_000_000 });
    expect(split("2026-10", 9_000_000).booked).toBe(0);
  });

  it("다음 달을 고르면 이번 달도 실적 + 예약 확정, 다음 달은 통째로 예약 확정", () => {
    expect(split("2026-11", 10_000_000)).toEqual({ actual: 4_000_000, booked: 6_000_000 });
    expect(split("2026-12", 3_000_000)).toEqual({ actual: 0, booked: 3_000_000 });
  });

  it("이번 달 실적이 총액보다 크거나 모르면 넘치지 않게", () => {
    expect(splitMonthRevenue("2026-11", 1_000_000, now, 2_000_000)).toEqual({ actual: 1_000_000, booked: 0 });
    expect(splitMonthRevenue("2026-11", 1_000_000, now, null)).toEqual({ actual: 0, booked: 1_000_000 });
  });
});
