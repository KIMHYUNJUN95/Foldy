"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notifyTaskParticipants } from "@/lib/notifications/create";
import type { TaskNotificationPayload } from "@/lib/notifications/types";
import {
  canEditTaskCore,
  getShareableUsers,
  getTaskScope,
  getTaskDetail,
  getVisibleTasks,
  normalizeTaskDateTime,
  resolveRecurrenceRule,
  taskAnchorDateInput,
  taskNeedsRecurrenceDate,
  taskTimeWithoutDate,
  tokyoDateOf,
  tokyoToday,
  ymdShift,
  taskAnchorDate,
  type TaskDetail,
  type TaskRecord,
} from "@/lib/tasks";
import {
  canMoveRecurringTo,
  isRecurringOccurrenceDate,
  isStandardRecurrence,
} from "@/lib/tasks-recurrence";
import {
  absorbEarlierOccurrences,
  releaseAbsorbedOccurrences,
  resolveCompletionOccurrence,
  clearOccurrenceState,
  completeOccurrence,
  resolvedOccurrenceDates,
  setOccurrenceOrders,
  setTaskSortOrders,
  skipOccurrences,
} from "@/lib/task-occurrences";
import { cleanupRemovedTaskImages, mergeTaskImageUrls } from "@/lib/task-images";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { isOwnerOrPlatformDeveloper, isPlatformDeveloper } from "@/config/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { bestEffortWrite, mustWrite } from "@/lib/db-write-guard";
import type { Database } from "@/types/database";

type Session = NonNullable<Awaited<ReturnType<typeof getCurrentAppSession>>>;

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}
function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}
const PRIORITIES = new Set(["normal", "important", "urgent", "medium"]);


const detailPath = (id: string, error?: string) =>
  `/mobile/tasks/${id}${error ? `?error=${error}` : ""}`;

// Project tasks are shown on their project page too, so a status change there must revalidate it —
// otherwise the checkbox/progress in the project detail view won't refresh (only Today/detail did).
function revalidateProjectPath(projectId: string | null) {
  if (projectId) revalidatePath(`/mobile/tasks/projects/${projectId}`);
}

// getTaskDetail uses the RLS-scoped client, so a non-null result already proves the
// acting user is a participant. Author actions additionally check authorship.
async function requireSessionAndTask(taskId: string): Promise<{
  session: Session;
  task: TaskDetail;
}> {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  const task = await getTaskDetail(session, taskId);
  if (!task) {
    redirect("/mobile/tasks");
  }
  return { session, task };
}

async function requireSession(): Promise<Session> {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  return session;
}

// "Overdue" for the Today-tab prompt: the caller's own (authored), active, non-project task whose
// due Tokyo date is before today — mirrors the Today view's overdue section. Scoped to authored
// tasks so the bulk actions never reschedule/delete someone else's shared task.
function isOverdueOwned(t: TaskRecord, today: string, userId: string): boolean {
  if (t.projectId || t.createdByUserId !== userId) return false;
  if (t.status === "completed" || t.status === "cancelled") return false;
  // Recurring overdue is per-occurrence (task_occurrence_state), handled by the carry/skip actions
  // below — never by the row-due bulk actions (2026-07-30 롤포워드 폐지).
  if (isStandardRecurrence(t.recurrenceRule)) return false;
  const due = tokyoDateOf(t.dueAt);
  return !!due && due < today;
}

/**
 * "일정변경" — move the selected overdue tasks to `targetDate` (YYYY-MM-DD, Tokyo).
 * `taskIds` are the IDs the user chose; server re-validates each is truly overdue + owned.
 */
export async function rescheduleOverdueTo(targetDate: string, taskIds: string[]) {
  const session = await requireSession();
  const today = tokyoToday();
  const allowed = new Set(taskIds);
  const overdue = (await getVisibleTasks(session)).filter(
    (t) => isOverdueOwned(t, today, session.user.id) && allowed.has(t.id),
  );
  if (overdue.length === 0) return;
  const supabase = getSupabaseServiceClient();
  const orgId = session.organization.id;
  for (const t of overdue) {
    // One-off only — recurring is excluded by isOverdueOwned (handled per-occurrence).
    const dueAt = new Date(`${targetDate}T${t.timeLabel || "00:00"}:00+09:00`).toISOString();
    await supabase
      .from("tasks")
      .update({ due_at: dueAt })
      .eq("id", t.id)
      .eq("organization_id", orgId);
  }
  revalidatePath("/mobile/tasks");
}

/**
 * "지난 미완료 삭제" — soft-delete the selected overdue one-off tasks. Recurring tasks are excluded
 * from this path (isOverdueOwned) — their overdue occurrences are cleared via skipOverdueOccurrences.
 */
