"use server";

import { revalidatePath } from "next/cache";
import {
  generateDailyReport,
  sendDailyReportToSlack,
  type DailyReportResult,
  type SendDailyReportToSlackResult,
} from "@/actions/task-report";
import { notifyProjectMembers, notifyTaskParticipants } from "@/lib/notifications/create";
import type { TaskNotificationPayload } from "@/lib/notifications/types";
import { getProjectDetail, type ProjectDetailData } from "@/lib/projects";
import {
  canEditTaskCore,
  getTaskScope,
  getShareableUsers,
  getTaskDetail,
  getTasksByIds,
  getVisibleTasks,
  normalizeTaskDateTime,
  resolveRecurrenceRule,
  taskAnchorDate,
  taskAnchorDateInput,
  taskNeedsRecurrenceDate,
  taskTimeWithoutDate,
  tokyoDateOf,
  tokyoToday,
  ymdShift,
  type TaskDetail,
  type TaskRecord,
} from "@/lib/tasks";
import {
  canMoveRecurringTo,
  isStandardRecurrence,
  recurringOccurrencesInRange,
} from "@/lib/tasks-recurrence";
import {
  clearOccurrenceState,
  absorbEarlierOccurrences,
  releaseAbsorbedOccurrences,
  resolveCompletionOccurrence,
  completeOccurrence,
  occurrenceStatesForTask,
  setOccurrenceOrders,
  setTaskSortOrders,
  skipOccurrences,
} from "@/lib/task-occurrences";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { isOwnerOrPlatformDeveloper } from "@/config/roles";
import {
  cleanupRemovedTaskImages,
  isOrgTaskImageUrl,
  mergeTaskImageUrls,
  sanitizeTaskImageUrls,
} from "@/lib/task-images";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { bestEffortWrite, mustWrite } from "@/lib/db-write-guard";
import type { Database } from "@/types/database";

export type TaskActionResult =
  | {
      ok: true;
      id?: string;
      /** 「오늘로 가져오기」 결과 — 호출부가 무슨 일이 일어났는지 토스트로 말하는 데 쓴다. */
      carry?: { moved: number; carried: boolean };
      /** 반복 완료가 실제로 기록한 회차 — 넘긴 날짜가 회차가 아니면 달라진다. 실행 취소는 이 날짜로. */
      occurrenceDate?: string;
    }
  | { ok: false; error: string };

type Session = NonNullable<Awaited<ReturnType<typeof getCurrentAppSession>>>;

const PRIORITIES = new Set(["normal", "important", "urgent", "medium"]);
const CONSOLE_PATH = "/admin/tasks";

// Session + org-context guard for the result-returning console actions (no redirect).
async function resolveSession(): Promise<Session | null> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  return session;
}

// getTaskDetail is RLS-scoped, so a non-null result already proves the acting user is a
// participant. Author-only actions additionally check authorship.
async function resolveTask(
  taskId: string,
): Promise<{ session: Session; task: TaskDetail } | null> {
  const session = await resolveSession();
  if (!session) return null;
  const id = String(taskId ?? "").trim();
  if (!id) return null;
  const task = await getTaskDetail(session, id);
  if (!task) return null;
  return { session, task };
}

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

/**
 * Linked operational context (건물 / 객실 / 예약 / 게스트) submitted from the console.
 *
 * Same four columns the mobile form writes (`property_id` / `room_id` / `reservation_id` /
 * `guest_name`), so a task links identically no matter which surface created it. Ids are opaque
 * here — they come from the picker's own org-scoped fetches (`fetchPickerBuildings` /
 * `fetchPickerRooms` / `fetchRoomReservations`), and the row itself is org-scoped on write.
 */
export type ConsoleTaskContext = {
  propertyId?: string | null;
  roomId?: string | null;
  reservationId?: string | null;
  guestName?: string | null;
};

function normalizeContext(ctx: ConsoleTaskContext | undefined) {
  const clean = (v: string | null | undefined) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };
  return {
    property_id: clean(ctx?.propertyId),
    room_id: clean(ctx?.roomId),
    reservation_id: clean(ctx?.reservationId),
    guest_name: clean(ctx?.guestName),
  };
}

// Clamp a submitted duration to the 1–1440 minute block length, or null if out of range/absent.
function clampDuration(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 1 && n <= 1440 ? n : null;
}

