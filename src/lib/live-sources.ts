/**
 * 화면별 실시간 구독 묶음 (2026-10-29) — `<LiveRefresh sources={…} />` 에 넘긴다.
 *
 * 필터는 Supabase realtime `postgres_changes` 형식(`칸=eq.값`). 조직 칸이 없는 테이블(`task_participants` ·
 * `task_updates`)은 나 · 그 할 일로 거른다. 어느 경우든 RLS 가 볼 수 있는 행의 신호만 보낸다.
 * 테이블은 `supabase_realtime` publication 에 있어야 한다(`202610290001_enable_ops_realtime.sql`).
 */
export type LiveSource = { table: string; filter: string };

const byOrg = (table: string, organizationId: string): LiveSource => ({
  table,
  filter: `organization_id=eq.${organizationId}`,
});

/** 할 일 목록 · 홈 카드. 남이 나를 새 할 일에 넣으면 `tasks` INSERT 는 RLS 에 막혀(아직 참여자가 아님) 안 오고 참여자 행이 온다. */
export function taskLiveSources(organizationId: string, userId: string): LiveSource[] {
  return [
    byOrg("tasks", organizationId),
    byOrg("task_occurrence_state", organizationId),
    { table: "task_participants", filter: `user_id=eq.${userId}` },
  ];
}

/** 할 일 상세 — 목록 묶음 + 그 할 일의 업데이트(댓글 · 사진). */
export function taskDetailLiveSources(organizationId: string, userId: string, taskId: string): LiveSource[] {
  return [...taskLiveSources(organizationId, userId), { table: "task_updates", filter: `task_id=eq.${taskId}` }];
}

/** 주문 · 수리 · 분실물 요청. */
export function requestLiveSources(organizationId: string): LiveSource[] {
  return [
    byOrg("order_requests", organizationId),
    byOrg("maintenance_reports", organizationId),
    byOrg("lost_items", organizationId),
  ];
}

/** 내 알림 — 종 숫자 · 사이드 메뉴 배지. 레이아웃에서 구독한다. */
export function notificationLiveSources(userId: string): LiveSource[] {
  return [{ table: "notifications", filter: `recipient_user_id=eq.${userId}` }];
}

/**
 * 근태 대기열(확인할 출퇴근 기록 · 정정 · 교통비 · 연차) · 내 신청 상태. 출퇴근 기록은 RLS 가 직원에겐 자기 것만,
 * 근태 관리자에겐 조직 전체를 보여 준다 — 신호도 그만큼만 온다.
 */
export function attendanceQueueLiveSources(organizationId: string): LiveSource[] {
  return [
    byOrg("attendance_sessions", organizationId),
    byOrg("attendance_correction_requests", organizationId),
    byOrg("transport_reimbursement_reports", organizationId),
    byOrg("annual_leave_requests", organizationId),
  ];
}