export async function dismissOverdueTasks(taskIds: string[]) {
  const session = await requireSession();
  const today = tokyoToday();
  const allowed = new Set(taskIds);
  const overdue = (await getVisibleTasks(session)).filter(
    (t) => isOverdueOwned(t, today, session.user.id) && allowed.has(t.id),
  );
  if (overdue.length === 0) return;
  const supabase = getSupabaseServiceClient();
  const orgId = session.organization.id;
  for (const t of overdue) {
    await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", t.id)
      .eq("organization_id", orgId);
  }
  revalidatePath("/mobile/tasks");
}

/**
 * 반복 작업의 **한 회차만** 건너뛰기 / 되돌리기 (2026-07-30).
 *
 * 목록에서 반복 카드를 삭제하면 시리즈 전체(`tasks` 행)가 사라져, "오늘만 못 한다"를 표현할 방법이
 * 없었다. 오버듀 회차에는 이미 `skipped` 수단이 있었지만 **오늘/내일 회차에는 배선이 없었다** —
 * 여기서 그 구멍을 메운다. 저장소는 기존 `task_occurrence_state` 를 그대로 쓴다.
 *
 * 날짜는 **절대 클라이언트를 믿지 않고** 규칙에서 다시 계산해 실제 회차인지 확인한다. 아니면 조용히
 * 무시한다(임의 날짜로 상태 행을 심을 수 없게).
 */
function isOccurrenceDate(task: TaskDetail, occurrenceDate: string): boolean {
  return isRecurringOccurrenceDate(
    task.recurrenceRule,
    recurringAnchorDate(task),
    occurrenceDate,
  );
}

/** "이 날짜만 건너뛰기" — 그 회차만 `skipped`, 반복은 예정대로 계속된다. */
export async function skipOccurrenceOn(taskId: string, occurrenceDate: string) {
  const id = String(taskId ?? "").trim();
  const date = String(occurrenceDate ?? "").trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const { session, task } = await requireSessionAndTask(id);
  if (!isOccurrenceDate(task, date)) return;
  const resolved = await resolvedOccurrenceDates(id);
  if (resolved.has(date)) return;
  await skipOccurrences({ taskId: id, organizationId: session.organization.id, dates: [date] });
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
}

/**
 * 건너뛰기 되돌리기(토스트의 "실행 취소").
 *
 * `clearOccurrenceState` 는 상태 종류를 가리지 않고 지운다. 사용자가 방금 누른 건너뛰기를 곧바로
 * 되돌리는 용도로만 노출하므로 실무상 문제는 없지만, 그 사이 같은 회차가 완료 처리됐다면 완료가
 * 풀린다는 점은 알고 있어야 한다(회차 상태는 한 칸뿐이라 종류별 삭제가 불가능하다).
 */
export async function unskipOccurrenceOn(taskId: string, occurrenceDate: string) {
  const id = String(taskId ?? "").trim();
  const date = String(occurrenceDate ?? "").trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const { task } = await requireSessionAndTask(id);
  if (!isOccurrenceDate(task, date)) return;
  await clearOccurrenceState(id, date);
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
}

/**
 * 결과를 돌려준다 — 호출부가 «무슨 일이 일어났는지» 토스트로 말할 수 있어야 하기 때문이다.
 * 오늘 회차가 이미 열려 있으면 새로 생기는 항목이 없어서, 예전에는 눌러도 화면상 아무 일도
 * 일어나지 않는 것처럼 보였다(지연 카드만 조용히 사라졌다).
 */
export type CarryOutcome = { moved: number; carried: boolean };

function otherParticipantIds(task: TaskDetail, actorUserId: string): string[] {
  return task.participants.map((p) => p.userId).filter((uid) => uid !== actorUserId);
}

async function notify(
  taskId: string,
  recipientUserIds: string[],
  actorUserId: string,
  organizationId: string,
  type: "task_shared" | "task_updated" | "task_completed",
  event: TaskNotificationPayload["event"],
  taskTitle: string,
  dedupeBase: string,
) {
  if (recipientUserIds.length === 0) return;
  await notifyTaskParticipants(getSupabaseServiceClient(), {
    organizationId,
    taskId,
    recipientUserIds,
    actorUserId,
    type,
    dedupeBase,
    payload: { taskId, taskTitle, actorUserId, event },
  });
}

