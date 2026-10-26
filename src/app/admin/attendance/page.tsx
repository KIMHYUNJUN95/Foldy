import { AdminShell } from "@/components/shell/admin-shell";
import { AttendanceSubnav } from "@/components/admin/attendance/attendance-subnav";
import { AttendanceOverview } from "@/components/admin/attendance/attendance-overview";
import { currentTokyoYm, getAdminAttendanceOverview } from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { loadExpiredResidenceCardUserIds } from "@/lib/staff-documents/server";
import { isValidYm } from "@/lib/attendance-clock";

// 관리자 · 근태 개요 (슬라이스 1).
// 셸 서브 탭 바 + KPI 바 + 검토/정정 카드 + 급여/교통비 요약.
// 선택한 달은 공용 근태 서브내비의 월 선택기가 제어한다.
// 참고: docs/product/05-admin-web-ia.md → "Attendance / Payroll / Transportation".
export default async function AdminAttendanceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const [session, params] = await Promise.all([
    requireAdminPageSession({ nextPath: "/admin/attendance" }),
    searchParams,
  ]);

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const requestedYm =
    isValidYm(params.ym)
      ? params.ym
      : currentTokyoYm();
  const data = await getAdminAttendanceOverview(session, localeTag, requestedYm);
  // 재류카드 만료 칩 — 검토 목록을 볼 수 있는(isPrivileged) 사람에게만, 사람 id 만(docs/product/41 「만료 표시」).
  const expiredCardUserIds = data.isPrivileged ? await loadExpiredResidenceCardUserIds(session.organization.id) : [];

  return (
    <AdminShell activeItem="attendance" title={c.headerOverview}>
      <AttendanceSubnav
        active="overview"
        monthLabel={data.monthLabel}
        c={c}
        ym={data.ym}
        localeTag={localeTag}
        badges={{
          queue: { n: data.kpi.reviewSessions + data.kpi.corrOpen, urgent: data.kpi.urgent > 0 },
          payroll: { n: data.kpi.payEstimated },
          transport: { n: data.kpi.trPending },
        }}
      />
      <AttendanceOverview data={data} c={c} localeTag={localeTag} expiredCardUserIds={expiredCardUserIds} />
    </AdminShell>
  );
}
