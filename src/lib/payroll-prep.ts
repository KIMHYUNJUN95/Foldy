import { calculatePayrollMonth, insuranceFiscalYear, type PayrollMonthIssue } from "@/lib/payroll-month-calc";
import type { PayrollKintai } from "@/lib/payroll-kintai";
import {
  payrollIssues,
  type MemberPayrollSetting,
  type PaymentMethod,
  type PayrollIssue,
  type WithholdingClass,
} from "@/lib/payroll-settings-rules";

/**
 * 알바 급여 P3 — 급여 준비 한 줄(한 사람)을 만든다(DB 없음, 순수). docs/product/39 §5-A · §5-D, 40 §4-2.
 *
 * 근태(시급 구간 · 추가수당 · 교통비) + 사람별 설정(P1) + 손 입력(`payroll_month_inputs`) → P2 엔진 → 화면 값 + 확인 필요.
 * 서버(`payroll-prep-server.ts`)가 읽어 와서 여기에 넣고, PC · 모바일이 같은 줄을 그린다.
 */

/** 새 계산(구간별 분 합계 · 실수령 10엔 올림)을 쓰는 첫 달 — 그 전 달은 지금 급여 검토 표 그대로(39 §11-10, 2026-10-25 결정 1). */
export const PAYROLL_PREP_START_YM = "2026-10";

export function payrollPrepAvailable(ym: string): boolean {
  return ym >= PAYROLL_PREP_START_YM;
}

/** Foldy 추가수당 → 명세서 칸(2026-10-25 결정 4): 「일반」 → 주말수당, 「특별」 → 특별수당. 잔업수당은 손 입력만. */
export function autoAllowanceColumns(regular: number, special: number) {
  return { overtime: 0, weekend: regular, special };
}

export type PrepIssue =
  | PayrollIssue
  | "not_finalized"
  | "no_tax_table"
  | "no_insurance_rate"
  | "prev_adjustment_month_missing"
  | "override_no_reason"
  | "allowance_without_work"
  | "bank_missing";

/** 확인 필요를 보여 주는 순서 — 막힌 이유가 큰 것부터. */
export const PREP_ISSUE_ORDER: readonly PrepIssue[] = [
  "not_finalized",
  "withholding",
  "payment_method",
  "bank_missing",
  "no_tax_table",
  "hei_over",
  "hei_no_hire_date",
  "katakana",
  "prev_adjustment_month_missing",
  "override_no_reason",
  "no_insurance_rate",
  "allowance_without_work",
];

export type PrepManual = {
  overtime: number;
  weekend: number;
  special: number;
  prevAdjustment: number;
  prevAdjustmentKind: "taxable" | "commute";
  /** `YYYY-MM` */
  prevAdjustmentYm: string | null;
  yearEndAdjustment: number;
  withholdingOverride: number | null;
  withholdingOverrideReason: string | null;
  employmentInsuranceOverride: number | null;
  memo: string | null;
  /** 그 달만 지급 방식 — null = 사람별 기본 설정(39 §3-B). 2026-10-26 전 스냅샷엔 없을 수 있다. */
  paymentMethodOverride: PaymentMethod | null;
};

export const EMPTY_PREP_MANUAL: PrepManual = {
  overtime: 0,
  weekend: 0,
  special: 0,
  prevAdjustment: 0,
  prevAdjustmentKind: "taxable",
  prevAdjustmentYm: null,
  yearEndAdjustment: 0,
  withholdingOverride: null,
  withholdingOverrideReason: null,
  employmentInsuranceOverride: null,
  memo: null,
  paymentMethodOverride: null,
};