// ── 1. Create ─────────────────────────────────────────────────────────────────
export async function createConsoleTask(input: {
  title: string;
  desc: string;
  date: string;
  time: string;
  durationMinutes: number | null;
  repeat: string;
  priority: string;
  tags: string[];
  projectId?: string | null;
  sectionId?: string | null;
  targetUserIds: string[];
  isDirective: boolean;
  /** Linked 건물/객실/예약/게스트 (2026-07-29 — parity with the mobile form). */
  context?: ConsoleTaskContext;
  /** Already-uploaded public URLs; the browser uploads to Storage first, same as mobile. */
  imageUrls?: string[];
}): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "missing_title" };

  const description = input.desc.trim();
  let date = input.date.trim();
  const time = input.time.trim();
  const priority = PRIORITIES.has(input.priority) ? input.priority : "normal";
  // Create has no previous rule, so `custom` can never be newly assigned (→ null).
  const repeat = resolveRecurrenceRule(input.repeat, null);
  const tags = input.tags.map((t) => t.trim()).filter(Boolean).slice(0, 10);
  // A recurrence needs a date anchor; if the user set a repeat but no date, anchor to today
  // (Todoist: "매주 월수금" starts today) instead of rejecting with repeat_needs_date.
  if (repeat && !date) date = tokyoToday();

  // Single-date model: scheduledDate is always empty; dueDate carries the single date.
  if (taskTimeWithoutDate({ scheduledDate: "", dueDate: date, time })) {
    return { ok: false, error: "time_needs_date" };
  }
  const { scheduledDate: sched, dueAt, allDay, timeLabel } = normalizeTaskDateTime({
    scheduledDate: "",
    dueDate: date,
    time,
  });
  // Duration is a time-block length and is only meaningful with a time-of-day.
  const finalDuration = timeLabel ? clampDuration(input.durationMinutes) : null;
  const anchorDate = taskAnchorDateInput({ scheduledDate: sched, dueAt });
  if (taskNeedsRecurrenceDate(repeat, anchorDate)) {
    return { ok: false, error: "repeat_needs_date" };
  }

  // Optional project link: getProjectDetail is RLS-scoped, so a non-null result proves the acting
  // user is a project participant. Project tasks are never per-task shared/directive.
  let linkedProjectId: string | null = null;
  let linkedSectionId: string | null = null;
  if (input.projectId) {
    const project = await getProjectDetail(session, input.projectId);
    if (!project) return { ok: false, error: "invalid_project" };
    linkedProjectId = input.projectId;
    linkedSectionId =
      input.sectionId && project.sections.some((s) => s.id === input.sectionId)
        ? input.sectionId
        : null;
  }

  // Validate targets against the org's active members (fail closed); never for project tasks.
  let shareIds: string[] = [];
  if (!linkedProjectId && input.targetUserIds.length > 0) {
    const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
    shareIds = Array.from(new Set(input.targetUserIds)).filter(
      (uid) => uid !== session.user.id && allowed.has(uid),
    );
  }
  const isDirective = !linkedProjectId && input.isDirective && shareIds.length > 0;
  // Dateless personal/shared quick-adds land in the staging Inbox (Todoist parity); dated tasks
  // and project tasks are never inbox.
  const isInboxTask = !sched && !dueAt && !linkedProjectId;

  const id = crypto.randomUUID();
  const recurrenceSeriesId = repeat ? id : null;
  const supabase = getSupabaseServiceClient();

  const insert: Database["public"]["Tables"]["tasks"]["Insert"] = {
    id,
    organization_id: session.organization.id,
    created_by_user_id: session.user.id,
    title,
    description: description || null,
    scheduled_date: sched,
    due_at: dueAt,
    all_day: allDay,
    time_label: timeLabel,
    duration_minutes: finalDuration,
    priority,
    status: "open",
    is_inbox: isInboxTask,
    is_shared: shareIds.length > 0,
    is_directive: isDirective,
    recurrence_rule: repeat,
    recurrence_series_id: recurrenceSeriesId,
    recurrence_instance_date: recurrenceSeriesId ? anchorDate : null,
    tags,
    // Cap is re-applied here, not trusted from the client (CLAUDE.md §8).
    image_urls: sanitizeTaskImageUrls(input.imageUrls ?? [], !!linkedProjectId, session.organization.id),
    project_id: linkedProjectId,
    section_id: linkedSectionId,
    ...normalizeContext(input.context),
  };
  const { error } = await supabase.from("tasks").insert(insert);
  if (error) return { ok: false, error: "save_failed" };

  // The author row MUST carry the same keys as the participant rows so PostgREST does not fill an
  // omitted NOT NULL column with NULL across the multi-row insert (see the mobile create note).
  const participantRows: Database["public"]["Tables"]["task_participants"]["Insert"][] = [
    {
      task_id: id,
      user_id: session.user.id,
      role: "author",
      is_first_recipient: false,
      added_by_user_id: null,
    },
    ...shareIds.map((uid, index) => ({
      task_id: id,
      user_id: uid,
      role: "participant",
      is_first_recipient: index === 0,
      added_by_user_id: session.user.id,
    })),
  ];
  const { error: pError } = await supabase
    .from("task_participants")
    .insert(participantRows);
  if (pError) {
    await supabase.from("tasks").delete().eq("id", id);
    return { ok: false, error: "save_failed" };
  }

  if (shareIds.length > 0) {
    await bestEffortWrite(
      "task_updates: insert",
      supabase.from("task_updates").insert({
          task_id: id,
          created_by_user_id: session.user.id,
          update_type: "system_shared",
          body: null,
        })
    );
    await notify(
      id,
      shareIds,
      session.user.id,
      session.organization.id,
      "task_shared",
      "shared",
      title,
      `task_shared:${id}`,
    );
  }

  revalidatePath(CONSOLE_PATH);
  return { ok: true, id };
}

// The occurrence date a recurring complete/reopen targets when none is passed: the FIXED anchor.
function recurringAnchorDate(task: TaskDetail): string {
  return task.recurrenceInstanceDate ?? tokyoDateOf(task.dueAt) ?? task.scheduledDate ?? tokyoToday();
}

// Shared completion (2026-07-30): RECURRING tasks record the given occurrence date in
// `task_occurrence_state` and never touch the row (no roll-forward); ONE-OFFs are stamped completed.
// Both log `completed` + notify participants.
async function completeInternal(
  session: Session,
  task: TaskDetail,
  occurrenceDate?: string,
): Promise<{ ok: boolean; recorded?: string }> {
  const supabase = getSupabaseServiceClient();
  let recorded: string | undefined;
  // 이미 완료된 일회성 작업은 아무것도 하지 않는다(2026-10-26) — 두 번 눌러도 완료 기록 · 알림이 중복되지 않게.
  if (!isStandardRecurrence(task.recurrenceRule) && task.status === "completed") {
    return { ok: true };
  }
  if (isStandardRecurrence(task.recurrenceRule)) {
    // 화면이 넘긴 날짜가 규칙상 회차가 아니면(월수금 반복을 화요일에 보는 경우) 가장 오래된
    // 미해결 회차로 정산한다 — 실제로 하는 일은 「밀린 그날 몫」이다(2026-09-08).
    const occ = await resolveCompletionOccurrence({
      taskId: task.id,
      rule: task.recurrenceRule,
      anchor: taskAnchorDate(task),
      requested: String(occurrenceDate ?? "").trim() || recurringAnchorDate(task),
    });
    const saved = await completeOccurrence({
      taskId: task.id,
      organizationId: session.organization.id,
      occurrenceDate: occ,
      userId: session.user.id,
    });
    // 저장이 실패하면 완료 기록 · 알림을 남기지 않는다(2026-10-26).
    if (!saved) return { ok: false };
    // 밀린 회차는 이 완료가 흡수한다 — 오늘 줄의 「N일 밀림」 배지가 함께 사라진다(2026-09-08).
    await absorbEarlierOccurrences({
      taskId: task.id,
      organizationId: session.organization.id,
      rule: task.recurrenceRule,
      anchor: taskAnchorDate(task),
      completedDate: occ,
    });
    recorded = occ;
  } else {
    const completed = await mustWrite(
      "task: complete",
      supabase
        .from("tasks")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          completed_by_user_id: session.user.id,
        })
        .eq("id", task.id)
        .eq("organization_id", session.organization.id),
    );
    if (!completed) return { ok: false };
  }
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: task.id,
        created_by_user_id: session.user.id,
        update_type: "completed",
      })
  );
  await notify(
    task.id,
    otherParticipantIds(task, session.user.id),
    session.user.id,
    session.organization.id,
    "task_completed",
    "completed",
    task.title,
    `task_completed:${task.id}:${Date.now()}`,
  );
  return { ok: true, recorded };
}

// Shared reopen: RECURRING clears that occurrence's recorded state; ONE-OFF clears completion
// stamps. Logs `reopened`, no notification.
async function reopenInternal(
  session: Session,
  task: TaskDetail,
  occurrenceDate?: string,
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  if (isStandardRecurrence(task.recurrenceRule)) {
    const occ = String(occurrenceDate ?? "").trim() || recurringAnchorDate(task);
    // 지우기가 실패하면 «다시 열림» 기록을 남기지 않는다(2026-10-26).
    if (!(await clearOccurrenceState(task.id, occ))) return false;
    // 그 완료가 흡수했던 밀린 회차도 되살린다 — 아니면 취소해도 밀림 배지가 안 돌아온다.
    await releaseAbsorbedOccurrences(task.id, occ);
  } else {
    const reopened = await mustWrite(
      "task: reopen",
      supabase
        .from("tasks")
        .update({
          status: "open",
          completed_at: null,
          completed_by_user_id: null,
        })
        .eq("id", task.id)
        .eq("organization_id", session.organization.id),
    );
    if (!reopened) return false;
  }
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: task.id,
        created_by_user_id: session.user.id,
        update_type: "reopened",
      })
  );
  return true;
}

