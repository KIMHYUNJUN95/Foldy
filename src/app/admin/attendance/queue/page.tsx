import { AdminShell } from "@/components/shell/admin-shell";
import { AttendanceSubnav } from "@/components/admin/attendance/attendance-subnav";
import { AttendanceQueueClient } from "@/components/admin/attendance/attendance-queue-client";
import {
  currentTokyoYm,
  getAdminAttendanceCorrections,
  getAdminAttendanceBadgeStats,
  getAdminAttendanceQueue,
  listActiveAttendanceStaff,
} from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";

// Admin · Attendance · Review Queue (Slice 2).
// Sessions table + multi-select bulk bar + right-detail session panel.
// Corrections list/panel ships in Slice 3.
// See docs/product/05-admin-web-ia.md → "Attendance / Payroll / Transportation".
export default async function AdminAttendanceQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string; ym?: string; filter?: string; q?: string }>;
}) {
  const [session, params] = await Promise.all([
    requireAdminPageSession({ nextPath: "/admin/attendance/queue" }),
    searchParams,
  ]);

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const carriedYm =
    typeof params.ym === "string" && /^\d{4}-\d{2}$/.test(params.ym) ? params.ym : currentTokyoYm();
  const initialFilter =
    params.filter === "review" ||
    params.filter === "pending" ||
    params.filter === "corr" ||
    params.filter === "all"
      ? params.filter
      : "review";
  const initialSearch = typeof params.q === "string" ? params.q.slice(0, 60) : "";
  const carriedMonthLabel = new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
  }).format(new Date(`${carriedYm}-01T00:00:00+09:00`));

  const [badgeStats, queue, corrections, staff] = await Promise.all([
    getAdminAttendanceBadgeStats(session, carriedYm),
    getAdminAttendanceQueue(session, localeTag, carriedYm),
    getAdminAttendanceCorrections(session, localeTag),
    listActiveAttendanceStaff(session),
  ]);
  const todayTokyo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (
    <AdminShell activeItem="attendance" title={c.headerQueue}>
      <AttendanceSubnav
        active="queue"
        monthLabel={carriedMonthLabel}
        c={c}
        ym={carriedYm}
        localeTag={localeTag}
        preserveMonthQueryKeys={["sessionId"]}
        badges={{
          queue: {
            n: badgeStats.queueOpen,
            urgent: badgeStats.queueUrgent > 0,
          },
          payroll: { n: badgeStats.payrollTargets },
          transport: { n: badgeStats.transportPending },
        }}
      />
      {queue.isPrivileged ? (
        <AttendanceQueueClient
          key={carriedYm}
          initialItems={queue.items}
          initialCorrections={corrections.items}
          initialSessionId={typeof params.sessionId === "string" ? params.sessionId : null}
          initialFilter={initialFilter}
          initialSearch={initialSearch}
          staff={staff}
          defaultDate={todayTokyo}
          locale={locale}
        />
      ) : (
        <AdminNoAccess title={dictionary.admin.shared.noAccessTitle} body={dictionary.admin.shared.noAccessBody} />
      )}
    </AdminShell>
  );
}
