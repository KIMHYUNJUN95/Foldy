import { AdminShell } from "@/components/shell/admin-shell";
import { AttendanceSubnav } from "@/components/admin/attendance/attendance-subnav";
import { AttendancePayrollClient } from "@/components/admin/attendance/attendance-payroll-client";
import {
  currentTokyoYm,
  getAdminAttendanceBadgeStats,
  getAdminAttendancePayroll,
} from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { loadWeeklyLimitChips, monthWeeklyRange } from "@/lib/staff-documents/weekly-limit-server";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";

// Admin · Attendance · Payroll (Slice 4).
// Monthly per-user payroll review wired to existing `getMonthlyPayView` +
// finalize/reopen/export server actions. Month is controlled by the shared attendance subnav picker.
// See docs/product/05-admin-web-ia.md → "Attendance / Payroll / Transportation".
export default async function AdminAttendancePayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const [session, params] = await Promise.all([
    requireAdminPageSession({ nextPath: "/admin/attendance/payroll" }),
    searchParams,
  ]);

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const requestedYm =
    typeof params.ym === "string" && /^\d{4}-\d{2}$/.test(params.ym)
      ? params.ym
      : currentTokyoYm();

  // 「주 28시간」 칩(docs/product/41 R4) — `staff_documents.view` 가 있을 때만. 이달 안에 끝나는 7일 창 기준.
  const [badgeStats, payroll, weeklyLimit] = await Promise.all([
    getAdminAttendanceBadgeStats(session, requestedYm),
    getAdminAttendancePayroll(session, requestedYm, localeTag),
    loadWeeklyLimitChips(session, monthWeeklyRange(requestedYm)),
  ]);

  return (
    <AdminShell activeItem="attendance" title={c.headerPayroll}>
      <AttendanceSubnav
        active="payroll"
        monthLabel={payroll.monthLabel}
        c={c}
        ym={payroll.ym}
        localeTag={localeTag}
        badges={{
          queue: {
            n: badgeStats.queueOpen,
            urgent: badgeStats.queueUrgent > 0,
          },
          payroll: { n: payroll.kpi.hourlyTarget },
          transport: { n: badgeStats.transportPending },
        }}
      />

      {payroll.isPrivileged ? (
        <AttendancePayrollClient
          key={payroll.ym}
          ym={payroll.ym}
          monthLabel={payroll.monthLabel}
          initialRows={payroll.rows}
          initialKpi={payroll.kpi}
          locale={locale}
          localeTag={localeTag}
          weeklyLimit={weeklyLimit}
        />
      ) : (
        <AdminNoAccess title={dictionary.admin.shared.noAccessTitle} body={dictionary.admin.shared.noAccessBody} />
      )}
    </AdminShell>
  );
}
