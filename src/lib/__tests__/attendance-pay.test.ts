import { describe, expect, it } from "vitest";
import {
  calculateMonthlyPay,
  dailyGrossExact,
  paidSecondsForSession,
  reconcileDailyPaysToTotal,
  resolveEffective,
  roundToNearest10,
} from "../attendance-pay-calculation";

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
