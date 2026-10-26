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
import { PayrollRoundClient } from "@/components/admin/attendance/payroll-prep/payroll-round-client";
import { PrepSteps, type PrepStage } from "@/components/admin/attendance/payroll-prep/prep-steps";
import { approvalOpen, payOpen } from "@/components/admin/attendance/payroll-prep/round-ui";
import { getPayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { payrollPrepAvailable } from "@/lib/payroll-prep";
import { getPayrollPrep } from "@/lib/payroll-prep-server";
import { isValidYm } from "@/lib/attendance-clock";

// 관리자 · 근태 · 급여 (Slice 4).
// 기존 `getMonthlyPayView` + finalize/reopen/export 서버 액션에 연결한 월별 사용자 급여 검토 화면.
// 월은 공용 근태 서브내비 피커로 제어한다.
// 참고: docs/product/05-admin-web-ia.md → "Attendance / Payroll / Transportation".
export default async function AdminAttendancePayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; stage?: string }>;
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
    isValidYm(params.ym)
      ? params.ym
      : currentTokyoYm();

  // 「주 28시간」 칩(docs/product/41 R4) — `staff_documents.view` 가 있을 때만. 이달 안에 끝나는 7일 창 기준.
  const [badgeStats, payroll, weeklyLimit, prep] = await Promise.all([
    getAdminAttendanceBadgeStats(session, requestedYm),
    getAdminAttendancePayroll(session, requestedYm, localeTag),
    loadWeeklyLimitChips(session, monthWeeklyRange(requestedYm)),
    // 10월분부터 새 계산(급여 준비) — 그 전 달은 지금 급여 검토 표 그대로.
    payrollPrepAvailable(requestedYm) ? getPayrollPrep(session, requestedYm) : Promise.resolve(null),
  ]);
  const showPrep = Boolean(prep?.canView);
  // P5 — 결재는 요청 뒤, 지급은 사장 결재 뒤에 열린다. `?stage=` 가 없으면 회차 상태가 정한다.
  const status = prep?.round.status ?? "preparing";
  const requested = params.stage;
  const stage: PrepStage =
    requested === "prep" || requested === "close"
      ? requested
      : requested === "approval" && approvalOpen(status)
        ? "approval"
        : requested === "pay" && payOpen(status)
          ? "pay"
          : payOpen(status)
            ? "pay"
            : approvalOpen(status)
              ? "approval"
              : prep && prep.allFinalized && prep.rows.length > 0
                ? "prep"
                : "close";
  const prepCopy = getPayrollPrepCopy(locale);

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

      {showPrep && prep ? <PrepSteps ym={payroll.ym} stage={stage} status={status} copy={prepCopy} /> : null}

      {showPrep && prep && stage !== "close" ? (
        <PayrollRoundClient key={payroll.ym} data={prep} locale={locale} localeTag={localeTag} stage={stage} />
      ) : payroll.isPrivileged ? (
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
