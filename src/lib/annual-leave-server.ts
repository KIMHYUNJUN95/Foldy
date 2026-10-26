// 연차 — Phase 1 백엔드용 서버 전용 DB 읽기/쓰기(hire_date + 본인이 입력한
// 잔여 기준선만. 마이그레이션 202607060001 과 docs/product/26-annual-leave-workflow.md 참고).
// 엄격히 본인 범위: 모든 조회/쓰기는 현재 사용자 id(호출자가 인증된 세션에서 넘긴다)와
// 조직 id 로 거른다.

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

/** `profiles.hire_date` + 사용자의 `annual_leave_baselines` 행을 읽는다. Null = 아직 설정 안 됨. */
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
 * 프로필의 hire_date 를 정하고 오늘 기준 잔여 기준선을 쓴다. 관리자 경로는 덮어쓴다.
 * 직원 본인 경로(`mode: "self_once"`)는 한 번만 된다 — 아래 참고.
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

/**
 * 기준 잔여 행이 이미 있는가(입사일 유무와 상관없이). 본인 자가 설정은 **처음 한 번만** 허용한다 —
 * 있으면 `already_set` 이고 이후 수정은 관리자 화면(`saveEmployeeLeaveBaseline`)에서만 한다(2026-10-26).
 */
export async function hasAnnualLeaveBaselineRow(
  service: Service,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await service
    .from("annual_leave_baselines")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/**
 * `mode: "self_once"` — 본인 자가 설정(모바일). 기준 행이 이미 있으면 `already_set` 으로 거절하고,
 * upsert 대신 insert 로 써서 두 번 눌러도(경쟁) 두 번째는 유니크 충돌로 막힌다. 입사일은 기준 행이
 * 들어간 **뒤에** 쓴다 — 거절된 요청이 입사일만 바꾸는 일이 없도록.
 * 기본(`"admin_upsert"`)은 관리자 경로 — 예전처럼 덮어쓴다.
 */
export async function setAnnualLeaveBaselineForUser(
  service: Service,
  organizationId: string,
  userId: string,
  input: { hireDate: string; baseAmount: number; bonusAmount?: number },
  mode: "admin_upsert" | "self_once" = "admin_upsert",
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
  const row = {
    organization_id: organizationId,
    user_id: userId,
    base_amount: input.baseAmount,
    bonus_amount: input.bonusAmount ?? 0,
    baseline_date: baselineDate,
  };

  if (mode === "self_once") {
    if (await hasAnnualLeaveBaselineRow(service, organizationId, userId)) {
      return { ok: false, error: "already_set" };
    }
    const { error: insertError } = await service.from("annual_leave_baselines").insert(row);
    if (insertError) {
      // 23505 = 유니크 충돌(동시에 두 번 저장) — 이미 설정된 것으로 본다.
      return { ok: false, error: insertError.code === "23505" ? "already_set" : "baseline_upsert_failed" };
    }
    const { error: profileError } = await service
      .from("profiles")
      .update({ hire_date: input.hireDate })
      .eq("id", userId);
    if (profileError) {
      // 입사일이 안 들어가면 기준 행만 남아 다시 설정도 못 하게 되므로 되돌린다.
      await service
        .from("annual_leave_baselines")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      return { ok: false, error: "profile_update_failed" };
    }
    return { ok: true };
  }

  const { error: profileError } = await service
    .from("profiles")
    .update({ hire_date: input.hireDate })
    .eq("id", userId);
  if (profileError) return { ok: false, error: "profile_update_failed" };

  const { error: baselineError } = await service
    .from("annual_leave_baselines")
    .upsert(row, { onConflict: "organization_id,user_id" });
  if (baselineError) return { ok: false, error: "baseline_upsert_failed" };

  return { ok: true };
}

/**
 * 잔여 풀에서 차감되는 승인된 휴가 일수: 유급(paid) → base 풀, 특별(special) → bonus
 * 풀. 경조(annual, 회사 부여)와 기타(other, 무급)는 둘 다에서 차감하지 않는다. 모바일 본인 요약과
 * 관리자 잔여 화면이 항상 일치하도록 기준을 한 곳에 둔다.
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

/** 기준선을 읽고 오늘의 요약을 계산하며 승인된 사용분을 뺀다. Null = 설정 안 됨. */
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
