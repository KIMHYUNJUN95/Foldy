import { AdminShell } from "@/components/shell/admin-shell";
import { AttendanceSubnav } from "@/components/admin/attendance/attendance-subnav";
import { AttendanceStaffDetail } from "@/components/admin/attendance/attendance-staff-detail";
import {
  currentTokyoYm,
  getAdminAttendanceBadgeStats,
  getAdminStaffDetail,
} from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";
import { loadExpiredResidenceCardUserIds } from "@/lib/staff-documents/server";

// Admin · Attendance · Staff Detail (Slice 6).
// Per-user monthly detail page wired to `getAdminStaffDetail` — header KPIs,
// daily session ledger (click → side panel), payroll + transport summary cards.
// Month is controlled by the shared attendance subnav picker.
export default async function AdminAttendanceStaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ ym?: string }>;
}) {
  const [p, q] = await Promise.all([params, searchParams]);
  const session = await requireAdminPageSession({
    nextPath: `/admin/attendance/staff/${p.userId}`,
  });

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const requestedYm =
    typeof q.ym === "string" && /^\d{4}-\d{2}$/.test(q.ym) ? q.ym : currentTokyoYm();

  const [badgeStats, detail, expiredCardUserIds] = await Promise.all([
    getAdminAttendanceBadgeStats(session, requestedYm),
    getAdminStaffDetail(session, p.userId, requestedYm, localeTag),
    // 재류카드 만료 칩 — 사람 id 만, 칩은 이 화면을 볼 수 있는(isPrivileged) 사람에게만 그린다(docs/product/41 「만료 표시」).
    loadExpiredResidenceCardUserIds(session.organization.id),
  ]);

  const title = c.staffPageTitle(detail.user.name, detail.monthLabel);

  return (
    <AdminShell activeItem="attendance" title={title}>
      <AttendanceSubnav
        active="payroll"
        monthLabel={detail.monthLabel}
        c={c}
        ym={detail.ym}
        localeTag={localeTag}
        monthPickerBasePath={`/admin/attendance/staff/${p.userId}`}
        badges={{
          queue: {
            n: badgeStats.queueOpen,
            urgent: badgeStats.queueUrgent > 0,
          },
          payroll: { n: badgeStats.payrollTargets },
          transport: { n: badgeStats.transportPending },
        }}
      />

      {detail.isPrivileged ? (
        <AttendanceStaffDetail
          data={detail}
          locale={locale}
          localeTag={localeTag}
          cardExpired={expiredCardUserIds.includes(detail.user.id)}
        />
      ) : (
        <AdminNoAccess title={dictionary.admin.shared.noAccessTitle} body={dictionary.admin.shared.noAccessBody} />
      )}
    </AdminShell>
  );
}
