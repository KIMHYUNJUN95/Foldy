import { describe, expect, it } from "vitest";
import {
  buildPrepRow,
  EMPTY_PREP_MANUAL,
  manualFromTotal,
  payrollPrepAvailable,
  prepTotals,
  sortPrepRows,
  type PrepRowInput,
} from "@/lib/payroll-prep";
import { getPayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { EMPTY_MEMBER_PAYROLL_SETTING } from "@/lib/payroll-settings-rules";

/** 알바 급여 P3 — 급여 준비 한 줄 · 합계 · 확인 필요(docs/product/39 §5-A · §5-D). 숫자는 시안(10월분 · 11/10 지급)과 같다. */
function input(over: Partial<PrepRowInput>): PrepRowInput {
  return {
    userId: "u",
    name: "가명",
    setting: { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "transfer", withholdingClass: "kou" },
    nameKatakana: "カメイ",
    hireDate: "2026-01-01",
    today: "2026-11-02",
    finalized: true,
    paidMinutes: 0,
    workDays: 0,
    rateSegments: [],
    dailyTaxable: [],
    allowanceRegular: 0,
    allowanceSpecial: 0,
    commuteApproved: 0,
    manual: null,
    taxYear: 2026,
    ym: "2026-10",
    insuranceRates: {},
    ...over,
  };
}

describe("buildPrepRow", () => {
  it("시급 두 구간 + 특별수당 + 지난달 조정 −1,200 → 실수령 105,340(+7 올림)", () => {
    const row = buildPrepRow(
      input({
        paidMinutes: 30 * 60 + 48 * 60 + 40,
        workDays: 13,
        rateSegments: [
          { rate: 1200, paidMinutes: 30 * 60 },
          { rate: 1250, paidMinutes: 48 * 60 + 40 },
        ],
        allowanceSpecial: 2000,
        commuteApproved: 7700,
        manual: { ...EMPTY_PREP_MANUAL, prevAdjustment: -1200, prevAdjustmentYm: "2026-08" },
      }),
    );
    expect(row.segments.map((s) => s.pay)).toEqual([36000, 60833]);
    expect(row.basePay).toBe(96833);
    expect(row.special).toBe(2000);
    expect(row.adjustments).toBe(800);
    expect(row.gross).toBe(105333);
    expect(row.withholding).toBe(0);
    expect(row.net).toBe(105340);
    expect(row.roundUpYen).toBe(7);
    expect(row.issues).toEqual([]);
  });

  it("「일반」 추가수당은 주말수당 칸, 「특별」은 특별수당 칸(결정 4)", () => {
    const row = buildPrepRow(input({ paidMinutes: 600, rateSegments: [{ rate: 1250, paidMinutes: 600 }], allowanceRegular: 3000, allowanceSpecial: 500 }));
    expect(row.overtime).toBe(0);
    expect(row.weekend).toBe(3000);
    expect(row.special).toBe(500);
  });

  it("원천세 구분이 없으면 원천세 · 실수령을 내지 않고 확인 필요", () => {
    const row = buildPrepRow(
      input({
        setting: { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "transfer" },
        paidMinutes: 55 * 60 + 5,
        rateSegments: [{ rate: 1200, paidMinutes: 55 * 60 + 5 }],
        commuteApproved: 5400,
      }),
    );
    expect(row.gross).toBe(71500);
    expect(row.withholding).toBeNull();
    expect(row.net).toBeNull();
    expect(row.issues).toEqual(["withholding"]);
  });

  it("근태 마감 전 · 가타카나 없음 · 사유 없는 원천세 덮어쓰기 · 몇 월분 없는 조정을 순서대로 모은다", () => {
    const row = buildPrepRow(
      input({
        finalized: false,
        nameKatakana: null,
        paidMinutes: 60,
        rateSegments: [{ rate: 1200, paidMinutes: 60 }],
        manual: { ...EMPTY_PREP_MANUAL, prevAdjustment: 500, withholdingOverride: 10 },
      }),
    );
    expect(row.issues).toEqual(["not_finalized", "katakana", "prev_adjustment_month_missing", "override_no_reason"]);
    expect(row.withholding).toBe(10);
  });

  it("세금표가 없는 해(지급일의 해)면 원천세를 내지 않는다", () => {
    const row = buildPrepRow(input({ taxYear: 2030, paidMinutes: 6000, rateSegments: [{ rate: 1250, paidMinutes: 6000 }] }));
    expect(row.issues).toContain("no_tax_table");
    expect(row.net).toBeNull();
  });

  it("근무 없이 수당만 있으면 확인 필요", () => {
    const row = buildPrepRow(input({ allowanceSpecial: 2000 }));
    expect(row.issues).toContain("allowance_without_work");
  });
});

describe("prepTotals · sortPrepRows", () => {
  it("이체 · 현금 실수령을 나누고, 계산 전 사람은 합계에서 뺀다", () => {
    const a = buildPrepRow(input({ userId: "a", name: "나", paidMinutes: 600, rateSegments: [{ rate: 1200, paidMinutes: 600 }] }));
    const b = buildPrepRow(
      input({
        userId: "b",
        name: "가",
        setting: { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "cash", withholdingClass: "kou" },
        paidMinutes: 600,
        rateSegments: [{ rate: 1200, paidMinutes: 600 }],
      }),
    );
    const c = buildPrepRow(
      input({
        userId: "c",
        name: "다",
        setting: { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "transfer" },
        paidMinutes: 600,
        rateSegments: [{ rate: 1200, paidMinutes: 600 }],
      }),
    );
    const t = prepTotals([a, b, c]);
    expect(t.transfer).toEqual({ people: 2, net: 12000 });
    expect(t.cash).toEqual({ people: 1, net: 12000 });
    expect(t.net).toBe(24000);
    expect(t.uncalculated).toBe(1);
    expect(t.needsCheck).toBe(1);
    expect(sortPrepRows([a, b, c]).map((r) => r.userId)).toEqual(["c", "b", "a"]);
  });
});

describe("helpers", () => {
  it("10월분부터 새 계산", () => {
    expect(payrollPrepAvailable("2026-09")).toBe(false);
    expect(payrollPrepAvailable("2026-10")).toBe(true);
  });
  it("칸 합계를 고치면 손 입력 = 합계 − 자동", () => {
    expect(manualFromTotal(2500, 2000)).toBe(500);
    expect(manualFromTotal(0, 2000)).toBe(-2000);
  });
  it("한국어 문구엔 한자가 없다", () => {
    const text = JSON.stringify(getPayrollPrepCopy("ko"));
    expect(text).not.toMatch(/[甲乙丙専社雇残週特前総差源]/);
  });
});
