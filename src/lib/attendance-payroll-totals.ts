// 근태 — 권한자 조직 전체 급여 합계 데이터 레이어 (Step 12).
//
// 백엔드/쿼리 전용. 향후 관리자 대시보드가 보여 줄 조직 전체 합계를 만든다 (확정 vs.
// 예상 인건비 합계, 미확정 근로자 수, 출근 현장별 합계). **대시보드
// UI 는 만들지 않았다** — 관리자/웹 대시보드는 앱이 완성될 때까지 보류이고, 이것은 대시보드(와 내보내기)가
// 부를 재사용 가능한 데이터 레이어다.
//
// 권한: 조직 전체 보상은 owner / attendance_payroll_admin 전용이다. 이 함수는
// 호출자 무관(org + ym)이므로, 호출자는 반드시 `attendanceCan` 으로 막아야 한다 (검토 큐와 같은 패턴).
// 그리고 `attendance_month_snapshots` 의 관리자 전용 SELECT RLS 가 안전망이다.
// 일반 사용자 / 시급 근로자는 여기에 닿지 않는다 — 본인 급여는 getMonthlyPayView 로만 본다.
//
// 숫자는 이미 만들어진 헬퍼에서 가져와 예상/확정이 일관되게 유지된다: 예상 = 관련
// 시급 근로자 각자의 현재 `getMonthlyPayView` 예상 총액 합; 확정 = `finalized` 월 스냅샷의 합
// (Step 11). 둘은 명확히 분리해서 둔다.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMonthlyPayView } from "@/lib/attendance-pay";
import { monthFirstDay } from "@/lib/attendance-finalization";

const TZ = "Asia/Tokyo";
type Service = ReturnType<typeof getSupabaseServiceClient>;

export type PayrollSiteTotal = {
  siteId: string | null;
  siteName: string;
  /** 이 출근 현장에 귀속된 예상 총액 (엔, 반올림). */
  gross: number;
  paidMinutes: number;
};

export type PayrollTotals = {
  ym: string; // YYYY-MM (도쿄)
  monthLabel: string;
  /** `finalized` 사람별 월 스냅샷(잠금)의 합 — 확정 데이터만. */
  finalizedLaborTotal: number;
  finalizedPaidMinutes: number;
  finalizedWorkerCount: number;
  /** 관련 시급 근로자 전체에 대해 현재 예상되는 총액 (예상, 확정 아님). */
  expectedLaborTotal: number;
  expectedPaidMinutes: number;
  /** 이번 달 근태가 있는 시급 근로자 (마감 관련 모집단). */
  relevantHourlyWorkerCount: number;
  /** 그 달의 확정 스냅샷이 없는 관련 시급 근로자. */
  unfinalizedWorkerCount: number;
  /** 출근 현장별로 집계한 예상 인건비 합계 (1차 규칙). */
  siteTotals: PayrollSiteTotal[];
};

function monthLabelOf(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, year: "numeric", month: "long" }).format(d);
}

function monthLastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

async function loadSiteNames(
  service: Service,
  organizationId: string,
  siteIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (siteIds.length === 0) return map;
  const res = await service
    .from("attendance_sites")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", siteIds);
  for (const r of (res.data ?? []) as { id: string; name: string }[]) map.set(r.id, r.name);
  return map;
}

/**
 * 도쿄 `ym` 의 조직 전체 급여 합계. 호출자는 먼저 권한을 확인해야 한다. O(관련
 * 시급 근로자) — 근로자마다 `getMonthlyPayView` 를 재사용하므로 예상 합계가 본인 보기와 일치한다.
 */
