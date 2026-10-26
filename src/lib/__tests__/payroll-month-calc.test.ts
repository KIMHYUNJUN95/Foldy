import { describe, expect, it } from "vitest";
import {
  calculatePayrollMonth,
  ceilTo10,
  DEFAULT_PAYROLL_TAX_RULES,
  EXCEL_LEGACY_TAX_RULES,
  employmentInsurancePremium,
  excelRound,
  insuranceFiscalYear,
  type PayrollMonthInput,
} from "@/lib/payroll-month-calc";

function input(over: Partial<PayrollMonthInput> = {}): PayrollMonthInput {
  return {
    segments: [{ hourlyRate: 1200, paidMinutes: 60 * 80 }],
    autoAllowances: { overtime: 0, weekend: 0, special: 0 },
    commuteNonTaxable: 0,
    withholding: { cls: "kou", dependents: 0, taxYear: 2026 },
    employmentInsurance: { enrolled: false, ratePerMille: null },
    ...over,
  };
}

describe("끝처리", () => {
  it("excelRound — 0.5 는 0 에서 먼 쪽", () => {
    expect(excelRound(17.5)).toBe(18);
    expect(excelRound(17.49)).toBe(17);
    expect(excelRound(-17.5)).toBe(-18);
  });

  it("ceilTo10 — 실수령 10엔 올림, 부동소수 끝 무시", () => {
    expect(ceilTo10(93)).toBe(100);
    expect(ceilTo10(100)).toBe(100);
    expect(ceilTo10(100.00000000000001)).toBe(100);
  });

  it("雇用保険 — 50전 이하 버림, 넘으면 올림", () => {
    // 100,100 × 5.5/1000 = 550.55 → 551
    expect(employmentInsurancePremium(100100, 5.5)).toBe(551);
    // 100,000 × 5.5/1000 = 550.0
    expect(employmentInsurancePremium(100000, 5.5)).toBe(550);
    // 100,090 × 5.5/1000 = 550.495 → 550
    expect(employmentInsurancePremium(100090, 5.5)).toBe(550);
    // 정확히 50전 → 버림: 100 × 5/1000 = 0.5
    expect(employmentInsurancePremium(100, 5)).toBe(0);
  });

  it("雇用保険 율은 年度(4월~3월) 기준", () => {
    expect(insuranceFiscalYear("2027-03")).toBe(2026);
    expect(insuranceFiscalYear("2027-04")).toBe(2027);
  });
});

