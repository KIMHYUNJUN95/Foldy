import "server-only";

import type { AppSession } from "@/lib/session";
import { attendanceCan } from "@/lib/attendance-review";
import { computePayrollMonth, loadPayrollMonthBase, loadPayrollMonthLinks } from "@/lib/admin-attendance";
import {
  buildPrepRow,
  EMPTY_PREP_MANUAL,
  payrollPrepAvailable,
  prepTotals,
  sortPrepRows,
  type PrepManual,
  type PrepRow,
  type PrepTotals,
} from "@/lib/payroll-prep";
import { loadMemberPayrollViews, loadOrgPayrollSettings } from "@/lib/payroll-settings-server";
import { paydayFor, type Payday } from "@/lib/payroll-settings-rules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { loadPayrollRound } from "@/lib/payroll-approval-server";
import type { PayrollRound } from "@/lib/payroll-approval";
import { tokyoToday } from "@/lib/tokyo-date";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { breakSecondsBySession } from "@/lib/attendance-pay-calculation";
import { computePayrollKintai, type KintaiAudit } from "@/lib/payroll-kintai";
import { loadMemberBanks } from "@/lib/payroll-bank-server";
import type { MemberBank } from "@/lib/payroll-bank";

/**
 * 알바 급여 P3 — 급여 준비 읽기(서버 전용, service role). PC 근태 › 급여 · 모바일 급여 준비가 같이 쓴다.
 * 보기 = `payroll.view`, 입력 = `payroll.manage`(`canManage`). docs/product/39 §5-A · §8, 40 §4-2.
 * P5: 결재 요청 이후(잠긴 달)는 숫자를 다시 셈하지 않고 요청 때 굳힌 스냅샷을 돌려준다 — 결재 · 지급 · 출력이 같은 숫자.
 * 결재자(`payroll.approve`)는 `payroll.view` 가 없어도 결재할 숫자를 본다.
 */

type Service = ReturnType<typeof getSupabaseServiceClient>;

export type PayrollPrepData = {
  ym: string;
  /** 새 계산 시작 달(10월분) 이후인지 — 아니면 화면이 지금 급여 검토 표만 보여 준다. */
  available: boolean;
  canView: boolean;
  canManage: boolean;
  /** 급여 결재(`payroll.approve`). */
  canApprove: boolean;
  payday: Payday;
  /** 설정 › 급여의 会社名(명세서 · 급여 엑셀에 찍힘). 비어 있으면 빈 글. */
  companyName: string;
  /** 근태 마감이 다 끝났는지 — 끝났으면 급여 탭이 「급여 준비」 단계로 열린다. */
  allFinalized: boolean;
  rows: PrepRow[];
  totals: PrepTotals;
  /** 급여 회차(P5) — 상태 · 결재 칸 · 지급 체크 · 기록. */
  round: PayrollRound;
  /**
   * 급여 계좌(지금 값 — 스냅샷에 넣지 않는다). `payroll.view` 가 있을 때만 채운다(결재만 하는 사람에겐 빈 객체).
   * 이체 목록 · 「계좌 바뀜」 확인에 쓴다. docs/product/39 §3-A
   */
  banks: Record<string, MemberBank>;
};

type InputRow = {
  user_id: string;
  overtime: number;
  weekend: number;
  special: number;
  prev_adjustment: number;
  prev_adjustment_kind: string;
  prev_adjustment_month: string | null;
  year_end_adjustment: number;
  withholding_override: number | null;
  withholding_override_reason: string | null;
  employment_insurance_override: number | null;
  memo: string | null;
  payment_method_override: string | null;
};

export const PAYROLL_MONTH_INPUT_SELECT =
  "user_id, overtime, weekend, special, prev_adjustment, prev_adjustment_kind, prev_adjustment_month, year_end_adjustment, withholding_override, withholding_override_reason, employment_insurance_override, memo, payment_method_override";

