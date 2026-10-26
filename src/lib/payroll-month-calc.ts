import { settleYen } from "@/lib/attendance-pay-calculation";
import type { WithholdingClass } from "@/lib/payroll-settings-rules";
import { dailyHeiWithholding, monthlyWithholding } from "@/lib/withholding-tax";

/**
 * 알바 급여 P2 — 한 사람의 한 달 급여 계산(DB 없음, 순수). docs/product/39 §4.
 *
 * 엑셀 `新アルバイト給与管理` 입력 시트의 열을 그대로 낸다(F · I · J~O · P · Q · U · V · W · Z · AB).
 * ```
 * 支給額_k  = ROUNDUP(시급_k × 분_k ÷ 60)        ← 시급 구간별 그 달 분 합계에 한 번 곱함, 소수점이면 1엔 올림(2026-10-27)
 * 課税計 P   = Σ支給額_k + 前月調整(과세) + 残業 + 週末 + 特別 + 通勤課税
 * 支給額合計 Q = P + 通勤非課税(+ 前月調整 교통비분)
 * 社会保険計 V = 雇用保険(가입자만)
 * 源泉税 W   = 표 조회(甲乙丙)
 * 控除合計 Z = V + W + 年末調整
 * 差引 AB    = Q − Z                            ← 1엔 단위 그대로 지급(2026-10-27 — 10엔 올림 폐지)
 * ```
 * 원천세 규칙은 `PayrollTaxRules` 로 갈라 둔다 — 기본값은 국세청 표 기준(인사팀 답변 2026-10-26), 엑셀 방식은
 * `EXCEL_LEGACY_TAX_RULES` 로 남겨 9월분 대조에 쓴다(§11-5 · §11-12).
 */

/** 원천세 규칙 스위치. 기본값 = `DEFAULT_PAYROLL_TAX_RULES`(국세청), 옛 엑셀 = `EXCEL_LEGACY_TAX_RULES`. */
export type PayrollTaxRules = {
  /** 乙: 표 조회 금액이 9,300엔 미만이면 0(옛 엑셀). 국세청 月額表 乙欄에는 이 하한이 없다. */
  otsuExcelFloor: boolean;
  /** 표 조회 금액 — 課税計 그대로(옛 엑셀) / 사회보험(雇用保険) 뺀 뒤(국세청 표 기준). */
  lookupBasis: "taxable" | "after_social_insurance";
  /** 甲 부양 인원 열을 쓸지. false = 늘 0人 열(옛 엑셀). */
  applyDependents: boolean;
  /** 丙: 근무한 날마다 日額表 丙欄(국세청) / 늘 0(옛 엑셀). */
  heiMode: "daily_table" | "excel_zero";
};

/**
 * 기본값 — 최신 국세청 표 그대로(인사팀 답변 2026-10-26): 乙 하한 없음 · 사회보험 뺀 금액으로 조회 ·
 * 甲 부양 인원 열 · 丙 日額表. 표의 해는 지급일의 해(`taxYear`).
 */
export const DEFAULT_PAYROLL_TAX_RULES: PayrollTaxRules = {
  otsuExcelFloor: false,
  lookupBasis: "after_social_insurance",
  applyDependents: true,
  heiMode: "daily_table",
};

/** 옛 엑셀(2026-09분까지)과 같은 숫자 — 운영엔 쓰지 않고 지난 달 대조(골든 테스트)에만. */
export const EXCEL_LEGACY_TAX_RULES: PayrollTaxRules = {
  otsuExcelFloor: true,
  lookupBasis: "taxable",
  applyDependents: false,
  heiMode: "excel_zero",
};

/** 옛 엑셀이 쓰던 乙 하한(사실은 옛 日額表 丙欄의 하루 기준) — `otsuExcelFloor` 일 때만. */
export const OTSU_EXCEL_FLOOR_YEN = 9300;

