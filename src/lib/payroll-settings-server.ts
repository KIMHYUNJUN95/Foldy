import "server-only";

import type { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";
import type { MemberBank } from "@/lib/payroll-bank";
import { loadMemberBanks } from "@/lib/payroll-bank-server";
import {
  EMPTY_MEMBER_PAYROLL_SETTING,
  parseInsuranceRates,
  payrollIssues,
  type MemberPayrollSetting,
  type PaymentMethod,
  type PayrollIssue,
  type WithholdingClass,
} from "@/lib/payroll-settings-rules";

/**
 * 알바 급여 P1 — 읽기(서버 전용, service role). 권한 확인은 부르는 쪽(wages.manage · payroll.manage)이 한다.
 * docs/product/39 §3-A · §3-C · docs/engineering/04-data-model.md → payroll_member_settings · org_payroll_settings
 */

type Service = ReturnType<typeof getSupabaseServiceClient>;

export type MemberPayrollView = {
  setting: MemberPayrollSetting;
  /** profiles.name_katakana — 본인이 가입 · 내 정보에서 넣는다. */
  nameKatakana: string | null;
  /** profiles.hire_date — 관리자는 근태 › 연차 › 잔여에서 고친다. */
  hireDate: string | null;
  issues: PayrollIssue[];
  /** 급여 설정을 바꾼 횟수(audit_logs). */
  changeCount: number;
};

type SettingRow = {
  user_id: string;
  payment_method: string | null;
  withholding_class: string | null;
  dependents: number;
  employment_insurance: boolean;
  employment_insurance_since: string | null;
};

export function rowToMemberSetting(row: Omit<SettingRow, "user_id"> | null | undefined): MemberPayrollSetting {
  if (!row) return { ...EMPTY_MEMBER_PAYROLL_SETTING };
  return {
    paymentMethod: row.payment_method === "cash" || row.payment_method === "transfer" ? (row.payment_method as PaymentMethod) : null,
    withholdingClass:
      row.withholding_class === "kou" || row.withholding_class === "otsu" || row.withholding_class === "hei"
        ? (row.withholding_class as WithholdingClass)
        : null,
    dependents: row.dependents ?? 0,
    employmentInsurance: Boolean(row.employment_insurance),
    employmentInsuranceSince: row.employment_insurance_since ?? null,
  };
}

/** 사람들의 급여 설정 + 프로필 값 + 확인 필요. `hourly` 가 아닌 사람은 확인 필요를 세지 않는다. */
export async function loadMemberPayrollViews(
  service: Service,
  organizationId: string,
  members: { userId: string; hourly: boolean }[],
  today: string,
): Promise<Map<string, MemberPayrollView>> {
  const out = new Map<string, MemberPayrollView>();
  if (members.length === 0) return out;
  const userIds = members.map((m) => m.userId);
  const [settingsRes, profilesRes, logsRes] = await Promise.all([
    service
      .from("payroll_member_settings")
      .select("user_id, payment_method, withholding_class, dependents, employment_insurance, employment_insurance_since")
      .eq("organization_id", organizationId)
      .in("user_id", userIds),
    service.from("profiles").select("id, name_katakana, hire_date").in("id", userIds),
    service
      .from("audit_logs")
      .select("target_id")
      .eq("organization_id", organizationId)
      .eq("action", "payroll_member_setting_update")
      .in("target_id", userIds),
  ]);
  if (settingsRes.error) console.warn("[payroll-settings] member settings read failed:", settingsRes.error.message);
  const settingByUser = new Map<string, SettingRow>();
  for (const row of (settingsRes.data ?? []) as SettingRow[]) settingByUser.set(row.user_id, row);
  const profileById = new Map<string, { name_katakana: string | null; hire_date: string | null }>();
  for (const p of (profilesRes.data ?? []) as { id: string; name_katakana: string | null; hire_date: string | null }[]) {
    profileById.set(p.id, p);
  }
  const changes = new Map<string, number>();
  for (const l of (logsRes.data ?? []) as { target_id: string | null }[]) {
    if (l.target_id) changes.set(l.target_id, (changes.get(l.target_id) ?? 0) + 1);
  }
  for (const m of members) {
    const setting = rowToMemberSetting(settingByUser.get(m.userId));
    const profile = profileById.get(m.userId);
    const nameKatakana = profile?.name_katakana?.trim() || null;
    const hireDate = profile?.hire_date ?? null;
    out.set(m.userId, {
      setting,
      nameKatakana,
      hireDate,
      issues: payrollIssues({ hourly: m.hourly, setting, nameKatakana, hireDate, today }),
      changeCount: changes.get(m.userId) ?? 0,
    });
  }
  return out;
}

/** 지금 고용 형태 — 근태 시급 화면과 같은 판정(활성 고용 형태 행 → 없으면 시급 이력이 있으면 시급제). */
export async function loadEmploymentNow(
  service: Service,
  organizationId: string,
  userId: string,
  today: string,
): Promise<{ employment: "hourly" | "salaried" | "unknown"; currentRate: number | null; currentFrom: string | null }> {
  const [ratesRes, empRes] = await Promise.all([
    service
      .from("hourly_rate_history")
      .select("hourly_rate, effective_from, effective_to")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("effective_from", { ascending: false }),
    service
      .from("employment_type_history")
      .select("employment_type, effective_from, effective_to")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("effective_from", { ascending: false }),
  ]);
  const rates = (ratesRes.data ?? []) as { hourly_rate: number; effective_from: string; effective_to: string | null }[];
  const emps = (empRes.data ?? []) as { employment_type: string; effective_from: string; effective_to: string | null }[];
  const activeNow = (r: { effective_from: string; effective_to: string | null }) =>
    r.effective_from <= today && (r.effective_to == null || r.effective_to >= today);
  const emp = emps.find(activeNow);
  const rate = rates.find(activeNow) ?? null;
  const employment = emp ? (emp.employment_type === "salaried" ? "salaried" : "hourly") : rates.length > 0 ? "hourly" : "unknown";
  return { employment, currentRate: rate?.hourly_rate ?? null, currentFrom: rate?.effective_from ?? null };
}

export type MemberPayrollPanel = {
  userId: string;
  employment: "hourly" | "salaried" | "unknown";
  currentRate: number | null;
  currentFrom: string | null;
  view: MemberPayrollView;
  /** 급여 계좌 — `payroll.view` 가 없으면 canView=false · summary=null(계좌는 읽지도 않는다). */
  bank: { canView: boolean; summary: MemberBank | null };
};

/**
 * 모바일 멤버 상세의 「급여 설정」 구역 — 보는 사람에게 `wages.manage` 가 없으면 null(구역을 그리지 않음).
 * 다른 조직 사람도 null.
 */
export async function loadMemberPayrollPanel(
  service: Service,
  organizationId: string,
  viewerId: string,
  userId: string,
  today: string,
): Promise<MemberPayrollPanel | null> {
  if (!(await attendanceCan(service, organizationId, viewerId, "wages.manage"))) return null;
  const member = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .limit(1);
  if ((member.data ?? []).length === 0) return null;
  const emp = await loadEmploymentNow(service, organizationId, userId, today);
  const views = await loadMemberPayrollViews(service, organizationId, [{ userId, hourly: emp.employment === "hourly" }], today);
  const view = views.get(userId);
  if (!view) return null;
  const canViewBank = await attendanceCan(service, organizationId, viewerId, "payroll.view");
  const summary = canViewBank ? ((await loadMemberBanks(service, organizationId, [userId])).get(userId) ?? null) : null;
  return { userId, ...emp, view, bank: { canView: canViewBank, summary } };
}

export type OrgPayrollSettings = {
  companyName: string;
  payDay: number;
  senmuApproverId: string | null;
  presidentApproverId: string | null;
  /** 연도 → 1,000분의 n. */
  employmentInsuranceRates: Record<string, number>;
};

export const DEFAULT_ORG_PAYROLL_SETTINGS: OrgPayrollSettings = {
  companyName: "",
  payDay: 10,
  senmuApproverId: null,
  presidentApproverId: null,
  employmentInsuranceRates: {},
};

export async function loadOrgPayrollSettings(service: Service, organizationId: string): Promise<OrgPayrollSettings> {
  const { data, error } = await service
    .from("org_payroll_settings")
    .select("company_name, pay_day, senmu_approver_id, president_approver_id, employment_insurance_rates")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) console.warn("[payroll-settings] org settings read failed:", error.message);
  if (!data) return { ...DEFAULT_ORG_PAYROLL_SETTINGS };
  return {
    companyName: data.company_name ?? "",
    payDay: data.pay_day ?? 10,
    senmuApproverId: data.senmu_approver_id ?? null,
    presidentApproverId: data.president_approver_id ?? null,
    employmentInsuranceRates: parseInsuranceRates(data.employment_insurance_rates),
  };
}