export function rowToPrepManual(row: Omit<InputRow, "user_id"> | null | undefined): PrepManual {
  if (!row) return { ...EMPTY_PREP_MANUAL };
  return {
    overtime: row.overtime ?? 0,
    weekend: row.weekend ?? 0,
    special: row.special ?? 0,
    prevAdjustment: row.prev_adjustment ?? 0,
    prevAdjustmentKind: row.prev_adjustment_kind === "commute" ? "commute" : "taxable",
    prevAdjustmentYm: row.prev_adjustment_month ? row.prev_adjustment_month.slice(0, 7) : null,
    yearEndAdjustment: row.year_end_adjustment ?? 0,
    withholdingOverride: row.withholding_override,
    withholdingOverrideReason: row.withholding_override_reason,
    employmentInsuranceOverride: row.employment_insurance_override,
    memo: row.memo,
    paymentMethodOverride:
      row.payment_method_override === "cash" || row.payment_method_override === "transfer" ? row.payment_method_override : null,
  };
}

const EMPTY_ROUND: PayrollRound = {
  status: "preparing",
  requestedByName: null,
  requestedAt: null,
  senmu: null,
  president: { approverId: null, approverName: null, approvedByName: null, approvedAt: null },
  paidAt: null,
  sentAt: null,
  sentByName: null,
  checks: {},
  paidPeople: 0,
  events: [],
  myTurn: null,
  viewerIsApprover: false,
  approversReady: false,
  lastReturn: null,
};

function emptyData(ym: string, payday: Payday): PayrollPrepData {
  return {
    ym,
    available: payrollPrepAvailable(ym),
    canView: false,
    canManage: false,
    canApprove: false,
    round: EMPTY_ROUND,
    payday,
    companyName: "",
    allFinalized: false,
    rows: [],
    totals: prepTotals([]),
    banks: {},
  };
}

/** 한 달 급여 준비 — 시급제 근무가 있는 사람만, 확인할 사람 먼저. */
export async function getPayrollPrep(session: AppSession, ym: string): Promise<PayrollPrepData> {
  const service = getSupabaseServiceClient();
  if (session.organization.id === "platform") return emptyData(ym, paydayFor(ym, 10));
  const organizationId = session.organization.id;
  const [canViewPayroll, canManage, canApprove, org] = await Promise.all([
    attendanceCan(service, organizationId, session.user.id, "payroll.view"),
    attendanceCan(service, organizationId, session.user.id, "payroll.manage"),
    attendanceCan(service, organizationId, session.user.id, "payroll.approve"),
    loadOrgPayrollSettings(service, organizationId),
  ]);
  const canView = canViewPayroll || canApprove;
  const payday = paydayFor(ym, org.payDay);
  const companyName = org.companyName;
  if (!canView || !payrollPrepAvailable(ym)) return { ...emptyData(ym, payday), companyName, canView, canManage, canApprove };
  const { round, snapshot } = await loadPayrollRound(service, organizationId, ym, session.user.id, org, canApprove);
  const banksFor = async (rows: readonly PrepRow[]): Promise<Record<string, MemberBank>> =>
    canViewPayroll ? Object.fromEntries(await loadMemberBanks(service, organizationId, rows.map((r) => r.userId))) : {};
  if (snapshot) {
    // 잠긴 달 — 요청 때 굳힌 값 그대로(근태 · 설정이 그 뒤 바뀌어도 결재한 숫자가 안 바뀐다).
    return {
      ym,
      available: true,
      canView,
      canManage,
      canApprove,
      payday: snapshot.payday,
      companyName: snapshot.companyName,
      allFinalized: true,
      rows: snapshot.rows,
      totals: snapshot.totals,
      round,
      banks: await banksFor(snapshot.rows),
    };
  }
  const prep = await loadPrepRows(service, organizationId, ym, payday, org.employmentInsuranceRates);
  return {
    ...prep,
    companyName,
    canView,
    canManage,
    canApprove,
    round,
    banks: await banksFor(prep.rows),
  };
}

