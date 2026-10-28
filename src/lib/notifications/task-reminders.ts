import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTaskParticipants } from "@/lib/notifications/create";
import {
  isRecurringOccurrenceDate,
  isStandardRecurrence,
  OCCURRENCE_STATE_WINDOW_DAYS,
  outstandingOverdueOccurrences,
} from "@/lib/tasks-recurrence";
import { tokyoDateOf, tokyoToday, ymdShift } from "@/lib/tokyo-date";
import type { Database } from "@/types/database";

type CandidateRow = {
  id: string;
  organization_id: string;
  title: string;
  due_at: string | null;
  scheduled_date: string | null;
  recurrence_rule: string | null;
  status: string;
};

/** 알림 한 건의 판정 결과. `dedupeBase` 가 같으면 수신자당 한 번만 만들어진다. */
export type ReminderDecision = {
  type: "task_due_soon" | "task_overdue";
  dedupeBase: string;
} | null;

/**
 * 반복 업무의 알림 판정(순수, 2026-10-28).
 *
 * 반복 업무의 `due_at` 은 마감이 아니라 **고정 앵커**라, 일회성처럼 보면 만든 다음 날 「기한 초과」가
 * 가고 `task_overdue:<id>` 키가 그 뒤 모든 알림을 막았다. 이제 회차 상태로 판정한다:
 * - 오늘이 회차이고 아직 열려 있으면 → 마감 임박, 키 `task_due_soon:<id>:<오늘>`.
 *   밀린 회차가 있어도 이것 하나만 보낸다 — 화면도 오늘 한 줄 + 「N일 밀림」 배지로 묶어 보여 준다.
 * - 오늘 회차가 없고(또는 이미 끝났고) 밀린 회차가 있으면 → 기한 초과, 키는 **가장 최근 밀린 회차**
 *   `task_overdue:<id>:<그 날짜>`. 같은 밀림에는 한 번, 새 회차를 또 놓치면 다시 한 번.
 */
