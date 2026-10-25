import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import { SettingsSubnav } from "@/components/admin/settings/settings-subnav";
import { PayrollSettingsClient } from "@/components/admin/settings/payroll-settings-client";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";
import "@/components/admin/settings/settings-white.css";
import { requireAdminSession } from "@/lib/admin-session";
import { getDictionary } from "@/lib/i18n";
import { getPayrollSettingsCopy } from "@/lib/payroll-settings-i18n";
import { loadOrgPayrollSettings } from "@/lib/payroll-settings-server";
import { hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoToday } from "@/lib/tokyo-date";

// Admin · 설정 › 급여 — 회사 이름 · 지급일 · 결재자 · 雇用保険 요율. 권한 `payroll.manage`(알바 급여 P1, docs/product/39 §3-C).
export default async function AdminPayrollSettingsPage() {
  const session = await requireAdminSession();
  if (!hasOrganizationContext(session)) redirect("/admin/settings?error=forbidden");

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const settings = dictionary.admin.settings;
  const copy = getPayrollSettingsCopy(locale);
  const canManage = session.capabilities.includes("payroll.manage");
  const showAttendance = session.capabilities.includes("attendance.settings");

  if (!canManage) {
    return (
      <AdminShell activeItem="settings" title={copy.pageTitle}>
        <div className="stw">
          <AdminNoAccess title={dictionary.admin.shared.noAccessTitle} body={dictionary.admin.shared.noAccessBody} />
        </div>
      </AdminShell>
    );
  }

  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  const membershipsRes = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  const userIds = [...new Set((membershipsRes.data ?? []).map((m) => m.user_id))];
  const [org, profilesRes] = await Promise.all([
    loadOrgPayrollSettings(service, organizationId),
    userIds.length > 0
      ? service.from("profiles").select("id, name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const members = (profilesRes.data ?? [])
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));

  const today = tokyoToday();

  return (
    <AdminShell activeItem="settings" title={copy.pageTitle}>
      <div className="stw">
        <SettingsSubnav
          active="payroll"
          settings={settings}
          showOrganization={session.user.role === "developer_super_admin"}
          showPayroll
          showAttendance={showAttendance}
          payrollLabel={copy.tab}
        />
        <PayrollSettingsClient
          copy={copy}
          initial={org}
          members={members}
          fromWorkYm={today.slice(0, 7)}
          thisYear={Number(today.slice(0, 4))}
          locale={locale}
        />
      </div>
    </AdminShell>
  );
}
