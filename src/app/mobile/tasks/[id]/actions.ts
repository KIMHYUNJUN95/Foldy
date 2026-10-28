"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notifyTaskParticipants } from "@/lib/notifications/create";
import type { TaskNotificationPayload } from "@/lib/notifications/types";
import {
  canEditTaskAsOwnerOrAuthor,
  canEditTaskCore,
  getProjectMembership,
  getShareableUsers,
  getTaskScope,
  getTaskDetail,
  getVisibleTasks,
  isValidHm,
  isValidYmd,
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
  clearSkippedOccurrenceState,
  completeOccurrence,
  occurrenceAlreadyCompleted,
  resolvedOccurrenceDates,
  setOccurrenceOrders,
  setTaskSortOrders,
  skipOccurrences,
} from "@/lib/task-occurrences";
import {
  cleanupRemovedTaskImages,
  isOrgTaskImageUrl,
  mergeTaskImageUrls,
} from "@/lib/task-images";
import { linkedContextBelongsToOrg } from "@/lib/task-linked-context";
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

// 프로젝트 할 일은 프로젝트 페이지에도 보이므로, 거기서 상태를 바꾸면 그 페이지도 revalidate 해야 한다 —
// 안 그러면 프로젝트 상세의 체크박스/진행률이 갱신되지 않는다(오늘/상세만 갱신됐음).
function revalidateProjectPath(projectId: string | null) {
  if (projectId) revalidatePath(`/mobile/tasks/projects/${projectId}`);
}

// getTaskDetail 은 RLS 범위 클라이언트를 쓰므로, null 이 아닌 결과는 이미 행동하는 사용자가
// 참여자임을 증명한다. 작성자 전용 액션은 작성 여부를 추가로 확인한다.
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

// 오늘 탭 안내용 "지난 할 일": 호출자 본인이 만든, 활성 상태의, 프로젝트가 아닌 할 일 중
// 마감 도쿄 날짜가 오늘 이전인 것 — 오늘 보기의 지난 섹션과 같다. 일괄 액션이 남의 공유 할 일을
// 옮기거나 지우지 않도록 본인이 만든 할 일로 한정한다.
function isOverdueOwned(t: TaskRecord, today: string, userId: string): boolean {
  if (t.projectId || t.createdByUserId !== userId) return false;
  if (t.status === "completed" || t.status === "cancelled") return false;
  // 반복 할 일의 지남은 회차(task_occurrence_state)별로 따진다(완료 흡수 · 회차 건너뛰기) —
  // 행 마감 기준 일괄 액션은 건드리지 않는다(2026-07-30 롤포워드 폐지).
  if (isStandardRecurrence(t.recurrenceRule)) return false;
  const due = tokyoDateOf(t.dueAt);
  return !!due && due < today;
}

/**
 * "일정변경" — 선택한 지난 할 일을 `targetDate`(YYYY-MM-DD, 도쿄)로 옮긴다.
 * `taskIds` 는 사용자가 고른 ID 이고, 서버가 각각 실제로 지났고 본인 소유인지 다시 검증한다.
 */
export async function rescheduleOverdueTo(targetDate: string, taskIds: string[]) {
  // 날짜 모양을 먼저 본다(2026-10-26) — 이상한 값이 오면 `new Date(...).toISOString()` 이
  // RangeError 를 던져 서버 액션이 500 으로 끝났다.
  const date = String(targetDate ?? "").trim();
  if (!isValidYmd(date)) return;
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
    // 단발성만 — 반복은 isOverdueOwned 가 제외한다(회차별로 처리).
    const dueAt = new Date(`${date}T${t.timeLabel || "00:00"}:00+09:00`).toISOString();
    await supabase
      .from("tasks")
      .update({ due_at: dueAt })
      .eq("id", t.id)
      .eq("organization_id", orgId);
  }
  revalidatePath("/mobile/tasks");
}

/**
 * "지난 미완료 삭제" — 선택한 지난 단발성 할 일을 소프트 삭제한다. 반복 할 일은
 * 이 경로에서 제외된다(isOverdueOwned) — 반복의 밀린 회차는 다음 완료가 흡수하고
 * (`absorbEarlierOccurrences`), 한 회차만 빼려면 `skipOccurrenceOn` 을 쓴다.
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
 * 건너뛰기 되돌리기(토스트의 "실행 취소" · 상세의 「건너뛴 날 → 되살리기」).
 *
 * «건너뜀» 상태일 때만 지운다(2026-10-28) — 그 사이 같은 회차가 완료됐다면 그 완료를 풀지 않는다.
 * 결과를 돌려줘, 상세의 되살리기 줄이 실패하면 다시 펴고 알릴 수 있다.
 */
