import { getCheckinPropertySettings } from "@/actions/checkin/settings";
import { CheckinSettingsConsole } from "@/components/admin/checkin/checkin-settings-console";
import { CheckinTabs } from "@/components/admin/checkin/checkin-ui";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";
import { AdminShell } from "@/components/shell/admin-shell";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { CHECKIN_PROPERTIES, checkinPropertyName } from "@/lib/checkin/model";
import { getDictionary } from "@/lib/i18n";

// 셀프 체크인 · 건물 설정 (2026-11-04, 시안 S8). 권한 `checkin.manage`. 건물은 `?property=` 로 고른다(기본: 첫 건물).
// 도메인 계약: docs/product/44-self-checkin-prd.md FR-S08
export const dynamic = "force-dynamic";

export default async function AdminCheckinSettingsPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  const session = await requireAdminPageSession({ nextPath: "/admin/checkin/settings" });
  const params = await searchParams;
  const dictionary = getDictionary(session.user.preferredLanguage);
  const copy = dictionary.checkinStaff;
  const shared = dictionary.admin.shared;

  if (!session.capabilities.includes("checkin.manage")) {
    return (
      <AdminShell activeItem="checkin" title={copy.title}>
        <AdminNoAccess title={shared.noAccessTitle} body={shared.noAccessBody} />
      </AdminShell>
    );
  }

  const propertyKey =
    typeof params.property === "string" && checkinPropertyName(params.property) ? params.property : (CHECKIN_PROPERTIES[0]?.key ?? "");
  const result = await getCheckinPropertySettings(propertyKey);
  return (
    <AdminShell activeItem="checkin" title={copy.title}>
      <div className="ck">
        <CheckinTabs active="settings" canManage copy={copy} />
      </div>
      <CheckinSettingsConsole copy={copy} shared={shared} properties={[...CHECKIN_PROPERTIES]} propertyKey={propertyKey} result={result} />
    </AdminShell>
  );
}
