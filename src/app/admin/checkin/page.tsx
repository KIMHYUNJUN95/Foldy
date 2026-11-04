import { getCheckinArrivals } from "@/actions/checkin/stays";
import { CheckinTodayConsole } from "@/components/admin/checkin/checkin-today-console";
import { CheckinTabs } from "@/components/admin/checkin/checkin-ui";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";
import { AdminShell } from "@/components/shell/admin-shell";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { CHECKIN_PROPERTIES, checkinPropertyName, resolveArrivalDate } from "@/lib/checkin/model";
import { getDictionary } from "@/lib/i18n";
import { tokyoToday } from "@/lib/tokyo-date";

// 셀프 체크인 · 오늘 도착 (2026-11-04, 시안 S1 · S1c · S1d). 날짜 · 건물은 쿼리스트링, 줄 상세는 패널이 서버 액션으로 따로 읽는다.
// 권한 `checkin.view` — 메뉴 숨김은 편의이고 서버 액션이 다시 막는다. 도메인 계약: docs/product/44-self-checkin-prd.md §4-4
export const dynamic = "force-dynamic";

type SearchParams = { date?: string; property?: string };

export default async function AdminCheckinPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireAdminPageSession({ nextPath: "/admin/checkin" });
  const params = await searchParams;
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const copy = dictionary.checkinStaff;
  const shared = dictionary.admin.shared;
  const canManage = session.capabilities.includes("checkin.manage");

  if (!session.capabilities.includes("checkin.view")) {
    return (
      <AdminShell activeItem="checkin" title={copy.title}>
        <AdminNoAccess title={shared.noAccessTitle} body={shared.noAccessBody} />
      </AdminShell>
    );
  }

  const date = resolveArrivalDate(typeof params.date === "string" ? params.date : null) ?? tokyoToday();
  const propertyKey = typeof params.property === "string" && checkinPropertyName(params.property) ? params.property : null;
  const result = await getCheckinArrivals({ date, propertyKey });

  return (
    <AdminShell activeItem="checkin" title={copy.title}>
      <div className="ck">
        <CheckinTabs active="today" canManage={canManage} copy={copy} />
      </div>
      <CheckinTodayConsole
        copy={copy}
        shared={shared}
        locale={locale}
        date={date}
        propertyKey={propertyKey}
        properties={[...CHECKIN_PROPERTIES]}
        result={result}
      />
    </AdminShell>
  );
}
