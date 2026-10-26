"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { payrollPrepAvailable, type PrepManual } from "@/lib/payroll-prep";
import { shiftYm } from "@/lib/payroll-settings-rules";
import { PAYROLL_MONTH_INPUT_SELECT, rowToPrepManual } from "@/lib/payroll-prep-server";
import { isPayrollMonthLocked } from "@/lib/payroll-approval-server";

/**
 * 알바 급여 P3 — 급여 준비 손 입력 저장(PC 근태 › 급여 패널 · 모바일 급여 준비 시트가 같이 부른다 → src/actions).
 * 칸마다 바로 저장 + 되돌리기(전 값을 같은 액션으로 다시 보냄). 권한 `payroll.manage`.
 * 막히면 redirect 대신 `forbidden`. docs/product/39 §3-B · §8, 40 §4-2
 */

export type PrepManualPatch = Partial<PrepManual>;

export type SavePayrollMonthInputResult =
  | { ok: true; manual: PrepManual; before: PrepManual }
  | { ok: false; reason: "forbidden" | "invalid" | "not_member" | "closed" | "locked" | "error" };

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_YEN = 10_000_000;
const MAX_TEXT = 200;

function isYen(v: unknown, allowNegative: boolean): v is number {
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= MAX_YEN && (allowNegative || v >= 0);
}

function cleanText(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > MAX_TEXT) return undefined;
  return t === "" ? null : t;
}

type Update = {
  overtime?: number;
  weekend?: number;
  special?: number;
  prev_adjustment?: number;
  prev_adjustment_kind?: string;
  prev_adjustment_month?: string | null;
  year_end_adjustment?: number;
  withholding_override?: number | null;
  withholding_override_reason?: string | null;
  employment_insurance_override?: number | null;
  memo?: string | null;
  payment_method_override?: string | null;
};

function toUpdate(p: PrepManualPatch): Update | null {
  const u: Update = {};
  for (const key of ["overtime", "weekend", "special"] as const) {
    if (key in p) {
      if (!isYen(p[key], true)) return null;
      u[key] = p[key];
    }
  }
  if ("prevAdjustment" in p) {
    if (!isYen(p.prevAdjustment, true)) return null;
    u.prev_adjustment = p.prevAdjustment;
  }
  if ("prevAdjustmentKind" in p) {
    if (p.prevAdjustmentKind !== "taxable" && p.prevAdjustmentKind !== "commute") return null;
    u.prev_adjustment_kind = p.prevAdjustmentKind;
  }
  if ("prevAdjustmentYm" in p) {
    if (p.prevAdjustmentYm !== null && !(typeof p.prevAdjustmentYm === "string" && YM_RE.test(p.prevAdjustmentYm))) return null;
    u.prev_adjustment_month = p.prevAdjustmentYm ? `${p.prevAdjustmentYm}-01` : null;
  }
  if ("yearEndAdjustment" in p) {
    if (!isYen(p.yearEndAdjustment, true)) return null;
    u.year_end_adjustment = p.yearEndAdjustment;
  }
  if ("withholdingOverride" in p) {
    if (p.withholdingOverride !== null && !isYen(p.withholdingOverride, false)) return null;
    u.withholding_override = p.withholdingOverride ?? null;
  }
  if ("employmentInsuranceOverride" in p) {
    if (p.employmentInsuranceOverride !== null && !isYen(p.employmentInsuranceOverride, false)) return null;
    u.employment_insurance_override = p.employmentInsuranceOverride ?? null;
  }
  if ("withholdingOverrideReason" in p) {
    const t = cleanText(p.withholdingOverrideReason);
    if (t === undefined) return null;
    u.withholding_override_reason = t;
  }
  if ("memo" in p) {
    const t = cleanText(p.memo);
    if (t === undefined) return null;
    u.memo = t;
  }
  if ("paymentMethodOverride" in p) {
    const m = p.paymentMethodOverride;
    if (m !== null && m !== "cash" && m !== "transfer") return null;
    u.payment_method_override = m ?? null;
  }
  return Object.keys(u).length > 0 ? u : null;
}

/** 한 사람 · 한 달의 손 입력 칸(하나 또는 여러 개)을 바로 저장. */
export async function savePayrollMonthInput(input: {
  userId: string;
  ym: string;
  patch: PrepManualPatch;
}): Promise<SavePayrollMonthInputResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "forbidden" };
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, session.user.id, "payroll.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (
    typeof input?.userId !== "string" ||
    !input.userId ||
    typeof input.ym !== "string" ||
    !YM_RE.test(input.ym) ||
    !input.patch ||
    typeof input.patch !== "object"
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (!payrollPrepAvailable(input.ym)) return { ok: false, reason: "closed" };
  const update = toUpdate(input.patch);
  if (!update) return { ok: false, reason: "invalid" };
  // P5 — 결재 요청 이후엔 잠금(고치려면 돌려보내기 · 결재 되돌리기로 급여 준비에 돌아온 뒤).
  if (await isPayrollMonthLocked(service, organizationId, input.ym)) return { ok: false, reason: "locked" };

  const memberRes = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .limit(1);
  if (memberRes.error) return { ok: false, reason: "error" };
  if ((memberRes.data ?? []).length === 0) return { ok: false, reason: "not_member" };

  const targetMonth = `${input.ym}-01`;
  const beforeRes = await service
    .from("payroll_month_inputs")
    .select(PAYROLL_MONTH_INPUT_SELECT)
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("target_month", targetMonth)
    .maybeSingle();
  if (beforeRes.error) return { ok: false, reason: "error" };

  // 지난달 조정 금액을 처음 넣을 때 몇 월분이 비어 있으면 근무 달의 앞달로 채운다(대부분 지난달 정정 — 다르면 고르면 됨).
  if (
    update.prev_adjustment !== undefined &&
    update.prev_adjustment !== 0 &&
    !("prev_adjustment_month" in update) &&
    !beforeRes.data?.prev_adjustment_month
  ) {
    update.prev_adjustment_month = `${shiftYm(input.ym, -1)}-01`;
  }

  const saved = await service
    .from("payroll_month_inputs")
    .upsert(
      {
        organization_id: organizationId,
        user_id: input.userId,
        target_month: targetMonth,
        ...update,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id,target_month" },
    )
    .select(PAYROLL_MONTH_INPUT_SELECT)
    .single();
  if (saved.error || !saved.data) {
    console.error("[payroll-prep] month input upsert failed:", saved.error?.message);
    return { ok: false, reason: "error" };
  }

  const before = rowToPrepManual(beforeRes.data);
  const after = rowToPrepManual(saved.data);
  await bestEffortWrite(
    "audit_logs: payroll_month_input_update",
    service.from("audit_logs").insert({
      organization_id: organizationId,
      actor_user_id: session.user.id,
      action: "payroll_month_input_update",
      target_type: "payroll_month_inputs",
      target_id: input.userId,
      metadata: { ym: input.ym, before, after },
    }),
  );

  revalidatePath("/admin/attendance/payroll");
  revalidatePath("/mobile/payroll");
  return { ok: true, manual: after, before };
}