export async function unskipOccurrenceOn(taskId: string, occurrenceDate: string): Promise<{ ok: boolean }> {
  const id = String(taskId ?? "").trim();
  const date = String(occurrenceDate ?? "").trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false };
  const { task } = await requireSessionAndTask(id);
  if (!isOccurrenceDate(task, date)) return { ok: false };
  if (!(await clearSkippedOccurrenceState(id, date))) return { ok: false };
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
  return { ok: true };
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

// 편집 실패는 편집 화면으로 돌려보낸다(2026-10-26) — 상세 화면은 `?error=` 를 그리지 않아 실패가
// 조용히 묻혔다. 편집 폼은 이 값을 오류로 보여 주고 입력(초안)을 그대로 둔다. 키는 문자열 그대로
// 적는다 — `action-error-keys.test.ts` 가 소스에서 `?error=키` 를 뽑아 사전에 있는지 확인한다.
export async function updateTaskCore(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const { session, task } = await requireSessionAndTask(id);
  if (!canEditTaskCore(session, task)) {
    redirect(`/mobile/tasks/${id}/edit?error=forbidden`);
  }

  const title = cleanText(formData.get("title"));
  if (!title) {
    redirect(`/mobile/tasks/${id}/edit?error=missing_title`);
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
  // 프로젝트 할 일은 사진 20장까지 허용하고, 일반 할 일은 기본 5장을 유지한다. 할 일에 이미 있는 사진은
  // 상한을 넘어도 유지된다(예: 프로젝트에서 빼낸 경우) — 새로 추가하는 것만 상한을 적용한다. 새 URL 은
  // 우리 `{org}/task-images/` 스토리지 객체여야 한다(2026-10-26) — lib/task-images 참고.
  const imageUrls = mergeTaskImageUrls(
    task.imageUrls,
    formData.getAll("imageUrls").map(String),
    !!task.projectId,
    session.organization.id,
  );
  const ctxPropertyId = cleanText(formData.get("ctxPropertyId")) || null;
  const ctxRoomId = cleanText(formData.get("ctxRoomId")) || null;
  const ctxReservationId = cleanText(formData.get("ctxReservationId")) || null;
  const ctxGuestName = cleanText(formData.get("ctxGuestName")) || null;
  // 연결 id 는 이 조직 것만(2026-10-28) — 서비스 키 쓰기라 다른 조직 예약 id 를 막아 줄 곳이 여기뿐이다.
  if (
    !(await linkedContextBelongsToOrg(session.organization.id, {
      propertyId: ctxPropertyId,
      roomId: ctxRoomId,
      reservationId: ctxReservationId,
    }))
  ) {
    redirect(`/mobile/tasks/${id}/edit?error=forbidden`);
  }
  const nextRecurrenceRule = resolveRecurrenceRule(repeatRaw, task.recurrenceRule);
  // 반복에는 날짜 기준이 필요하다. 날짜 없는 반복은 거부하지 않고 오늘로 기준을 잡는다(Todoist 방식).
  if (nextRecurrenceRule && !scheduledDate && !dueDate) scheduledDate = tokyoToday();
  // 비어 있지 않은 날짜 · 시각은 실제로 있는 값이어야 한다(2026-10-28) — 「2026-02-31」 · 「25:00」을 조용히
  // 버리거나 굴리지 않고 수정 화면으로 되돌린다(새 키 없이 기존 save_failed 문구).
  if (
    (scheduledDate && !isValidYmd(scheduledDate)) ||
    (dueDate && !isValidYmd(dueDate)) ||
    (time && !isValidHm(time))
  ) {
    redirect(`/mobile/tasks/${id}/edit?error=save_failed`);
  }
  // 특정 시각에는 날짜 기준이 필요하다 — 조용히 버리지 않고 거부한다(수정 화면으로 되돌림).
  if (taskTimeWithoutDate({ scheduledDate, dueDate, time })) {
    redirect(`/mobile/tasks/${id}/edit?error=time_needs_date`);
  }
  // 날짜/시각 저장은 하나의 공용 규칙을 쓴다(lib/tasks normalizeTaskDateTime 참고) — 생성과
  // 수정이 똑같다: 종일을 켜면 시각이 깔끔히 지워지고 time_label/due_at 이 남지 않는다.
  const { scheduledDate: sched, dueAt, allDay, timeLabel } = normalizeTaskDateTime({
    scheduledDate,
    dueDate,
    time,
  });
  // 소요 시간은 시간 블록 길이(1–1440분)이며 시각이 있을 때만 의미가 있다.
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
    // `custom` 은 이 할 일이 이미 custom 이었던 경우에만 유지한다. custom 이 아닌 할 일은 custom 이 될 수 없다.
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
  // 이번 수정에서 작성자가 뗀 파일(서버가 가진 이전 집합에서 새 집합을 뺀 것).
  const removedImageUrls = task.imageUrls.filter((u) => !imageUrls.includes(u));
  const { error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) {
    redirect(`/mobile/tasks/${id}/edit?error=save_failed`);
  }
  // DB 가 더는 참조하지 않게 된 뒤에만, 뗀 파일을 완전 삭제한다.
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

export type MoveToInboxResult =
  | { ok: true; previousProjectId: string; previousSectionId: string | null }
  | { ok: false; reason: "auth" | "not_found" | "forbidden" | "not_in_project" | "save_failed" };

// 관리함 = "프로젝트 밖 내 모든 작업". 옮기기 = 프로젝트 · 섹션에서 빼기(날짜 · 시간 · 반복 유지).
// is_inbox 는 어떤 뷰도 쓰지 않아 건드리지 않는다. PC moveConsoleToInbox 와 같은 규칙.
export async function moveTaskToInbox(taskId: string): Promise<MoveToInboxResult> {
  const id = String(taskId ?? "").trim();
  const session = await getCurrentAppSession();
  if (!id || !session || !hasOrganizationContext(session)) return { ok: false, reason: "auth" };
  const task = await getTaskDetail(session, id);
  if (!task) return { ok: false, reason: "not_found" };
  if (!task.projectId) return { ok: false, reason: "not_in_project" };
  // 프로젝트에서 빼는 것은 작성자(또는 개발자)만 — 프로젝트 주인의 편집 권한(2026-10-28)은 여기 안 넓힌다.
  if (!isOwnerOrPlatformDeveloper(session.user, task.createdByUserId)) return { ok: false, reason: "forbidden" };
  const supabase = getSupabaseServiceClient();
  const moved = await mustWrite(
    "task: move to inbox",
    supabase
      .from("tasks")
      .update({ project_id: null, section_id: null })
      .eq("id", id)
      .eq("organization_id", session.organization.id),
  );
  if (!moved) return { ok: false, reason: "save_failed" };
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
  revalidateProjectPath(task.projectId);
  return { ok: true, previousProjectId: task.projectId, previousSectionId: task.sectionId };
}

// 「관리함으로 옮겼어요」 되돌리기 — 프로젝트 · 섹션을 되돌려 놓는다. 작성자만, 프로젝트는 아직 내가 열 수 있는
// 곳이어야 하고, 섹션은 그 프로젝트의 것이어야 한다(그 사이 지워졌으면 섹션 없이 프로젝트로만 복원).
export async function restoreTaskToProject(
  taskId: string,
  projectId: string,
  sectionId: string | null,
): Promise<{ ok: boolean }> {
  const id = String(taskId ?? "").trim();
  const pid = String(projectId ?? "").trim();
  const sid = sectionId ? String(sectionId).trim() : null;
  const session = await getCurrentAppSession();
  if (!id || !pid || !session || !hasOrganizationContext(session)) return { ok: false };
  const task = await getTaskDetail(session, id);
  if (!task || task.projectId || !isOwnerOrPlatformDeveloper(session.user, task.createdByUserId)) return { ok: false };
  if (!(await getTaskScope(session)).projectIds.has(pid)) return { ok: false };
  const supabase = getSupabaseServiceClient();
  let nextSection: string | null = null;
  if (sid) {
    const { data } = await supabase
      .from("project_sections")
      .select("id")
      .eq("id", sid)
      .eq("project_id", pid)
      .maybeSingle();
    nextSection = data ? sid : null;
  }
  const restored = await mustWrite(
    "task: restore to project",
    supabase
      .from("tasks")
      .update({ project_id: pid, section_id: nextSection })
      .eq("id", id)
      .eq("organization_id", session.organization.id),
  );
  if (!restored) return { ok: false };
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
  revalidateProjectPath(pid);
  return { ok: true };
}

// 스와이프 액션 후 돌아갈 목록 보기 허용 목록(스와이프한 탭에 그대로 머물게 함).
// 페이지의 VIEWS 허용 목록과 같다.
// "sent" 는 구 탭 키(→ instr). 되돌아오기 쿼리에 남아 있을 수 있어 계속 받아 준다.
const LIST_VIEWS = new Set(["today", "tomorrow", "inbox", "instr", "sent", "completed", "calendar"]);
function listPathForView(formData: FormData, error?: string): string {
  const view = cleanText(formData.get("view"));
  const base = LIST_VIEWS.has(view) ? `/mobile/tasks?view=${view}` : "/mobile/tasks";
  if (!error) return base;
  return `${base}${base.includes("?") ? "&" : "?"}moveError=${error}`;
}

// 할 일을 due_at 으로 `date`(도쿄 YYYY-MM-DD)에 맞추는 필드. 시각이 있으면 보존한다.
// scheduled_date 를 비워 due_at 이 유일한 기준이 되게 한다.
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

// "오늘로" 스와이프 액션: 할 일을 도쿄 운영 날짜로 맞추고 Inbox 에서
// 꺼낸다. 시작한 탭으로 돌아가 카드가 오늘로 옮겨진 것을 보여준다.
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

// "내일로" 스와이프 액션(오늘 탭): 할 일을 도쿄 다음 운영 날짜로 미루고
// Inbox 에서 꺼낸다. 시작한 탭으로 돌아가 카드가 내일로 옮겨진 것을 보여준다.
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

// 호출자가 날짜를 주지 않을 때 반복 할 일의 완료/재개가 대상으로 삼는 회차 날짜: 할 일의
// 고정 기준(recurrence_instance_date), 없으면 마감/예정 날짜, 그것도 없으면 오늘.
function recurringAnchorDate(task: TaskRecord): string {
  return task.recurrenceInstanceDate ?? tokyoDateOf(task.dueAt) ?? task.scheduledDate ?? tokyoToday();
}

// 할 일을 완료한다. 반복(2026-07-30): 완료는 행을 건드리지 않고, 주어진 회차 날짜를
// `task_occurrence_state` 에 기록한다(앞으로 넘기지 않음). 그래서 예정된 모든 날짜가
// 계속 보이고 각각 따로 완료할 수 있다. 단발성: 예전처럼 상태 + 완료 도장을 찍는다. 둘 다
// `completed` 갱신 로그를 남기고 참여자에게 알린다. 프로그램 호출용(목록 카드 / 상세 / 캘린더).
// 반복 완료가 실제로 기록한 회차 날짜를 돌려준다(회차가 아닌 날에는 넘겨받은 날짜와 다름) —
// 실행 취소는 그 날짜를 다시 열어야 한다.
export type TaskStatusResult = { ok: boolean; occurrenceDate?: string };

export async function completeTask(
  taskId: string,
  occurrenceDate?: string,
): Promise<TaskStatusResult> {
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false };
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
    // 이미 완료된 회차면 아무것도 하지 않는다(2026-10-28) — 두 번 누르거나 두 사람이 동시에 눌러도
    // 완료 기록 · 알림이 겹치지 않게. 결과는 성공으로 돌려 화면의 체크를 그대로 둔다.
    if (await occurrenceAlreadyCompleted(id, occ)) {
      return { ok: true, occurrenceDate: occ };
    }
    const saved = await completeOccurrence({
      taskId: id,
      organizationId: session.organization.id,
      occurrenceDate: occ,
      userId: session.user.id,
    });
    // 저장이 실패하면 완료 기록 · 알림을 남기지 않는다(2026-10-26) — 호출부가 낙관적 체크를 되돌린다.
    if (!saved) return { ok: false };
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
          // 회차 날짜를 함께 남긴다(2026-10-28) — 업무일지가 (작업, 회차)별로 완료 · 다시 열기를 맞춘다.
          body: occ,
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
    return { ok: true, occurrenceDate: occ };
  }

  // 아직 완료가 아닌 행만 바꾼다(2026-10-28) — «읽고 나서 쓰기»면 동시에 두 번 눌렀을 때 둘 다 통과해
  // 완료 기록 · 알림이 겹쳤다. 바뀐 행이 없으면 이미 완료된 것이라 조용히 성공으로 끝낸다.
  const { data: completedRows, error: completeError } = await supabase
    .from("tasks")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by_user_id: session.user.id,
    })
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .neq("status", "completed")
    .select("id");
  if (completeError) {
    console.error("[db-write] task: complete failed:", completeError.message);
    return { ok: false };
  }
  if (!completedRows || completedRows.length === 0) return { ok: true };
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
  return { ok: true };
}

