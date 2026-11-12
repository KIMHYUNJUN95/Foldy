import "server-only";

/**
 * 할 일 만들기 — 한 곳의 검사 · 저장(2026-11-13). docs/product/18-todo-task-workflow.md · 28
 *
 * 모바일 할 일 폼(`/mobile/tasks/new` 의 `createTask`)과 손님 메시지 「업무 만들기」(47 §6-4)가 같이 쓴다. 결과 코드만 돌려주고
 * 길(redirect)은 부르는 쪽이 정한다. 검사 · 저장 내용은 예전 `createTask` 그대로(연결 id 는 이 조직 것만 · 날짜 · 시각 · 반복 ·
 * 프로젝트 참여 · 공유 대상 = 활성 멤버 · 사진 일반 5 / 프로젝트 20 · 작성자 + 참여자 행 · 공유 알림).
 */

import { notifyTaskParticipants } from "@/lib/notifications/create";
import { getProjectDetail } from "@/lib/projects";
import {
  getShareableUsers,
  isValidHm,
  isValidYmd,
  taskAnchorDateInput,
  taskNeedsRecurrenceDate,
  normalizeTaskDateTime,
  resolveRecurrenceRule,
  taskTimeWithoutDate,
  tokyoToday,
} from "@/lib/tasks";
import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { sanitizeTaskImageUrls } from "@/lib/task-images";
import { linkedContextBelongsToOrg } from "@/lib/task-linked-context";

