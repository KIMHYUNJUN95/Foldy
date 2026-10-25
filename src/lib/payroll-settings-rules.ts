import { addDaysKey, dayOfWeek, japanHolidayOf, type JapanHolidayKey } from "@/lib/japan-holidays";

/**
 * 알바 급여 P1 — 순수 규칙(서버 · 화면 공용, DB 없음). docs/product/39 §3-A · §3-C.
 *
 * - 지급일: 급여 기간 1일~말일, 다음 달 `payDay` 일. 토 · 일 · 일본 공휴일이면 **앞 평일**(2026-10-25 결정 — 선택지 없음).
 * - 확인 필요: 시급제 활성 멤버만 센다. 지급 방식 · 원천세 구분 · 가타카나 이름이 비었거나, 丙인데 입사 2개월이 지났을 때.
 */

export type PaymentMethod = "cash" | "transfer";
export type WithholdingClass = "kou" | "otsu" | "hei";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "transfer"];
export const WITHHOLDING_CLASSES: readonly WithholdingClass[] = ["kou", "otsu", "hei"];
export const MAX_DEPENDENTS = 7;

/** 화면에 그대로 찍는 원천세 구분 글자(언어와 상관없이 같은 한자). */
export const WITHHOLDING_LABEL: Record<WithholdingClass, string> = { kou: "甲", otsu: "乙", hei: "丙" };

export type MemberPayrollSetting = {
  paymentMethod: PaymentMethod | null;
  withholdingClass: WithholdingClass | null;
  dependents: number;
  employmentInsurance: boolean;
  employmentInsuranceSince: string | null;
};

export const EMPTY_MEMBER_PAYROLL_SETTING: MemberPayrollSetting = {
  paymentMethod: null,
  withholdingClass: null,
  dependents: 0,
  employmentInsurance: false,
  employmentInsuranceSince: null,
};

export type PayrollIssue = "payment_method" | "withholding" | "katakana" | "hei_over" | "hei_no_hire_date";

/** 입사일 + 2개월(같은 날짜, 없으면 그 달 말일). 丙 「2개월 이내 고용」 경계. */
export function twoMonthsAfter(hireDate: string): string {
  const [y, m, d] = hireDate.split("-").map(Number);
  const total = y * 12 + (m - 1) + 2;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * 한 사람의 「확인 필요」 목록. 시급제가 아니면 빈 목록(월급제는 세무사 담당).
 * `today` 는 도쿄 날짜 키 — 丙은 입사 2개월이 되는 날을 지나면(그날 다음부터) 걸린다.
 */
export function payrollIssues(input: {
  hourly: boolean;
  setting: MemberPayrollSetting;
  nameKatakana: string | null;
  hireDate: string | null;
  today: string;
}): PayrollIssue[] {
  if (!input.hourly) return [];
  const out: PayrollIssue[] = [];
  if (!input.setting.paymentMethod) out.push("payment_method");
  if (!input.setting.withholdingClass) out.push("withholding");
  if (!input.nameKatakana?.trim()) out.push("katakana");
  if (input.setting.withholdingClass === "hei") {
    if (!input.hireDate) out.push("hei_no_hire_date");
    else if (input.today > twoMonthsAfter(input.hireDate)) out.push("hei_over");
  }
  return out;
}

export type PaydayShiftReason = "sat" | "sun" | "holiday";

export type Payday = {
  /** 근무 달 `YYYY-MM`(「N월분」). */
  workYm: string;
  /** 실제 지급일 `YYYY-MM-DD`. */
  date: string;
  /** 규칙상 날짜(옮기기 전). */
  nominal: string;
  /** 옮겼으면 옮긴 이유(규칙상 날짜 기준). */
  shiftedBecause: PaydayShiftReason | null;
  /** 공휴일 때문이면 그 공휴일 이름 키. */
  holiday: JapanHolidayKey | null;
};

export function shiftYm(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function isOffDay(dateKey: string): boolean {
  const dow = dayOfWeek(dateKey);
  return dow === 0 || dow === 6 || japanHolidayOf(dateKey) !== null;
}

/** `workYm` 분 급여의 지급일 — 다음 달 `payDay`(1~28) 일, 쉬는 날이면 앞 평일. */
export function paydayFor(workYm: string, payDay: number): Payday {
  const payYm = shiftYm(workYm, 1);
  const day = Math.min(Math.max(Math.trunc(payDay) || 10, 1), 28);
  const nominal = `${payYm}-${String(day).padStart(2, "0")}`;
  const dow = dayOfWeek(nominal);
  const holiday = japanHolidayOf(nominal);
  const shiftedBecause: PaydayShiftReason | null = holiday ? "holiday" : dow === 0 ? "sun" : dow === 6 ? "sat" : null;
  let date = nominal;
  while (isOffDay(date)) date = addDaysKey(date, -1);
  return { workYm, date, nominal, shiftedBecause, holiday };
}

/** `fromWorkYm` 분부터 `count` 달의 지급일. */
export function upcomingPaydays(fromWorkYm: string, payDay: number, count = 12): Payday[] {
  return Array.from({ length: count }, (_, i) => paydayFor(shiftYm(fromWorkYm, i), payDay));
}

/** 雇用保険 근로자 부담률 표(연도 → 1,000분의 n). DB jsonb 를 안전하게 읽는다. */
export function parseInsuranceRates(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [year, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof value === "number" ? value : Number(value);
    if (/^\d{4}$/.test(year) && Number.isFinite(n) && n >= 0 && n < 100) out[year] = n;
  }
  return out;
}