// 완료한 할 일을 다시 연다: 상태 + 완료 도장을 지우고 `reopened` 갱신 로그를 남긴다.
// 알림은 없다(다시 여는 것은 조용한 정정이며, 보통 같은 사용자가 탭을 되돌리는 경우다).
// 실행 취소 토스트와 상세 화면의 "다시 열기" 버튼이 쓴다.
export async function reopenTask(
  taskId: string,
  occurrenceDate?: string,
): Promise<TaskStatusResult> {
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false };
  const { session, task } = await requireSessionAndTask(id);
  const supabase = getSupabaseServiceClient();

  // 반복(2026-07-30): 다시 열면 그 회차에 기록된 상태를 지워 다시 열린 상태가 된다
  // (완료가 행을 건드린 적이 없음). 단발성: 행의 완료 도장을 지운다.
  if (isStandardRecurrence(task.recurrenceRule)) {
    const occ = String(occurrenceDate ?? "").trim() || recurringAnchorDate(task);
    if (!(await clearOccurrenceState(id, occ))) return { ok: false };
    // 그 완료가 흡수했던 밀린 회차도 되살린다 — 콘솔 `reopenInternal` 과 같은 규칙.
    await releaseAbsorbedOccurrences(id, occ);
    await bestEffortWrite(
      "task_updates: insert",
      supabase.from("task_updates").insert({
          task_id: id,
          created_by_user_id: session.user.id,
          update_type: "reopened",
          body: occ, // 어느 회차를 다시 열었는지(업무일지 상쇄용, completeTask 참고)
        })
    );
    revalidatePath("/mobile/tasks");
    revalidatePath(detailPath(id));
    revalidateProjectPath(task.projectId);
    return { ok: true, occurrenceDate: occ };
  }

  const reopened = await mustWrite(
    "task: reopen",
    supabase
      .from("tasks")
      .update({
        status: "open",
        completed_at: null,
        completed_by_user_id: null,
      })
      .eq("id", id)
      .eq("organization_id", session.organization.id),
  );
  if (!reopened) return { ok: false };
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
  return { ok: true };
}

