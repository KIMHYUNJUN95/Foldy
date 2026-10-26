import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingBag, ShoppingCart, Wrench } from "lucide-react";
import { RequestsFilterView } from "@/components/requests/requests-filter-view";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import "@/components/requests/requests-list.css";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOrgLostItems } from "@/lib/lost-found";
import { getOrgMaintenanceReports } from "@/lib/maintenance-reports";
import { getOnboardingState } from "@/lib/onboarding";
import { getOrgOrderRequests } from "@/lib/order-requests";
import {
  parseRequestDatePreset,
  parseRequestDateRange,
} from "@/lib/request-filters";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = {
  searchParams: Promise<{ date?: string; endDate?: string; startDate?: string }>;
};

export default async function MobileRequestsPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/requests");
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const datePreset = parseRequestDatePreset(params.date);
  const dateRange = parseRequestDateRange({
    endDate: params.endDate,
    startDate: params.startDate,
  });
  const hasCustomRange = Boolean(dateRange.startDate || dateRange.endDate);
  const dateFilter = hasCustomRange ? dateRange : { datePreset };

  const [lostItems, maintenanceReports, orderRequests, roomCatalog] = await Promise.all([
    getOrgLostItems(session, dateFilter),
    getOrgMaintenanceReports(session, dateFilter),
    // 분리된 catch: 주문 조회 실패가 페이지 전체를 무너뜨리면 안 된다.
    getOrgOrderRequests(session, dateFilter).catch((err: unknown) => {
      console.warn("[requests page] order requests unavailable:", err);
      return [];
    }),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
  ]);

  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="requests" badges={navBadges} title={dictionary.mobile.requestsTitle} split>
      <SplitList detail="requests">
        {/* 화이트 리디자인(2026-10-13 · 10-14 문구 맞춤, 시안 Req-Phone): 제목 · 한 줄 → 옅은 타일 셋(아이콘 위 · 글자 아래). */}
        <div className="rqw-head">
          <h1>{dictionary.mobile.requestsHead.title}</h1>
          <p>{dictionary.mobile.requestsHead.sub}</p>
        </div>
        <div className="rqw-quick">
          <Link href="/mobile/lost-found/new">
            <ShoppingBag aria-hidden="true" />
            {dictionary.mobile.requestsHead.lost}
          </Link>
          <Link href="/mobile/maintenance/new">
            <Wrench aria-hidden="true" />
            {dictionary.mobile.requestsHead.maintenance}
          </Link>
          <Link href="/mobile/requests/orders/new">
            <ShoppingCart aria-hidden="true" />
            {dictionary.mobile.requestsHead.order}
          </Link>
        </div>

        <RequestsFilterView
          filterLabels={{
            building: dictionary.cleaning.manualBuildingLabel,
            calendarApply: dictionary.mobile.calendarApply,
            calendarClear: dictionary.mobile.calendarClear,
            calendarClose: dictionary.mobile.calendarClose,
            calendarPreviousMonth: dictionary.mobile.calendarPreviousMonth,
            calendarNextMonth: dictionary.mobile.calendarNextMonth,
            clearBuildingFilter: dictionary.mobile.clearBuildingFilter,
            calendarSelectEnd: dictionary.mobile.calendarSelectEnd,
            calendarSelectStart: dictionary.mobile.calendarSelectStart,
            calendarTitle: dictionary.mobile.calendarTitle,
            filterActive: dictionary.mobile.filterActive,
            filterAll: dictionary.mobile.filterAll,
            filterButton: dictionary.mobile.filterButton,
            filterClosed: dictionary.mobile.filterClosed,
            filterCustomRange: dictionary.mobile.filterCustomRange,
            filterLast7Days: dictionary.mobile.filterLast7Days,
            filterLast30Days: dictionary.mobile.filterLast30Days,
            filterLostFound: dictionary.mobile.filterLostFound,
            filterMaintenance: dictionary.mobile.filterMaintenance,
            filterOrder: dictionary.mobile.filterOrder,
            filterScopeMine: dictionary.mobile.filterScopeMine,
            filterScopeMineRequest: dictionary.mobile.filterScopeMineRequest,
            filterToday: dictionary.mobile.filterToday,
            groupDate: dictionary.mobile.filterGroupDate,
            groupScope: dictionary.mobile.filterGroupScope,
            groupStatus: dictionary.mobile.filterGroupStatus,
            groupType: dictionary.mobile.filterGroupType,
            groupToday: dictionary.mobile.groupToday,
            groupYesterday: dictionary.mobile.groupYesterday,
            groupEarlier: dictionary.mobile.groupEarlier,
            openCountTemplate: dictionary.mobile.requestOpenCount,
            noFilterResults: dictionary.mobile.noFilterResults,
            returnedEntry: dictionary.lostFound.returned.entry,
            disposedEntry: dictionary.lostFound.disposed.entry,
          }}
          buildingLabels={dictionary.cleaning.buildingLabels}
          currentUserId={session.user.id}
          canDeleteAny={session.capabilities.includes("request.delete_any")}
          datePreset={datePreset}
          deleteCopy={{
            confirmTitle: dictionary.mobile.deleteConfirmTitle,
            confirmBody: dictionary.mobile.deleteConfirmBody,
            deleteAction: dictionary.mobile.deleteAction,
            cancel: dictionary.mobile.calendarClose,
            deleteFailed: dictionary.mobile.deleteFailed,
          }}
          endDate={dateRange.endDate}
          locale={locale}
          lostFoundCopy={{
            fromCleaningTag: dictionary.lostFound.fromCleaningTag,
            groupActive: dictionary.lostFound.groupActive,
            groupClosed: dictionary.lostFound.groupClosed,
            mobileListTitle: dictionary.lostFound.mobileListTitle,
            noRecords: dictionary.lostFound.noRecords,
            reporter: dictionary.lostFound.reporter,
            room: dictionary.lostFound.room,
            statusLabels: dictionary.lostFound.statusLabels,
          }}
          lostItems={lostItems}
          maintenanceCopy={{
            buildingOnly: dictionary.maintenance.form.roomBuildingOnly,
            fromCleaningTag: dictionary.maintenance.fromCleaningTag,
            mobileListTitle: dictionary.maintenance.mobileListTitle,
            noRecords: dictionary.maintenance.noRecords,
            reporter: dictionary.maintenance.reporter,
            room: dictionary.maintenance.room,
            statusLabels: dictionary.maintenance.statusLabels,
            urgentLabel: dictionary.maintenance.form.urgencies.urgent,
          }}
          maintenanceReports={maintenanceReports}
          orderRequests={orderRequests}
          orderCopy={{
            sectionTitle: dictionary.mobile.quickActions.order,
            statusLabels: dictionary.mobile.orderStatusLabels,
            deliveryDateShort: dictionary.mobile.orderDetail.deliveryDateShort,
            groupActive: dictionary.mobile.orderDetail.wGroupActive,
            groupDeliv: dictionary.mobile.orderDetail.wGroupDeliv,
            groupPast: dictionary.mobile.orderDetail.wGroupPast,
            arriveToday: dictionary.mobile.orderDetail.wArriveToday,
            arriveTomorrow: dictionary.mobile.orderDetail.wArriveTomorrow,
            arriveOn: dictionary.mobile.orderDetail.wArriveOn,
            reqOn: dictionary.mobile.orderDetail.wReqOn,
          }}
          deliveryCalendarCopy={{
            title: dictionary.mobile.deliveryCalendar.title,
            openLabel: dictionary.mobile.deliveryCalendar.openLabel,
            empty: dictionary.mobile.deliveryCalendar.empty,
            dayEmpty: dictionary.mobile.deliveryCalendar.dayEmpty,
            today: dictionary.mobile.deliveryCalendar.today,
            close: dictionary.mobile.deliveryCalendar.close,
            previousMonth: dictionary.mobile.deliveryCalendar.previousMonth,
            nextMonth: dictionary.mobile.deliveryCalendar.nextMonth,
            countTemplate: dictionary.mobile.deliveryCalendar.countTemplate,
            rangeLabel: dictionary.mobile.deliveryCalendar.rangeLabel,
            monthCountTemplate: dictionary.mobile.deliveryCalendar.monthCountTemplate,
            tomorrow: dictionary.mobile.deliveryCalendar.tomorrow,
          }}
          roomCatalog={roomCatalog ?? []}
          startDate={dateRange.startDate}
        />
      </SplitList>
    </MobileShell>
  );
}