// ── 2. Status ───────────────────────────────────────────────────────────────
export async function setConsoleTaskStatus(
  taskId: string,
  status: "open" | "in_progress" | "completed",
  occurrenceDate?: string,
): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;

  if (status === "completed") {
    const done = await completeInternal(session, task, occurrenceDate);
    if (!done.ok) return { ok: false, error: "save_failed" };
    revalidatePath(CONSOLE_PATH);
    return { ok: true, occurrenceDate: done.recorded };
  }
  // Reopening a completed recurring occurrence (status→open) clears that occurrence's state, not the
  // row. An open occurrence going 진행 중 → 대기 is a row change and falls through below.
  if (status === "open" && isStandardRecurrence(task.recurrenceRule)) {
    const occ = String(occurrenceDate ?? "").trim();
    const states = occ ? await occurrenceStatesForTask(task.id) : null;
    if (!occ || states?.get(occ) === "completed" || task.status !== "in_progress") {
      if (!(await reopenInternal(session, task, occurrenceDate))) {
        return { ok: false, error: "save_failed" };
      }
      revalidatePath(CONSOLE_PATH);
      return { ok: true };
    }
  }

  const supabase = getSupabaseServiceClient();
  await supabase
    .from("tasks")
    .update({
      status,
      completed_at: null,
      completed_by_user_id: null,
    })
    .eq("id", task.id)
    .eq("organization_id", session.organization.id);
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: task.id,
        created_by_user_id: session.user.id,
        // Clearing a completed task back to open reads as a reopen; other transitions are status changes.
        update_type: task.status === "completed" && status === "open" ? "reopened" : "status_changed",
      })
  );
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 3. Toggle complete (checkbox) ──────────────────────────────────────────────
export async function toggleConsoleComplete(
  taskId: string,
  complete: boolean,
  occurrenceDate?: string,
): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  if (complete) {
    const done = await completeInternal(session, task, occurrenceDate);
    if (!done.ok) return { ok: false, error: "save_failed" };
    revalidatePath(CONSOLE_PATH);
    return { ok: true, occurrenceDate: done.recorded };
  }
  if (!(await reopenInternal(session, task, occurrenceDate))) {
    return { ok: false, error: "save_failed" };
  }
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── Recurring overdue backlog resolution (2026-07-30, mirrors the mobile actions) ────────────
/**
 * 반복 작업의 **한 회차만** 건너뛰기 / 되돌리기 (2026-07-30) — 모바일 `skipOccurrenceOn` 과 같은 규칙.
 *
 * 목록의 삭제는 `tasks` 행을 지워 모든 날짜에서 사라지게 한다. 반복 업무에는 "그날만 못 한다"가
 * 흔하므로 회차 단위 건너뛰기를 따로 둔다. 저장은 기존 `task_occurrence_state` 의 `skipped`.
 *
 * 날짜는 **클라이언트를 믿지 않고** 반복 규칙에서 재계산해 실제 회차인지 확인한다.
 */
function isConsoleOccurrenceDate(task: TaskDetail, occurrenceDate: string): boolean {
  if (!isStandardRecurrence(task.recurrenceRule)) return false;
  const anchor = recurringAnchorDate(task);
  if (!anchor) return false;
  return (
    recurringOccurrencesInRange(task.recurrenceRule, anchor, occurrenceDate, occurrenceDate).length > 0
  );
}

