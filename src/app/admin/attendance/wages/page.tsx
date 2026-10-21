import { CircleAlert } from "lucide-react";
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

// Admin · Attendance · Hourly Wage Management (Slice 7).
// Per-member hourly rate management with inline live editor wired to
// `setHourlyRate` server action (audit-logged, gated by attendanceCan).
// Past closed rate tiers are non-editable (no retroactive change).
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
    typeof params.ym === "string" && /^\d{4}-\d{2}$/.test(params.ym) ? params.ym : currentTokyoYm();
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
        <div className="card">
          <div className="state">
            <span className="state__ic empty">
              <span className="ic">
                <CircleAlert />
              </span>
            </span>
            <div className="state__t">{c.wageNoDataTitle}</div>
            <div className="state__s">{c.wageNoDataBody}</div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
