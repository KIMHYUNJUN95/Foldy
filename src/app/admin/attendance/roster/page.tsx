import { AdminShell } from "@/components/shell/admin-shell";
import { AttendanceSubnav } from "@/components/admin/attendance/attendance-subnav";
import { AttendanceRosterClient } from "@/components/admin/attendance/attendance-roster-client";
import { getAttendanceRoster } from "@/lib/attendance-roster";
import { currentTokyoYm, getAdminAttendanceBadgeStats } from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { dayWeeklyRange, loadWeeklyLimitChips } from "@/lib/staff-documents/weekly-limit-server";
import { loadExpiredResidenceCardUserIds } from "@/lib/staff-documents/server";

function tokyoDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function clampRosterDate(input: string | undefined, todayDate: string): string {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return todayDate;
  if (input > todayDate) return todayDate;

  const ninetyDaysAgo = new Date(`${todayDate}T00:00:00+09:00`);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const minDate = tokyoDateKey(ninetyDaysAgo);
  return input >= minDate ? input : todayDate;
}

function dateLabel(dateKey: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));
}

export default async function AdminAttendanceRosterPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const [session, params] = await Promise.all([
    requireAdminPageSession({ nextPath: "/admin/attendance/roster" }),
    searchParams,
  ]);

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const todayDate = tokyoDateKey();
  const operatingDate = clampRosterDate(params.date, todayDate);
  const carriedYm = currentTokyoYm();

  // 「주 28시간」 칩(docs/product/41 R4) — `staff_documents.view` 가 있을 때만 읽는다. 그날까지 최근 일주일 안에 끝나는 7일 창.
  const [badgeStats, rosterDay, weeklyLimit, expiredCardUserIds] = await Promise.all([
    getAdminAttendanceBadgeStats(session, carriedYm),
    getAttendanceRoster(session.organization.id, operatingDate, localeTag),
    loadWeeklyLimitChips(session, dayWeeklyRange(operatingDate)),
    // 재류카드 만료 칩 — 근태 관리(`attendance.manage`) 하는 사람에게만, 사람 id 만(docs/product/41 「만료 표시」).
    session.capabilities.includes("attendance.manage")
      ? loadExpiredResidenceCardUserIds(session.organization.id)
      : Promise.resolve<string[]>([]),
  ]);

  return (
    <AdminShell activeItem="attendance" title={c.headerRoster}>
      <AttendanceSubnav
        active="roster"
        monthLabel={dateLabel(rosterDay.operatingDate, localeTag)}
        c={c}
        localeTag={localeTag}
        datePicker={{
          date: rosterDay.operatingDate,
          todayDate,
          basePath: "/admin/attendance/roster",
        }}
        badges={{
          roster: { n: rosterDay.counts.working + rosterDay.counts.on_break },
          queue: {
            n: badgeStats.queueOpen,
            urgent: badgeStats.queueUrgent > 0,
          },
          payroll: { n: badgeStats.payrollTargets },
          transport: { n: badgeStats.transportPending },
        }}
      />
      <AttendanceRosterClient
        key={rosterDay.operatingDate}
        initialRosterDay={rosterDay}
        initialTodayDate={todayDate}
        locale={locale}
        localeTag={localeTag}
        weeklyLimit={weeklyLimit}
        expiredCardUserIds={expiredCardUserIds}
      />
    </AdminShell>
  );
}