export async function skipConsoleOccurrence(
  taskId: string,
  occurrenceDate: string,
): Promise<TaskActionResult> {
  const date = String(occurrenceDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalid_date" };
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  if (!isConsoleOccurrenceDate(task, date)) return { ok: false, error: "invalid_date" };
  // 이미 완료 · 건너뜀 · 옮김 상태인 회차는 건드리지 않는다(2026-10-26) — 덮어쓰면 완료 기록이 사라진다.
  const states = await occurrenceStatesForTask(task.id);
  const existing = states.get(date);
  if (existing === "skipped") return { ok: true };
  if (existing) return { ok: false, error: "already_resolved" };
  const skipped = await skipOccurrences({
    taskId: task.id,
    organizationId: session.organization.id,
    dates: [date],
  });
  if (!skipped) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

/**
 * 건너뛰기 되돌리기. `clearOccurrenceState` 는 상태 종류를 가리지 않으므로, 토스트가 떠 있는 사이
 * 같은 회차가 완료됐다면 그 완료까지 풀린다(회차 상태 칸이 하나뿐이라 종류별 삭제가 불가능).
 */
export async function unskipConsoleOccurrence(
  taskId: string,
  occurrenceDate: string,
): Promise<TaskActionResult> {
  const date = String(occurrenceDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalid_date" };
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { task } = resolved;
  if (!isConsoleOccurrenceDate(task, date)) return { ok: false, error: "invalid_date" };
  if (!(await clearOccurrenceState(task.id, date))) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 4. Edit core (author only) ─────────────────────────────────────────────────
export async function updateConsoleTaskCore(input: {
  taskId: string;
  title: string;
  desc: string;
  date: string;
  time: string;
  durationMinutes: number | null;
  repeat: string;
  priority: string;
  tags: string[];
  /** Linked 건물/객실/예약/게스트. Omit to leave the existing link untouched. */
  context?: ConsoleTaskContext;
  /** Full replacement set of already-uploaded URLs. Omit to leave photos untouched. */
  imageUrls?: string[];
}): Promise<TaskActionResult> {
  const resolved = await resolveTask(input.taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  if (!canEditTaskCore(session, task)) return { ok: false, error: "forbidden" };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "missing_title" };
  const description = input.desc.trim();
  let date = input.date.trim();
  const time = input.time.trim();
  const tags = input.tags.map((t) => t.trim()).filter(Boolean).slice(0, 10);
  const nextRecurrenceRule = resolveRecurrenceRule(input.repeat, task.recurrenceRule);
  // 반복이 있는데 날짜가 없으면 오늘로 앵커(create 와 동일; repeat_needs_date 방지).
  if (nextRecurrenceRule && !date) date = tokyoToday();

  if (taskTimeWithoutDate({ scheduledDate: "", dueDate: date, time })) {
    return { ok: false, error: "time_needs_date" };
  }
  const { scheduledDate: sched, dueAt, allDay, timeLabel } = normalizeTaskDateTime({
    scheduledDate: "",
    dueDate: date,
    time,
  });
  const finalDuration = timeLabel ? clampDuration(input.durationMinutes) : null;
  const anchorDate = taskAnchorDateInput({ scheduledDate: sched, dueAt });
  if (taskNeedsRecurrenceDate(nextRecurrenceRule, anchorDate)) {
    return { ok: false, error: "repeat_needs_date" };
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
    priority: PRIORITIES.has(input.priority) ? input.priority : "normal",
    recurrence_rule: nextRecurrenceRule,
    recurrence_series_id: task.recurrenceSeriesId ?? (nextRecurrenceRule ? task.id : null),
    recurrence_instance_date:
      task.recurrenceSeriesId || nextRecurrenceRule
        ? anchorDate ?? task.recurrenceInstanceDate ?? null
        : null,
    tags,
  };
  // Photos and context are optional patches: an omitted field leaves the stored value alone, so a
  // caller that only edits the title can't silently wipe a link or detach every photo.
  const nextImageUrls =
    input.imageUrls === undefined
      ? null
      : mergeTaskImageUrls(task.imageUrls, input.imageUrls, !!task.projectId, session.organization.id);
  if (nextImageUrls) update.image_urls = nextImageUrls;
  if (input.context !== undefined) Object.assign(update, normalizeContext(input.context));

  // Files detached in this edit — from server truth, never from client input.
  const removedImageUrls = nextImageUrls
    ? task.imageUrls.filter((u) => !nextImageUrls.includes(u))
    : [];
  const { error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", task.id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  // Only after the DB no longer references them, hard-delete the detached files.
  await cleanupRemovedTaskImages(supabase, removedImageUrls, session.organization.id);
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: task.id,
        created_by_user_id: session.user.id,
        update_type: "system_edited",
      })
  );
  await notify(
    task.id,
    otherParticipantIds(task, session.user.id),
    session.user.id,
    session.organization.id,
    "task_updated",
    "edited",
    title,
    `task_edited:${task.id}:${Date.now()}`,
  );
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 5. Reschedule (author only) ────────────────────────────────────────────────
/**
 * 작성자 전용이다(2026-07-31 수정). `resolveTask` 는 "이 작업을 **볼 수** 있는가"(참여자 포함)만
 * 증명하므로, 예전에는 공유만 받은 참여자가 남의 작업 마감일·시간·반복 주기를 바꿀 수 있었다.
 * 날짜를 비우면 아래에서 `recurrence_*` 까지 지우므로 반복 시리즈를 통째로 해제하는 것도 가능했다.
 * 모바일의 같은 조작(`updateTaskCore`)은 처음부터 작성자 전용이라 두 화면의 권한이 어긋나 있었다.
 * 오늘/내일로 이동(`moveConsoleToToday`/`Tomorrow`)은 모바일에서도 참여자에게 열려 있어 그대로 둔다.
 */
export async function rescheduleConsoleTask(
  taskId: string,
  input: { date: string; time: string; durationMinutes: number | null; repeat: string },
): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  if (!canEditTaskCore(session, task)) return { ok: false, error: "forbidden" };

  const date = input.date.trim();
  const time = input.time.trim();
  // Empty date clears the schedule → the task returns to the no-date Inbox (Todoist "remove date").
  // Without an anchor a recurrence rule is meaningless, so it is cleared too.
  if (!date) {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        due_at: null,
        scheduled_date: null,
        all_day: true,
        time_label: null,
        duration_minutes: null,
        is_inbox: true,
        recurrence_rule: null,
        recurrence_series_id: null,
        recurrence_instance_date: null,
      })
      .eq("id", task.id)
      .eq("organization_id", session.organization.id);
    if (error) return { ok: false, error: "save_failed" };
    revalidatePath(CONSOLE_PATH);
    return { ok: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalid_date" };

  const { dueAt, allDay, timeLabel } = normalizeTaskDateTime({
    scheduledDate: "",
    dueDate: date,
    time,
  });
  const finalDuration = timeLabel ? clampDuration(input.durationMinutes) : null;
  const nextRecurrenceRule = resolveRecurrenceRule(input.repeat, task.recurrenceRule);

  const supabase = getSupabaseServiceClient();
  const update: Database["public"]["Tables"]["tasks"]["Update"] = {
    due_at: dueAt,
    all_day: allDay,
    time_label: timeLabel,
    duration_minutes: finalDuration,
    scheduled_date: null,
    is_inbox: false,
    recurrence_rule: nextRecurrenceRule,
    recurrence_series_id: task.recurrenceSeriesId ?? (nextRecurrenceRule ? task.id : null),
    recurrence_instance_date: task.recurrenceSeriesId || nextRecurrenceRule ? date : null,
  };
  const { error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", task.id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 5b. 지연 일괄 처리 (2026-07-31) ────────────────────────────────────────────
/**
 * 지연 배너의 "일정 변경" / "지난 미완료 삭제"는 화면에 보이던 목록을 그대로 서버로 넘긴다.
 * 그 목록을 그대로 믿으면 화면 밖의 남의 작업 id 를 끼워 넣어도 통과하므로, 모바일
 * (`rescheduleOverdueTo` / `dismissOverdueTasks`)과 **같은 규칙으로 서버에서 다시 계산한다**:
 * 내가 만든 · 프로젝트 밖 · 활성 · 마감 토쿄일이 오늘 이전인 **일회성** 작업만 대상.
 *
 * 반복의 지연은 회차 단위(`task_occurrence_state`)라 여기서 제외한다 —
 * `carryConsoleOverdueToToday` / `skipConsoleOverdue` 가 따로 처리한다.
 */
function isConsoleOverdueOwned(t: TaskRecord, today: string, userId: string): boolean {
  if (t.projectId || t.createdByUserId !== userId) return false;
  if (t.status === "completed" || t.status === "cancelled") return false;
  if (isStandardRecurrence(t.recurrenceRule)) return false;
  const due = tokyoDateOf(t.dueAt);
  return !!due && due < today;
}

/** 선택한 지연 작업들을 `targetDate`(YYYY-MM-DD, Tokyo)로 옮긴다. 각 작업의 시각은 보존한다. */
export async function rescheduleConsoleOverdue(
  targetDate: string,
  taskIds: string[],
): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const date = String(targetDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalid_date" };
  const allowed = new Set((taskIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean));
  if (allowed.size === 0) return { ok: true };
  const today = tokyoToday();
  const targets = (await getVisibleTasks(session)).filter(
    (t) => allowed.has(t.id) && isConsoleOverdueOwned(t, today, session.user.id),
  );
  if (targets.length === 0) return { ok: true };

  const supabase = getSupabaseServiceClient();
  await Promise.all(
    targets.map((t) =>
      supabase
        .from("tasks")
        .update({
          due_at: new Date(`${date}T${t.timeLabel || "00:00"}:00+09:00`).toISOString(),
          scheduled_date: null,
          is_inbox: false,
        })
        .eq("id", t.id)
        .eq("organization_id", session.organization.id),
    ),
  );
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

/** `deletedIds` 는 `restoreConsoleTasks` 로 되돌릴 수 있는 id 들(전부 내가 만든 작업이다). */
export type OverdueBulkResult =
  | { ok: true; deletedIds: string[] }
  | { ok: false; error: string };

/** 선택한 지연 작업들을 소프트 삭제(실행 취소 가능). 대상 판정은 위와 동일하게 서버에서 재계산. */
export async function dismissConsoleOverdue(taskIds: string[]): Promise<OverdueBulkResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const allowed = new Set((taskIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean));
  if (allowed.size === 0) return { ok: true, deletedIds: [] };
  const today = tokyoToday();
  const ids = (await getVisibleTasks(session))
    .filter((t) => allowed.has(t.id) && isConsoleOverdueOwned(t, today, session.user.id))
    .map((t) => t.id);
  if (ids.length === 0) return { ok: true, deletedIds: [] };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "delete_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true, deletedIds: ids };
}

// ── 6. Share / assign as directive (author only) ──────────────────────────────
export async function shareConsoleTask(
  taskId: string,
  userIds: string[],
  asDirective: boolean,
): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  // Project tasks are governed by project membership, not per-task sharing.
  if (task.projectId) return { ok: false, error: "forbidden" };
  // 플랫폼 개발자는 작성자와 같은 힘(빼기 · 지시 바꾸기)을 갖는다(2026-10-23).
  const isAuthor = canEditTaskCore(session, task);
  const isParticipant = task.participants.some((p) => p.userId === session.user.id);
  if (!isAuthor && !isParticipant) return { ok: false, error: "forbidden" };

  // Reconcile the participant set to exactly `userIds` (the picker shows existing participants
  // pre-checked, so unchecking one must REMOVE them — not just add). Author is never touched.
  const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
  const desired = new Set(
    Array.from(new Set(userIds)).filter((uid) => uid !== session.user.id && allowed.has(uid)),
  );
  const currentNonAuthor = task.participants
    .filter((p) => p.role !== "author")
    .map((p) => p.userId);
  const toAdd = Array.from(desired).filter((uid) => !currentNonAuthor.includes(uid));
  /**
   * 참여자도 사람을 **부를 수** 있지만(Re-sharing, 2026-07-31 소유자 결정) **뺄 수는 없다.**
   * 이 액션은 피커의 체크 상태를 그대로 반영하는 재조정이라, 그냥 열어 주면 참여자가 다른 참여자를
   * 축출할 수 있게 된다 — 모바일 `shareTaskWithUsers` 는 추가 전용이라 애초에 그 힘이 없다.
   * 그래서 작성자가 아니면 제거분을 버리고 추가만 적용한다("초대는 열되 축출은 잠근다").
   */
  const toRemove = isAuthor ? currentNonAuthor.filter((uid) => !desired.has(uid)) : [];

  const supabase = getSupabaseServiceClient();
  if (toRemove.length > 0) {
    await supabase
      .from("task_participants")
      .delete()
      .eq("task_id", task.id)
      .in("user_id", toRemove);
  }
  if (toAdd.length > 0) {
    // A first-recipient still remains only if a kept (not-removed) participant already had it.
    const hadFirst = task.participants.some((p) => p.isFirstRecipient && !toRemove.includes(p.userId));
    const rows: Database["public"]["Tables"]["task_participants"]["Insert"][] = toAdd.map(
      (uid, index) => ({
        task_id: task.id,
        user_id: uid,
        role: "participant",
        is_first_recipient: !hadFirst && index === 0,
        added_by_user_id: session.user.id,
      }),
    );
    const { error: pError } = await supabase.from("task_participants").insert(rows);
    if (pError) return { ok: false, error: "save_failed" };
    await bestEffortWrite(
      "task_updates: insert",
      supabase.from("task_updates").insert({
          task_id: task.id,
          created_by_user_id: session.user.id,
          update_type: "system_shared",
        })
    );
  }

  /**
   * 작성자만 공유/지시 성격을 바꾼다. 참여자의 추가는 사람만 늘릴 뿐이라 `is_shared` 는 이미 true
   * 이고, **지시 여부를 뒤집게 두면 참여자가 남의 평범한 공유를 "지시"로 승격**시킬 수 있다.
   */
  if (isAuthor) {
    const isShared = desired.size > 0;
    await supabase
      .from("tasks")
      .update({ is_shared: isShared, is_directive: asDirective && isShared })
      .eq("id", task.id)
      .eq("organization_id", session.organization.id);
  } else if (toAdd.length > 0) {
    await supabase
      .from("tasks")
      .update({ is_shared: true })
      .eq("id", task.id)
      .eq("organization_id", session.organization.id);
  }

  if (toAdd.length > 0) {
    await notify(
      task.id,
      toAdd,
      session.user.id,
      session.organization.id,
      "task_shared",
      "shared",
      task.title,
      `task_shared:${task.id}`,
    );
  }
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 7. Add note (participant) ──────────────────────────────────────────────────
export async function addConsoleNote(
  taskId: string,
  body: string,
  imageUrls: string[] = [],
): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  const text = String(body ?? "").trim();
  // Update-log photos stay at 5 even on a project task — the 20 cap is task-level only.
  // 메모 사진은 우리 스토리지의 `{org}/task-update-images/` 객체만(2026-10-26, 모바일 addTaskUpdate 와 같다).
  const photos = Array.from(new Set((imageUrls ?? []).map((v) => String(v))))
    .filter((u) => isOrgTaskImageUrl(u, session.organization.id, "task-update-images"))
    .slice(0, 5);
  if (!text && photos.length === 0) return { ok: false, error: "empty" };

  const supabase = getSupabaseServiceClient();
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: task.id,
        created_by_user_id: session.user.id,
        update_type: "note",
        body: text || null,
        image_urls: photos,
      })
  );
  await notify(
    task.id,
    otherParticipantIds(task, session.user.id),
    session.user.id,
    session.organization.id,
    "task_updated",
    "note",
    task.title,
    `task_note:${task.id}:${Date.now()}`,
  );
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 8. Delete (author) / leave (participant) ───────────────────────────────────
// User deletion is now a SOFT delete (`deleted_at`) so the undo toast / restoreConsoleTask can bring
// it back. Reads filter `deleted_at is null`, so a soft-deleted task disappears from every view.
export async function deleteConsoleTask(taskId: string): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  if (!canEditTaskCore(session, task)) return { ok: false, error: "forbidden" };
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", task.id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "delete_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// Undo a soft delete. getTaskDetail filters deleted rows, so this reads the row directly and checks
// authorship before clearing `deleted_at`.
export async function restoreConsoleTask(taskId: string): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false, error: "not_found" };
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("tasks")
    .select("created_by_user_id")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const row = data as { created_by_user_id: string } | null;
  if (!row) return { ok: false, error: "not_found" };
  if (!isOwnerOrPlatformDeveloper(session.user, row.created_by_user_id)) return { ok: false, error: "forbidden" };
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

