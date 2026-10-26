import { AdminShell } from "@/components/shell/admin-shell";
import { AttendanceSubnav } from "@/components/admin/attendance/attendance-subnav";
import { AdminLiveRefresh } from "@/components/admin/shared/admin-live-refresh";
import { LeaveQueueClient } from "@/components/admin/attendance/leave-queue-client";
import {
  getAdminLeaveQueue,
  type LeaveStatusGroup,
  type LeaveType,
} from "@/lib/annual-leave-approvals-server";
import {
  listAdminLeaveBalances,
  listLeaveApplicants,
  listLeaveDocuments,
  listLeaveLedger,
} from "@/lib/annual-leave-admin-server";
import { getAdminAttendanceBadgeStats } from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";

const STATUS_GROUPS: LeaveStatusGroup[] = ["pending", "approved", "rejectedCancelled", "all"];
const LEAVE_TYPES: LeaveType[] = ["annual", "paid", "special", "other"];

// 관리자 · 근태 · 휴가 승인 검토.
// 하위 탭: 승인 심사 / 팀 캘린더 / 직원 잔여·부여 / 문서 / 대장. 승인자 관리는
// 사용자 화면(/admin/users)에서 모든 역할/권한 부여를 통합하므로, 예전
// 승인자 관리 하위 탭은 제거됐다. 참고: docs/product/26-annual-leave-workflow.md.
export default async function AdminAttendanceLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ statusGroup?: string; type?: string; q?: string; requestId?: string; view?: string; user?: string }>;
}) {
  const [session, params] = await Promise.all([
    requireAdminPageSession({ nextPath: "/admin/attendance/leave" }),
    searchParams,
  ]);

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const lc = dictionary.admin.leaveConsole;

  const statusGroup: LeaveStatusGroup = STATUS_GROUPS.includes(
    params.statusGroup as LeaveStatusGroup,
  )
    ? (params.statusGroup as LeaveStatusGroup)
    : "pending";
  const type: LeaveType | undefined = LEAVE_TYPES.includes(params.type as LeaveType)
    ? (params.type as LeaveType)
    : undefined;
  const search = typeof params.q === "string" ? params.q : undefined;

  // 클라이언트가 상태 그룹 / 유형 / 검색으로 로컬 필터링하고(탭은 링크가 아니라 버튼), 그룹별 건수를
  // 계산하려면 전체 데이터가 필요하므로 여기서는 항상 모든 그룹을 가져온다. URL 의
  // statusGroup/type/search 는 클라이언트의 초기 UI 상태로만 전달한다 (딥링크).
  const [queue, applicants, balances, documents, ledger, badgeStats] = await Promise.all([
    getAdminLeaveQueue(session, { statusGroup: "all" }),
    listLeaveApplicants(session),
    listAdminLeaveBalances(session),
    listLeaveDocuments(session),
    listLeaveLedger(session),
    // 다른 모든 근태 탭이 보여주는 것과 같은 배지 건수. 이게 없으면 검토 큐 / 급여 검토 /
    // 교통비 검토 칩이 이 탭에서만 사라지고, 탭 줄 전체가 왼쪽으로 밀린다.
    getAdminAttendanceBadgeStats(session),
  ]);

  return (
    <AdminShell activeItem="attendance" title={lc.header}>
      <AttendanceSubnav
        active="leave"
        c={c}
        badges={{
          queue: { n: badgeStats.queueOpen, urgent: badgeStats.queueUrgent > 0 },
          payroll: { n: badgeStats.payrollTargets },
          transport: { n: badgeStats.transportPending },
        }}
      />
      {queue.isApprover ? (
        <>
        {/* 새 신청 · 취소 · 다른 승인자 처리가 새로고침 없이 바로 보이게(2026-10-15). */}
        <AdminLiveRefresh table="annual_leave_requests" organizationId={session.organization.id} />
        <LeaveQueueClient
          initialItems={queue.items}
          summary={queue.summary}
          initialStatusGroup={statusGroup}
          initialType={type ?? null}
          initialSearch={search ?? ""}
          initialRequestId={typeof params.requestId === "string" ? params.requestId : null}
          initialView={params.view === "balance" ? "balance" : "review"}
          initialBalanceUserId={params.view === "balance" && typeof params.user === "string" ? params.user : null}
          locale={locale}
          applicants={applicants}
          balances={balances}
          documents={documents}
          ledger={ledger}
          currentUserId={session.user.id}
          currentUserName={session.user.name}
        />
        </>
      ) : (
        <AdminNoAccess title={dictionary.admin.shared.noAccessTitle} body={dictionary.admin.shared.noAccessBody} />
      )}
    </AdminShell>
  );
}
