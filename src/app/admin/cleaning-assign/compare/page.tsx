import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import { AssignCompare } from "@/components/admin/cleaning-assign/assign-compare";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getMonthlyPayView } from "@/lib/attendance-pay";
import { isAttendancePayrollAdmin } from "@/lib/attendance-review";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { isMonthKey, monthOf } from "@/lib/cleaning-assign/day-state";
import { loadAssignSettings, loadCompareRows } from "@/lib/cleaning-assign/data";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 청소 월 비교표 — 방 수 ↔ 급여(의심 신호). 배정 담당이면서 **급여를 볼 수 있는 사람만**(근태 · 급여 화면과 같은 기준).
 * docs/product/37-cleaning-shift-assignment.md 「4-4」
 */
export default async function AdminCleaningAssignComparePage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const [session, params] = await Promise.all([requireAdminPageSession({ nextPath: "/admin/cleaning-assign/compare" }), searchParams]);
  if (!session.capabilities.includes("cleaning.assign")) redirect("/admin");
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  if (!(await isAttendancePayrollAdmin(supabase, organizationId, session.user.id))) redirect("/admin/cleaning-assign");
  const locale = session.user.preferredLanguage;
  const copy = getCleaningAssignCopy(locale);
  const ym = isMonthKey(params.ym) ? params.ym! : monthOf(getCleaningOperatingDateKey());
  const [rows, settings] = await Promise.all([
    loadCompareRows(supabase, organizationId, ym, async (userId) => {
      const view = await getMonthlyPayView(organizationId, userId, ym, locale);
      return { expectedGross: view.expectedGross, finalizedGross: view.finalization?.gross ?? null, totalPaidMinutes: view.finalization?.paidMinutes ?? view.totalPaidMinutes };
    }),
    loadAssignSettings(supabase, organizationId),
  ]);
  return (
    <AdminShell activeItem="cleaning-assign" title={copy.compareTitle}>
      <AssignCompare rows={rows} ym={ym} threshold={settings.flagThreshold} copy={copy} locale={locale} shared={getDictionary(locale).admin.shared} />
    </AdminShell>
  );
}