export type PayrollMonthInput = {
  /** 시급 구간(엑셀 ①②…) — 그 달 분 합계. 순서는 그대로 열 순서. */
  segments: readonly { hourlyRate: number; paidMinutes: number }[];
  /** Foldy 추가수당을 명세서 칸으로 나눈 값(엔, 소수 가능 — 칸마다 엔 반올림). */
  autoAllowances: { overtime: number; weekend: number; special: number };
  /** 승인된 교통비(비과세). */
  commuteNonTaxable: number;
  /** 급여 준비 화면 손 입력(엔). 없으면 0. */
  manual?: Partial<PayrollManualInput>;
  withholding: {
    cls: WithholdingClass | null;
    dependents: number;
    /** 지급일의 해 — 그해 표로 조회. */
    taxYear: number;
    /** 丙일 때 근무한 날마다의 과세 급여(엔). */
    heiDailyTaxable?: readonly number[];
  };
  employmentInsurance: {
    enrolled: boolean;
    /** 근로자 부담률(1,000분의 n). 가입자인데 null 이면 「부담률 없음」. */
    ratePerMille: number | null;
  };
  rules?: PayrollTaxRules;
};

export type PayrollManualInput = {
  /** 前月調整額(±). */
  prevMonthAdjustment: number;
  /** 前月調整額이 과세 급여 조정인지, 교통비(비과세) 조정인지(§11-14). */
  prevMonthAdjustmentKind: "taxable" | "commute";
  /** 前月調整額이 몇 월분인지(`YYYY-MM`) — 금액이 있으면 꼭(備考 「N月分」). */
  prevMonthAdjustmentYm: string | null;
  overtime: number;
  weekend: number;
  special: number;
  commuteTaxable: number;
  /** 雇用保険 손 덮어쓰기(가입자만). null = 계산값. */
  employmentInsuranceOverride: number | null;
  /** 年末調整(±, 공제 쪽 — 돌려줄 때는 음수). */
  yearEndAdjustment: number;
  /** 源泉所得税 손 덮어쓰기(사유는 부르는 쪽이 남김). null = 계산값. */
  withholdingOverride: number | null;
};

export type PayrollMonthIssue =
  | "no_withholding_class"
  | "no_tax_table"
  | "no_insurance_rate"
  | "prev_adjustment_month_missing";

export type PayrollMonthResult = {
  /** F · I … — 구간마다 ROUND(시급 × 분 ÷ 60). */
  segmentPays: { hourlyRate: number; paidMinutes: number; pay: number }[];
  /** J 前月調整額 — 과세분(교통비 조정은 `commuteNonTaxable` 에 들어감). */
  prevMonthAdjustment: number;
  /** K · L · M — 자동 + 손 입력. */
  overtime: number;
  weekend: number;
  special: number;
  /** N · O. */
  commuteTaxable: number;
  commuteNonTaxable: number;
  /** P 課税計. */
  taxable: number;
  /** Q 支給額合計(= AA 総支給額). */
  grossTotal: number;
  /** U 雇用保険 · V 社会保険計(健康 · 介護 · 厚生年金은 0). */
  employmentInsurance: number;
  socialInsuranceTotal: number;
  /** 원천세 표 조회에 쓴 금액. */
  withholdingBasis: number;
  /** W 源泉所得税. */
  withholding: number;
  withholdingOverridden: boolean;
  /** Y 年末調整. */
  yearEndAdjustment: number;
  /** Z 控除合計(住民税 0). */
  deductionTotal: number;
  /** AB 差引支給額 — 1엔 단위(Q − Z). */
  netPay: number;
  issues: PayrollMonthIssue[];
};