export async function leaveConsoleTask(taskId: string): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  const supabase = getSupabaseServiceClient();

  // Author leaving = full deletion for everyone (soft delete, so it's undoable like a normal delete).
  if (task.createdByUserId === session.user.id) {
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", task.id)
      .eq("organization_id", session.organization.id);
    if (error) return { ok: false, error: "delete_failed" };
    revalidatePath(CONSOLE_PATH);
    return { ok: true };
  }

  await supabase
    .from("task_participants")
    .delete()
    .eq("task_id", task.id)
    .eq("user_id", session.user.id);
  // If no non-author participants remain, the task returns to private (and non-directive).
  const remainingNonAuthor = task.participants.filter(
    (p) => p.role !== "author" && p.userId !== session.user.id,
  ).length;
  if (remainingNonAuthor === 0) {
    await supabase
      .from("tasks")
      .update({ is_shared: false, is_directive: false })
      .eq("id", task.id)
      .eq("organization_id", session.organization.id);
  }
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 8b. Bulk delete (selection mode + 지난 미완료 정리) ─────────────────────────
// Mirrors what a per-task delete does, but resolves the whole selection in one round trip: tasks the
// caller authored are soft-deleted (undoable), tasks they merely participate in are left instead
// (removing the caller from `task_participants`) — the same author/participant split
// `leaveConsoleTask` makes, because a participant has no right to delete someone else's task.
//
// Persist a manual drag-reorder of the 관리함(Inbox) list (2026-07-30). `orderedIds` is the new
// top-to-bottom order; each row's `sort_order` is set to its index. Org-scoped. Mirrors the mobile
// `reorderTasks`; `sort_order` is global to the task (shared with the Today drag order).
export async function reorderConsoleTasks(orderedIds: string[]): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const ids = Array.from(
    new Set((orderedIds ?? []).map((s) => String(s).trim()).filter(Boolean)),
  ).slice(0, 500);
  if (ids.length === 0) return { ok: true };
  // 조직 조건만으로는 같은 조직 남의 개인 작업 순서도 바꿀 수 있다(서비스 키 쓰기) — 내가 볼 수 있는
  // 작업(getTaskScope)만 남긴다(2026-10-26). 인덱스는 원래 목록 기준을 유지한다.
  const scope = await getTaskScope(session);
  const positions = new Map<string, number>();
  ids.forEach((id, index) => {
    if (scope.taskIds.has(id)) positions.set(id, index);
  });
  await setTaskSortOrders({ organizationId: session.organization.id, positions });
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