export async function updateTaskCore(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const { session, task } = await requireSessionAndTask(id);
  if (!canEditTaskCore(session, task)) {
    redirect(detailPath(id, "forbidden"));
  }

  const title = cleanText(formData.get("title"));
  if (!title) {
    redirect(detailPath(id, "missing_title"));
  }
  const description = cleanText(formData.get("description"));
  let scheduledDate = cleanText(formData.get("scheduledDate"));
  const dueDate = cleanText(formData.get("dueDate"));
  const time = cleanText(formData.get("time"));
  const durationRaw = cleanText(formData.get("durationMinutes"));
  const priorityRaw = cleanText(formData.get("priority"));
  const repeatRaw = cleanText(formData.get("repeat"));
  const tags = parseStringArray(cleanText(formData.get("tagsJson")))
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
  // Project tasks allow up to 20 photos; regular tasks keep the standard 5. Photos the task already
  // has survive the cap (e.g. moved out of a project) — only new additions are capped.
  const imageUrls = mergeTaskImageUrls(
    task.imageUrls,
    formData.getAll("imageUrls").map(String),
    !!task.projectId,
  );
  const ctxPropertyId = cleanText(formData.get("ctxPropertyId")) || null;
  const ctxRoomId = cleanText(formData.get("ctxRoomId")) || null;
  const ctxReservationId = cleanText(formData.get("ctxReservationId")) || null;
  const ctxGuestName = cleanText(formData.get("ctxGuestName")) || null;
  const nextRecurrenceRule = resolveRecurrenceRule(repeatRaw, task.recurrenceRule);
  // A recurrence needs a date anchor; a repeat with no date anchors to today (Todoist), not rejected.
  if (nextRecurrenceRule && !scheduledDate && !dueDate) scheduledDate = tokyoToday();
  // A specific time needs a date anchor — reject rather than silently drop it (back to edit).
  if (taskTimeWithoutDate({ scheduledDate, dueDate, time })) {
    redirect(`/mobile/tasks/${id}/edit?error=time_needs_date`);
  }
  // One shared rule for date/time persistence (see lib/tasks normalizeTaskDateTime) — keeps
  // create and edit identical: toggling all-day clears time cleanly, no stale time_label/due_at.
  const { scheduledDate: sched, dueAt, allDay, timeLabel } = normalizeTaskDateTime({
    scheduledDate,
    dueDate,
    time,
  });
  // Duration is a time-block length (1–1440 min) and is only meaningful with a time-of-day.
  const durationParsed = /^\d+$/.test(durationRaw) ? Number(durationRaw) : null;
  const durationMinutes =
    durationParsed && durationParsed >= 1 && durationParsed <= 1440 ? durationParsed : null;
  const finalDuration = timeLabel ? durationMinutes : null;
  const anchorDate = taskAnchorDateInput({ scheduledDate: sched, dueAt });
  if (taskNeedsRecurrenceDate(nextRecurrenceRule, anchorDate)) {
    redirect(`/mobile/tasks/${id}/edit?error=repeat_needs_date`);
  }

  const supabase = getSupabaseServiceClient();
  const update: Database["public"]["Tables"]["tasks"]["Update"] = {
    title,
    description: description || null,
    scheduled_date: sched,
    due_at: dueAt,
    all_day: allDay,
    time_label: timeLabel,
    duration_minutes: finalDuration,
    priority: PRIORITIES.has(priorityRaw) ? priorityRaw : "normal",
    // `custom` is kept only if this task already had it; non-custom tasks can't become custom.
    recurrence_rule: nextRecurrenceRule,
    recurrence_series_id:
      task.recurrenceSeriesId ?? (nextRecurrenceRule ? task.id : null),
    recurrence_instance_date:
      task.recurrenceSeriesId || nextRecurrenceRule
        ? anchorDate ?? task.recurrenceInstanceDate ?? null
        : null,
    tags,
    image_urls: imageUrls,
    property_id: ctxPropertyId,
    room_id: ctxRoomId,
    reservation_id: ctxReservationId,
    guest_name: ctxGuestName,
  };
  // Files the author detached in this edit (server-truth previous set minus the new set).
  const removedImageUrls = task.imageUrls.filter((u) => !imageUrls.includes(u));
  const { error } = await supabase.from("tasks").update(update).eq("id", id);
  if (error) {
    redirect(detailPath(id, "save_failed"));
  }
  // Only after the DB no longer references them, hard-delete the detached files.
  await cleanupRemovedTaskImages(supabase, removedImageUrls, session.organization.id);
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: id,
        created_by_user_id: session.user.id,
        update_type: "system_edited",
      })
  );
  await notify(
    id,
    otherParticipantIds(task, session.user.id),
    session.user.id,
    session.organization.id,
    "task_updated",
    "edited",
    title,
    `task_edited:${id}:${Date.now()}`,
  );
  redirect(detailPath(id));
}

async function setInbox(formData: FormData, isInbox: boolean) {
  const id = cleanText(formData.get("taskId"));
  await requireSessionAndTask(id);
  const supabase = getSupabaseServiceClient();
  const moved = await mustWrite(
    "task: toggle inbox",
    supabase.from("tasks").update({ is_inbox: isInbox }).eq("id", id),
  );
  redirect(moved ? detailPath(id) : detailPath(id, "save_failed"));
}
export async function moveTaskToInbox(formData: FormData) {
  await setInbox(formData, true);
}
export async function moveTaskOutOfInbox(formData: FormData) {
  await setInbox(formData, false);
}

