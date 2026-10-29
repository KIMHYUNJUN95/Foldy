"use server";

import { revalidatePath } from "next/cache";
import { generateDailyReport, type DailyReportResult } from "@/actions/task-report";
import { notifyProjectMembers, notifyTaskParticipants } from "@/lib/notifications/create";
import type { TaskNotificationPayload } from "@/lib/notifications/types";
import { getProjectDetail, type ProjectDetailData } from "@/lib/projects";
import {
  canEditTaskAsOwnerOrAuthor,
  canEditTaskCore,
  getProjectMembership,
  getTaskScope,
  getShareableUsers,
  getTaskDetail,
  getTasksByIds,
  getVisibleTasks,
  isValidHm,
  isValidYmd,
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
  clearSkippedOccurrenceState,
  absorbEarlierOccurrences,
  releaseAbsorbedOccurrences,
  resolveCompletionOccurrence,
  completeOccurrence,
  occurrenceAlreadyCompleted,
  occurrenceStatesForTask,
  setOccurrenceOrders,
  setTaskSortOrders,
  skipOccurrences,
} from "@/lib/task-occurrences";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { isOwnerOrPlatformDeveloper } from "@/config/roles";
import {
  cleanupRemovedTaskImages,
  cleanupRemovedTaskUpdateImages,
  collectProjectImageUrls,
  isOrgTaskImageUrl,
  mergeTaskImageUrls,
  sanitizeTaskImageUrls,
} from "@/lib/task-images";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { linkedContextBelongsToOrg } from "@/lib/task-linked-context";
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

// 결과를 돌려주는 콘솔 액션(리다이렉트 없음)용 세션 + 조직 컨텍스트 가드.
async function resolveSession(): Promise<Session | null> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  return session;
}

// getTaskDetail 은 RLS 범위라 null 이 아니면 행위자가 이미 참여자임이 증명된다.
// 작성자 전용 액션은 작성자 여부를 추가로 확인한다.
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
 * 콘솔에서 제출한 연결 운영 컨텍스트(건물 / 객실 / 예약 / 게스트).
 *
 * 모바일 폼이 쓰는 네 컬럼(`property_id` / `room_id` / `reservation_id` /
 * `guest_name`)과 같아서, 어느 화면에서 만들든 할 일이 똑같이 연결된다. id 는 여기서
 * 불투명 값이다 — 선택기가 직접 조직 범위로 가져온 것(`fetchPickerBuildings` /
 * `fetchPickerRooms` / `fetchRoomReservations`)이고, 행 자체도 쓸 때 조직 범위로 저장된다.
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

/**
 * 연결 id 가 이 조직 것인지 확인한다(2026-10-28) — 서비스 키 쓰기라 다른 조직 예약 id 를 막아 줄 곳이
 * 여기뿐이다. 선택기가 조직 범위로만 고르게 해도 UI 를 믿지 않는다.
 */
async function contextBelongsToOrg(
  session: Session,
  ctx: ReturnType<typeof normalizeContext>,
): Promise<boolean> {
  return linkedContextBelongsToOrg(session.organization.id, {
    propertyId: ctx.property_id,
    roomId: ctx.room_id,
    reservationId: ctx.reservation_id,
  });
}

/**
 * 남의 작업을 되살릴 수 있는가(플랫폼 개발자) — **열 수 있는 작업(getTaskScope)만**(2026-10-28,
 * 05 문서 규칙). 범위는 참여자 행 · 프로젝트 소속으로 정해져 소프트 삭제된 행도 담는다.
 * 작성자 본인 것은 범위와 상관없이 되살린다.
 */
async function restorableIds(
  session: Session,
  rows: { id: string; created_by_user_id: string; project_id: string | null }[],
): Promise<string[]> {
  // 프로젝트 주인도 자기가 지운 멤버 할 일을 되살린다(2026-10-28, canEditTaskCore 와 같은 규칙).
  const membership = await getProjectMembership(
    rows.map((r) => r.project_id).filter((v): v is string => !!v),
  );
  const own = rows.filter((r) =>
    canEditTaskAsOwnerOrAuthor(
      session.user,
      r.created_by_user_id,
      r.project_id ? (membership.get(r.project_id)?.ownerUserId ?? null) : null,
    ),
  );
  if (own.every((r) => r.created_by_user_id === session.user.id)) return own.map((r) => r.id);
  const scope = await getTaskScope(session);
  return own
    .filter((r) => r.created_by_user_id === session.user.id || scope.taskIds.has(r.id))
    .map((r) => r.id);
}

