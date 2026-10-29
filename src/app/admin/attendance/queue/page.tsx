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
import { isValidYm } from "@/lib/attendance-clock";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { attendanceQueueLiveSources } from "@/lib/live-sources";

// 관리자 · 근태 · 검토 대기열 (슬라이스 2).
// 세션 표 + 다중 선택 일괄 바 + 오른쪽 세션 상세 패널.
// 정정 목록/패널은 슬라이스 3에서 제공한다.
// 참고: docs/product/05-admin-web-ia.md → "Attendance / Payroll / Transportation".
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
    isValidYm(params.ym) ? params.ym : currentTokyoYm();
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
      <LiveRefresh sources={attendanceQueueLiveSources(session.organization.id)} />
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
