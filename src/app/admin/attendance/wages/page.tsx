import { AdminShell } from "@/components/shell/admin-shell";
import { AttendanceSubnav } from "@/components/admin/attendance/attendance-subnav";
import { AttendanceWagesClient } from "@/components/admin/attendance/attendance-wages-client";
import { AttendanceAllowancesSection } from "@/components/admin/attendance/attendance-allowances-section";
import {
  currentTokyoYm,
  getAdminAttendanceBadgeStats,
  getAdminAttendanceWages,
  listAttendanceAllowances,
} from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";
import { isValidYm } from "@/lib/attendance-clock";

// 관리자 · 근태 · 시급 관리 (Slice 7).
// 구성원별 시급 관리: 인라인 실시간 편집기가
// `setHourlyRate` 서버 액션에 연결된다 (감사 로그 기록, attendanceCan 으로 게이트).
// 마감된 과거 시급 구간은 수정할 수 없다 (소급 변경 불가).
export default async function AdminAttendanceWagesPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const [session, params] = await Promise.all([
    requireAdminPageSession({ nextPath: "/admin/attendance/wages" }),
    searchParams,
  ]);

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const carriedYm =
    isValidYm(params.ym) ? params.ym : currentTokyoYm();
  const carriedMonthLabel = new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
  }).format(new Date(`${carriedYm}-01T00:00:00+09:00`));

  const [badgeStats, wages, allowances] = await Promise.all([
    getAdminAttendanceBadgeStats(session, carriedYm),
    getAdminAttendanceWages(session),
    listAttendanceAllowances(session, localeTag),
  ]);
  const todayTokyo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const allowanceStaff = wages.rows
    .filter((r) => r.employment === "hourly")
    .map((r) => ({ userId: r.userId, userName: r.userName }));

  return (
    <AdminShell activeItem="attendance" title={c.headerWages}>
      <AttendanceSubnav
        active="wages"
        monthLabel={carriedMonthLabel}
        c={c}
        ym={carriedYm}
        localeTag={localeTag}
        badges={{
          queue: {
            n: badgeStats.queueOpen,
            urgent: badgeStats.queueUrgent > 0,
          },
          payroll: { n: badgeStats.payrollTargets },
          transport: { n: badgeStats.transportPending },
        }}
      />

      {wages.isPrivileged ? (
        <>
          <AttendanceWagesClient
            initialRows={wages.rows}
            ym={carriedYm}
            defaultEffectiveFrom={wages.defaultEffectiveFrom}
            minEffectiveFrom={wages.minEffectiveFrom}
            gapFillMinFrom={wages.gapFillMinFrom}
            locale={locale}
            localeTag={localeTag}
          />
          <AttendanceAllowancesSection
            allowances={allowances.rows}
            staff={allowanceStaff}
            defaultDate={todayTokyo}
            locale={locale}
            localeTag={localeTag}
          />
        </>
      ) : (
        <AdminNoAccess title={dictionary.admin.shared.noAccessTitle} body={dictionary.admin.shared.noAccessBody} />
      )}
    </AdminShell>
  );
}
