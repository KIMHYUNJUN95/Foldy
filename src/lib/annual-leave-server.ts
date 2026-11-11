// 연차 — Phase 1 백엔드용 서버 전용 DB 읽기/쓰기(hire_date + 본인이 입력한
// 잔여 기준선만. 마이그레이션 202607060001 과 docs/product/26-annual-leave-workflow.md 참고).
// 엄격히 본인 범위: 모든 조회/쓰기는 현재 사용자 id(호출자가 인증된 세션에서 넘긴다)와
// 조직 id 로 거른다.

import "server-only";
import { isHourlyRole } from "@/config/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  computeAnnualLeaveSummary,
  leaveUsagesFromRows,
  tokyoToday,
  type AnnualLeaveSummary,
  type LeaveUsage,
} from "@/lib/annual-leave";

type Service = ReturnType<typeof getSupabaseServiceClient>;

export type AnnualLeaveBaselineRow = {
  hireDate: string;
  baseAmount: number;
  bonusAmount: number;
  baselineDate: string;
  /**
   * 결재자가 아직 확인하지 않은 기준 잔여(2026-11-11, M11). 본인이 처음 입력한 입사일 · 잔여는 결재자가
   * 확인할 때까지 「확인 전」이다. 화면 표시는 2차에서 붙인다 — 지금은 데이터만 내보낸다.
   */
  provisional: boolean;
};

/** PostgREST 읽기 실패를 숨기지 않는다(2026-11-11, H5) — 0 · null 로 바꾸면 잔여가 부풀거나 「설정 안 됨」이 된다. */
export class LeaveReadError extends Error {
  constructor(what: string, cause?: unknown) {
    super(`annual leave read failed: ${what}`);
    this.name = "LeaveReadError";
    this.cause = cause;
  }
}

const PAGE_SIZE = 1000;

/**
 * 새 칸이 아직 없는 DB(마이그레이션 202611110002 전)에서 난 오류인가. 코드가 먼저 배포돼도 동작해야 해서
 * (2026-11-11 배포 순서), 새 칸을 쓰는 쓰기는 이 오류면 그 칸을 빼고 다시 쓴다.
 * 42703 = Postgres 없는 칸, PGRST204 = PostgREST 스키마 캐시에 없는 칸.
 */
export function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42703" || code === "PGRST204";
}

/** 새 DB 함수가 아직 없는가(42883 = 없는 함수, PGRST202 = 스키마 캐시에 없는 함수). */
export function isMissingFunctionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42883" || code === "PGRST202";
}

/**
 * 1,000행 상한을 넘겨 끝까지 읽는다(2026-11-11, M14). `page(from, to)` 는 **정렬이 고정된** 쿼리에
 * `.range(from, to)` 를 붙여 돌려줘야 한다. 실패하면 던진다.
 */
export async function selectAllPages<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new LeaveReadError(what, error);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

