"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { rowToMemberSetting } from "@/lib/payroll-settings-server";
import {
  MAX_DEPENDENTS,
  PAYMENT_METHODS,
  WITHHOLDING_CLASSES,
  parseInsuranceRates,
  type MemberPayrollSetting,
  type PaymentMethod,
  type WithholdingClass,
} from "@/lib/payroll-settings-rules";

/**
 * 알바 급여 P1 — 쓰기(PC 근태 › 시급 패널 · 설정 › 급여 · 모바일 멤버 상세가 같이 부른다 → src/actions).
 * 막히면 redirect 대신 `forbidden` 을 돌려준다(CLAUDE.md — 폰 사용자를 관리자 화면으로 보내지 않기).
 * docs/product/39 §3-A · §3-C · §8
 */

export type SaveMemberPayrollSettingResult =
  | { ok: true; setting: MemberPayrollSetting }
  | { ok: false; reason: "forbidden" | "invalid" | "not_member" | "error" };

export type MemberPayrollSettingPatch = {
  paymentMethod?: PaymentMethod | null;
  withholdingClass?: WithholdingClass | null;
  dependents?: number;
  employmentInsurance?: boolean;
  employmentInsuranceSince?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 한 사람의 급여 설정 한 칸(또는 여러 칸)을 바로 저장 — 고르면 저장 + 되돌리기(같은 액션에 전 값). 권한 `wages.manage`. */
export async function saveMemberPayrollSetting(input: {
  userId: string;
  patch: MemberPayrollSettingPatch;
}): Promise<SaveMemberPayrollSettingResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "forbidden" };
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, session.user.id, "wages.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (typeof input?.userId !== "string" || !input.userId || !input.patch || typeof input.patch !== "object") {
    return { ok: false, reason: "invalid" };
  }

  const p = input.patch;
  const update: {
    payment_method?: string | null;
    withholding_class?: string | null;
    dependents?: number;
    employment_insurance?: boolean;
    employment_insurance_since?: string | null;
  } = {};
  if ("paymentMethod" in p) {
    if (p.paymentMethod !== null && !PAYMENT_METHODS.includes(p.paymentMethod as PaymentMethod)) return { ok: false, reason: "invalid" };
    update.payment_method = p.paymentMethod ?? null;
  }
  if ("withholdingClass" in p) {
    if (p.withholdingClass !== null && !WITHHOLDING_CLASSES.includes(p.withholdingClass as WithholdingClass)) {
      return { ok: false, reason: "invalid" };
    }
    update.withholding_class = p.withholdingClass ?? null;
  }
  if ("dependents" in p) {
    if (!Number.isInteger(p.dependents) || (p.dependents as number) < 0 || (p.dependents as number) > MAX_DEPENDENTS) {
      return { ok: false, reason: "invalid" };
    }
    update.dependents = p.dependents as number;
  }
  if ("employmentInsurance" in p) {
    if (typeof p.employmentInsurance !== "boolean") return { ok: false, reason: "invalid" };
    update.employment_insurance = p.employmentInsurance;
    // 가입을 끄면 가입일도 비운다 — 다시 켤 때 옛 날짜가 남아 있지 않게.
    if (!p.employmentInsurance) update.employment_insurance_since = null;
  }
  if ("employmentInsuranceSince" in p) {
    if (p.employmentInsuranceSince !== null && !(typeof p.employmentInsuranceSince === "string" && DATE_RE.test(p.employmentInsuranceSince))) {
      return { ok: false, reason: "invalid" };
    }
    update.employment_insurance_since = p.employmentInsuranceSince ?? null;
  }
  if (Object.keys(update).length === 0) return { ok: false, reason: "invalid" };

  // 같은 조직 사람만(퇴사 · 정지 포함 — 그 달 근무가 남아 있을 수 있다).
  const memberRes = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .limit(1);
  if (memberRes.error) return { ok: false, reason: "error" };
  if ((memberRes.data ?? []).length === 0) return { ok: false, reason: "not_member" };

  const beforeRes = await service
    .from("payroll_member_settings")
    .select("payment_method, withholding_class, dependents, employment_insurance, employment_insurance_since")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (beforeRes.error) return { ok: false, reason: "error" };

  const saved = await service
    .from("payroll_member_settings")
    .upsert(
      {
        organization_id: organizationId,
        user_id: input.userId,
        ...update,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id" },
    )
    .select("payment_method, withholding_class, dependents, employment_insurance, employment_insurance_since")
    .single();
  if (saved.error || !saved.data) {
    console.error("[payroll-settings] member upsert failed:", saved.error?.message);
    return { ok: false, reason: "error" };
  }

  const before = rowToMemberSetting(beforeRes.data);
  const after = rowToMemberSetting(saved.data);
  await bestEffortWrite(
    "audit_logs: payroll_member_setting_update",
    service.from("audit_logs").insert({
      organization_id: organizationId,
      actor_user_id: session.user.id,
      action: "payroll_member_setting_update",
      target_type: "payroll_member_settings",
      target_id: input.userId,
      metadata: { before, after },
    }),
  );

  revalidatePath("/admin/attendance/wages");
  revalidatePath("/mobile/users", "layout");
  return { ok: true, setting: after };
}

export type SaveOrgPayrollSettingsResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "invalid" | "same_approver" | "not_member" | "error" };

export type OrgPayrollSettingsPatch = {
  companyName?: string;
  payDay?: number;
  senmuApproverId?: string | null;
  presidentApproverId?: string | null;
  /** 한 해의 雇用保険 근로자 부담률(1,000분의 n). `null` 이면 그 해를 지운다. */
  employmentInsuranceRate?: { year: number; permille: number | null };
};

/** 회사 급여 설정 저장 — 권한 `payroll.manage`. */
export async function saveOrgPayrollSettings(patch: OrgPayrollSettingsPatch): Promise<SaveOrgPayrollSettingsResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "forbidden" };
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, session.user.id, "payroll.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!patch || typeof patch !== "object") return { ok: false, reason: "invalid" };

  const currentRes = await service
    .from("org_payroll_settings")
    .select("company_name, pay_day, senmu_approver_id, president_approver_id, employment_insurance_rates")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (currentRes.error) return { ok: false, reason: "error" };
  const current = currentRes.data;

  const update: {
    company_name?: string | null;
    pay_day?: number;
    senmu_approver_id?: string | null;
    president_approver_id?: string | null;
    employment_insurance_rates?: Record<string, number>;
  } = {};
  if ("companyName" in patch) {
    if (typeof patch.companyName !== "string") return { ok: false, reason: "invalid" };
    const name = patch.companyName.trim();
    if (name.length > 80) return { ok: false, reason: "invalid" };
    update.company_name = name || null;
  }
  if ("payDay" in patch) {
    if (!Number.isInteger(patch.payDay) || (patch.payDay as number) < 1 || (patch.payDay as number) > 28) {
      return { ok: false, reason: "invalid" };
    }
    update.pay_day = patch.payDay as number;
  }
  for (const field of ["senmuApproverId", "presidentApproverId"] as const) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value !== null && typeof value !== "string") return { ok: false, reason: "invalid" };
    if (value) {
      const m = await service
        .from("memberships")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("user_id", value)
        .eq("status", "active")
        .limit(1);
      if (m.error) return { ok: false, reason: "error" };
      if ((m.data ?? []).length === 0) return { ok: false, reason: "not_member" };
    }
    update[field === "senmuApproverId" ? "senmu_approver_id" : "president_approver_id"] = value ?? null;
  }
  const senmu = "senmu_approver_id" in update ? update.senmu_approver_id : (current?.senmu_approver_id ?? null);
  const president = "president_approver_id" in update ? update.president_approver_id : (current?.president_approver_id ?? null);
  if (senmu && president && senmu === president) return { ok: false, reason: "same_approver" };

  if (patch.employmentInsuranceRate) {
    const { year, permille } = patch.employmentInsuranceRate;
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return { ok: false, reason: "invalid" };
    if (permille !== null && !(typeof permille === "number" && Number.isFinite(permille) && permille >= 0 && permille < 100)) {
      return { ok: false, reason: "invalid" };
    }
    const rates = parseInsuranceRates(current?.employment_insurance_rates);
    if (permille === null) delete rates[String(year)];
    else rates[String(year)] = Math.round(permille * 100) / 100;
    update.employment_insurance_rates = rates;
  }
  if (Object.keys(update).length === 0) return { ok: false, reason: "invalid" };

  const saved = await service.from("org_payroll_settings").upsert(
    {
      organization_id: organizationId,
      ...update,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (saved.error) {
    console.error("[payroll-settings] org upsert failed:", saved.error.message);
    return { ok: false, reason: "error" };
  }

  await bestEffortWrite(
    "audit_logs: org_payroll_settings_update",
    service.from("audit_logs").insert({
      organization_id: organizationId,
      actor_user_id: session.user.id,
      action: "org_payroll_settings_update",
      target_type: "org_payroll_settings",
      target_id: organizationId,
      metadata: { before: current ?? null, changes: update },
    }),
  );

  revalidatePath("/admin/settings/payroll");
  return { ok: true };
}