// 제출된 소요 시간을 1–1440분 블록 길이로 제한하고, 범위를 벗어나거나 없으면 null.
function clampDuration(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 1 && n <= 1440 ? n : null;
}

// ── 1. 생성 ─────────────────────────────────────────────────────────────────
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
  /** 연결된 건물/객실/예약/게스트(2026-07-29 — 모바일 폼과 동일). */
  context?: ConsoleTaskContext;
  /** 이미 업로드된 공개 URL. 브라우저가 모바일과 같이 Storage 에 먼저 올린다. */
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
  // 생성에는 이전 규칙이 없으므로 `custom` 은 새로 지정할 수 없다(→ null).
  const repeat = resolveRecurrenceRule(input.repeat, null);
  const tags = input.tags.map((t) => t.trim()).filter(Boolean).slice(0, 10);
  // 반복에는 날짜 기준점이 필요하다. 반복만 정하고 날짜가 없으면 오늘을 기준으로 삼는다
  // (Todoist: "매주 월수금" 은 오늘부터 시작) — repeat_needs_date 로 거절하지 않는다.
  if (repeat && !date) date = tokyoToday();
  // 날짜 · 시각은 달력 · 시계에 실제로 있는 값만(2026-10-28) — 「2026-13-01」은 500, 「2026-02-31」은 3월로 굴렀다.
  // 날짜는 `isValidYmd`, 시각은 `isValidHm`(lib/tasks).
  if ((date && !isValidYmd(date)) || (time && !isValidHm(time))) return { ok: false, error: "invalid_date" };

  // 단일 날짜 모델: scheduledDate 는 항상 비어 있고 dueDate 가 그 하나의 날짜를 가진다.
  if (taskTimeWithoutDate({ scheduledDate: "", dueDate: date, time })) {
    return { ok: false, error: "time_needs_date" };
  }
  const { scheduledDate: sched, dueAt, allDay, timeLabel } = normalizeTaskDateTime({
    scheduledDate: "",
    dueDate: date,
    time,
  });
  // 소요 시간은 시간 블록 길이이고 시각이 있을 때만 의미가 있다.
  const finalDuration = timeLabel ? clampDuration(input.durationMinutes) : null;
  const anchorDate = taskAnchorDateInput({ scheduledDate: sched, dueAt });
  if (taskNeedsRecurrenceDate(repeat, anchorDate)) {
    return { ok: false, error: "repeat_needs_date" };
  }

  // 선택적 프로젝트 연결: getProjectDetail 은 RLS 범위라 null 이 아니면 행위자가
  // 프로젝트 참여자임이 증명된다. 프로젝트 할 일은 개별 공유/지시가 되지 않는다.
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

  // 대상은 조직의 활성 멤버로 검증한다(실패 시 닫힘). 프로젝트 할 일에는 하지 않는다.
  let shareIds: string[] = [];
  if (!linkedProjectId && input.targetUserIds.length > 0) {
    const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
    shareIds = Array.from(new Set(input.targetUserIds)).filter(
      (uid) => uid !== session.user.id && allowed.has(uid),
    );
  }
  const isDirective = !linkedProjectId && input.isDirective && shareIds.length > 0;
  // 날짜 없는 개인/공유 빠른 추가는 대기 중인 Inbox 로 들어간다(Todoist 와 동일). 날짜가 있는 할 일과
  // 프로젝트 할 일은 inbox 가 아니다.
  const isInboxTask = !sched && !dueAt && !linkedProjectId;
  const context = normalizeContext(input.context);
  if (!(await contextBelongsToOrg(session, context))) return { ok: false, error: "forbidden" };

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
    // 상한은 클라이언트를 믿지 않고 여기서 다시 적용한다(CLAUDE.md §8).
    image_urls: sanitizeTaskImageUrls(input.imageUrls ?? [], !!linkedProjectId, session.organization.id),
    project_id: linkedProjectId,
    section_id: linkedSectionId,
    ...context,
  };
  const { error } = await supabase.from("tasks").insert(insert);
  if (error) return { ok: false, error: "save_failed" };

  // 작성자 행은 참여자 행과 반드시 같은 키를 가져야 한다. 안 그러면 PostgREST 가 다중 행 insert 에서
  // 빠진 NOT NULL 컬럼을 NULL 로 채운다(모바일 생성 주석 참고).
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

