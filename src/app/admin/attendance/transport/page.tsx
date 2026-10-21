import { AdminShell } from "@/components/shell/admin-shell";
import { AttendanceSubnav } from "@/components/admin/attendance/attendance-subnav";
import { AttendanceTransportClient } from "@/components/admin/attendance/attendance-transport-client";
import {
  currentTokyoYm,
  getAdminAttendanceBadgeStats,
  getAdminAttendanceTransport,
} from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";

// Admin · Attendance · Transport (Slice 5).
// Monthly per-user transport reimbursement review wired to
// `getTransportReportSummaryForAdmin` + `loadAdminTransportDetail` +
// `setTransportReportReview`. Month is controlled by the shared attendance subnav picker.
export default async function AdminAttendanceTransportPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; user?: string }>;
}) {
  const [session, params] = await Promise.all([
    requireAdminPageSession({ nextPath: "/admin/attendance/transport" }),
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

  const [badgeStats, transport] = await Promise.all([
    getAdminAttendanceBadgeStats(session, requestedYm),
    getAdminAttendanceTransport(session, requestedYm, localeTag),
  ]);

  return (
    <AdminShell activeItem="attendance" title={c.headerTransport}>
      <AttendanceSubnav
        active="transport"
        monthLabel={transport.monthLabel}
        c={c}
        ym={transport.ym}
        localeTag={localeTag}
        preserveMonthQueryKeys={["user"]}
        badges={{
          queue: {
            n: badgeStats.queueOpen,
            urgent: badgeStats.queueUrgent > 0,
          },
          payroll: { n: badgeStats.payrollTargets },
          transport: { n: transport.kpi.pendingReview },
        }}
      />

      {transport.isPrivileged ? (
        <AttendanceTransportClient
          key={transport.ym}
          ym={transport.ym}
          monthLabel={transport.monthLabel}
          initialRows={transport.rows}
          initialUserId={typeof params.user === "string" ? params.user : null}
          locale={locale}
          localeTag={localeTag}
        />
      ) : (
        <AdminNoAccess title={dictionary.admin.shared.noAccessTitle} body={dictionary.admin.shared.noAccessBody} />
      )}
    </AdminShell>
  );
}