/**
 * 진행 중(in_progress) 전환 — 어드민 콘솔의 `setConsoleTaskStatus` 와 같은 3상태 모델을 모바일에도
 * 연다(2026-07-30). 그전까지 모바일은 완료/재개 2상태뿐이라, 콘솔이 "진행 중"으로 바꾼 작업을
 * 현장에서 **읽기만 하고 설정할 수 없었다**(`task-detail-view.tsx` 가 값은 표시하고 있었다).
 *
 * 완료 전환은 반복 처리(occurrence)와 알림이 얽혀 있어 기존 `completeTask` 가 계속 맡고, 이 액션은
 * open ↔ in_progress 만 다룬다 — 완료 상태를 이 경로로 되돌리지 않도록 완료 스탬프도 함께 지운다.
 */
export async function setTaskProgress(
  taskId: string,
  inProgress: boolean,
): Promise<{ ok: boolean; reason?: "recurring" }> {
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false };
  const { session, task } = await requireSessionAndTask(id);
  // 반복 업무의 행 상태는 언제나 열림이다 — 완료는 회차(task_occurrence_state)별로 따로 든다
  // (2026-07-30). 행을 in_progress 로 바꾸면 모든 회차가 함께 «진행 중»이 되고, 완료된 회차
  // 표시와도 어긋난다. 화면은 반복 업무에 진행 세그먼트를 그리지 않지만 서버도 거절한다(2026-10-26).
  if (isStandardRecurrence(task.recurrenceRule)) return { ok: false, reason: "recurring" };
  const supabase = getSupabaseServiceClient();
  const saved = await mustWrite(
    "task: set progress",
    supabase
      .from("tasks")
      .update({
        status: inProgress ? "in_progress" : "open",
        completed_at: null,
        completed_by_user_id: null,
      })
      .eq("id", id)
      .eq("organization_id", session.organization.id),
  );
  if (!saved) return { ok: false };
  // 완료였던 작업을 이 경로로 되돌리면 완료 도장이 지워지므로 `reopened` 를 남긴다(2026-10-28) — 상태 변경만
  // 적으면 기록 · 업무일지가 여전히 «완료»로 셌다. 진행 중으로 간 경우는 그 전환도 함께 적는다.
  const logs: Database["public"]["Tables"]["task_updates"]["Insert"][] = [];
  if (task.status === "completed") {
    // 여러 행 insert 는 키 모양이 같아야 한다(빠진 키는 NULL 로 채워진다) — body 를 비워 맞춘다.
    logs.push({ task_id: id, created_by_user_id: session.user.id, update_type: "reopened", body: null });
  }
  if (task.status !== "completed" || inProgress) {
    logs.push({
      task_id: id,
      created_by_user_id: session.user.id,
      update_type: "status_changed",
      body: inProgress ? "in_progress" : "open",
    });
  }
  await bestEffortWrite("task_updates: insert", supabase.from("task_updates").insert(logs));
  revalidatePath("/mobile/tasks");
  revalidatePath(detailPath(id));
  revalidateProjectPath(task.projectId);
  return { ok: true };
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
  // 안전장치: 참여자 행이 들어가지 않았다면 할 일을 공유됨으로 표시하지 않고,
  // system_shared 로그도 쓰지 않으며, 알림도 보내지 않는다 — 안 그러면
  // 일어나지 않은 공유 때문에 할 일이 잘못된 공유 상태로 보인다.
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

  // 작성자가 나가면 모두에게 할 일이 삭제된다(soft delete → 실행 취소 가능).
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

  // 작성자(또는 플랫폼 개발자, 2026-10-23)만 다른 사람을 내보낼 수 있고, 본인은 누구나 빠질 수 있다.
  if (!removingSelf && !canEditTaskCore(session, task)) {
    redirect(detailPath(id, "forbidden"));
  }
  // 이 경로로 작성자를 제거하지 않는다(작성자는 위의 본인 삭제로만 나간다).
  if (targetUserId === task.createdByUserId) {
    redirect(detailPath(id, "forbidden"));
  }

  // 실패하면 빠진 척하지 않는다(2026-10-26) — 예전엔 결과를 버려 「나가기」 후 목록으로 갔다가
  // 새로고침하면 작업이 그대로 있었다.
  const removed = await mustWrite(
    "task_participants: remove",
    supabase.from("task_participants").delete().eq("task_id", id).eq("user_id", targetUserId),
  );
  if (!removed) {
    redirect(detailPath(id, "save_failed"));
  }

  // 작성자 외 참여자가 남지 않으면 할 일은 비공개로 돌아간다.
  const remainingNonAuthor = task.participants.filter(
    (p) => p.role !== "author" && p.userId !== targetUserId,
  ).length;
  if (remainingNonAuthor === 0) {
    await bestEffortWrite(
      "task: clear is_shared after last participant left",
      supabase.from("tasks").update({ is_shared: false }).eq("id", id),
    );
  }

  // 스스로 빠진 참여자는 더는 그 할 일을 보지 못한다.
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
  // ?deleted=<id> → 목록이 restoreTask 를 부르는 "삭제했습니다 · 실행 취소" 토스트를 보여준다.
  redirect(`/mobile/tasks?deleted=${id}`);
}