/** 지금 값으로 다시 셈한 급여 준비(스냅샷 무시) — 결재 요청이 굳힐 값. */
export async function loadPrepRows(
  service: Service,
  organizationId: string,
  ym: string,
  payday: Payday,
  insuranceRates: Record<string, number>,
): Promise<Omit<PayrollPrepData, "canView" | "canManage" | "canApprove" | "companyName" | "round" | "banks">> {
  const firstDay = `${ym}-01`;
  const today = tokyoToday();
  const [membersRes, base, transportRes, inputsRes] = await Promise.all([
    service.from("memberships").select("user_id, status").eq("organization_id", organizationId),
    loadPayrollMonthBase(service, organizationId, ym),
    // 승인된 교통비 — 근태 급여 화면 · 내보내기와 같은 읽기(approved · target_month · total_amount_cached).
    service
      .from("transport_reimbursement_reports")
      .select("user_id, total_amount_cached")
      .eq("organization_id", organizationId)
      .eq("target_month", firstDay)
      .eq("status", "approved"),
    service
      .from("payroll_month_inputs")
      .select(PAYROLL_MONTH_INPUT_SELECT)
      .eq("organization_id", organizationId)
      .eq("target_month", firstDay),
  ]);
  if (inputsRes.error) console.warn("[payroll-prep] month inputs read failed:", inputsRes.error.message);

  const candidates = new Set<string>();
  for (const m of (membersRes.data ?? []) as { user_id: string; status: string }[]) {
    if (m.status === "active") candidates.add(m.user_id);
  }
  for (const s of base.sessions) candidates.add(s.user_id);
  for (const s of base.snapshots) candidates.add(s.user_id);
  const manualByUser = new Map<string, PrepManual>();
  for (const row of (inputsRes.data ?? []) as InputRow[]) {
    manualByUser.set(row.user_id, rowToPrepManual(row));
    candidates.add(row.user_id);
  }
  const userIds = Array.from(candidates);
  const links = await loadPayrollMonthLinks(service, organizationId, base.sessions);
  const computed = computePayrollMonth({ ...base, ...links }, ym, "ko", userIds);
  const hourlyIds = userIds.filter((id) => computed.get(id)?.pay.hourlyEligible || manualByUser.has(id));
  if (hourlyIds.length === 0) {
    return { ym, available: true, payday, allFinalized: false, rows: [], totals: prepTotals([]) };
  }

  const hourlySet = new Set(hourlyIds);
  const hourlySessions = base.sessions.filter((s) => hourlySet.has(s.user_id));
  const [profilesRes, views, kintaiSources, banks] = await Promise.all([
    service.from("profiles").select("id, name").in("id", hourlyIds),
    loadMemberPayrollViews(
      service,
      organizationId,
      hourlyIds.map((userId) => ({ userId, hourly: true })),
      today,
    ),
    loadKintaiSources(service, organizationId, ym, hourlySessions, hourlyIds),
    loadMemberBanks(service, organizationId, hourlyIds),
  ]);
  const breakSecs = breakSecondsBySession(links.breaks, base.sessions);
  const nameById = new Map<string, string>();
  for (const p of (profilesRes.data ?? []) as { id: string; name: string }[]) nameById.set(p.id, p.name);
  const transportByUser = new Map<string, number>();
  for (const r of (transportRes.data ?? []) as { user_id: string; total_amount_cached: number | null }[]) {
    transportByUser.set(r.user_id, (transportByUser.get(r.user_id) ?? 0) + (r.total_amount_cached ?? 0));
  }
  const taxYear = Number(payday.date.slice(0, 4));

  const rows = hourlyIds.map((userId) => {
    const month = computed.get(userId)!;
    const view = views.get(userId)!;
    return buildPrepRow({
      userId,
      name: nameById.get(userId) ?? "—",
      setting: view.setting,
      nameKatakana: view.nameKatakana,
      hireDate: view.hireDate,
      today,
      finalized: month.finalized,
      paidMinutes: month.pay.totalPaidMinutes,
      workDays: month.pay.workDays,
      rateSegments: month.prep.rateSegments,
      dailyTaxable: month.prep.dailyTaxable,
      allowanceRegular: month.pay.allowanceRegularTotal,
      allowanceSpecial: month.pay.allowanceSpecialTotal,
      commuteApproved: transportByUser.get(userId) ?? 0,
      manual: manualByUser.get(userId) ?? null,
      taxYear,
      ym,
      insuranceRates,
      hasBankAccount: banks.has(userId),
      kintai: computePayrollKintai({
        days: month.prep.dailyPaid,
        sessions: hourlySessions.filter((s) => s.user_id === userId),
        breakSecondsBySession: breakSecs,
        auditsBySession: kintaiSources.auditsBySession,
        assignedDates: kintaiSources.assignedByUser.get(userId) ?? [],
        today,
      }),
    });
  });
  sortPrepRows(rows);
  return {
    ym,
    available: true,
    payday,
    allFinalized: rows.every((r) => r.finalized),
    rows,
    totals: prepTotals(rows),
  };
}