/**
 * 한 날짜 목록(오늘/내일)의 순서 저장 — 콘솔판. 모바일 `reorderDateTasks` 와 **같은 저장 모델**을
 * 쓴다: 일회성은 `tasks.sort_order`, 반복 회차는 `task_occurrence_order(task_id, occurrence_date)`.
 * 반복은 행 하나가 여러 날짜에 나타나므로 날짜별 위치를 따로 들어야 한다.
 *
 * 인덱스는 병합 목록 기준. 두 저장처를 다시 합쳐 정렬했을 때 사용자가 놓은 순서가 재현되어야 한다.
 */
export async function reorderConsoleDateTasks(
  occurrenceDate: string,
  items: { taskId: string; recurring: boolean }[],
): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const date = String(occurrenceDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalid_date" };

  const seen = new Set<string>();
  const clean = (items ?? [])
    .map((it) => ({ taskId: String(it?.taskId ?? "").trim(), recurring: !!it?.recurring }))
    .filter((it) => it.taskId && !seen.has(it.taskId) && seen.add(it.taskId))
    .slice(0, 500);
  if (clean.length === 0) return { ok: true };

  const scope = await getTaskScope(session);
  const recurringPositions = new Map<string, number>();
  const oneOffUpdates: { taskId: string; index: number }[] = [];
  clean.forEach((it, index) => {
    if (!scope.taskIds.has(it.taskId)) return;
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
  revalidatePath(CONSOLE_PATH);
  // 회차 순서 저장이 실패하면 화면만 바뀐 채 새로고침에서 되돌아간다 — 조용히 넘기지 않는다.
  if (!orderOk) return { ok: false, error: "save_failed" };
  return { ok: true };
}

// `deletedIds` is what `restoreConsoleTasks` can undo. `leftIds` cannot be undone this way (undoing
// a leave means re-adding participant rows), so the caller must not promise undo for those.
export type BulkDeleteResult =
  | { ok: true; deletedIds: string[]; leftIds: string[]; failedIds: string[] }
  | { ok: false; error: string };

export async function bulkDeleteConsoleTasks(taskIds: string[]): Promise<BulkDeleteResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  // 상한 200 — 모바일 `deleteTasksInList` 와 동일.
  const ids = [...new Set((taskIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))].slice(
    0,
    200,
  );
  if (!ids.length) return { ok: true, deletedIds: [], leftIds: [], failedIds: [] };

  const deletedIds: string[] = [];
  const leftIds: string[] = [];
  const failedIds: string[] = [];

  // 배치 조회 한 번. 예전에는 id 마다 `getTaskDetail` 을 불러서, 200건 선택 시 한 번의 클릭이
  // 수백 쿼리로 번졌다(건당 tasks + task_updates + 참여자 + 컨텍스트). `getTasksByIds` 는 RLS
  // 스코프라 여기서도 «이 사용자가 건드려도 되는 행인가»를 그대로 증명한다 — 결과에 없는 id 는
  // 조용히 버리지 않고 실패로 보고한다(2026-08-28).
  const found = await getTasksByIds(session, ids);
  const byId = new Map(found.map((t) => [t.id, t]));
  const resolved = ids.map((id) => ({ id, task: byId.get(id) ?? null }));

  const supabase = getSupabaseServiceClient();
  const now = new Date().toISOString();
  const mine: string[] = [];
  const theirs: string[] = [];
  for (const { id, task } of resolved) {
    if (!task) {
      failedIds.push(id);
      continue;
    }
    if (canEditTaskCore(session, task)) mine.push(id);
    else theirs.push(id);
  }

  if (mine.length) {
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: now })
      .in("id", mine)
      .eq("organization_id", session.organization.id);
    if (error) failedIds.push(...mine);
    else deletedIds.push(...mine);
  }

  if (theirs.length) {
    const { error } = await supabase
      .from("task_participants")
      .delete()
      .in("task_id", theirs)
      .eq("user_id", session.user.id);
    if (error) {
      failedIds.push(...theirs);
    } else {
      leftIds.push(...theirs);
      // Same rule as the single leave: a task with no non-author participants left goes private.
      const orphaned = resolved
        .filter(
          ({ id, task }) =>
            theirs.includes(id) &&
            task != null &&
            task.participants.filter((p) => p.role !== "author" && p.userId !== session.user.id)
              .length === 0,
        )
        .map(({ id }) => id);
      if (orphaned.length) {
        await supabase
          .from("tasks")
          .update({ is_shared: false, is_directive: false })
          .in("id", orphaned)
          .eq("organization_id", session.organization.id);
      }
    }
  }

  revalidatePath(CONSOLE_PATH);
  return { ok: true, deletedIds, leftIds, failedIds };
}