// 소프트 삭제 되돌리기(목록의 삭제 토스트에서). requireSessionAndTask 는 삭제된 행을 거르므로,
// 행을 직접 읽어 조직 + 작성자를 확인한 뒤 `deleted_at` 을 지운다.
export async function restoreTask(taskId: string): Promise<{ ok: boolean }> {
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false };
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false };
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("tasks")
    .select("created_by_user_id, project_id")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const row = data as { created_by_user_id: string; project_id: string | null } | null;
  if (!row) return { ok: false };
  // 프로젝트 주인도 자기가 지운 멤버 할 일을 되살린다(2026-10-28, canEditTaskCore 와 같은 규칙).
  const projectOwnerUserId = row.project_id
    ? ((await getProjectMembership([row.project_id])).get(row.project_id)?.ownerUserId ?? null)
    : null;
  if (!canEditTaskAsOwnerOrAuthor(session.user, row.created_by_user_id, projectOwnerUserId)) {
    return { ok: false };
  }
  // 남의 작업(개발자)은 **열 수 있는 작업(getTaskScope)만** 되살린다(2026-10-28, 05 문서 규칙) — 범위는
  // 소프트 삭제된 행도 담는다(참여자 행 · 프로젝트 소속은 삭제와 무관).
  if (row.created_by_user_id !== session.user.id && !(await getTaskScope(session)).taskIds.has(id)) {
    return { ok: false };
  }
  const { error } = await supabase
    .from("tasks")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false };
  revalidatePath("/mobile/tasks");
  return { ok: true };
}