export type PrepRow = {
  userId: string;
  name: string;
  /** 일본 이름(가타카나) — 출력 양식의 氏名 · 세무사용 이름. */
  nameKatakana: string | null;
  /** 甲 부양 인원 — 출력 엑셀의 원천세 수식이 표의 몇 人 열을 볼지. */
  dependents: number;
  /** 이번 달 지급 방식 — 그 달만 바꾼 값이 있으면 그것, 없으면 사람별 기본 설정. */
  paymentMethod: PaymentMethod | null;
  /** 사람별 기본 지급 방식(그 달만 바꿨는지 보여 줄 때). 2026-10-26 전 스냅샷엔 없다. */
  paymentMethodDefault?: PaymentMethod | null;
  withholdingClass: WithholdingClass | null;
  finalized: boolean;
  paidMinutes: number;
  workDays: number;
  /** 시급 구간 ①② … — 구간마다 ROUND(시급 × 분 ÷ 60). */
  /** `since` = 그 시급으로 처음 근무한 날(첫 구간은 보통 1일 무렵이라 화면이 안 쓴다). */
  segments: { rate: number; paidMinutes: number; pay: number; since: string | null }[];
  /** Σ 구간 금액(시급 합계). */
  basePay: number;
  /** Foldy 추가수당이 채운 칸(엔 반올림 전). */
  auto: { overtime: number; weekend: number; special: number };
  manual: PrepManual;
  /** 자동 + 손 = 칸 합계. */
  overtime: number;
  weekend: number;
  special: number;
  /** 지난달 조정 중 과세분(교통비 조정은 `commute` 에 들어감). */
  prevAdjustmentTaxable: number;
  /** 수당 · 조정 열 = 잔업 + 주말 + 특별 + 지난달 조정(과세). */
  adjustments: number;
  /** 교통비(비과세, 교통비 조정 포함). */
  commute: number;
  taxable: number;
  gross: number;
  employmentInsurance: number;
  /** 원천세 — 구분 · 세금표가 없어 낼 수 없으면 null. */
  withholding: number | null;
  withholdingOverridden: boolean;
  yearEndAdjustment: number;
  /** 실수령 — 원천세를 낼 수 없으면 null. */
  net: number | null;
  roundUpYen: number;
  issues: PrepIssue[];
  /** 출력 엑셀 근태 칸(欠勤 · 残業 · 週末 · 勤務表チェック用) — 2026-10-26 이전 결재 스냅샷엔 없다(빈칸으로 낸다). */
  kintai?: PayrollKintai;
};

export type PrepRowInput = {
  userId: string;
  name: string;
  setting: MemberPayrollSetting;
  nameKatakana: string | null;
  hireDate: string | null;
  /** 도쿄 오늘 — 丙 2개월 판정. */
  today: string;
  finalized: boolean;
  paidMinutes: number;
  workDays: number;
  rateSegments: readonly { rate: number; paidMinutes: number; since?: string | null }[];
  dailyTaxable: readonly number[];
  allowanceRegular: number;
  allowanceSpecial: number;
  commuteApproved: number;
  manual: PrepManual | null;
  /** 지급일의 해 — 세금표. */
  taxYear: number;
  /** 근무 달 — 雇用保険 年度. */
  ym: string;
  insuranceRates: Record<string, number>;
  kintai?: PayrollKintai;
  /** 급여 계좌가 있는지 — 이번 달 계좌 이체인데 없으면 「계좌 없음」. undefined = 보지 않음. */
  hasBankAccount?: boolean;
};

function engineIssue(issue: PayrollMonthIssue): PrepIssue | null {
  if (issue === "no_withholding_class") return null; // 설정 쪽 「withholding」 과 같다
  return issue;
}