// Allowed list views for the swipe-action return redirect (keeps the user on the tab they swiped
// from). Mirrors the page's VIEWS allow-list.
// "sent" 는 구 탭 키(→ instr). 되돌아오기 쿼리에 남아 있을 수 있어 계속 받아 준다.
const LIST_VIEWS = new Set(["today", "tomorrow", "inbox", "instr", "sent", "completed", "calendar"]);
function listPathForView(formData: FormData, error?: string): string {
  const view = cleanText(formData.get("view"));
  const base = LIST_VIEWS.has(view) ? `/mobile/tasks?view=${view}` : "/mobile/tasks";
  if (!error) return base;
  return `${base}${base.includes("?") ? "&" : "?"}moveError=${error}`;
}

// Fields to anchor a task to `date` (Tokyo YYYY-MM-DD) via due_at, preserving any time-of-day.
// Clears scheduled_date so due_at is the single anchor.
//
// **`recurrence_instance_date` 는 여기서 절대 건드리지 않는다.** 반복 시리즈의 앵커는 고정이고
// (2026-07-30 롤포워드 폐지), 밀린 회차는 앵커부터 계산되므로 앵커를 옮기면 지연 백로그가 통째로
// 사라진다. 호출부(이동 액션)가 반복 업무를 아예 거절하므로 여기까지 오지도 않는다. 앵커를 바꾸는
// 정당한 경로는 사용자가 명시적으로 날짜를 고치는 편집(`updateTaskCore`)뿐이다.
function anchorToDate(task: TaskDetail, date: string): Database["public"]["Tables"]["tasks"]["Update"] {
  const dueAt = new Date(`${date}T${task.timeLabel ?? "00:00"}:00+09:00`).toISOString();
  return {
    due_at: dueAt,
    all_day: !task.timeLabel,
    scheduled_date: null,
    is_inbox: false,
  };
}

// "To today" swipe action: anchor the task to the Tokyo operating date and pull it
// out of Inbox. Returns to the originating tab so the card moves into Today.
export async function moveTaskToToday(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const { task } = await requireSessionAndTask(id);
  const today = tokyoToday();
  // 반복 업무는 이 이동을 아예 거절한다(2026-08-25). 이동은 `due_at`(=시리즈 앵커)을 다시 쓰는데,
  // 반복 앵커는 «고정»이 계약이고(2026-07-30 롤포워드 폐지) 밀린 회차는 앵커부터 계산되므로,
  // 앵커를 오늘로 당기는 순간 시리즈 위상이 바뀌고 쌓여 있던 지연 백로그가 통째로 사라진다.
  // 반복은 날짜 단위 처리(회차 건너뛰기 / 오늘로 가져오기)로 다룬다.
  if (isStandardRecurrence(task.recurrenceRule)) {
    redirect(listPathForView(formData, "recurring_series"));
  }
  // 위 가드가 반복을 먼저 걸러내므로 실질적으로 도달하지 않지만, 방어적으로 남겨 둔다(2026-07-30).
  if (!canMoveRecurringTo(task.recurrenceRule, taskAnchorDate(task), today)) {
    redirect(listPathForView(formData, "duplicate_occurrence"));
  }
  const supabase = getSupabaseServiceClient();
  // 실패하면 스와이프해도 카드가 안 움직인다 — 조용히 목록으로 돌려보내면 「앱이 고장났다」로 읽힌다.
  const moved = await mustWrite(
    "task: move to today",
    supabase.from("tasks").update(anchorToDate(task, today)).eq("id", id),
  );
  redirect(listPathForView(formData, moved ? undefined : "save_failed"));
}

// "To tomorrow" swipe action (Today tab): defer the task to the Tokyo next operating date and pull
// it out of Inbox. Returns to the originating tab so the card moves into Tomorrow.
export async function moveTaskToTomorrow(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const { task } = await requireSessionAndTask(id);
  const tomorrow = ymdShift(tokyoToday(), 1);
  // `moveTaskToToday` 와 같은 이유로 반복 업무는 거절한다 — 고정 앵커 계약 + 지연 백로그 소실.
  if (isStandardRecurrence(task.recurrenceRule)) {
    redirect(listPathForView(formData, "recurring_series"));
  }
  if (!canMoveRecurringTo(task.recurrenceRule, taskAnchorDate(task), tomorrow)) {
    redirect(listPathForView(formData, "duplicate_occurrence"));
  }
  const supabase = getSupabaseServiceClient();
  // 실패하면 스와이프해도 카드가 안 움직인다 — 조용히 목록으로 돌려보내면 「앱이 고장났다」로 읽힌다.
  const moved = await mustWrite(
    "task: move to tomorrow",
    supabase.from("tasks").update(anchorToDate(task, tomorrow)).eq("id", id),
  );
  redirect(listPathForView(formData, moved ? undefined : "save_failed"));
}