// 목록 일괄 삭제 · 되돌리기 대상 — 내가 쓴 할 일 + 내가 주인인 프로젝트의 할 일(2026-10-28 주인 권한).
// 개발자는 열 수 있는 작업(getTaskScope) 전부. 서비스 키 쓰기라 id 를 그대로 믿지 않는다.
async function manageableListTaskIds(
  session: Parameters<typeof getTaskScope>[0],
  ids: string[],
  supabase: ReturnType<typeof getSupabaseServiceClient>,
): Promise<string[]> {
  if (isPlatformDeveloper(session.user.role)) {
    const scope = await getTaskScope(session);
    return ids.filter((id) => scope.taskIds.has(id));
  }
  const { data } = await supabase
    .from("tasks")
    .select("id, created_by_user_id, project_id")
    .in("id", ids)
    .eq("organization_id", session.organization.id);
  const rows = (data ?? []) as Array<{ id: string; created_by_user_id: string; project_id: string | null }>;
  const projectIds = Array.from(
    new Set(rows.filter((r) => r.created_by_user_id !== session.user.id && r.project_id).map((r) => r.project_id as string)),
  );
  const owned = new Set<string>();
  if (projectIds.length > 0) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id")
      .in("id", projectIds)
      .eq("organization_id", session.organization.id)
      .eq("created_by_user_id", session.user.id);
    for (const p of (projects ?? []) as Array<{ id: string }>) owned.add(p.id);
  }
  return rows
    .filter((r) => r.created_by_user_id === session.user.id || (!!r.project_id && owned.has(r.project_id)))
    .map((r) => r.id);
}