const PRIORITIES = new Set(["normal", "important", "urgent", "medium"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 다시 보낸 요청으로 볼 시간 — 이보다 오래된 같은 id 줄은 「이미 있음」이 아니라 실패로 본다. */
export const TASK_RESEND_WINDOW_MS = 10 * 60 * 1000;

export type TaskCreateInput = {
  /**
   * 화면이 만든 요청 id(선택, 2026-11-13 손님 메시지 「업무 만들기」). 주면 그 id 로 넣고, 같은 id 로 다시 오면(응답을 못 받고 다시 누름)
   * **그 사람이 방금(10분 안) 만든 같은 조직 할 일**일 때만 그 할 일을 돌려준다 — 두 번 만들지 않는다. 비우면 예전처럼 서버가 만든다.
   */
  id?: string | null;
  title: string;
  description: string;
  scheduledDate: string;
  dueDate: string;
  time: string;
  durationMinutes: string;
  priority: string;
  repeat: string;
  tags: string[];
  shareUserIds: string[];
  directive: boolean;
  imageUrls: string[];
  ctxPropertyId: string | null;
  ctxRoomId: string | null;
  ctxReservationId: string | null;
  ctxGuestName: string | null;
  projectId: string | null;
  sectionId: string | null;
};

export type TaskCreateError =
  | "missing_title"
  | "forbidden"
  | "invalid_date"
  | "time_needs_date"
  | "repeat_needs_date"
  | "project_not_found"
  | "save_failed";

export type TaskCreateResult = { ok: true; id: string; projectId: string | null } | { ok: false; error: TaskCreateError };

/** 부르는 쪽이 이미 `hasOrganizationContext(session)` 을 확인했다고 본다. */
export async function createTaskRecord(session: AppSession, input: TaskCreateInput): Promise<TaskCreateResult> {
  const fail = (error: TaskCreateError): TaskCreateResult => ({ ok: false, error });
  const title = input.title.trim();
  if (!title) return fail("missing_title");
  const requestedId = input.id?.trim() || "";
  if (requestedId && !UUID.test(requestedId)) return fail("save_failed");

  const description = input.description.trim();
  let scheduledDate = input.scheduledDate.trim();
  const dueDate = input.dueDate.trim();
  const time = input.time.trim();
  const durationRaw = input.durationMinutes.trim();
  const priority = PRIORITIES.has(input.priority) ? input.priority : "normal";
  // 생성에는 이전 규칙이 없으므로 `custom` 은 새로 지정할 수 없다(→ null).
  const repeat = resolveRecurrenceRule(input.repeat, null);
  // 날짜 없는 반복은 오늘을 기준으로 삼는다(Todoist). 거절하지 않는다.
  if (repeat && !scheduledDate && !dueDate) scheduledDate = tokyoToday();
  const tags = input.tags
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
  // 안전 상한(20). 실제 상한(일반 5 / 프로젝트 20)은 insert 때. 우리 `{org}/task-images/` 저장소 객체만 받는다.
  const imageUrls = sanitizeTaskImageUrls(input.imageUrls, true, session.organization.id);
  const ctxPropertyId = input.ctxPropertyId || null;
  const ctxRoomId = input.ctxRoomId || null;
  const ctxReservationId = input.ctxReservationId || null;
  const ctxGuestName = input.ctxGuestName || null;
  // 연결 id 는 이 조직 것만(2026-10-28) — 서비스 키 insert 라 다른 조직 예약 id 를 막아 줄 곳이 여기뿐이다.
  if (
    !(await linkedContextBelongsToOrg(session.organization.id, {
      propertyId: ctxPropertyId,
      roomId: ctxRoomId,
      reservationId: ctxReservationId,
    }))
  ) {
    return fail("forbidden");
  }

  if ((scheduledDate && !isValidYmd(scheduledDate)) || (dueDate && !isValidYmd(dueDate)) || (time && !isValidHm(time))) {
    return fail("invalid_date");
  }
  if (taskTimeWithoutDate({ scheduledDate, dueDate, time })) return fail("time_needs_date");
  const { scheduledDate: sched, dueAt, allDay, timeLabel } = normalizeTaskDateTime({ scheduledDate, dueDate, time });
  const durationParsed = /^\d+$/.test(durationRaw) ? Number(durationRaw) : null;
  const durationMinutes = durationParsed && durationParsed >= 1 && durationParsed <= 1440 ? durationParsed : null;
  const finalDuration = timeLabel ? durationMinutes : null;
  const anchorDate = taskAnchorDateInput({ scheduledDate: sched, dueAt });
  if (taskNeedsRecurrenceDate(repeat, anchorDate)) return fail("repeat_needs_date");

  // 프로젝트 할 일(선택): 보는 사람이 참여자인지(RLS 범위 읽기로 증명) · 섹션이 그 프로젝트 것인지.
  let linkedProjectId: string | null = null;
  let linkedSectionId: string | null = null;
  if (input.projectId) {
    const project = await getProjectDetail(session, input.projectId);
    if (!project) return fail("project_not_found");
    linkedProjectId = input.projectId;
    linkedSectionId = input.sectionId && project.sections.some((s) => s.id === input.sectionId) ? input.sectionId : null;
  }

  // 공유 대상은 조직의 활성 멤버로 검증한다(실패 시 닫힘). 프로젝트 할 일에는 하지 않는다.
  let shareIds: string[] = [];
  if (!linkedProjectId && input.shareUserIds.length > 0) {
    const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
    shareIds = Array.from(new Set(input.shareUserIds)).filter((uid) => uid !== session.user.id && allowed.has(uid));
  }

  const id = requestedId || crypto.randomUUID();
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
    is_inbox: false,
    is_shared: shareIds.length > 0,
    // 지시는 대상이 있을 때만(콘솔 `createConsoleTask` 와 같은 규칙).
    is_directive: input.directive && shareIds.length > 0,
    recurrence_rule: repeat,
    recurrence_series_id: recurrenceSeriesId,
    recurrence_instance_date: recurrenceSeriesId ? anchorDate : null,
    tags,
    image_urls: imageUrls.slice(0, linkedProjectId ? 20 : 5),
    property_id: ctxPropertyId,
    room_id: ctxRoomId,
    reservation_id: ctxReservationId,
    guest_name: ctxGuestName,
    project_id: linkedProjectId,
    section_id: linkedSectionId,
  };
  const { error } = await supabase.from("tasks").insert(insert);
  if (error) {
    // 같은 요청 id 로 다시 옴 — 내가 방금 만든 이 조직 할 일이면 그것을 돌려준다(참여자 · 알림은 첫 번째가 이미 했다).
    if (requestedId && (error as { code?: string }).code === "23505") {
      const { data } = await supabase
        .from("tasks")
        .select("id, project_id, created_at")
        .eq("id", requestedId)
        .eq("organization_id", session.organization.id)
        .eq("created_by_user_id", session.user.id)
        .is("deleted_at", null)
        .maybeSingle();
      const own = data as { id: string; project_id: string | null; created_at: string } | null;
      if (own && Date.now() - Date.parse(own.created_at) <= TASK_RESEND_WINDOW_MS) {
        return { ok: true, id: own.id, projectId: own.project_id };
      }
    }
    return fail("save_failed");
  }

  // 작성자 행과 참여자 행은 같은 키 모양이어야 한다(PostgREST 다중 행 INSERT 는 빠진 키를 NULL 로 채운다 — is_first_recipient NOT NULL).
  const participantRows: Database["public"]["Tables"]["task_participants"]["Insert"][] = [
    { task_id: id, user_id: session.user.id, role: "author", is_first_recipient: false, added_by_user_id: null },
    ...shareIds.map((uid, index) => ({
      task_id: id,
      user_id: uid,
      role: "participant",
      is_first_recipient: index === 0,
      added_by_user_id: session.user.id,
    })),
  ];
  const { error: pError } = await supabase.from("task_participants").insert(participantRows);
  if (pError) {
    // 만들기 되돌리기는 하드 삭제(CLAUDE.md 9 — create-rollback).
    await supabase.from("tasks").delete().eq("id", id).eq("organization_id", session.organization.id);
    return fail("save_failed");
  }

  if (shareIds.length > 0) {
    await bestEffortWrite(
      "task_updates: insert",
      supabase.from("task_updates").insert({
        task_id: id,
        created_by_user_id: session.user.id,
        update_type: "system_shared",
        body: null,
      }),
    );
    await notifyTaskParticipants(supabase, {
      organizationId: session.organization.id,
      taskId: id,
      recipientUserIds: shareIds,
      actorUserId: session.user.id,
      type: "task_shared",
      dedupeBase: `task_shared:${id}`,
      payload: { taskId: id, taskTitle: title, actorUserId: session.user.id, event: "shared" },
    });
  }
  return { ok: true, id, projectId: linkedProjectId };
}