export async function getPayrollTotals(
  organizationId: string,
  ym: string,
): Promise<PayrollTotals> {
  const service = getSupabaseServiceClient();
  const firstDay = monthFirstDay(ym);
  const lastDay = monthLastDay(ym);

  // 1) 이번 달 근태가 있는 서로 다른 근로자 + 세션 → 출근 현장 맵 (1차 규칙).
  const sessRes = await service
    .from("attendance_sessions")
    .select("id, user_id, clock_in_site_id")
    .eq("organization_id", organizationId)
    .gte("operating_date", firstDay)
    .lte("operating_date", lastDay);
  const monthSessions = (sessRes.data ?? []) as {
    id: string;
    user_id: string;
    clock_in_site_id: string | null;
  }[];
  const sessionSite = new Map<string, string | null>();
  for (const s of monthSessions) sessionSite.set(s.id, s.clock_in_site_id);
  const candidateUserIds = Array.from(new Set(monthSessions.map((s) => s.user_id)));

  // 2) 그 달의 확정 스냅샷 (확정 인건비 합계 — 확정 데이터만).
  const snapRes = await service
    .from("attendance_month_snapshots")
    .select("user_id, gross_amount, total_paid_minutes")
    .eq("organization_id", organizationId)
    .eq("target_month", firstDay)
    .eq("status", "finalized");
  const finalizedRows = (snapRes.data ?? []) as {
    user_id: string;
    gross_amount: number;
    total_paid_minutes: number;
  }[];
  const finalizedUserIds = new Set(finalizedRows.map((r) => r.user_id));
  const finalizedLaborTotal = finalizedRows.reduce((sum, r) => sum + Number(r.gross_amount), 0);
  const finalizedPaidMinutes = finalizedRows.reduce((sum, r) => sum + Number(r.total_paid_minutes), 0);

  // 3) 관련 시급 근로자별 예상 (본인 보기 계산 재사용 → 일관된 숫자).
  const views = await Promise.all(
    candidateUserIds.map((uid) => getMonthlyPayView(organizationId, uid, ym)),
  );

  let expectedLaborTotal = 0;
  let expectedPaidMinutes = 0;
  let relevantHourlyWorkerCount = 0;
  const siteAccum = new Map<string | null, { grossExact: number; paidMinutes: number }>();

  views.forEach((view) => {
    if (!view.hourlyEligible) return; // 월급제만 있는 달은 급여 마감 대상이 아니다
    relevantHourlyWorkerCount += 1;
    expectedLaborTotal += view.expectedGross;
    expectedPaidMinutes += view.totalPaidMinutes;

    // 출근 현장별 집계, 각 포함 세션의 정확한 총액에서.
    for (const day of view.days) {
      for (const s of day.sessions) {
        if (!s.included) continue;
        const siteId = sessionSite.get(s.sessionId) ?? null;
        const acc = siteAccum.get(siteId) ?? { grossExact: 0, paidMinutes: 0 };
        acc.grossExact += s.dailyGrossExact;
        acc.paidMinutes += s.paidMinutes;
        siteAccum.set(siteId, acc);
      }
    }
  });

  // 그 달 마감되지 않은 관련 시급 근로자.
  const relevantHourlyUserIds = candidateUserIds.filter((_, i) => views[i].hourlyEligible);
  const unfinalizedWorkerCount = relevantHourlyUserIds.filter(
    (uid) => !finalizedUserIds.has(uid),
  ).length;

  const siteIds = Array.from(siteAccum.keys()).filter(Boolean) as string[];
  const siteNames = await loadSiteNames(service, organizationId, siteIds);
  const siteTotals: PayrollSiteTotal[] = Array.from(siteAccum.entries())
    .map(([siteId, v]) => ({
      siteId,
      siteName: siteId ? (siteNames.get(siteId) ?? "—") : "미지정",
      gross: Math.round(v.grossExact),
      paidMinutes: v.paidMinutes,
    }))
    .sort((a, b) => b.gross - a.gross);

  return {
    ym,
    monthLabel: monthLabelOf(ym),
    finalizedLaborTotal,
    finalizedPaidMinutes,
    finalizedWorkerCount: finalizedUserIds.size,
    expectedLaborTotal,
    expectedPaidMinutes,
    relevantHourlyWorkerCount,
    unfinalizedWorkerCount,
    siteTotals,
  };
}