// 반복 완료/재개에서 날짜를 넘기지 않았을 때 대상이 되는 발생 날짜: 고정된 기준점.
function recurringAnchorDate(task: TaskDetail): string {
  return task.recurrenceInstanceDate ?? tokyoDateOf(task.dueAt) ?? task.scheduledDate ?? tokyoToday();
}

// 공유 완료(2026-07-30): 반복 할 일은 주어진 발생 날짜를
// `task_occurrence_state` 에 기록하고 행은 건드리지 않는다(앞으로 굴리지 않음). 1회성은 완료 시각을 찍는다.
// 둘 다 `completed` 를 기록하고 참여자에게 알린다.
async function completeInternal(
  session: Session,
  task: TaskDetail,
  occurrenceDate?: string,
): Promise<{ ok: boolean; recorded?: string }> {
  const supabase = getSupabaseServiceClient();
  let recorded: string | undefined;
  // 이미 완료된 일회성 작업은 아무것도 하지 않는다(2026-10-26) — 두 번 눌러도 완료 기록 · 알림이 중복되지 않게.
  // 읽어 둔 상태는 빠른 길일 뿐이고, 실제 막음은 아래 조건부 UPDATE(.neq completed)가 한다(2026-10-28).
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
    // 이미 완료된 회차면 아무것도 하지 않는다(2026-10-28, 모바일 `completeTask` 와 같은 규칙) — 완료 기록 ·
    // 알림이 겹치지 않게. 결과는 성공으로 돌려 화면의 체크를 그대로 둔다.
    if (await occurrenceAlreadyCompleted(task.id, occ)) {
      return { ok: true, recorded: occ };
    }
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
    // 아직 완료가 아닌 행만 바꾼다(2026-10-28) — 동시에 두 번 눌러도 한 번만 통과한다.
    const { data: completedRows, error: completeError } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by_user_id: session.user.id,
      })
      .eq("id", task.id)
      .eq("organization_id", session.organization.id)
      .neq("status", "completed")
      .select("id");
    if (completeError) {
      console.error("[db-write] task: complete failed:", completeError.message);
      return { ok: false };
    }
    if (!completedRows || completedRows.length === 0) return { ok: true };
  }
  await bestEffortWrite(
    "task_updates: insert",
    supabase.from("task_updates").insert({
        task_id: task.id,
        created_by_user_id: session.user.id,
        update_type: "completed",
        // 반복은 회차 날짜를 함께 남긴다(2026-10-28) — 업무일지가 (작업, 회차)별로 완료 · 다시 열기를 맞춘다.
        body: recorded ?? null,
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

// 공유 재개: 반복은 그 발생분의 기록된 상태를 지우고, 1회성은 완료
// 표시를 지운다. `reopened` 를 기록하고 알림은 없다.
async function reopenInternal(
  session: Session,
  task: TaskDetail,
  occurrenceDate?: string,
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  let reopenedOcc: string | null = null;
  if (isStandardRecurrence(task.recurrenceRule)) {
    const occ = String(occurrenceDate ?? "").trim() || recurringAnchorDate(task);
    reopenedOcc = occ;
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
        body: reopenedOcc, // 어느 회차를 다시 열었는지(업무일지 상쇄용)
      })
  );
  return true;
}

// ── 2. 상태 ───────────────────────────────────────────────────────────────
const CONSOLE_STATUSES = new Set(["open", "in_progress", "completed"]);

/**
 * 권한은 모바일과 같다 — 작업을 열 수 있는 참여자(`resolveTask`)면 상태를 바꾼다(모바일 `completeTask` ·
 * `setTaskProgress` 도 참여자에게 열려 있다). 상태 값은 세 가지만 받는다(2026-10-28) — 예전엔 클라이언트가
 * 보낸 문자열을 그대로 써서 `cancelled` 같은 값도 들어갔다.
 */
export async function setConsoleTaskStatus(
  taskId: string,
  status: "open" | "in_progress" | "completed",
  occurrenceDate?: string,
): Promise<TaskActionResult> {
  if (!CONSOLE_STATUSES.has(String(status))) return { ok: false, error: "forbidden" };
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;

  if (status === "completed") {
    const done = await completeInternal(session, task, occurrenceDate);
    if (!done.ok) return { ok: false, error: "save_failed" };
    revalidatePath(CONSOLE_PATH);
    return { ok: true, occurrenceDate: done.recorded };
  }
  if (isStandardRecurrence(task.recurrenceRule)) {
    // 반복 업무의 행은 언제나 열림이다 — 완료는 회차별로 든다(2026-07-30). 행을 진행 중으로 바꾸면 모든 회차가
    // 함께 «진행 중»이 된다. 모바일 `setTaskProgress` 와 같이 거절한다(2026-10-28).
    if (status === "in_progress") return { ok: false, error: "forbidden" };
    // 완료된 회차를 다시 여는 것(status→open)은 그 회차의 상태를 지울 뿐 행은 건드리지 않는다.
    // 예전 데이터로 행이 진행 중인 반복이면 아래 행 갱신으로 넘어가 열림으로 돌린다.
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
  const saved = await mustWrite(
    "task: set status",
    supabase
      .from("tasks")
      .update({
        status,
        completed_at: null,
        completed_by_user_id: null,
      })
      .eq("id", task.id)
      .eq("organization_id", session.organization.id),
  );
  if (!saved) return { ok: false, error: "save_failed" };
  // 완료였던 작업은 어느 쪽으로 가든 완료 도장이 지워지므로 `reopened` 를 남긴다(2026-10-28) — 진행 중으로
  // 바꿀 때 상태 변경만 적으면 기록 · 업무일지가 여전히 «완료»로 셌다. 진행 중으로 간 경우는 그 전환도 적는다.
  // 여러 행 insert 는 키 모양이 같아야 해서(빠진 키는 NULL) body 를 모두 적는다.
  const logs: Database["public"]["Tables"]["task_updates"]["Insert"][] = [];
  if (task.status === "completed") {
    logs.push({ task_id: task.id, created_by_user_id: session.user.id, update_type: "reopened", body: null });
  }
  if (task.status !== "completed" || status === "in_progress") {
    logs.push({
      task_id: task.id,
      created_by_user_id: session.user.id,
      update_type: "status_changed",
      body: status,
    });
  }
  await bestEffortWrite("task_updates: insert", supabase.from("task_updates").insert(logs));
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 3. 완료 토글(체크박스) ──────────────────────────────────────────────
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

// ── 반복 지연 밀림 해소(2026-07-30, 모바일 액션과 동일) ────────────────
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
 * 건너뛰기 되돌리기(실행 취소 토스트 · 상세의 「건너뛴 날 → 되살리기」). «건너뜀» 상태일 때만 지운다
 * (2026-10-28) — 그 사이 같은 회차가 완료됐다면 그 완료를 풀지 않는다.
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
  if (!(await clearSkippedOccurrenceState(task.id, date))) return { ok: false, error: "save_failed" };
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 4. 핵심 수정(작성자만) ─────────────────────────────────────────────────
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
  /** 연결된 건물/객실/예약/게스트. 생략하면 기존 연결을 그대로 둔다. */
  context?: ConsoleTaskContext;
  /** 이미 업로드된 URL 전체로 교체한다. 생략하면 사진을 그대로 둔다. */
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
  if ((date && !isValidYmd(date)) || (time && !isValidHm(time))) return { ok: false, error: "invalid_date" };

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
  // 사진과 컨텍스트는 선택적 패치다. 생략한 필드는 저장된 값을 그대로 두므로
  // 제목만 고치는 호출자가 링크나 사진 연결을 모르는 사이에 지우지 않는다.
  const nextImageUrls =
    input.imageUrls === undefined
      ? null
      : mergeTaskImageUrls(task.imageUrls, input.imageUrls, !!task.projectId, session.organization.id);
  if (nextImageUrls) update.image_urls = nextImageUrls;
  if (input.context !== undefined) {
    const context = normalizeContext(input.context);
    if (!(await contextBelongsToOrg(session, context))) return { ok: false, error: "forbidden" };
    Object.assign(update, context);
  }

  // 이번 수정에서 분리된 파일 — 클라이언트 입력이 아니라 서버가 아는 값으로 정한다.
  const removedImageUrls = nextImageUrls
    ? task.imageUrls.filter((u) => !nextImageUrls.includes(u))
    : [];
  const { error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", task.id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  // DB 가 더는 참조하지 않는 것을 확인한 뒤에만, 분리된 파일을 하드 삭제한다.
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

// ── 5. 일정 변경(작성자만) ────────────────────────────────────────────────
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
  // 날짜를 비우면 일정이 지워져 할 일이 날짜 없는 Inbox 로 돌아간다(Todoist "날짜 제거").
  // 기준점이 없으면 반복 규칙이 의미가 없으므로 같이 지운다.
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
  if (!isValidYmd(date) || (time && !isValidHm(time))) return { ok: false, error: "invalid_date" };

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
 * 반복의 지연은 회차 단위(`task_occurrence_state`)라 여기서 제외한다 — 밀린 회차는 다음 완료가
 * 흡수하고(`absorbEarlierOccurrences`), 한 회차만 빼려면 `skipConsoleOccurrence` 를 쓴다.
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
  if (!isValidYmd(date)) return { ok: false, error: "invalid_date" };
  const allowed = new Set((taskIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean));
  if (allowed.size === 0) return { ok: true };
  const today = tokyoToday();
  const targets = (await getVisibleTasks(session)).filter(
    (t) => allowed.has(t.id) && isConsoleOverdueOwned(t, today, session.user.id),
  );
  if (targets.length === 0) return { ok: true };

  const supabase = getSupabaseServiceClient();
  const results = await Promise.all(
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
  // 일부라도 실패하면 알린다 — 화면은 전부 옮겨진 줄 안다.
  if (results.some((r) => r.error)) return { ok: false, error: "save_failed" };
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

// ── 6. 공유 / 지시로 배정(작성자만) ──────────────────────────────────────
export async function shareConsoleTask(
  taskId: string,
  userIds: string[],
  asDirective: boolean,
): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  // 프로젝트 할 일은 개별 공유가 아니라 프로젝트 멤버십이 관리한다.
  if (task.projectId) return { ok: false, error: "forbidden" };
  // 플랫폼 개발자는 작성자와 같은 힘(빼기 · 지시 바꾸기)을 갖는다(2026-10-23).
  const isAuthor = canEditTaskCore(session, task);
  const isParticipant = task.participants.some((p) => p.userId === session.user.id);
  if (!isAuthor && !isParticipant) return { ok: false, error: "forbidden" };

  // 참여자 집합을 정확히 `userIds` 로 맞춘다(선택기가 기존 참여자를 미리 체크해 보여 주므로
  // 체크를 풀면 추가만이 아니라 제거도 해야 한다). 작성자는 건드리지 않는다.
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
    // 첫 수신자는 남겨 둔(제거되지 않은) 참여자가 이미 가지고 있을 때만 그대로 남는다.
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

// ── 7. 메모 추가(참여자) ──────────────────────────────────────────────────
export async function addConsoleNote(
  taskId: string,
  body: string,
  imageUrls: string[] = [],
): Promise<TaskActionResult> {
  const resolved = await resolveTask(taskId);
  if (!resolved) return { ok: false, error: "not_found" };
  const { session, task } = resolved;
  const text = String(body ?? "").trim();
  // 업데이트 기록 사진은 프로젝트 할 일이어도 5장이다 — 20장 상한은 할 일 단위에만 적용된다.
  // 메모 사진은 우리 스토리지의 `{org}/task-update-images/` 객체만(2026-10-26, 모바일 addTaskUpdate 와 같다).
  const photos = Array.from(new Set((imageUrls ?? []).map((v) => String(v))))
    .filter((u) => isOrgTaskImageUrl(u, session.organization.id, "task-update-images"))
    .slice(0, 5);
  if (!text && photos.length === 0) return { ok: false, error: "empty" };

  const supabase = getSupabaseServiceClient();
  // 메모는 이 액션의 본 데이터다 — 저장이 실패했는데 성공을 돌려주면 입력이 사라진다(2026-10-28).
  const saved = await mustWrite(
    "task_updates: insert note",
    supabase.from("task_updates").insert({
        task_id: task.id,
        created_by_user_id: session.user.id,
        update_type: "note",
        body: text || null,
        image_urls: photos,
      }),
  );
  if (!saved) return { ok: false, error: "save_failed" };
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

// ── 8. 삭제(작성자) / 나가기(참여자) ───────────────────────────────────
// 사용자 삭제는 이제 소프트 삭제(`deleted_at`)라 실행 취소 토스트 / restoreConsoleTask 가
// 되살릴 수 있다. 읽기는 `deleted_at is null` 로 거르므로 소프트 삭제된 할 일은 모든 화면에서 사라진다.
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

// 소프트 삭제 실행 취소. getTaskDetail 은 삭제된 행을 거르므로 여기서는 행을 직접 읽고
// `deleted_at` 을 지우기 전에 작성자 여부를 확인한다.
export async function restoreConsoleTask(taskId: string): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false, error: "not_found" };
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("tasks")
    .select("created_by_user_id, project_id")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const row = data as { created_by_user_id: string; project_id: string | null } | null;
  if (!row) return { ok: false, error: "not_found" };
  if ((await restorableIds(session, [{ id, ...row }])).length === 0) {
    return { ok: false, error: "forbidden" };
  }
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

  // 작성자가 나가면 모두에게 삭제된 것이다(소프트 삭제라 일반 삭제처럼 실행 취소할 수 있다).
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

  // 내 참여자 행이 없으면 나갈 것이 없다(2026-10-28) — 남이 만든 **프로젝트** 작업은 참여자 행 없이 프로젝트
  // 소속으로만 보인다. 예전엔 지울 행이 없는데도 «남은 참여자 0» 으로 보고 남의 작업을 비공개 · 지시 해제했다.
  // 프로젝트 작업에서 빠지는 길은 프로젝트 나가기다.
  if (!task.participants.some((p) => p.userId === session.user.id && p.role !== "author")) {
    return { ok: false, error: "forbidden" };
  }
  const left = await mustWrite(
    "task_participants: leave",
    supabase.from("task_participants").delete().eq("task_id", task.id).eq("user_id", session.user.id),
  );
  if (!left) return { ok: false, error: "save_failed" };
  // 작성자 외 참여자가 없으면 할 일은 비공개로(지시도 해제) 돌아간다.
  const remainingNonAuthor = task.participants.filter(
    (p) => p.role !== "author" && p.userId !== session.user.id,
  ).length;
  if (remainingNonAuthor === 0) {
    await bestEffortWrite(
      "task: clear is_shared after last participant left",
      supabase
        .from("tasks")
        .update({ is_shared: false, is_directive: false })
        .eq("id", task.id)
        .eq("organization_id", session.organization.id),
    );
  }
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 8b. Bulk delete (selection mode + 지난 미완료 정리) ─────────────────────────
// 할 일 하나를 삭제할 때와 똑같이 하되 선택 전체를 한 번의 왕복으로 처리한다: 내가 만든 할 일은
// 소프트 삭제(실행 취소 가능), 참여만 하는 할 일은 대신 나간다
// (`task_participants` 에서 나를 제거) — `leaveConsoleTask` 와 같은 작성자/참여자 구분이다.
// 참여자에게는 남의 할 일을 삭제할 권한이 없기 때문이다.
//
// 관리함(Inbox) 목록의 수동 드래그 순서를 저장한다(2026-07-30). `orderedIds` 가 새
// 위에서 아래 순서이고, 각 행의 `sort_order` 를 그 인덱스로 정한다. 조직 범위. 모바일
// `reorderTasks` 와 같다. `sort_order` 는 할 일 전체에 대해 하나이며 오늘 드래그 순서와 공유한다.
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

// `deletedIds` 는 `restoreConsoleTasks` 가 되돌릴 수 있는 것이다. `leftIds` 는 이렇게 되돌릴 수 없으므로
// (나가기를 되돌리려면 참여자 행을 다시 넣어야 한다) 호출자는 그쪽에 실행 취소를 약속하면 안 된다.
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
    // 남의 작업은 **내 참여자 행이 있을 때만** 나간다(2026-10-28, `leaveConsoleTask` 와 같은 규칙). 남이 만든
    // 프로젝트 작업은 참여자 행이 없어 나갈 것이 없다 — 실패로 보고하고 그 작업은 건드리지 않는다.
    else if (task.participants.some((p) => p.userId === session.user.id && p.role !== "author")) {
      theirs.push(id);
    } else failedIds.push(id);
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
      // 한 건 나가기와 같은 규칙: 작성자 외 참여자가 남지 않은 할 일은 비공개로 돌아간다.
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
        await bestEffortWrite(
          "tasks: clear is_shared after bulk leave",
          supabase
            .from("tasks")
            .update({ is_shared: false, is_directive: false })
            .in("id", orphaned)
            .eq("organization_id", session.organization.id),
        );
      }
    }
  }

  revalidatePath(CONSOLE_PATH);
  return { ok: true, deletedIds, leftIds, failedIds };
}

/** `bulkDeleteConsoleTasks` 의 실행 취소 — 호출자가 만든 행만 되살린다(위 참고). */
export async function restoreConsoleTasks(taskIds: string[]): Promise<TaskActionResult> {
  const session = await resolveSession();
  if (!session) return { ok: false, error: "auth" };
  const ids = [...new Set((taskIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (!ids.length) return { ok: true };
  const supabase = getSupabaseServiceClient();
  // 삭제된 행은 getTaskDetail 에서 걸러지므로 여기서 작성자 여부를 직접 확인한다.
  const { data } = await supabase
    .from("tasks")
    .select("id, created_by_user_id, project_id")
    .in("id", ids)
    .eq("organization_id", session.organization.id);
  const own = await restorableIds(
    session,
    (data ?? []) as { id: string; created_by_user_id: string; project_id: string | null }[],
  );
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

// ── 9. 오늘 / Inbox 로 옮기기(참여자) ──────────────────────────────────
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
  // due_at 으로 도쿄 운영 날짜에 맞추되 시각은 유지하고, Inbox 에서 꺼낸다.
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

/** `moveConsoleToToday` 와 같은 기준점 로직이고 도쿄 기준 하루 뒤. */
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
  // 프로젝트 주인의 편집 권한(2026-10-28)은 여기 안 넓힌다 — 남의 할 일을 프로젝트 밖으로 빼지 않게.
  if (task.projectId && !isOwnerOrPlatformDeveloper(session.user, task.createdByUserId)) return { ok: false, error: "forbidden" };
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

// ── 10. 프로젝트 생성 ─────────────────────────────────────────────────────
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

// ── 11. 일일 보고(공용 직원 전용 생성기에 위임) ───────────────────────
export async function generateConsoleReport(date: string): Promise<DailyReportResult> {
  return generateDailyReport(date);
}

// ── 12. 오른쪽 패널용 할 일 상세 전체 불러오기(업데이트 + 해석된 컨텍스트) ─────
// getTaskDetail 은 RLS 범위라 null 이 아니면 보는 사람이 참여자임이 이미 증명된다.
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

// ── 13. 콘솔 프로젝트 보기용 프로젝트의 섹션 + 할 일 불러오기 ───────────────
// getProjectDetail 은 RLS 범위라 null 이 아니면 보는 사람이 프로젝트 멤버임이 증명된다.
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
 * 프로젝트 소유자 전용 삭제. 참여자, 섹션, 프로젝트의 할 일까지 연쇄 삭제하는 하드 삭제다
 * (FK `on delete cascade`) — 프로젝트 전체를 지우는 것은 의도적이고 되돌릴 수 없는 동작이며
 * (UI 에서 확인 단계를 거친다) 그래서 일부러 할 일 소프트 삭제/실행 취소 경로를 쓰지 않는다.
 * 모바일 `deleteProject` 와 같다. 조직 범위 service-role 쓰기. `getProjectDetail` 은 RLS 범위라
 * null 이 아니면 호출자가 멤버임이 이미 증명되고, 삭제는 `viewerIsOwner` 로 막는다.
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
  // 섹션 행이 지워지면 FK(`on delete set null`)가 그 할 일들의 section_id 를 비운다 — 나중에 하나를 되살리면
  // **섹션 없는 프로젝트 할 일**로 돌아와 프로젝트 화면의 기본 묶음에 보인다(2026-10-28 확인).
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
  // cascade 는 행만 지우고 스토리지 사진은 남긴다(2026-10-28 · 메모 사진 2026-10-29) — 지우기 전에 경로를 모아 둔다.
  const { taskImageUrls, updateImageUrls } = await collectProjectImageUrls(supabase, id, session.organization.id);
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };
  // 행이 지워진 뒤에 지운다 — 공용 헬퍼가 «조직의 다른 할 일이 아직 쓰는 파일»은 남긴다.
  await cleanupRemovedTaskImages(supabase, taskImageUrls, session.organization.id);
  await cleanupRemovedTaskUpdateImages(supabase, updateImageUrls, session.organization.id);
  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}
