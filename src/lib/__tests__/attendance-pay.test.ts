import { describe, expect, it } from "vitest";
import {
  calculateMonthlyPay,
  dailyGrossExact,
  paidSecondsForSession,
  reconcileDailyPaysToTotal,
  resolveEffective,
  roundToNearest10,
} from "../attendance-pay-calculation";
import { gapFillMinFrom } from "../attendance";

describe("attendance hourly pay calculation", () => {
  it("uses the rate effective on the Tokyo operating date boundary", () => {
    const rates = [
      { hourly_rate: 1200, effective_from: "2026-06-01", effective_to: "2026-06-14" },
      { hourly_rate: 1300, effective_from: "2026-06-15", effective_to: null },
    ];

    expect(resolveEffective(rates, "2026-06-14")?.hourly_rate).toBe(1200);
    expect(resolveEffective(rates, "2026-06-15")?.hourly_rate).toBe(1300);
    expect(resolveEffective(rates, "2026-07-01")?.hourly_rate).toBe(1300);
  });

  it("prefers the latest matching effective row when ranges overlap", () => {
    const rates = [
      { hourly_rate: 1200, effective_from: "2026-06-01", effective_to: null },
      { hourly_rate: 1350, effective_from: "2026-06-20", effective_to: null },
    ];

    expect(resolveEffective(rates, "2026-06-19")?.hourly_rate).toBe(1200);
    expect(resolveEffective(rates, "2026-06-20")?.hourly_rate).toBe(1350);
  });

  it("subtracts only closed break seconds and never returns negative paid seconds", () => {
    expect(
      paidSecondsForSession("2026-06-01T09:00:00+09:00", "2026-06-01T17:30:30+09:00", 1800),
    ).toBe(28830);
    expect(
      paidSecondsForSession("2026-06-01T09:00:00+09:00", "2026-06-01T09:10:00+09:00", 3600),
    ).toBe(0);
  });

  it("keeps daily gross exact and applies the 10-yen ceiling only at the monthly layer", () => {
    expect(dailyGrossExact(1, 1250)).toBeCloseTo(20.8333333333, 8);
    expect(roundToNearest10(20.8333333333)).toBe(30);
    expect(roundToNearest10(100)).toBe(100);
    expect(roundToNearest10(101)).toBe(110);
  });

  it("reconciles personal export daily display amounts to the official monthly total", () => {
    const rows = [
      { workMinutes: 1, dailyPay: 21 },
      { workMinutes: 1, dailyPay: 21 },
      { workMinutes: 0, dailyPay: 0 },
    ];

    const reconciled = reconcileDailyPaysToTotal(rows, 50);

    expect(reconciled.map((row) => row.dailyPay)).toEqual([21, 29, 0]);
    expect(reconciled.reduce((sum, row) => sum + row.dailyPay, 0)).toBe(50);
  });

  it("does not overpay 10 yen from floating-point noise before the monthly ceiling (2026-10-19)", () => {
    // 1,000엔 × 1분 = 16.666…엔, 6일이면 정확히 100엔. 부동소수 합은 100.00000000000001 → 전에는 110엔.
    expect(roundToNearest10(100.00000000000001)).toBe(100);
    expect(roundToNearest10(100.0001)).toBe(110);
    const sessions = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      operating_date: `2026-09-0${i + 1}`,
      clock_in_at: `2026-09-0${i + 1}T09:00:00+09:00`,
      clock_out_at: `2026-09-0${i + 1}T09:01:00+09:00`,
      status: "completed",
      review_state: "normal",
    }));
    const calc = calculateMonthlyPay({
      userId: "u",
      firstDay: "2026-09-01",
      lastDay: "2026-09-30",
      sessions,
      rates: [{ hourly_rate: 1000, effective_from: "2026-01-01", effective_to: null }],
      employment: [{ employment_type: "hourly", effective_from: "2026-01-01", effective_to: null }],
      allowances: [],
      breakSecondsBySession: new Map(),
      correctionStatusOf: () => null,
    });
    expect(calc.totalPaidMinutes).toBe(6);
    expect(calc.expectedGross).toBe(100);
    expect(calc.baseGross).toBe(100);
  });
});

// 2026-10-21 — 시급 · 고용형태 등록이 첫 출근보다 늦으면 그 사이 근무가 조용히 0원이 되고 마감도 통과됐다.
describe("unpricedCount — 고용형태 · 시급이 없어 0원이 된 근무", () => {
  const session = (date: string) => ({
    id: date,
    operating_date: date,
    clock_in_at: `${date}T09:00:00+09:00`,
    clock_out_at: `${date}T18:00:00+09:00`,
    status: "completed",
    review_state: "normal",
  });
  const base = {
    userId: "u",
    firstDay: "2026-10-01",
    lastDay: "2026-10-31",
    allowances: [],
    breakSecondsBySession: new Map<string, number>(),
    correctionStatusOf: () => null,
  };

  it("고용형태가 없는 날 · 시급이 없는 시급제 날을 센다", () => {
    const calc = calculateMonthlyPay({
      ...base,
      sessions: [session("2026-10-01"), session("2026-10-03"), session("2026-10-06")],
      // 고용형태는 10/3 부터, 시급은 10/5 부터 — 10/1(고용형태 없음) · 10/3(시급 없음)이 0원.
      employment: [{ employment_type: "hourly", effective_from: "2026-10-03", effective_to: null }],
      rates: [{ hourly_rate: 1000, effective_from: "2026-10-05", effective_to: null }],
    });
    expect(calc.unpricedCount).toBe(2);
    expect(calc.totalPaidMinutes).toBe(9 * 60);
  });

  it("월급제 날 · 검토 필요 같은 이미 막히는 근무는 세지 않는다", () => {
    const calc = calculateMonthlyPay({
      ...base,
      sessions: [session("2026-10-01"), { ...session("2026-10-02"), review_state: "review_required" }],
      employment: [
        { employment_type: "salaried", effective_from: "2026-01-01", effective_to: "2026-10-01" },
        { employment_type: "hourly", effective_from: "2026-10-02", effective_to: null },
      ],
      rates: [{ hourly_rate: 1000, effective_from: "2026-10-02", effective_to: null }],
    });
    expect(calc.unpricedCount).toBe(0);
    expect(calc.excludedCount).toBe(1);
  });
});

describe("gapFillMinFrom — 빈 날 채우기는 지난달 1일부터", () => {
  it("지난달 1일, 1월이면 작년 12월 1일", () => {
    expect(gapFillMinFrom("2026-10-21")).toBe("2026-09-01");
    expect(gapFillMinFrom("2027-01-05")).toBe("2026-12-01");
  });
});

describe("monthlyPayYen — 2026-10월분부터 1엔 단위(2026-10-27)", () => {
  it("10월분부터는 1엔 미만 반올림, 그 전 달은 10엔 올림", async () => {
    const { monthlyPayYen, ONE_YEN_PAY_START_YM } = await import("@/lib/attendance-pay-calculation");
    const { PAYROLL_PREP_START_YM } = await import("@/lib/payroll-prep");
    expect(ONE_YEN_PAY_START_YM).toBe(PAYROLL_PREP_START_YM);
    expect(monthlyPayYen(93.2, "2026-10")).toBe(93);
    expect(monthlyPayYen(93.5, "2026-10")).toBe(94);
    expect(monthlyPayYen(100.00000000000001, "2026-10")).toBe(100);
    expect(monthlyPayYen(93.2, "2026-09")).toBe(100);
  });
});