// The occurrence date a recurring complete/reopen targets when the caller passes none: the task's
// FIXED anchor (recurrence_instance_date), falling back to its due/scheduled date, then today.
function recurringAnchorDate(task: TaskRecord): string {
  return task.recurrenceInstanceDate ?? tokyoDateOf(task.dueAt) ?? task.scheduledDate ?? tokyoToday();
}

// Mark a task complete. RECURRING (2026-07-30): completion never touches the row — it records the
// given occurrence date in `task_occurrence_state` (no roll-forward), so every scheduled date stays
// visible and independently completable. ONE-OFF: sets status + completion stamps as before. Both
// log a `completed` update + notify participants. Programmatic (list card / detail view / calendar).
// Returns the occurrence date a recurring completion actually recorded (it differs from the passed
// date on a non-occurrence day) — undo must reopen that date.
export async function completeTask(taskId: string, occurrenceDate?: string): Promise<string | undefined> {
  const id = String(taskId ?? "").trim();
  if (!id) return;
  const { session, task } = await requireSessionAndTask(id);
  const supabase = getSupabaseServiceClient();

  if (isStandardRecurrence(task.recurrenceRule)) {
    // 콘솔 `completeInternal` 과 같은 규칙 — 회차가 아닌 날짜면 가장 오래된 미해결 회차로 정산.
    const occ = await resolveCompletionOccurrence({
      taskId: id,
      rule: task.recurrenceRule,
      anchor: taskAnchorDate(task),
      requested: String(occurrenceDate ?? "").trim() || recurringAnchorDate(task),
    });
    await completeOccurrence({
      taskId: id,
      organizationId: session.organization.id,
      occurrenceDate: occ,
      userId: session.user.id,
    });
    // 밀린 회차는 이 완료가 흡수한다 — 콘솔 `completeInternal` 과 같은 규칙(2026-09-08).
    await absorbEarlierOccurrences({
      taskId: id,
      organizationId: session.organization.id,
      rule: task.recurrenceRule,
      anchor: taskAnchorDate(task),
      completedDate: occ,
    });
    await bestEffortWrite(
      "task_updates: insert",
      supabase.from("task_updates").insert({
          task_id: id,
          created_by_user_id: session.user.id,
          update_type: "completed",
        })
    );
    await notify(
      id,
      otherParticipantIds(task, session.user.id),
      session.user.id,
      session.organization.id,
      "task_completed",
      "completed",
      task.title,
      `task_completed:${id}:${Date.now()}`,
    );
    revalidatePath("/mobile/tasks");
    revalidatePath(detailPath(id));
    revalidateProjectPath(task.projectId);
    return occ;
  }

  await supabase
    .from("tasks")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by_user_id: session.user.id,
    })
    .eq("id", id);
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: id,
        created_by_user_id: session.user.id,
        update_type: "completed",
      })
  );
  await notify(
    id,
    otherParticipantIds(task, session.user.id),
    session.user.id,
    session.organization.id,
    "task_completed",
    "completed",
    task.title,
    `task_completed:${id}:${Date.now()}`,
  );
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
  revalidateProjectPath(task.projectId);
}

// Re-open a completed task: clear status + completion stamps and log a `reopened` update. No
// notification (re-opening is a quiet correction, typically the same user undoing a tap). Used by
// the undo toast and the detail view's "다시 열기" button.
export async function reopenTask(taskId: string, occurrenceDate?: string) {
  const id = String(taskId ?? "").trim();
  if (!id) return;
  const { session, task } = await requireSessionAndTask(id);
  const supabase = getSupabaseServiceClient();

  // RECURRING (2026-07-30): reopening clears that occurrence's recorded state so it becomes open
  // again (the row was never touched by completion). ONE-OFF: clears the row's completion stamps.
  if (isStandardRecurrence(task.recurrenceRule)) {
    const occ = String(occurrenceDate ?? "").trim() || recurringAnchorDate(task);
    await clearOccurrenceState(id, occ);
    // 그 완료가 흡수했던 밀린 회차도 되살린다 — 콘솔 `reopenInternal` 과 같은 규칙.
    await releaseAbsorbedOccurrences(id, occ);
    await bestEffortWrite(
      "task_updates: insert",
      supabase.from("task_updates").insert({
          task_id: id,
          created_by_user_id: session.user.id,
          update_type: "reopened",
        })
    );
    revalidatePath("/mobile/tasks");
    revalidatePath(detailPath(id));
    revalidateProjectPath(task.projectId);
    return;
  }

  await supabase
    .from("tasks")
    .update({
      status: "open",
      completed_at: null,
      completed_by_user_id: null,
    })
    .eq("id", id);
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: id,
        created_by_user_id: session.user.id,
        update_type: "reopened",
      })
  );
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
  revalidateProjectPath(task.projectId);
}

