import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/admin-session";
import { getDictionary } from "@/lib/i18n";
import { hasOrganizationContext } from "@/lib/session";
import { AdminShell } from "@/components/shell/admin-shell";
import "@/components/admin/settings/settings-white.css";

// Admin · 설정 — 2026-10-15 화이트 리디자인부터 랜딩 카드 화면이 없다. 설정은 탭(출퇴근 현장 | 조직 설정)이
// 첫 화면이라, 여기서는 권한에 맞는 탭으로 보낸다. `?error=` 는 그대로 넘겨 그 탭 맨 위 한 줄로 보인다.
// 두 탭 모두 권한이 없으면(현장 관리 권한 없는 관리자) 안내 한 줄만 띄운다 — 다시 보내면 무한 반복이 된다.
export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const params = (await searchParams) ?? {};
  const errorRaw = params.error;
  const errorKey = Array.isArray(errorRaw) ? errorRaw[0] : errorRaw;
  const suffix = errorKey ? `?error=${encodeURIComponent(errorKey)}` : "";

  if (session.capabilities.includes("attendance.settings") && hasOrganizationContext(session)) {
    redirect(`/admin/settings/attendance${suffix}`);
  }
  if (session.capabilities.includes("payroll.manage") && hasOrganizationContext(session)) {
    redirect(`/admin/settings/payroll${suffix}`);
  }
  if (session.user.role === "developer_super_admin") {
    redirect(`/admin/settings/organization${suffix}`);
  }

  const settings = getDictionary(session.user.preferredLanguage).admin.settings;
  return (
    <AdminShell activeItem="settings" title={settings.settingsTitle}>
      <div className="stw">
        <div className="stw-empty">{settings.errors.forbidden}</div>
      </div>
    </AdminShell>
  );
}