// 목록에서 일괄 삭제(다중 선택). 실행한 사용자가 만든 할 일만 지운다 —
// `created_by_user_id` 필터가 권한 경계이므로, 공유받은(본인 것이 아닌) 할 일을 골라도
// 그냥 건드리지 않고 둔다. 목록에 머문다(revalidate).
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
  // 내 할 일 · 내가 주인인 프로젝트의 할 일 · (개발자) 열 수 있는 할 일만 — manageableListTaskIds.
  const targetIds = await manageableListTaskIds(session, ids, supabase);
  if (targetIds.length === 0) return { deletedIds: [] };
  // 실제로 지워진 id 만 돌려준다 — 목록에서 남의 작업을 같이 골랐어도 그건 안 지워지므로,
  // "실행 취소" 가 지우지도 않은 작업을 되살리려 하면 안 된다(콘솔 `bulkDeleteConsoleTasks` 와 동일).
  const query = supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", targetIds)
    // 조직 스코프도 함께 건다 — 작성자 조건만으로도 실무상 안전하지만, 쌍둥이인
    // `restoreTasksInList` 는 걸고 있어서 두 함수의 방어 수준이 달랐다(2026-08-28).
    .eq("organization_id", session.organization.id);
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
  // 플랫폼 개발자는 자기가 지운 남의 작업도 되살린다(단건 restoreTask 와 같은 규칙, 2026-10-23) — 다만
  // **열 수 있는 작업(getTaskScope)만**(2026-10-28). 예전엔 조직 안 아무 작업이나 되살릴 수 있었다.
  const targetIds = await manageableListTaskIds(session, ids, supabase);
  if (targetIds.length === 0) return;
  const query = supabase
    .from("tasks")
    .update({ deleted_at: null })
    .in("id", targetIds)
    .eq("organization_id", session.organization.id);
  await bestEffortWrite("tasks: bulk restore", query);
  revalidatePath("/mobile/tasks");
}

/**
 * 순서 저장 결과(2026-10-28, 화면과의 공용 약속) — 드래그 순서 저장은 예상된 실패로 throw 하지 않고
 * 이 모양으로 돌려준다. 화면은 `ok:false` 면 낙관적 순서를 되돌리고 알린다. 공유 액션 규칙대로 권한 실패는
 * redirect 가 아니라 `forbidden` 이다(드래그 중 다른 화면으로 튕기면 안 된다).
 */
export type ReorderResult = { ok: true } | { ok: false; reason: "forbidden" | "invalid" | "error" };

async function reorderSession(): Promise<Session | null> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  return session;
}

/**
 * `setTaskSortOrders` 를 부르고 실패를 결과로 바꾼다. 지금 그 헬퍼는 결과를 돌려주지 않지만(void),
 * false 를 돌려주게 바뀌어도 여기서 그대로 잡히도록 `unknown` 으로 받는다.
 */
async function saveTaskSortOrders(organizationId: string, positions: Map<string, number>): Promise<boolean> {
  const result: unknown = await setTaskSortOrders({ organizationId, positions });
  return result !== false;
}

