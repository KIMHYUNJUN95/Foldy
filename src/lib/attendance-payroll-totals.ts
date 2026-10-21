// Attendance — privileged org-wide PAYROLL TOTALS data layer (Step 12).
//
// Backend/query-only. Produces the org-wide totals a future admin dashboard will show (finalized vs
// expected labor total, unfinalized worker count, site-based totals by clock-in site). **No dashboard
// UI is built** — the admin/web dashboard is deferred until the app is complete; this is the reusable
// data layer it (and export) will call.
//
// PRIVILEGE: org-wide compensation is owner / attendance_payroll_admin only. This function is
// caller-agnostic (org + ym); the CALLER MUST gate it with `attendanceCan` (the same pattern
// as the review queue), and the `attendance_month_snapshots` admin-only SELECT RLS is the backstop.
// Regular users / hourly workers never reach this — they only see their own pay via getMonthlyPayView.
//
// Numbers come from the ALREADY-BUILT helpers so expected/finalized stay consistent: expected = the sum
// of each relevant hourly worker's current `getMonthlyPayView` expected gross; finalized = the sum of
// `finalized` monthly snapshots (Step 11). The two are kept explicitly separate.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMonthlyPayView } from "@/lib/attendance-pay";
import { monthFirstDay } from "@/lib/attendance-finalization";

const TZ = "Asia/Tokyo";
type Service = ReturnType<typeof getSupabaseServiceClient>;

export type PayrollSiteTotal = {
  siteId: string | null;
  siteName: string;
  /** Expected gross attributed to this clock-in site (yen, rounded). */
  gross: number;
  paidMinutes: number;
};

export type PayrollTotals = {
  ym: string; // YYYY-MM (Tokyo)
  monthLabel: string;
  /** Sum of `finalized` per-person monthly snapshots (locked) — finalized data only. */
  finalizedLaborTotal: number;
  finalizedPaidMinutes: number;
  finalizedWorkerCount: number;
  /** Currently projected gross across relevant hourly workers (expected, NOT finalized). */
  expectedLaborTotal: number;
  expectedPaidMinutes: number;
  /** Hourly workers with attendance this month (the finalization-relevant population). */
  relevantHourlyWorkerCount: number;
  /** Relevant hourly workers without a finalized snapshot for the month. */
  unfinalizedWorkerCount: number;
  /** Expected labor totals aggregated by CLOCK-IN site (first-slice rule). */
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
 * Org-wide payroll totals for a Tokyo `ym`. Caller MUST have verified privilege first. O(relevant
 * hourly workers) — each worker reuses `getMonthlyPayView`, so expected totals match the self-view.
 */
export async function getPayrollTotals(
  organizationId: string,
  ym: string,
): Promise<PayrollTotals> {
  const service = getSupabaseServiceClient();
  const firstDay = monthFirstDay(ym);
  const lastDay = monthLastDay(ym);

  // 1) Distinct workers with attendance this month + a session → clock-in-site map (first-slice rule).
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

  // 2) Finalized snapshots for the month (finalized labor total — finalized data ONLY).
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

  // 3) Expected per relevant hourly worker (reuses the self-view calc → consistent numbers).
  const views = await Promise.all(
    candidateUserIds.map((uid) => getMonthlyPayView(organizationId, uid, ym)),
  );

  let expectedLaborTotal = 0;
  let expectedPaidMinutes = 0;
  let relevantHourlyWorkerCount = 0;
  const siteAccum = new Map<string | null, { grossExact: number; paidMinutes: number }>();

  views.forEach((view) => {
    if (!view.hourlyEligible) return; // salaried-only months are not payroll-finalization targets
    relevantHourlyWorkerCount += 1;
    expectedLaborTotal += view.expectedGross;
    expectedPaidMinutes += view.totalPaidMinutes;

    // Site rollup by clock-in site, from each included session's exact gross.
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

  // Relevant hourly workers not finalized for the month.
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
