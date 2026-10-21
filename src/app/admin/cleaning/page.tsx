import { AdminShell } from "@/components/shell/admin-shell";
import { CleaningConsole } from "@/components/admin/cleaning/cleaning-console";
import { monthRange } from "@/components/admin/cleaning/cleaning-console-data";
import { getAdminCleaningHistory, getAdminCleaningToday } from "@/lib/admin-cleaning";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { canForceCompleteCleaning, getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getDictionary } from "@/lib/i18n";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";

// 청소 · 셋팅 대상은 예약에서만 나온다 — 요금 · 차단 신호로 다시 읽지 않는다(2026-10-19).
const LIVE_KINDS = ["reservations"] as const;

// Admin · Cleaning — 오늘 현황 (real-time board) / 기록 (filterable history) console. Real
// cleaning_sessions + reservation data (see src/lib/admin-cleaning.ts) as of 2026-07-14 — replaces
// the earlier design-implementation mock. See docs/product/07-cleaning-workflow.md →
// "2026-07-14 어드민 청소 대시보드 — 백엔드 연동".
export default async function AdminCleaningPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const session = await requireAdminPageSession({ nextPath: "/admin/cleaning" });
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);

  // 조회할 운영일. 형식이 어긋나면 조용히 오늘로 떨어진다 — 잘못된 링크로 화면이 깨지지 않게.
  const rawDate = (await searchParams)?.date;
  const dateParam = Array.isArray(rawDate) ? rawDate[0] : rawDate;
  const operatingToday = getCleaningOperatingDateKey();
  const viewDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : operatingToday;

  const [ty, tm] = operatingToday.split("-").map(Number);
  const range = monthRange(ty, tm - 1);
  // 기록은 객실 목록만 기다린다 — 오늘 현황과 동시에 읽는다.
  const [today, history] = await Promise.all([
    getAdminCleaningToday(session, viewDate),
    getActiveRoomCatalogServer(session.organization.id)
      .catch(() => undefined)
      .then((roomCatalog) =>
        getAdminCleaningHistory(session, { startDate: range.from, endDate: range.to }, roomCatalog),
      ),
  ]);

  return (
    <AdminShell activeItem="cleaning" title={dictionary.cleaning.adminTitle}>
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <CleaningConsole
        locale={locale}
        viewDate={viewDate}
        operatingToday={operatingToday}
        tasks={today.tasks}
        setupTargets={today.setupTargets}
        staff={today.staff}
        loadError={today.loadError}
        initialHistory={history}
        initialHistoryFrom={range.from}
        initialHistoryTo={range.to}
        canForceComplete={canForceCompleteCleaning(session)}
      />
    </AdminShell>
  );
}
