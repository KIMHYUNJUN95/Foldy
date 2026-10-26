import Link from "next/link";
import type { ReactNode } from "react";
import { ChartColumn, Clock, Bus, Tags, Users, Wallet, Plane } from "lucide-react";
import { AdminDatePicker } from "../shared/admin-date-picker";
import { AdminMonthPicker } from "../shared/admin-month-picker";
import type { Capability } from "@/config/capabilities";
import type { Dictionary } from "@/lib/i18n";
import { getCurrentAppSession } from "@/lib/session";

type Tab = "overview" | "roster" | "queue" | "payroll" | "transport" | "wages" | "leave";
type Att = Dictionary["admin"]["attendanceConsole"];

/** `needs` — 이 탭을 보이게 하는 권한 키(하나라도 있으면). 없으면 누구나(현황 · 출근부). 2026-10-21 근태 · 급여 키 분리. */
const TABS: { id: Tab; href: string; icon: ReactNode; labelKey: keyof Att; needs?: Capability[] }[] = [
  { id: "overview", href: "/admin/attendance", icon: <ChartColumn />, labelKey: "tabOverview" },
  { id: "queue", href: "/admin/attendance/queue", icon: <Clock />, labelKey: "tabQueue", needs: ["attendance.manage"] },
  { id: "payroll", href: "/admin/attendance/payroll", icon: <Wallet />, labelKey: "tabPayroll", needs: ["payroll.view"] },
  { id: "wages", href: "/admin/attendance/wages", icon: <Tags />, labelKey: "tabWages", needs: ["wages.manage"] },
  { id: "transport", href: "/admin/attendance/transport", icon: <Bus />, labelKey: "tabTransport", needs: ["transport.manage"] },
  { id: "roster", href: "/admin/attendance/roster", icon: <Users />, labelKey: "tabRoster" },
  { id: "leave", href: "/admin/attendance/leave", icon: <Plane />, labelKey: "tabLeave", needs: ["leave.approve"] },
];

export async function AttendanceSubnav({
  active,
  monthLabel,
  c,
  badges,
  ym,
  localeTag,
  monthPickerBasePath,
  preserveMonthQueryKeys,
  datePicker,
}: {
  active: Tab;
  /** 오른쪽 선택기의 접근성 이름. 월/날짜 범위가 없는 탭(연차)에서는 생략한다. */
  monthLabel?: string;
  c: Att;
  badges?: Partial<Record<Tab, { n: number; urgent?: boolean }>>;
  /** 설정되면 선택한 월이 탭 사이에서 유지되도록 모든 탭 링크에 `?ym=` 으로 실어 보낸다. */
  ym?: string;
  localeTag?: string;
  monthPickerBasePath?: string;
  preserveMonthQueryKeys?: string[];
  datePicker?: {
    date: string;
    todayDate: string;
    basePath?: string;
  };
}) {
  const suffix = ym ? `?ym=${ym}` : "";
  const session = await getCurrentAppSession();
  const caps = session?.capabilities ?? [];
  // 지금 보고 있는 탭은 권한이 없어도 남긴다(그 화면이 「권한 없음」을 그린다).
  const tabs = TABS.filter((t) => t.id === active || !t.needs || t.needs.some((k) => caps.includes(k)));
  const activeTab = TABS.find((tab) => tab.id === active);
  const pickerBasePath = monthPickerBasePath ?? activeTab?.href ?? "/admin/attendance";

  // 월/날짜 범위가 없는 탭(연차)은 오른쪽 컨트롤을 아예 그리지 않는다. 예전에는
  // 정적 텍스트 대체가 있었는데 페이지 제목과 겹쳤고 이 막대가 다른 모든 탭과 다른
  // 컴포넌트처럼 읽히게 만들었다.
  const picker =
    localeTag && datePicker ? (
      <AdminDatePicker
        date={datePicker.date}
        todayDate={datePicker.todayDate}
        localeTag={localeTag}
        basePath={datePicker.basePath ?? activeTab?.href ?? "/admin/attendance/roster"}
        labels={{
          prevDay: c.payPagerPrev,
          nextDay: c.payPagerNext,
          prevMonth: c.monthPickerPrevYear,
          nextMonth: c.monthPickerNextYear,
          open: c.rosterDateSelectLabel,
          today: c.rosterGoToday,
          todayTag: c.rosterTodayTag,
          pastTag: c.rosterPastTag,
        }}
      />
    ) : localeTag && ym ? (
      <AdminMonthPicker
        ym={ym}
        localeTag={localeTag}
        basePath={pickerBasePath}
        preserveQueryKeys={preserveMonthQueryKeys}
        labels={{
          prevMonth: c.payPagerPrev,
          nextMonth: c.payPagerNext,
          prevYear: c.monthPickerPrevYear,
          nextYear: c.monthPickerNextYear,
          open: c.monthPickerOpen,
          thisMonth: c.monthPickerThisMonth,
        }}
      />
    ) : null;

  return (
    <div className="subnav" role="tablist" aria-label={c.crumb}>
      {tabs.map((t) => {
        const badge = badges?.[t.id];
        const label = c[t.labelKey] as string;
        return (
          <Link
            key={t.id}
            href={`${t.href}${suffix}`}
            className={`subnav__t${t.id === active ? " on" : ""}`}
            aria-current={t.id === active ? "page" : undefined}
          >
            <span className="ic">{t.icon}</span>
            {label}
            {badge && badge.n > 0 ? (
              <span className={`cnt${badge.urgent ? " urgent" : ""}`}>{badge.n}</span>
            ) : null}
          </Link>
        );
      })}
      <span className="subnav__spacer" />
      {picker ? (
        <div className="subnav__month" aria-label={monthLabel}>
          {picker}
        </div>
      ) : null}
    </div>
  );
}
