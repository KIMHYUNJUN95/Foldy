import { AdminReservationConsole } from "@/components/admin/calendar/admin-reservation-console";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { AdminShell } from "@/components/shell/admin-shell";
import {
  buildMonthLabel,
  getAdminCalendarDashboardData,
} from "@/lib/admin-calendar-dashboard";
import { requireAdminSession } from "@/lib/admin-session";

type PageProps = {
  searchParams: Promise<{
    month?: string;
    property?: string;
  }>;
};

// 예약 막대 · 차단 구간만 그린다 — 요금 동기화 신호로 두 달 예약을 다시 읽지 않는다(2026-10-19).
const LIVE_KINDS = ["reservations", "blocks"] as const;

function buildMobileCalendarHref(month: string, property: string | null) {
  const params = new URLSearchParams({ month });
  if (property) {
    params.set("property", property);
  }
  return `/mobile/calendar?${params.toString()}`;
}

export default async function AdminCalendarPage({ searchParams }: PageProps) {
  const [session, params] = await Promise.all([requireAdminSession(), searchParams]);
  const data = await getAdminCalendarDashboardData(session, params);

  return (
    <AdminShell
      activeItem="calendar"
      mobileHref={buildMobileCalendarHref(data.selectedMonth, data.selectedProperty)}
      title={buildMonthLabel(data.selectedMonth, data.locale)}
    >
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <AdminReservationConsole
        beds24SyncPaused={data.beds24SyncPaused}
        blockedProperties={[]}
        buildingInfos={data.buildingInfos}
        currentMonth={data.currentMonth}
        dates={data.dates}
        initialLocale={data.locale}
        isOutOfWindow={data.isOutOfWindow}
        nextMonth={data.nextMonth}
        prevMonth={data.prevMonth}
        propertyOptions={data.propertyOptions}
        reservationNotes={data.reservationNotes}
        reservations={data.reservations}
        roomBlocks={data.roomBlocks}
        roomRows={data.roomRows}
        selectedMonth={data.selectedMonth}
        selectedProperty={data.selectedProperty}
        today={data.today}
      />
    </AdminShell>
  );
}