/** Undo for `bulkDeleteConsoleTasks` — restores only rows the caller authored (see above). */
export async function restoreConsoleTasks(taskIds: string[]): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const ids = [...new Set((taskIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (!ids.length) return { ok: true };
  const supabase = getSupabaseServiceClient();
  // Deleted rows are filtered out of getTaskDetail, so authorship is checked directly here.
  const { data } = await supabase
    .from("tasks")
    .select("id, created_by_user_id")
    .in("id", ids)
    .eq("organization_id", session.organization.id);
  const own = ((data ?? []) as { id: string; created_by_user_id: string }[])
    .filter((r) => isOwnerOrPlatformDeveloper(session.user, r.created_by_user_id))
    .map((r) => r.id);
  if (!own.length) return { ok: false, error: "forbidden" };
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: null })
    .in("id", own)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 9. Move to today / inbox (participant) ─────────────────────────────────────
export async function moveConsoleToToday(taskId: string): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  const today = tokyoToday();
  // 반복 업무는 이 이동을 아예 거절한다(2026-08-25). 이동은 `due_at`(=시리즈 앵커)을 다시 쓰는데,
  // 반복 앵커는 «고정»이 계약이고(2026-07-30 롤포워드 폐지) 밀린 회차는 앵커부터 계산되므로,
  // 앵커를 오늘로 당기는 순간 시리즈 위상이 바뀌고 쌓여 있던 지연 백로그가 통째로 사라진다.
  // 반복은 날짜 단위 처리(회차 건너뛰기 / 오늘로 가져오기)로 다룬다.
  if (isStandardRecurrence(task.recurrenceRule)) {
    return { ok: false, error: "recurring_series" };
  }
  // 위 가드가 반복을 먼저 걸러내므로 실질적으로 도달하지 않지만, 방어적으로 남겨 둔다(2026-07-30).
  if (!canMoveRecurringTo(task.recurrenceRule, taskAnchorDate(task), today)) {
    return { ok: false, error: "duplicate_occurrence" };
  }
  const supabase = getSupabaseServiceClient();
  // Anchor to the Tokyo operating date via due_at, preserving any time-of-day; pull out of Inbox.
  // `recurrence_instance_date` 는 건드리지 않는다 — 위 주석의 고정 앵커 계약.
  const dueAt = new Date(`${today}T${task.timeLabel ?? "00:00"}:00+09:00`).toISOString();
  const update: Database["public"]["Tables"]["tasks"]["Update"] = {
    due_at: dueAt,
    all_day: !task.timeLabel,
    scheduled_date: null,
    is_inbox: false,
  };
  const { error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", task.id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

/** Same anchor logic as `moveConsoleToToday`, one Tokyo day later. */
export async function moveConsoleToTomorrow(taskId: string): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  const tomorrow = ymdShift(tokyoToday(), 1);
  // `moveConsoleToToday` 와 같은 이유로 반복 업무는 거절한다 — 고정 앵커 계약 + 지연 백로그 소실.
  if (isStandardRecurrence(task.recurrenceRule)) {
    return { ok: false, error: "recurring_series" };
  }
  if (!canMoveRecurringTo(task.recurrenceRule, taskAnchorDate(task), tomorrow)) {
    return { ok: false, error: "duplicate_occurrence" };
  }
  const supabase = getSupabaseServiceClient();
  const dueAt = new Date(`${tomorrow}T${task.timeLabel ?? "00:00"}:00+09:00`).toISOString();
  const update: Database["public"]["Tables"]["tasks"]["Update"] = {
    due_at: dueAt,
    all_day: !task.timeLabel,
    scheduled_date: null,
    is_inbox: false,
  };
  const { error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", task.id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

export async function moveConsoleToInbox(taskId: string): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  // 프로젝트 작업을 프로젝트에서 빼는 것은 작성자(또는 개발자)만(2026-10-26) — 참여자가 남의 작업을 옮기지 못하게.
  if (task.projectId && !canEditTaskCore(session, task)) return { ok: false, error: "forbidden" };
  const supabase = getSupabaseServiceClient();
  // 관리함 = "프로젝트 밖 모든 작업"(Todoist Inbox 모델). 관리함으로 이동 = 프로젝트에서 빼는 것
  // (날짜/시간/반복 유지). is_inbox 는 뷰를 가르지 않으므로 건드리지 않는다(날짜 있는 작업의 crumb 오표시 방지).
  const { error } = await supabase
    .from("tasks")
    .update({ project_id: null, section_id: null })
    .eq("id", task.id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 10. Create project ─────────────────────────────────────────────────────────
export async function createConsoleProject(
  title: string,
  memberIds: string[],
): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const name = String(title ?? "").trim();
  if (!name) return { ok: false, error: "missing_title" };

  const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
  const inviteIds = Array.from(new Set(memberIds ?? [])).filter(
    (uid) => uid !== session.user.id && allowed.has(uid),
  );

  const id = crypto.randomUUID();
  const supabase = getSupabaseServiceClient();
  const insert: Database["public"]["Tables"]["projects"]["Insert"] = {
    id,
    organization_id: session.organization.id,
    created_by_user_id: session.user.id,
    title: name,
    description: null,
    is_shared: inviteIds.length > 0,
  };
  const { error } = await supabase.from("projects").insert(insert);
  if (error) return { ok: false, error: "save_failed" };

  const participantRows: Database["public"]["Tables"]["project_participants"]["Insert"][] = [
    {
      project_id: id,
      user_id: session.user.id,
      role: "owner",
      is_first_recipient: false,
      added_by_user_id: null,
    },
    ...inviteIds.map((uid, index) => ({
      project_id: id,
      user_id: uid,
      role: "member",
      is_first_recipient: index === 0,
      added_by_user_id: session.user.id,
    })),
  ];
  const { error: pError } = await supabase
    .from("project_participants")
    .insert(participantRows);
  if (pError) {
    await supabase.from("projects").delete().eq("id", id);
    return { ok: false, error: "save_failed" };
  }

  if (inviteIds.length > 0) {
    await notifyProjectMembers(supabase, {
      organizationId: session.organization.id,
      projectId: id,
      recipientUserIds: inviteIds,
      actorUserId: session.user.id,
      dedupeBase: `project_shared:${id}`,
      payload: { projectId: id, projectTitle: name, actorUserId: session.user.id, event: "shared" },
    });
  }

  revalidatePath(CONSOLE_PATH);
  return { ok: true, id };
}

// ── 11. Daily report (delegate to the shared staff-only generator) ─────────────
export async function generateConsoleReport(date: string): Promise<DailyReportResult> {
  return generateDailyReport(date);
}

export async function sendConsoleReportToSlack(
  date: string,
  text: string,
): Promise<SendDailyReportToSlackResult> {
  return sendDailyReportToSlack(date, text);
}

// ── 12. Load full task detail (updates + resolved context) for the right panel ─────────────
// getTaskDetail is RLS-scoped, so a non-null result already proves the viewer participates.
export type ConsoleTaskDetailResult =
  | { ok: true; task: TaskDetail }
  | { ok: false; error: string };

export async function getConsoleTaskDetail(taskId: string): Promise<ConsoleTaskDetailResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const task = await getTaskDetail(session, taskId);
  if (!task) return { ok: false, error: "not_found" };
  return { ok: true, task };
}

// ── 13. Load a project's sections + tasks for the console project view ─────────
// getProjectDetail is RLS-scoped, so a non-null result proves the viewer is a project member.
export type ConsoleProjectDetailResult =
  | { ok: true; project: ProjectDetailData }
  | { ok: false; error: string };

export async function getConsoleProjectDetail(
  projectId: string,
): Promise<ConsoleProjectDetailResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const id = String(projectId ?? "").trim();
  if (!id) return { ok: false, error: "not_found" };
  const project = await getProjectDetail(session, id);
  if (!project) return { ok: false, error: "not_found" };
  return { ok: true, project };
}

/**
 * Owner-only project delete. Hard delete that cascades to participants, sections, and the project's
 * tasks (FK `on delete cascade`) — deleting a whole project is a deliberate, non-undoable action
 * (kept behind a confirm in the UI), so it intentionally does NOT use the task soft-delete/undo path.
 * Mirrors the mobile `deleteProject`. Org-scoped service-role write; `getProjectDetail` is RLS-scoped
 * so a non-null result already proves the caller is a member, and `viewerIsOwner` gates the delete.
 */
/* ── 프로젝트 섹션 · 멤버 (2026-07-30) ───────────────────────────────────────────
   모바일에만 있던 프로젝트 구성 기능을 콘솔로 가져온다. 관리자가 프로젝트를 짜는 화면인데 섹션과
   멤버를 만질 수 없던 격차를 메우는 것. 모바일 액션(`mobile/tasks/projects/actions.ts`)은
   FormData + redirect 시그니처라 그대로 못 쓰고, 콘솔 관례인 `TaskActionResult` 반환형으로 다시
   쓴다 — 권한 규칙(**소유자만**)과 부수 효과는 모바일과 동일하게 유지한다. */

/** 소유자 확인 + 프로젝트 로드. `getProjectDetail` 은 RLS 스코프라 non-null 이면 참여자임이 증명된다. */
type OwnedProject =
  | { ok: false; error: string }
  | { ok: true; session: Session; project: ProjectDetailData; id: string };

async function resolveOwnedProject(projectId: string): Promise<OwnedProject> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const id = String(projectId ?? "").trim();
  if (!id) return { ok: false, error: "not_found" };
  const project = await getProjectDetail(session, id);
  if (!project) return { ok: false, error: "not_found" };
  if (!project.viewerCanManage) return { ok: false, error: "forbidden" };
  return { ok: true, session, project, id };
}