/** 엑셀 ROUND(x, 0) — 0.5 는 0 에서 먼 쪽으로. 부동소수 끝은 먼저 맞춘다. */
export function excelRound(yen: number): number {
  const v = settleYen(yen);
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** 엑셀 ROUNDUP(x, 0) — 소수점이면 1엔 올림(2026-10-27 사용자 결정). 부동소수 끝은 먼저 맞춘다. */
export function ceilYen(yen: number): number {
  return Math.ceil(settleYen(yen));
}

/** 雇用保険 근로자 부담 — 賃金 × 율, 1엔 미만은 50전 이하 버림 · 넘으면 올림(급여에서 뗄 때의 법정 끝처리). */
export function employmentInsurancePremium(wages: number, ratePerMille: number): number {
  const exact = settleYen((wages * ratePerMille) / 1000);
  if (exact <= 0) return 0;
  const yen = Math.floor(exact);
  return settleYen(exact - yen) > 0.5 ? yen + 1 : yen;
}

/** 雇用保険 율이 바뀌는 단위는 年度(4월~3월) — 그 달 급여(말일 마감)가 속한 年度. */
export function insuranceFiscalYear(workYm: string): number {
  const [y, m] = workYm.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

const ZERO_MANUAL: PayrollManualInput = {
  prevMonthAdjustment: 0,
  prevMonthAdjustmentKind: "taxable",
  prevMonthAdjustmentYm: null,
  overtime: 0,
  weekend: 0,
  special: 0,
  commuteTaxable: 0,
  employmentInsuranceOverride: null,
  yearEndAdjustment: 0,
  withholdingOverride: null,
};

export function calculatePayrollMonth(input: PayrollMonthInput): PayrollMonthResult {
  const rules = input.rules ?? DEFAULT_PAYROLL_TAX_RULES;
  const manual = { ...ZERO_MANUAL, ...input.manual };
  const issues: PayrollMonthIssue[] = [];

  const segmentPays = input.segments.map((s) => ({
    hourlyRate: s.hourlyRate,
    paidMinutes: s.paidMinutes,
    pay: ceilYen((s.hourlyRate * s.paidMinutes) / 60),
  }));
  const basePay = segmentPays.reduce((sum, s) => sum + s.pay, 0);

  const adjustTaxable = manual.prevMonthAdjustmentKind === "commute" ? 0 : manual.prevMonthAdjustment;
  const adjustCommute = manual.prevMonthAdjustmentKind === "commute" ? manual.prevMonthAdjustment : 0;
  if (manual.prevMonthAdjustment !== 0 && !manual.prevMonthAdjustmentYm) issues.push("prev_adjustment_month_missing");

  const overtime = ceilYen(input.autoAllowances.overtime) + manual.overtime;
  const weekend = ceilYen(input.autoAllowances.weekend) + manual.weekend;
  const special = ceilYen(input.autoAllowances.special) + manual.special;
  const commuteTaxable = manual.commuteTaxable;
  const commuteNonTaxable = excelRound(input.commuteNonTaxable) + adjustCommute;

  const taxable = basePay + adjustTaxable + overtime + weekend + special + commuteTaxable;
  const grossTotal = taxable + commuteNonTaxable;

  let employmentInsurance = 0;
  if (input.employmentInsurance.enrolled) {
    if (manual.employmentInsuranceOverride != null) {
      employmentInsurance = manual.employmentInsuranceOverride;
    } else if (input.employmentInsurance.ratePerMille == null) {
      issues.push("no_insurance_rate");
    } else {
      employmentInsurance = employmentInsurancePremium(grossTotal, input.employmentInsurance.ratePerMille);
    }
  }
  const socialInsuranceTotal = employmentInsurance;

  const withholdingBasis = rules.lookupBasis === "after_social_insurance" ? taxable - socialInsuranceTotal : taxable;
  let computed = 0;
  const { cls, taxYear } = input.withholding;
  if (cls == null) {
    issues.push("no_withholding_class");
  } else if (cls === "hei") {
    if (rules.heiMode === "daily_table") {
      for (const day of input.withholding.heiDailyTaxable ?? []) {
        const tax = dailyHeiWithholding(taxYear, day);
        if (tax == null) {
          issues.push("no_tax_table");
          computed = 0;
          break;
        }
        computed += tax;
      }
    }
  } else if (cls === "otsu" && rules.otsuExcelFloor && withholdingBasis < OTSU_EXCEL_FLOOR_YEN) {
    computed = 0;
  } else {
    const dependents = cls === "kou" && rules.applyDependents ? input.withholding.dependents : 0;
    const tax = monthlyWithholding(taxYear, cls, withholdingBasis, dependents);
    if (tax == null) issues.push("no_tax_table");
    else computed = tax;
  }
  const withholdingOverridden = manual.withholdingOverride != null;
  const withholding = manual.withholdingOverride ?? computed;

  const deductionTotal = socialInsuranceTotal + withholding + manual.yearEndAdjustment;
  const netPay = grossTotal - deductionTotal;

  return {
    segmentPays,
    prevMonthAdjustment: adjustTaxable,
    overtime,
    weekend,
    special,
    commuteTaxable,
    commuteNonTaxable,
    taxable,
    grossTotal,
    employmentInsurance,
    socialInsuranceTotal,
    withholdingBasis,
    withholding,
    withholdingOverridden,
    yearEndAdjustment: manual.yearEndAdjustment,
    deductionTotal,
    netPay,
    issues,
  };
}