const KINTAI_ID_CHUNK = 200;

function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += KINTAI_ID_CHUNK) out.push(items.slice(i, i + KINTAI_ID_CHUNK));
  return out;
}

/**
 * 출력 엑셀 근태 칸의 원천 — 세션 감사 기록(본인 원래 시각 · 정정 이유)과 그 달 청소 배정(= 확정 시프트, 欠勤日数).
 * 배정은 방마다 한 행이라 한 달에 1,000행을 쉽게 넘는다 — 둘 다 `readAllPages` 로 끝까지 읽는다.
 * 읽기 실패는 경고만 남기고 읽은 만큼 쓴다(근태 칸은 확인용이라 급여 계산을 막지 않는다).
 */
async function loadKintaiSources(
  service: Service,
  organizationId: string,
  ym: string,
  sessions: readonly { id: string }[],
  userIds: readonly string[],
): Promise<{ auditsBySession: Map<string, KintaiAudit[]>; assignedByUser: Map<string, string[]> }> {
  const firstDay = `${ym}-01`;
  const lastDay = tokyoMonthLastDay(ym);
  const [auditPages, assignPages] = await Promise.all([
    Promise.all(
      chunked(sessions.map((s) => s.id)).map((ids) =>
        readAllPages<KintaiAudit>((from, to) =>
          service
            .from("attendance_session_audits")
            .select("session_id, action_type, before_json, created_at")
            .eq("organization_id", organizationId)
            .in("session_id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
    ),
    Promise.all(
      chunked(userIds).map((ids) =>
        readAllPages<{ user_id: string; work_date: string }>((from, to) =>
          service
            .from("cleaning_assignments")
            .select("user_id, work_date")
            .eq("organization_id", organizationId)
            .gte("work_date", firstDay)
            .lte("work_date", lastDay)
            .in("user_id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
    ),
  ]);
  const auditsBySession = new Map<string, KintaiAudit[]>();
  for (const res of auditPages) {
    if (res.error) console.warn("[payroll-prep] session audits read failed:", res.error.message);
    for (const a of res.data) {
      const list = auditsBySession.get(a.session_id);
      if (list) list.push(a);
      else auditsBySession.set(a.session_id, [a]);
    }
  }
  const assignedByUser = new Map<string, string[]>();
  for (const res of assignPages) {
    if (res.error) console.warn("[payroll-prep] cleaning assignments read failed:", res.error.message);
    for (const a of res.data) {
      const list = assignedByUser.get(a.user_id);
      if (list) list.push(a.work_date);
      else assignedByUser.set(a.user_id, [a.work_date]);
    }
  }
  return { auditsBySession, assignedByUser };
}

/** YYYY-MM 의 마지막 날 키. */
function tokyoMonthLastDay(ym: string): string {
  const days = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return `${ym}-${String(days).padStart(2, "0")}`;
}