export async function addConsoleProjectSection(
  projectId: string,
  title: string,
): Promise<TaskActionResult> {
  const r = await resolveOwnedProject(projectId);
  if (!r.ok) return { ok: false, error: r.error };
  const name = String(title ?? "").trim();
  if (!name) return { ok: false, error: "missing_title" };
  const nextOrder = r.project.sections.reduce((max, s) => Math.max(max, (s.sortOrder ?? 0) + 1), 0);
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("project_sections")
    .insert({ project_id: r.id, title: name, sort_order: nextOrder });
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

export async function renameConsoleProjectSection(
  projectId: string,
  sectionId: string,
  title: string,
): Promise<TaskActionResult> {
  const r = await resolveOwnedProject(projectId);
  if (!r.ok) return { ok: false, error: r.error };
  const name = String(title ?? "").trim();
  if (!name) return { ok: false, error: "missing_title" };
  if (!r.project.sections.some((s) => s.id === sectionId)) return { ok: false, error: "not_found" };
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("project_sections")
    .update({ title: name })
    .eq("id", sectionId)
    .eq("project_id", r.id);
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

export async function deleteConsoleProjectSection(
  projectId: string,
  sectionId: string,
): Promise<TaskActionResult> {
  const r = await resolveOwnedProject(projectId);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.project.sections.some((s) => s.id === sectionId)) return { ok: false, error: "not_found" };
  const supabase = getSupabaseServiceClient();
  // 스펙: 섹션을 지우면 그 안의 작업도 지운다. 삭제 정책에 맞춰 **소프트 삭제**(reads 가
  // deleted_at 을 필터)한 뒤 섹션 행을 제거한다 — 모바일과 동일.
  // 하위 작업 정리가 실패했는데 섹션만 지우면, 그 작업들은 **없는 섹션을 가리킨 채 남는다**
  // (project_id 는 있고 section_id 는 죽은 값) — 어느 목록에도 안 뜨고 되돌릴 단서도 없다.
  // 섹션 삭제 앞에서 반드시 확인한다(2026-09-08).
  const cleared = await mustWrite(
    "section delete: soft-delete child tasks",
    supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("project_id", r.id)
      .eq("section_id", sectionId),
  );
  if (!cleared) return { ok: false, error: "delete_failed" };
  const { error } = await supabase
    .from("project_sections")
    .delete()
    .eq("id", sectionId)
    .eq("project_id", r.id);
  if (error) return { ok: false, error: "delete_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

export async function inviteConsoleProjectMembers(
  projectId: string,
  userIds: string[],
): Promise<TaskActionResult> {
  const r = await resolveOwnedProject(projectId);
  if (!r.ok) return { ok: false, error: r.error };
  const allowed = new Set((await getShareableUsers(r.session)).map((u) => u.id));
  const existing = new Set(r.project.members.map((m) => m.userId));
  const newIds = Array.from(new Set(userIds ?? []))
    .filter((uid) => uid !== r.session.user.id && allowed.has(uid) && !existing.has(uid));
  if (newIds.length === 0) return { ok: true };
  const supabase = getSupabaseServiceClient();
  const hadFirst = r.project.members.some((m) => m.isFirstRecipient);
  const rows: Database["public"]["Tables"]["project_participants"]["Insert"][] = newIds.map(
    (uid, index) => ({
      project_id: r.id,
      user_id: uid,
      role: "member",
      is_first_recipient: !hadFirst && index === 0,
      added_by_user_id: r.session.user.id,
    }),
  );
  const { error } = await supabase.from("project_participants").insert(rows);
  if (error) return { ok: false, error: "save_failed" };
  await supabase.from("projects").update({ is_shared: true }).eq("id", r.id);
  await notifyProjectMembers(supabase, {
    organizationId: r.session.organization.id,
    projectId: r.id,
    recipientUserIds: newIds,
    actorUserId: r.session.user.id,
    dedupeBase: `project_shared:${r.id}`,
    payload: {
      projectId: r.id,
      projectTitle: r.project.title,
      actorUserId: r.session.user.id,
      event: "shared",
    },
  });
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

export async function removeConsoleProjectMember(
  projectId: string,
  userId: string,
): Promise<TaskActionResult> {
  const r = await resolveOwnedProject(projectId);
  if (!r.ok) return { ok: false, error: r.error };
  // 생성자(소유자)는 이 경로로 절대 제거되지 않는다 — 모바일과 동일한 방어선.
  if (userId === r.project.createdByUserId) return { ok: false, error: "forbidden" };
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("project_participants")
    .delete()
    .eq("project_id", r.id)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "delete_failed" };
  const remaining = r.project.members.filter(
    (m) => m.role !== "owner" && m.userId !== userId,
  ).length;
  if (remaining === 0) {
    await supabase.from("projects").update({ is_shared: false }).eq("id", r.id);
  }
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

export async function deleteConsoleProject(projectId: string): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const id = String(projectId ?? "").trim();
  if (!id) return { ok: false, error: "not_found" };
  const project = await getProjectDetail(session, id);
  if (!project) return { ok: false, error: "not_found" };
  if (!project.viewerCanManage) return { ok: false, error: "forbidden" };
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}