describe("calculatePayrollMonth", () => {
  it("시급 구간별 월 합계 분에 한 번 곱하고 엔 반올림(엑셀 ROUND(시급 × 시간 × 24))", () => {
    // 1,050 × 53시간 32분 = 1,050 × 3212 ÷ 60 = 56,210 / 1,100 × 1분 = 18.33 → 18
    const r = calculatePayrollMonth(
      input({
        segments: [
          { hourlyRate: 1050, paidMinutes: 3212 },
          { hourlyRate: 1100, paidMinutes: 1 },
        ],
      }),
    );
    expect(r.segmentPays.map((s) => s.pay)).toEqual([56210, 18]);
    expect(r.taxable).toBe(56228);
  });

  it("課税計 · 支給額合計 · 差引(10엔 올림) — 엑셀 열 순서대로", () => {
    const r = calculatePayrollMonth(
      input({
        segments: [{ hourlyRate: 1200, paidMinutes: 60 * 100 + 7 }], // 120,140
        autoAllowances: { overtime: 0, weekend: 3000, special: 1500.4 },
        commuteNonTaxable: 8420,
        manual: {
          prevMonthAdjustment: -500,
          prevMonthAdjustmentYm: "2026-08",
          overtime: 1000,
          yearEndAdjustment: 0,
        },
      }),
    );
    expect(r.segmentPays[0].pay).toBe(120140);
    expect(r.weekend).toBe(3000);
    expect(r.special).toBe(1500);
    expect(r.overtime).toBe(1000);
    expect(r.taxable).toBe(120140 - 500 + 1000 + 3000 + 1500);
    expect(r.grossTotal).toBe(r.taxable + 8420);
    // 甲 0人: 課税計 125,140 → 表 [125,000, 127,000) 의 0人
    expect(r.withholding).toBe(1190);
    expect(r.deductionTotal).toBe(1190);
    expect(r.netPay).toBe(ceilTo10(r.grossTotal - 1190));
    expect(r.roundUpYen).toBe(r.netPay - (r.grossTotal - 1190));
    expect(r.roundUpYen).toBeGreaterThanOrEqual(0);
    expect(r.roundUpYen).toBeLessThan(10);
    expect(r.issues).toEqual([]);
  });

  it("前月調整額 금액이 있는데 몇 월분이 없으면 확인 필요", () => {
    const r = calculatePayrollMonth(input({ manual: { prevMonthAdjustment: 300 } }));
    expect(r.issues).toContain("prev_adjustment_month_missing");
  });

  it("前月調整額이 교통비 조정이면 비과세로 간다", () => {
    const r = calculatePayrollMonth(
      input({
        commuteNonTaxable: 5000,
        manual: { prevMonthAdjustment: 600, prevMonthAdjustmentKind: "commute", prevMonthAdjustmentYm: "2026-08" },
      }),
    );
    expect(r.prevMonthAdjustment).toBe(0);
    expect(r.commuteNonTaxable).toBe(5600);
    expect(r.taxable).toBe(96000);
  });

  describe("乙", () => {
    const otsu = (taxable: number, rules = DEFAULT_PAYROLL_TAX_RULES) =>
      calculatePayrollMonth(
        input({
          segments: [{ hourlyRate: 1000, paidMinutes: (taxable * 60) / 1000 }],
          withholding: { cls: "otsu", dependents: 0, taxYear: 2026 },
          rules,
        }),
      ).withholding;

    it("기본값은 국세청 표대로 하한 없이 소액도 3.063%", () => {
      expect(otsu(9000)).toBe(275);
      expect(otsu(9300)).toBe(284);
    });

    it("옛 엑셀 방식은 9,300엔 미만 0", () => {
      expect(otsu(9000, EXCEL_LEGACY_TAX_RULES)).toBe(0);
      expect(otsu(9300, EXCEL_LEGACY_TAX_RULES)).toBe(284);
    });
  });

  it("甲 부양 인원 — 기본값은 반영, 옛 엑셀은 늘 0人", () => {
    const base = input({
      segments: [{ hourlyRate: 1500, paidMinutes: 60 * 200 }], // 300,000
      withholding: { cls: "kou", dependents: 1, taxYear: 2026 },
    });
    expect(calculatePayrollMonth(base).withholding).toBe(6320);
    expect(calculatePayrollMonth({ ...base, rules: EXCEL_LEGACY_TAX_RULES }).withholding).toBe(7930);
  });

  it("丙 — 근무한 날마다 日額表, 엑셀 방식이면 0", () => {
    const hei = input({ withholding: { cls: "hei", dependents: 0, taxYear: 2026, heiDailyTaxable: [9000, 9800, 12000] } });
    const r = calculatePayrollMonth(hei);
    expect(r.withholding).toBe(0 + 1 + 79);
    expect(calculatePayrollMonth({ ...hei, rules: EXCEL_LEGACY_TAX_RULES }).withholding).toBe(0);
  });

  it("雇用保険 — 가입자만, 賃金総額(교통비 포함) × 율, 율 없으면 확인 필요", () => {
    const enrolled = input({
      commuteNonTaxable: 4000,
      employmentInsurance: { enrolled: true, ratePerMille: 5.5 },
    });
    const r = calculatePayrollMonth(enrolled);
    // (96,000 + 4,000) × 5.5/1000 = 550
    expect(r.employmentInsurance).toBe(550);
    expect(r.socialInsuranceTotal).toBe(550);
    expect(r.deductionTotal).toBe(550 + r.withholding);

    const noRate = calculatePayrollMonth({ ...enrolled, employmentInsurance: { enrolled: true, ratePerMille: null } });
    expect(noRate.employmentInsurance).toBe(0);
    expect(noRate.issues).toContain("no_insurance_rate");

    const overridden = calculatePayrollMonth({ ...enrolled, manual: { employmentInsuranceOverride: 500 } });
    expect(overridden.employmentInsurance).toBe(500);
  });

  it("조회 금액 — 기본값은 사회보험 뺀 뒤, 옛 엑셀은 課税計 그대로", () => {
    const base = input({
      segments: [{ hourlyRate: 1000, paidMinutes: 60 * 105 }], // 105,000
      employmentInsurance: { enrolled: true, ratePerMille: 5.5 },
    });
    const r = calculatePayrollMonth(base);
    expect(r.withholdingBasis).toBe(105000 - 577);
    expect(r.withholding).toBe(0);
    expect(calculatePayrollMonth({ ...base, rules: EXCEL_LEGACY_TAX_RULES }).withholdingBasis).toBe(105000);
  });

  it("세금표 없는 해 · 구분 없음은 확인 필요", () => {
    expect(calculatePayrollMonth(input({ withholding: { cls: "kou", dependents: 0, taxYear: 2030 } })).issues).toContain(
      "no_tax_table",
    );
    expect(calculatePayrollMonth(input({ withholding: { cls: null, dependents: 0, taxYear: 2026 } })).issues).toContain(
      "no_withholding_class",
    );
  });

  it("源泉所得税 손 덮어쓰기", () => {
    const r = calculatePayrollMonth(input({ manual: { withholdingOverride: 1234 } }));
    expect(r.withholding).toBe(1234);
    expect(r.withholdingOverridden).toBe(true);
  });
});
