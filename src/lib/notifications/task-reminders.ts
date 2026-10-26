import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTaskParticipants } from "@/lib/notifications/create";
import { tokyoDateOf, tokyoToday } from "@/lib/tasks";
import type { Database } from "@/types/database";

type CandidateRow = {
  id: string;
  organization_id: string;
  title: string;
  due_at: string | null;
  status: string;
};

export type TaskReminderResult = {
  scanned: number;
  dueSoonTasks: number;
  overdueTasks: number;
  notificationsAttempted: number;
};

const EMPTY: TaskReminderResult = {
  scanned: 0,
  dueSoonTasks: 0,
  overdueTasks: 0,
  notificationsAttempted: 0,
};

/**
 * 시간 기반 할 일 알림을 평가해서 퍼뜨린다. 하루 한 번 크론
 * (`/api/tasks/reminders` 참고)에서 실행하도록 만들었으며, 이 두 유형을 만들 수 있는 유일한 경로다.
 *
 * 1차 규칙 (기능의 나머지처럼 도쿄 영업일 기준):
 * - **마감 임박** — `due_at` 도쿄 날짜 == 오늘인 진행 중 할 일 (`open`/`in_progress`).
 *   같은 날 알림 한 번이며, 단계적으로 반복하지 않는다.
 * - **기한 초과** — `due_at` 도쿄 날짜가 오늘보다 앞인 진행 중 할 일.
 *
 * 스팸 방지: notifications 의 `unique (recipient_user_id, dedupe_key)`
 * 제약과 `dedupe_key = task_due_soon|task_overdue:<taskId>` 로 중복을 제거하므로, 각 할 일은
 * 수신자당 마감 임박 하나, 기한 초과 하나까지만 만들어진다 — 크론을 다시 돌려도
 * 이미 알린 할 일에는 아무 일도 일어나지 않는다.
 *
 * 권한/범위: 할 일은 조직 범위이고, 수신자는 정확히 할 일의 참여자다
 * (그래서 개인 비공개 할 일은 작성자에게만 알리고, 공유 할 일은 현재 모든
 * 참여자에게 닿는다 — 그 외 누구에게도 가지 않는다). 행위자가 없는 시스템 알림이므로 작성자는
 * 일부러 포함한다 (남의 활동이 아니라 본인의 마감이므로).
 */
export async function runTaskReminders(
  supabase: SupabaseClient<Database>,
  options: { organizationId?: string } = {},
): Promise<TaskReminderResult> {
  const today = tokyoToday();
  const [ty, tm, td] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);
  // 상한: 내일 00:00 JST 이전에 마감인 것은 오늘 이하이고, 미래 할 일은
  // 마감 임박도 기한 초과도 아니므로 후보 집합에 들어오지 않는다.
  const upperBoundIso = new Date(`${tomorrow}T00:00:00+09:00`).toISOString();

  let query = supabase
    .from("tasks")
    .select("id, organization_id, title, due_at, status")
    .not("due_at", "is", null)
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null)
    .lt("due_at", upperBoundIso);
  if (options.organizationId) {
    query = query.eq("organization_id", options.organizationId);
  }

  const { data, error } = await query;
  if (error || !data) return EMPTY;
  const rows = data as CandidateRow[];
  if (rows.length === 0) return EMPTY;

  // 모든 후보 할 일의 참여자를 한 번의 왕복으로 가져온다 (N+1 방지).
  const taskIds = rows.map((r) => r.id);
  const { data: partData } = await supabase
    .from("task_participants")
    .select("task_id, user_id")
    .in("task_id", taskIds);
  const participantsByTask = new Map<string, string[]>();
  for (const p of (partData ?? []) as Array<{ task_id: string; user_id: string }>) {
    participantsByTask.set(p.task_id, [...(participantsByTask.get(p.task_id) ?? []), p.user_id]);
  }

  let dueSoonTasks = 0;
  let overdueTasks = 0;
  let notificationsAttempted = 0;

  for (const row of rows) {
    const dueDate = tokyoDateOf(row.due_at);
    if (!dueDate) continue;
    const recipients = participantsByTask.get(row.id) ?? [];
    if (recipients.length === 0) continue;

    const overdue = dueDate < today;
    const dueSoon = dueDate === today;
    if (!overdue && !dueSoon) continue;

    const type = overdue ? "task_overdue" : "task_due_soon";
    const event = overdue ? "overdue" : "due_soon";
    if (overdue) overdueTasks += 1;
    else dueSoonTasks += 1;
    notificationsAttempted += recipients.length;

    await notifyTaskParticipants(supabase, {
      organizationId: row.organization_id,
      taskId: row.id,
      recipientUserIds: recipients,
      actorUserId: "", // 시스템 알림 — 행위자 없음, 그래서 모든 참여자가 알림을 받는다
      type,
      dedupeBase: `${type}:${row.id}`, // 할 일당 수신자당 하나, 영구적으로
      payload: { taskId: row.id, taskTitle: row.title, actorUserId: null, event },
    });
  }

  return { scanned: rows.length, dueSoonTasks, overdueTasks, notificationsAttempted };
}