/**
 * 진행 중(in_progress) 전환 — 어드민 콘솔의 `setConsoleTaskStatus` 와 같은 3상태 모델을 모바일에도
 * 연다(2026-07-30). 그전까지 모바일은 완료/재개 2상태뿐이라, 콘솔이 "진행 중"으로 바꾼 작업을
 * 현장에서 **읽기만 하고 설정할 수 없었다**(`task-detail-view.tsx` 가 값은 표시하고 있었다).
 *
 * 완료 전환은 반복 처리(occurrence)와 알림이 얽혀 있어 기존 `completeTask` 가 계속 맡고, 이 액션은
 * open ↔ in_progress 만 다룬다 — 완료 상태를 이 경로로 되돌리지 않도록 완료 스탬프도 함께 지운다.
 */
export async function setTaskProgress(taskId: string, inProgress: boolean) {
  const id = String(taskId ?? "").trim();
  if (!id) return;
  const { session, task } = await requireSessionAndTask(id);
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("tasks")
    .update({
      status: inProgress ? "in_progress" : "open",
      completed_at: null,
      completed_by_user_id: null,
    })
    .eq("id", id);
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: id,
        created_by_user_id: session.user.id,
        update_type: "status_changed",
        body: inProgress ? "in_progress" : "open",
      })
  );
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
  revalidateProjectPath(task.projectId);
}

/**
 * 참여자 추가(공유 / 지시 대상 확대) — **참여자도 할 수 있다**(소유자 결정 2026-07-31,
 * `docs/product/18-todo-task-workflow.md` → Sharing Model → Re-sharing).
 *
 * 이 액션은 **추가 전용**이다(`!existing.has(uid)`). 남을 빼는 것은 작성자만 가능하며 그 경로는
 * `removeTaskParticipant` 가 따로 막는다 — "초대는 열되 축출은 잠근다".
 *
 * 알아둘 것: 지시(`is_directive`) 작업에 참여자가 누군가를 추가하면, 추가된 사람에게는 **원
 * 작성자가 보낸 지시**로 보인다(`recvInstr` 판정은 작성자 기준). 누가 실제로 불렀는지는
 * `task_participants.added_by_user_id` 에 남는다.
 */
export async function shareTaskWithUsers(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const { session, task } = await requireSessionAndTask(id);
  // 프로젝트 작업의 공유는 per-task 가 아니라 프로젝트 멤버십이 정한다(콘솔과 동일한 규칙).
  if (task.projectId) {
    redirect(detailPath(id, "forbidden"));
  }
  const requested = parseStringArray(cleanText(formData.get("shareJson")));
  const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
  const existing = new Set(task.participants.map((p) => p.userId));
  const newIds = Array.from(new Set(requested)).filter(
    (uid) => uid !== session.user.id && allowed.has(uid) && !existing.has(uid),
  );
  if (newIds.length === 0) {
    redirect(detailPath(id));
  }
  const supabase = getSupabaseServiceClient();
  const hadFirst = task.participants.some((p) => p.isFirstRecipient);
  const rows: Database["public"]["Tables"]["task_participants"]["Insert"][] = newIds.map(
    (uid, index) => ({
      task_id: id,
      user_id: uid,
      role: "participant",
      is_first_recipient: !hadFirst && index === 0,
      added_by_user_id: session.user.id,
    }),
  );
  // Fail-safe: if the participant rows do not land, do NOT mark the task shared,
  // do NOT write the system_shared log, and do NOT emit notifications — otherwise
  // the task would show a false shared state for a share that never happened.
  const { error: pError } = await supabase.from("task_participants").insert(rows);
  if (pError) {
    redirect(detailPath(id, "save_failed"));
  }
  await supabase.from("tasks").update({ is_shared: true }).eq("id", id);
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: id,
        created_by_user_id: session.user.id,
        update_type: "system_shared",
      })
  );
  await notify(
    id,
    newIds,
    session.user.id,
    session.organization.id,
    "task_shared",
    "shared",
    task.title,
    `task_shared:${id}`,
  );
  redirect(detailPath(id));
}

