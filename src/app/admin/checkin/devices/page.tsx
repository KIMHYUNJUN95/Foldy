import { listCheckinDevices } from "@/actions/checkin/devices";
import { CheckinDevicesConsole } from "@/components/admin/checkin/checkin-devices-console";
import { CheckinTabs } from "@/components/admin/checkin/checkin-ui";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";
import { AdminShell } from "@/components/shell/admin-shell";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { CHECKIN_PROPERTIES } from "@/lib/checkin/model";
import { getDictionary } from "@/lib/i18n";

// 셀프 체크인 · 기기 (2026-11-04, 시안 S7 · S7b). 권한 `checkin.manage`. 도메인 계약: docs/product/44-self-checkin-prd.md FR-S07
export const dynamic = "force-dynamic";

export default async function AdminCheckinDevicesPage() {
  const session = await requireAdminPageSession({ nextPath: "/admin/checkin/devices" });
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

  const result = await listCheckinDevices();
  return (
    <AdminShell activeItem="checkin" title={copy.title}>
      <div className="ck">
        <CheckinTabs active="devices" canManage copy={copy} />
      </div>
      <CheckinDevicesConsole copy={copy} shared={shared} properties={[...CHECKIN_PROPERTIES]} result={result} />
    </AdminShell>
  );
}