/** `profiles.hire_date` + 사용자의 `annual_leave_baselines` 행을 읽는다. Null = 아직 설정 안 됨. 읽기 실패는 던진다. */
export async function getAnnualLeaveBaseline(
  service: Service,
  organizationId: string,
  userId: string,
): Promise<AnnualLeaveBaselineRow | null> {
  const [profileRes, baselineRes] = await Promise.all([
    service.from("profiles").select("hire_date").eq("id", userId).maybeSingle(),
    service
      .from("annual_leave_baselines")
      // `*` — 확인 칸(confirmed_at)이 아직 없는 DB 에서도 읽힌다(그때는 전부 확인 전).
      .select("*")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profileRes.error) throw new LeaveReadError("profiles.hire_date", profileRes.error);
  if (baselineRes.error) throw new LeaveReadError("annual_leave_baselines", baselineRes.error);
  const profile = profileRes.data as { hire_date: string | null } | null;
  const baseline = baselineRes.data as {
    base_amount: number;
    bonus_amount: number;
    baseline_date: string;
    confirmed_at?: string | null;
  } | null;

  if (!profile?.hire_date || !baseline) return null;

  return {
    hireDate: profile.hire_date,
    baseAmount: Number(baseline.base_amount),
    bonusAmount: Number(baseline.bonus_amount),
    baselineDate: baseline.baseline_date,
    provisional: !baseline.confirmed_at,
  };
}

/**
 * 여러 사람의 기준 잔여를 한 번에(결재 큐 요약, 2026-11-11 성능) — `getAnnualLeaveBaseline` 과 같은 규칙. 없는 사람은 Map 에 없다.
 */
export async function getAnnualLeaveBaselinesForUsers(
  service: Service,
  organizationId: string,
  userIds: readonly string[],
): Promise<Map<string, AnnualLeaveBaselineRow>> {
  const out = new Map<string, AnnualLeaveBaselineRow>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return out;
  const [profileRes, baselineRes] = await Promise.all([
    service.from("profiles").select("id, hire_date").in("id", ids),
    service.from("annual_leave_baselines").select("*").eq("organization_id", organizationId).in("user_id", ids),
  ]);
  if (profileRes.error) throw new LeaveReadError("profiles.hire_date", profileRes.error);
  if (baselineRes.error) throw new LeaveReadError("annual_leave_baselines", baselineRes.error);
  const hire = new Map(
    ((profileRes.data ?? []) as { id: string; hire_date: string | null }[]).map((p) => [p.id, p.hire_date]),
  );
  for (const b of (baselineRes.data ?? []) as {
    user_id: string;
    base_amount: number;
    bonus_amount: number;
    baseline_date: string;
    confirmed_at?: string | null;
  }[]) {
    const hireDate = hire.get(b.user_id);
    if (!hireDate) continue;
    out.set(b.user_id, {
      hireDate,
      baseAmount: Number(b.base_amount),
      bonusAmount: Number(b.bonus_amount),
      baselineDate: b.baseline_date,
      provisional: !b.confirmed_at,
    });
  }
  return out;
}

/** 여러 사람의 승인된 신청 행(잔여 계산용 칸만)을 한 번에 — 끝까지 쪽 나눠 읽는다. */
export async function listApprovedLeaveRowsForUsers(
  service: Service,
  organizationId: string,
  userIds: readonly string[],
): Promise<{ id: string; user_id: string; leave_type: string; days_count: number; start_date: string }[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  return selectAllPages("annual_leave_requests.approved_users", (from, to) =>
    service
      .from("annual_leave_requests")
      .select("id, user_id, leave_type, days_count, start_date")
      .eq("organization_id", organizationId)
      .in("user_id", ids)
      .eq("status", "approved")
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/** 실제로 있는 날짜인가(2026-02-30 같은 값 거름). */
function isRealIsoDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
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
  const { data, error } = await service
    .from("annual_leave_baselines")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new LeaveReadError("annual_leave_baselines.exists", error);
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
  /** 저장한 결재자(관리자 경로). 대상 본인이면 확인됨으로 치지 않는다 — 자기 잔여를 자기가 확정하지 않는다(M6 · M11). */
  actorUserId: string | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isRealIsoDate(input.hireDate)) return { ok: false, error: "invalid_dates" };
  // 미래 입사일은 받지 않는다(2026-11-11, M11) — 아직 오지 않은 부여가 미리 계산된다.
  if (input.hireDate > tokyoToday()) return { ok: false, error: "future_hire_date" };
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
  // 확인됨 = 대상이 아닌 결재자가 저장했을 때만. 본인 자가 설정 · 결재자 자기 저장은 「확인 전」(M11).
  const confirmedBy = mode === "admin_upsert" && actorUserId && actorUserId !== userId ? actorUserId : null;
  const row = {
    organization_id: organizationId,
    user_id: userId,
    base_amount: input.baseAmount,
    bonus_amount: input.bonusAmount ?? 0,
    baseline_date: baselineDate,
    confirmed_at: confirmedBy ? new Date().toISOString() : null,
    confirmed_by_user_id: confirmedBy,
  };

  // 확인 칸이 아직 없는 DB 면 그 칸을 빼고 쓴다(코드 먼저 배포).
  const legacyRow = {
    organization_id: row.organization_id,
    user_id: row.user_id,
    base_amount: row.base_amount,
    bonus_amount: row.bonus_amount,
    baseline_date: row.baseline_date,
  };

  if (mode === "self_once") {
    // 읽기 실패는 결과로 돌려준다 — 서버 액션 밖으로 던지면 화면이 결과 대신 오류 화면을 본다(2026-11-11).
    let exists: boolean;
    try {
      exists = await hasAnnualLeaveBaselineRow(service, organizationId, userId);
    } catch (error) {
      if (!(error instanceof LeaveReadError)) throw error;
      console.error("[setAnnualLeaveBaselineForUser]", error.message);
      return { ok: false, error: "read_failed" };
    }
    if (exists) return { ok: false, error: "already_set" };
    let { error: insertError } = await service.from("annual_leave_baselines").insert(row);
    if (insertError && isMissingColumnError(insertError)) {
      ({ error: insertError } = await service.from("annual_leave_baselines").insert(legacyRow));
    }
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

  let { error: baselineError } = await service
    .from("annual_leave_baselines")
    .upsert(row, { onConflict: "organization_id,user_id" });
  if (baselineError && isMissingColumnError(baselineError)) {
    ({ error: baselineError } = await service
      .from("annual_leave_baselines")
      .upsert(legacyRow, { onConflict: "organization_id,user_id" }));
  }
  if (baselineError) return { ok: false, error: "baseline_upsert_failed" };

  return { ok: true };
}

/**
 * 잔여 풀에서 차감되는 승인된 휴가: 유급(paid) → base 풀, 특별(special) → bonus
 * 풀. 경조(annual, 회사 부여)와 기타(other, 무급)는 둘 다에서 차감하지 않는다. 모바일 본인 요약과
 * 관리자 잔여 화면 · 승인 판정이 항상 일치하도록 기준을 한 곳에 둔다.
 *
 * `usages` 는 사용일(시작일)이 붙은 목록 — 잔여 계산은 이것을 쓴다(H3). 1,000행 넘게 끝까지 읽고(M14),
 * 읽기가 실패하면 던진다(H5 — 예전에는 0 으로 바뀌어 잔여가 부풀었다). `excludeRequestId` 는 승인 판정 ·
 * 상세 화면에서 그 신청 자신을 빼고 계산할 때 쓴다.
 */
export async function sumApprovedLeaveUsage(
  service: Service,
  organizationId: string,
  userId: string,
  opts: { excludeRequestId?: string } = {},
): Promise<{ base: number; bonus: number; usages: LeaveUsage[] }> {
  const rows = await selectAllPages<{ id: string; leave_type: string; days_count: number; start_date: string }>(
    "annual_leave_requests.approved",
    (from, to) =>
      service
        .from("annual_leave_requests")
        .select("id, leave_type, days_count, start_date")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .eq("status", "approved")
        .order("id", { ascending: true })
        .range(from, to),
  );
  const usages = leaveUsagesFromRows(rows.filter((r) => r.id !== opts.excludeRequestId));
  let base = 0;
  let bonus = 0;
  for (const u of usages) {
    if (u.pool === "base") base += u.days;
    else bonus += u.days;
  }
  return { base, bonus, usages };
}

export type MyAnnualLeaveSummary = AnnualLeaveSummary & { provisional: boolean };

/**
 * 기준선을 읽고 오늘의 요약을 계산하며 승인된 사용분을 뺀다. Null = 설정 안 됨.
 * `extraUsages` = 아직 승인 전인 신청을 넣어 보는 계산(승인 판정 · 상세의 「승인 후」).
 */
export async function getMyAnnualLeaveSummary(
  service: Service,
  organizationId: string,
  userId: string,
  opts: { excludeRequestId?: string; extraUsages?: LeaveUsage[] } = {},
): Promise<MyAnnualLeaveSummary | null> {
  const baseline = await getAnnualLeaveBaseline(service, organizationId, userId);
  if (!baseline) return null;

  const usage = await sumApprovedLeaveUsage(service, organizationId, userId, {
    excludeRequestId: opts.excludeRequestId,
  });
  const summary = computeAnnualLeaveSummary({
    hireDate: baseline.hireDate,
    baselineDate: baseline.baselineDate,
    baselineAmount: baseline.baseAmount,
    bonusBaselineAmount: baseline.bonusAmount,
    usages: [...usage.usages, ...(opts.extraUsages ?? [])],
    asOf: tokyoToday(),
  });
  return { ...summary, provisional: baseline.provisional };
}