export async function removeTaskParticipant(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const targetUserId = cleanText(formData.get("userId"));
  const { session, task } = await requireSessionAndTask(id);
  const isAuthor = task.createdByUserId === session.user.id;
  const removingSelf = targetUserId === session.user.id;
  const supabase = getSupabaseServiceClient();

  // Author leaving = full task deletion for everyone (soft delete → undoable).
  if (isAuthor && removingSelf) {
    // 실패했는데 `?deleted=` 로 보내면 「삭제했습니다 · 실행 취소」 토스트가 뜬다 — 지워지지도
    // 않은 작업을 되살리라고 권하는 셈이다(2026-09-08).
    const deleted = await mustWrite(
      "task: author leave = soft delete",
      supabase
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", session.organization.id),
    );
    redirect(deleted ? `/mobile/tasks?deleted=${id}` : detailPath(id, "save_failed"));
  }

  // Only the author (or the platform developer, 2026-10-23) may remove others; anyone may remove themselves.
  if (!removingSelf && !canEditTaskCore(session, task)) {
    redirect(detailPath(id, "forbidden"));
  }
  // Never remove the author via this path (author leaves only via self-delete above).
  if (targetUserId === task.createdByUserId) {
    redirect(detailPath(id, "forbidden"));
  }

  await supabase
    .from("task_participants")
    .delete()
    .eq("task_id", id)
    .eq("user_id", targetUserId);

  // If no non-author participants remain, the task returns to private.
  const remainingNonAuthor = task.participants.filter(
    (p) => p.role !== "author" && p.userId !== targetUserId,
  ).length;
  if (remainingNonAuthor === 0) {
    await bestEffortWrite(
      "task: clear is_shared after last participant left",
      supabase.from("tasks").update({ is_shared: false }).eq("id", id),
    );
  }

  // A participant who removed themselves no longer sees the task.
  if (removingSelf) {
    redirect("/mobile/tasks");
  }
  redirect(detailPath(id));
}

export async function deleteTask(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const { session, task } = await requireSessionAndTask(id);
  if (!canEditTaskCore(session, task)) {
    redirect(detailPath(id, "forbidden"));
  }
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) {
    redirect(detailPath(id, "delete_failed"));
  }
  // ?deleted=<id> → the list shows a "삭제했습니다 · 실행 취소" toast that calls restoreTask.
  redirect(`/mobile/tasks?deleted=${id}`);
}

// Undo a soft delete (from the list's delete toast). requireSessionAndTask filters deleted rows, so
// read the row directly, verify org + authorship, then clear `deleted_at`.
export async function restoreTask(taskId: string): Promise<{ ok: boolean }> {
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false };
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false };
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("tasks")
    .select("created_by_user_id")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const row = data as { created_by_user_id: string } | null;
  if (!row || !isOwnerOrPlatformDeveloper(session.user, row.created_by_user_id)) return { ok: false };
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false };
  revalidatePath("/mobile/tasks");
  return { ok: true };
}

// Batch delete from the list (multi-select). Only deletes tasks the acting user authored —
// the `created_by_user_id` filter is the authorization boundary, so selecting tasks shared to
// you (that you don't own) simply leaves them untouched. Stays on the list (revalidates).
export async function deleteTasksInList(taskIds: string[]): Promise<{ deletedIds: string[] }> {
  const ids = Array.from(
    new Set((taskIds ?? []).map((s) => String(s).trim()).filter(Boolean)),
  ).slice(0, 200);
  if (ids.length === 0) return { deletedIds: [] };
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  const supabase = getSupabaseServiceClient();
  // 플랫폼 개발자는 남의 작업도 지운다(2026-10-23) — 다만 **자기가 열 수 있는 작업(getTaskScope)** 만.
  // 작성자 조건을 빼는 대신 범위 조건을 건다(서비스 키 쓰기라 id 를 그대로 믿으면 안 된다).
  const developer = isPlatformDeveloper(session.user.role);
  const targetIds = developer
    ? await getTaskScope(session).then((scope) => ids.filter((id) => scope.taskIds.has(id)))
    : ids;
  if (targetIds.length === 0) return { deletedIds: [] };
  // 실제로 지워진 id 만 돌려준다 — 목록에서 남의 작업을 같이 골랐어도 그건 안 지워지므로,
  // "실행 취소" 가 지우지도 않은 작업을 되살리려 하면 안 된다(콘솔 `bulkDeleteConsoleTasks` 와 동일).
  let query = supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", targetIds)
    // 조직 스코프도 함께 건다 — 작성자 조건만으로도 실무상 안전하지만, 쌍둥이인
    // `restoreTasksInList` 는 걸고 있어서 두 함수의 방어 수준이 달랐다(2026-08-28).
    .eq("organization_id", session.organization.id);
  if (!developer) query = query.eq("created_by_user_id", session.user.id);
  const { data } = await query.select("id");
  revalidatePath("/mobile/tasks");
  return { deletedIds: ((data ?? []) as Array<{ id: string }>).map((r) => r.id) };
}