export function decideRecurringReminder(args: {
  taskId: string;
  rule: string | null;
  anchor: string | null;
  today: string;
  resolvedDates: ReadonlySet<string>;
}): ReminderDecision {
  const { taskId, rule, anchor, today, resolvedDates } = args;
  if (!anchor || !isStandardRecurrence(rule)) return null;
  const todayIsOpen = isRecurringOccurrenceDate(rule, anchor, today) && !resolvedDates.has(today);
  if (todayIsOpen) return { type: "task_due_soon", dedupeBase: `task_due_soon:${taskId}:${today}` };
  const overdue = outstandingOverdueOccurrences(rule, anchor, today, resolvedDates);
  const newest = overdue[overdue.length - 1];
  if (!newest) return null;
  return { type: "task_overdue", dedupeBase: `task_overdue:${taskId}:${newest}` };
}

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
 * **반복 업무는 회차 기준이다(2026-10-28)** — `decideRecurringReminder` 참고. 키에 회차 날짜가
 * 붙어(`…:<taskId>:<YYYY-MM-DD>`) 회차마다 한 번씩 갈 수 있다. 이 크론은 회차를 행으로 만들지
 * 않는다(읽기만).
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
  const tomorrow = ymdShift(today, 1);
  // 상한: 내일 00:00 JST 이전에 마감인 것은 오늘 이하이고, 미래 할 일은
  // 마감 임박도 기한 초과도 아니므로 후보 집합에 들어오지 않는다.
  const upperBoundIso = new Date(`${tomorrow}T00:00:00+09:00`).toISOString();

  // 일회성 후보 — 반복 업무는 아래에서 회차 기준으로 따로 본다.
  let query = supabase
    .from("tasks")
    .select("id, organization_id, title, due_at, scheduled_date, recurrence_rule, status")
    .not("due_at", "is", null)
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null)
    .lt("due_at", upperBoundIso);
  if (options.organizationId) {
    query = query.eq("organization_id", options.organizationId);
  }
  // 반복 후보 — 앵커가 `due_at` 이 아니라 `scheduled_date` 에만 있을 수도 있어 날짜 조건 없이 읽는다.
  // 반복 행은 완료돼도 열린 채로 남으므로(2026-07-30) 상태 조건이 그대로 맞다.
  let recurringQuery = supabase
    .from("tasks")
    .select("id, organization_id, title, due_at, scheduled_date, recurrence_rule, status")
    .not("recurrence_rule", "is", null)
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null);
  if (options.organizationId) {
    recurringQuery = recurringQuery.eq("organization_id", options.organizationId);
  }

  const [oneOffRes, recurringRes] = await Promise.all([query, recurringQuery]);
  if (oneOffRes.error || !oneOffRes.data) return EMPTY;
  const oneOffs = (oneOffRes.data as CandidateRow[]).filter(
    (r) => !isStandardRecurrence(r.recurrence_rule),
  );
  const recurring = ((recurringRes.error ? [] : recurringRes.data ?? []) as CandidateRow[]).filter(
    (r) => isStandardRecurrence(r.recurrence_rule),
  );
  const rows = [...oneOffs, ...recurring];
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

  // 반복 후보의 회차 상태(화면과 같은 창). 읽기에 실패하면 반복 알림은 이번 회차에 건너뛴다 —
  // 상태 없이 판정하면 끝낸 회차까지 «밀림» 으로 보고 틀린 알림을 보낸다.
  const resolvedByTask = new Map<string, Set<string>>();
  let recurringStatesOk = recurring.length === 0;
  if (recurring.length > 0) {
    const since = ymdShift(today, -OCCURRENCE_STATE_WINDOW_DAYS);
    recurringStatesOk = true;
    const ids = recurring.map((r) => r.id);
    outer: for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      for (let from = 0; ; from += 1000) {
        const { data: stateData, error: stateError } = await supabase
          .from("task_occurrence_state")
          .select("task_id, occurrence_date")
          .in("task_id", chunk)
          .gte("occurrence_date", since)
          .order("task_id", { ascending: true })
          .order("occurrence_date", { ascending: true })
          .range(from, from + 999);
        if (stateError) {
          recurringStatesOk = false;
          break outer;
        }
        const stateRows = (stateData ?? []) as Array<{ task_id: string; occurrence_date: string }>;
        for (const r of stateRows) {
          const set = resolvedByTask.get(r.task_id) ?? new Set<string>();
          set.add(r.occurrence_date);
          resolvedByTask.set(r.task_id, set);
        }
        if (stateRows.length < 1000) break;
      }
    }
  }

  let dueSoonTasks = 0;
  let overdueTasks = 0;
  let notificationsAttempted = 0;

  for (const row of rows) {
    const recipients = participantsByTask.get(row.id) ?? [];
    if (recipients.length === 0) continue;

    let decision: ReminderDecision = null;
    if (isStandardRecurrence(row.recurrence_rule)) {
      if (!recurringStatesOk) continue;
      decision = decideRecurringReminder({
        taskId: row.id,
        rule: row.recurrence_rule,
        anchor: tokyoDateOf(row.due_at) ?? row.scheduled_date,
        today,
        resolvedDates: resolvedByTask.get(row.id) ?? new Set(),
      });
    } else {
      const dueDate = tokyoDateOf(row.due_at);
      if (dueDate && dueDate < today) {
        decision = { type: "task_overdue", dedupeBase: `task_overdue:${row.id}` };
      } else if (dueDate === today) {
        decision = { type: "task_due_soon", dedupeBase: `task_due_soon:${row.id}` };
      }
    }
    if (!decision) continue;

    const overdue = decision.type === "task_overdue";
    if (overdue) overdueTasks += 1;
    else dueSoonTasks += 1;
    notificationsAttempted += recipients.length;

    await notifyTaskParticipants(supabase, {
      organizationId: row.organization_id,
      taskId: row.id,
      recipientUserIds: recipients,
      actorUserId: "", // 시스템 알림 — 행위자 없음, 그래서 모든 참여자가 알림을 받는다
      type: decision.type,
      // 일회성은 할 일당 수신자당 하나(영구), 반복은 회차 날짜까지 붙여 회차마다 하나.
      dedupeBase: decision.dedupeBase,
      payload: {
        taskId: row.id,
        taskTitle: row.title,
        actorUserId: null,
        event: overdue ? "overdue" : "due_soon",
      },
    });
  }

  return { scanned: rows.length, dueSoonTasks, overdueTasks, notificationsAttempted };
}