export function buildPrepRow(input: PrepRowInput): PrepRow {
  const manual = { ...EMPTY_PREP_MANUAL, ...input.manual };
  const paymentMethod = manual.paymentMethodOverride ?? input.setting.paymentMethod;
  const auto = autoAllowanceColumns(input.allowanceRegular, input.allowanceSpecial);
  const result = calculatePayrollMonth({
    segments: input.rateSegments.map((s) => ({ hourlyRate: s.rate, paidMinutes: s.paidMinutes })),
    autoAllowances: auto,
    commuteNonTaxable: input.commuteApproved,
    manual: {
      overtime: manual.overtime,
      weekend: manual.weekend,
      special: manual.special,
      prevMonthAdjustment: manual.prevAdjustment,
      prevMonthAdjustmentKind: manual.prevAdjustmentKind,
      prevMonthAdjustmentYm: manual.prevAdjustmentYm,
      yearEndAdjustment: manual.yearEndAdjustment,
      withholdingOverride: manual.withholdingOverride,
      employmentInsuranceOverride: manual.employmentInsuranceOverride,
    },
    withholding: {
      cls: input.setting.withholdingClass,
      dependents: input.setting.dependents,
      taxYear: input.taxYear,
      heiDailyTaxable: input.dailyTaxable,
    },
    employmentInsurance: {
      enrolled: input.setting.employmentInsurance,
      ratePerMille: input.insuranceRates[String(insuranceFiscalYear(input.ym))] ?? null,
    },
  });

  const issues = new Set<PrepIssue>();
  if (!input.finalized) issues.add("not_finalized");
  for (const i of payrollIssues({
    hourly: true,
    setting: input.setting,
    nameKatakana: input.nameKatakana,
    hireDate: input.hireDate,
    today: input.today,
  })) {
    // 지급 방식을 그 달만 골랐으면 이번 달은 비어 있지 않다.
    if (i === "payment_method" && paymentMethod) continue;
    issues.add(i);
  }
  if (paymentMethod === "transfer" && input.hasBankAccount === false) issues.add("bank_missing");
  for (const i of result.issues) {
    const mapped = engineIssue(i);
    if (mapped) issues.add(mapped);
  }
  if (manual.withholdingOverride != null && !manual.withholdingOverrideReason?.trim()) issues.add("override_no_reason");
  const allowanceTotal = result.overtime + result.weekend + result.special;
  if (input.paidMinutes === 0 && allowanceTotal !== 0) issues.add("allowance_without_work");

  const withholdingKnown =
    result.withholdingOverridden ||
    (input.setting.withholdingClass != null && !result.issues.includes("no_tax_table"));
  const basePay = result.segmentPays.reduce((sum, s) => sum + s.pay, 0);

  return {
    userId: input.userId,
    name: input.name,
    nameKatakana: input.nameKatakana,
    dependents: input.setting.dependents,
    paymentMethod,
    paymentMethodDefault: input.setting.paymentMethod,
    withholdingClass: input.setting.withholdingClass,
    finalized: input.finalized,
    paidMinutes: input.paidMinutes,
    workDays: input.workDays,
    segments: result.segmentPays.map((s, i) => ({
      rate: s.hourlyRate,
      paidMinutes: s.paidMinutes,
      pay: s.pay,
      since: input.rateSegments[i]?.since ?? null,
    })),
    basePay,
    auto,
    manual,
    overtime: result.overtime,
    weekend: result.weekend,
    special: result.special,
    prevAdjustmentTaxable: result.prevMonthAdjustment,
    adjustments: allowanceTotal + result.prevMonthAdjustment,
    commute: result.commuteNonTaxable,
    taxable: result.taxable,
    gross: result.grossTotal,
    employmentInsurance: result.employmentInsurance,
    withholding: withholdingKnown ? result.withholding : null,
    withholdingOverridden: result.withholdingOverridden,
    yearEndAdjustment: result.yearEndAdjustment,
    net: withholdingKnown ? result.netPay : null,
    roundUpYen: withholdingKnown ? result.roundUpYen : 0,
    issues: PREP_ISSUE_ORDER.filter((i) => issues.has(i)),
    ...(input.kintai ? { kintai: input.kintai } : {}),
  };
}

export type PrepTotals = {
  people: number;
  transfer: { people: number; net: number };
  cash: { people: number; net: number };
  /** 실수령 합계 — 계산된 사람만. */
  net: number;
  withholding: number;
  gross: number;
  basePay: number;
  adjustments: number;
  commute: number;
  paidMinutes: number;
  /** 실수령을 아직 못 낸 사람. */
  uncalculated: number;
  /** 확인 필요가 하나라도 있는 사람. */
  needsCheck: number;
};

export function prepTotals(rows: readonly PrepRow[]): PrepTotals {
  const t: PrepTotals = {
    people: rows.length,
    transfer: { people: 0, net: 0 },
    cash: { people: 0, net: 0 },
    net: 0,
    withholding: 0,
    gross: 0,
    basePay: 0,
    adjustments: 0,
    commute: 0,
    paidMinutes: 0,
    uncalculated: 0,
    needsCheck: 0,
  };
  for (const r of rows) {
    const bucket = r.paymentMethod === "cash" ? t.cash : r.paymentMethod === "transfer" ? t.transfer : null;
    if (bucket) bucket.people += 1;
    if (r.net == null) t.uncalculated += 1;
    else {
      t.net += r.net;
      if (bucket) bucket.net += r.net;
    }
    t.withholding += r.withholding ?? 0;
    t.gross += r.gross;
    t.basePay += r.basePay;
    t.adjustments += r.adjustments;
    t.commute += r.commute;
    t.paidMinutes += r.paidMinutes;
    if (r.issues.length > 0) t.needsCheck += 1;
  }
  return t;
}

/** 확인할 사람 먼저, 그다음 이름 순. */
export function sortPrepRows(rows: PrepRow[]): PrepRow[] {
  return rows.sort((a, b) => {
    const ai = a.issues.length > 0 ? 0 : 1;
    const bi = b.issues.length > 0 ? 0 : 1;
    return ai - bi || a.name.localeCompare(b.name);
  });
}

/** 화면에서 칸 합계를 고치면 손 입력 = 합계 − 자동(엔 반올림). */
export function manualFromTotal(total: number, auto: number): number {
  return Math.round(total) - Math.round(auto);
}
