// Annual leave — server-only DB read/write for the Phase 1 backend (hire_date + self-entered
// balance baseline only; see migration 202607060001 and docs/product/26-annual-leave-workflow.md).
// Strictly self-scoped: every query/write filters by the CURRENT user's id (passed by the caller
// from the authenticated session) AND the organization id.

import "server-only";
import { isHourlyRole } from "@/config/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { computeAnnualLeaveSummary, tokyoToday, type AnnualLeaveSummary } from "@/lib/annual-leave";

type Service = ReturnType<typeof getSupabaseServiceClient>;

export type AnnualLeaveBaselineRow = {
  hireDate: string;
  baseAmount: number;
  bonusAmount: number;
  baselineDate: string;
};

/** Reads `profiles.hire_date` + the user's `annual_leave_baselines` row. Null = not set up yet. */
export async function getAnnualLeaveBaseline(
  service: Service,
  organizationId: string,
  userId: string,
): Promise<AnnualLeaveBaselineRow | null> {
  const [{ data: profileResult }, { data: baselineResult }] = await Promise.all([
    service.from("profiles").select("hire_date").eq("id", userId).maybeSingle(),
    service
      .from("annual_leave_baselines")
      .select("base_amount, bonus_amount, baseline_date")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const profile = profileResult as { hire_date: string | null } | null;
  const baseline = baselineResult as { base_amount: number; bonus_amount: number; baseline_date: string } | null;

  if (!profile?.hire_date || !baseline) return null;

  return {
    hireDate: profile.hire_date,
    baseAmount: Number(baseline.base_amount),
    bonusAmount: Number(baseline.bonus_amount),
    baselineDate: baseline.baseline_date,
  };
}

/**
 * Self-service upsert: sets hire_date on the profile and writes the balance baseline as of today.
 * Overwrites any prior baseline (the employee is expected to do this once at setup).
 *
 * **검증이 여기 있는 이유 (2026-08-03).** 이 함수는 service-role 클라이언트로 쓰므로 RLS 가
 * 아무것도 막지 않는다. 상한·자격 검사가 관리자 경로(`saveEmployeeLeaveBaseline`)에만 있어서,
 * 모바일 자가 설정 액션은 **부여일수·입사일을 무제한으로 자기부여**할 수 있었다. 급여와 직결되는
 * 값이라 호출자마다 따로 막으면 언젠가 또 갈라진다 — **유일한 쓰기 지점인 여기서** 막는다.
 * 상한 값(40 / 8)과 시급직 제외 규칙은 관리자 경로에 있던 것을 그대로 옮겨 왔다.
 */
export const MAX_LEAVE_GRANT = 40;
export const MAX_LEAVE_BONUS = 8;
/**
 * 시급제 역할은 연차 대상이 아니다(확정 정책). 2026-10-21 역할 정리로 시급제는 아르바이트(`part_time_staff`)와
 * 아르바이트 리더(`staff`) 둘이다. 그 외 조직 역할은 전부 월급제 정규직으로 본다.
 */
export function isLeaveHourlyRole(role: string): boolean {
  return isHourlyRole(role);
}

export async function setAnnualLeaveBaselineForUser(
  service: Service,
  organizationId: string,
  userId: string,
  input: { hireDate: string; baseAmount: number; bonusAmount?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.hireDate)) return { ok: false, error: "invalid_dates" };
  if (!Number.isFinite(input.baseAmount) || input.baseAmount < 0 || input.baseAmount > MAX_LEAVE_GRANT) {
    return { ok: false, error: "invalid_grant" };
  }
  const bonus = input.bonusAmount ?? 0;
  if (!Number.isFinite(bonus) || bonus < 0 || bonus > MAX_LEAVE_BONUS) {
    return { ok: false, error: "invalid_bonus" };
  }

  // 활성 멤버십 + 시급직 제외. 조직 스코프로 조회하므로 남의 조직 사용자에게는 쓸 수 없다.
  const { data: memData } = await service
    .from("memberships")
    .select("status, role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  const membership = memData as { status: string; role: string } | null;
  if (!membership || membership.status !== "active") return { ok: false, error: "target_not_found" };
  if (isLeaveHourlyRole(membership.role)) return { ok: false, error: "hourly_excluded" };

  const baselineDate = tokyoToday();

  const { error: profileError } = await service
    .from("profiles")
    .update({ hire_date: input.hireDate })
    .eq("id", userId);
  if (profileError) return { ok: false, error: "profile_update_failed" };

  const { error: baselineError } = await service.from("annual_leave_baselines").upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      base_amount: input.baseAmount,
      bonus_amount: input.bonusAmount ?? 0,
      baseline_date: baselineDate,
    },
    { onConflict: "organization_id,user_id" },
  );
  if (baselineError) return { ok: false, error: "baseline_upsert_failed" };

  return { ok: true };
}

/**
 * Approved leave days that draw down the balance pools: 유급(paid) → base pool, 특별(special) → bonus
 * pool. 경조(annual, company-granted) and 기타(other, unpaid) draw from neither. Single source of truth
 * so the mobile self-summary and the admin balance views always agree.
 */
export async function sumApprovedLeaveUsage(
  service: Service,
  organizationId: string,
  userId: string,
): Promise<{ base: number; bonus: number }> {
  const { data } = await service
    .from("annual_leave_requests")
    .select("leave_type, days_count")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "approved");
  let base = 0;
  let bonus = 0;
  for (const r of (data ?? []) as { leave_type: string; days_count: number }[]) {
    if (r.leave_type === "paid") base += Number(r.days_count);
    else if (r.leave_type === "special") bonus += Number(r.days_count);
  }
  return { base, bonus };
}

/** Reads the baseline and computes today's summary, with approved usage deducted. Null = not set up. */
export async function getMyAnnualLeaveSummary(
  service: Service,
  organizationId: string,
  userId: string,
): Promise<AnnualLeaveSummary | null> {
  const baseline = await getAnnualLeaveBaseline(service, organizationId, userId);
  if (!baseline) return null;

  const usage = await sumApprovedLeaveUsage(service, organizationId, userId);
  return computeAnnualLeaveSummary({
    hireDate: baseline.hireDate,
    baselineDate: baseline.baselineDate,
    baselineAmount: baseline.baseAmount,
    bonusBaselineAmount: baseline.bonusAmount,
    usedDays: usage.base,
    specialUsedDays: usage.bonus,
    asOf: tokyoToday(),
  });
}