/** 목록 일괄 삭제 되돌리기. 소프트 삭제라 `deleted_at` 만 지우면 복구된다(작성자 본인 한정). */
export async function restoreTasksInList(taskIds: string[]): Promise<void> {
  const ids = Array.from(
    new Set((taskIds ?? []).map((s) => String(s).trim()).filter(Boolean)),
  ).slice(0, 200);
  if (ids.length === 0) return;
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return;
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("tasks")
    .update({ deleted_at: null })
    .in("id", ids)
    .eq("organization_id", session.organization.id);
  // 플랫폼 개발자는 자기가 지운 남의 작업도 되살린다(단건 restoreTask 와 같은 규칙, 2026-10-23).
  if (!isPlatformDeveloper(session.user.role)) query = query.eq("created_by_user_id", session.user.id);
  await query;
  revalidatePath("/mobile/tasks");
}

// Persist a manual drag-reorder of the Today view. `orderedIds` is the section's task ids in their
// new top-to-bottom order; each row's sort_order is set to its index (0..n). Org-scoped, so a user
// can only reorder tasks inside their own organization. sort_order is global to the task (not
// per-user) — see the migration note. Stays on the list (revalidates); the optimistic client order
// already reflects the change.
export async function reorderTasks(orderedIds: string[]) {
  const ids = Array.from(
    new Set((orderedIds ?? []).map((s) => String(s).trim()).filter(Boolean)),
  ).slice(0, 500);
  if (ids.length === 0) return;
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  await setTaskSortOrders({
    organizationId: session.organization.id,
    positions: new Map(ids.map((id, index) => [id, index])),
  });
  revalidatePath("/mobile/tasks");
}

/**
 * 한 날짜 목록(오늘/내일/지연)의 순서를 저장한다 — **일회성과 반복 회차가 섞인 하나의 순서 공간**.
 *
 * 저장처가 둘로 나뉘는 것이 이 함수의 존재 이유다.
 * - 일회성 작업: `tasks.sort_order` (행 하나 = 날짜 하나 = 위치 하나)
 * - 반복 회차: `task_occurrence_order(task_id, occurrence_date)` — 반복은 행 하나가 여러 날짜에
 *   나타나므로 날짜별 위치를 따로 들어야 한다. 여기에 `tasks.sort_order` 를 쓰면 오늘에서 올린
 *   순서가 내일·모레까지 따라 올라간다.
 *
 * 인덱스는 **병합 목록 기준**으로 부여한다. 두 저장처를 다시 합쳐 정렬했을 때 사용자가 놓은 순서가
 * 그대로 재현되어야 하기 때문이다.
 */
export async function reorderDateTasks(
  occurrenceDate: string,
  items: { taskId: string; recurring: boolean }[],
) {
  const date = String(occurrenceDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  const seen = new Set<string>();
  const clean = (items ?? [])
    .map((it) => ({ taskId: String(it?.taskId ?? "").trim(), recurring: !!it?.recurring }))
    .filter((it) => it.taskId && !seen.has(it.taskId) && seen.add(it.taskId))
    .slice(0, 500);
  if (clean.length === 0) return;

  const recurringPositions = new Map<string, number>();
  const oneOffUpdates: { taskId: string; index: number }[] = [];
  clean.forEach((it, index) => {
    if (it.recurring) recurringPositions.set(it.taskId, index);
    else oneOffUpdates.push({ taskId: it.taskId, index });
  });

  const [, orderOk] = await Promise.all([
    setTaskSortOrders({
      organizationId: session.organization.id,
      positions: new Map(oneOffUpdates.map((it) => [it.taskId, it.index])),
    }),
    setOccurrenceOrders({
      organizationId: session.organization.id,
      occurrenceDate: date,
      positions: recurringPositions,
    }),
  ]);
  if (!orderOk) {
    // 저장 실패는 화면상 "드래그했는데 되돌아옴"으로만 보인다 — 서버 로그와 함께 남긴다.
    console.error("[reorderDateTasks] occurrence order not persisted", { date });
  }
  revalidatePath("/mobile/tasks");
}

export async function addTaskUpdate(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const { session, task } = await requireSessionAndTask(id);
  const body = cleanText(formData.get("body"));
  const imageUrls = formData
    .getAll("imageUrls")
    .map((v) => String(v))
    .filter((u) => u.startsWith("https://") || u.startsWith("http://"))
    .slice(0, 5);
  if (!body && imageUrls.length === 0) {
    redirect(detailPath(id));
  }
  const supabase = getSupabaseServiceClient();
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: id,
        created_by_user_id: session.user.id,
        update_type: "note",
        body: body || null,
        image_urls: imageUrls,
      })
  );
  await notify(
    id,
    otherParticipantIds(task, session.user.id),
    session.user.id,
    session.organization.id,
    "task_updated",
    "note",
    task.title,
    `task_note:${id}:${Date.now()}`,
  );
  redirect(detailPath(id));
}