// 오늘 보기의 수동 드래그 순서 변경을 저장한다. `orderedIds` 는 섹션의 할 일 id 를 위에서 아래
// 새 순서로 담은 것이며, 각 행의 sort_order 를 인덱스(0..n)로 설정한다. 조직 범위라서
// 사용자는 자기 조직 안의 할 일만 재정렬할 수 있다. sort_order 는 할 일 전체에 공통이다(사용자별
// 아님) — 마이그레이션 메모 참고. 목록에 머문다(revalidate). 낙관적 클라이언트 순서가
// 이미 변경을 반영하고 있다.
export async function reorderTasks(orderedIds: string[]): Promise<ReorderResult> {
  try {
    const ids = Array.from(
      new Set((orderedIds ?? []).map((s) => String(s).trim()).filter(Boolean)),
    ).slice(0, 500);
    if (ids.length === 0) return { ok: true }; // 저장할 것이 없다
    const session = await reorderSession();
    if (!session) return { ok: false, reason: "forbidden" };
    // 조직 조건만으로는 같은 조직 남의 개인 작업 순서도 바꿀 수 있었다(서비스 키 쓰기) — 내가 볼 수
    // 있는 작업(getTaskScope)만 남긴다(2026-10-26). 인덱스는 원래 목록 기준을 유지한다.
    const scope = await getTaskScope(session);
    const positions = new Map<string, number>();
    ids.forEach((id, index) => {
      if (scope.taskIds.has(id)) positions.set(id, index);
    });
    if (positions.size === 0) return { ok: false, reason: "forbidden" };
    const saved = await saveTaskSortOrders(session.organization.id, positions);
    revalidatePath("/mobile/tasks");
    return saved ? { ok: true } : { ok: false, reason: "error" };
  } catch (error) {
    console.error("[reorderTasks] failed:", error);
    return { ok: false, reason: "error" };
  }
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
): Promise<ReorderResult> {
  try {
    const date = String(occurrenceDate ?? "").trim();
    if (!isValidYmd(date)) return { ok: false, reason: "invalid" };
    const session = await reorderSession();
    if (!session) return { ok: false, reason: "forbidden" };
    const seen = new Set<string>();
    const clean = (items ?? [])
      .map((it) => ({ taskId: String(it?.taskId ?? "").trim(), recurring: !!it?.recurring }))
      .filter((it) => it.taskId && !seen.has(it.taskId) && seen.add(it.taskId))
      .slice(0, 500);
    if (clean.length === 0) return { ok: true }; // 저장할 것이 없다
    // 내가 볼 수 있는 작업만(2026-10-26, `reorderTasks` 와 같은 이유). 인덱스는 병합 목록 기준을
    // 그대로 쓰므로 걸러진 항목이 있어도 나머지 위치는 사용자가 놓은 순서를 유지한다.
    const scope = await getTaskScope(session);

    const recurringPositions = new Map<string, number>();
    const oneOffPositions = new Map<string, number>();
    clean.forEach((it, index) => {
      if (!scope.taskIds.has(it.taskId)) return;
      if (it.recurring) recurringPositions.set(it.taskId, index);
      else oneOffPositions.set(it.taskId, index);
    });
    if (recurringPositions.size === 0 && oneOffPositions.size === 0) {
      return { ok: false, reason: "forbidden" };
    }

    const [sortOk, orderOk] = await Promise.all([
      saveTaskSortOrders(session.organization.id, oneOffPositions),
      setOccurrenceOrders({
        organizationId: session.organization.id,
        occurrenceDate: date,
        positions: recurringPositions,
      }),
    ]);
    revalidatePath("/mobile/tasks");
    // 저장 실패는 화면상 "드래그했는데 되돌아옴"으로만 보인다 — 결과로 돌려 화면이 알리게 한다.
    if (!sortOk || !orderOk) {
      console.error("[reorderDateTasks] order not persisted", { date, sortOk, orderOk });
      return { ok: false, reason: "error" };
    }
    return { ok: true };
  } catch (error) {
    console.error("[reorderDateTasks] failed:", error);
    return { ok: false, reason: "error" };
  }
}

export async function addTaskUpdate(formData: FormData) {
  const id = cleanText(formData.get("taskId"));
  const { session, task } = await requireSessionAndTask(id);
  const body = cleanText(formData.get("body"));
  // 메모 사진은 우리 스토리지의 `{org}/task-update-images/` 객체만 받는다(2026-10-26) — 임의 URL 을
  // 심어 참여자 화면에 외부 이미지를 띄우는 것을 막는다.
  const imageUrls = Array.from(new Set(formData.getAll("imageUrls").map((v) => String(v))))
    .filter((u) => isOrgTaskImageUrl(u, session.organization.id, "task-update-images"))
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
