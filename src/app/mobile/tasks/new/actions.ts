"use server";

import { redirect } from "next/navigation";
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
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { sanitizeTaskImageUrls } from "@/lib/task-images";
import { linkedContextBelongsToOrg } from "@/lib/task-linked-context";

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

export async function quickCreateTask(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const title = cleanText(formData.get("title"));
  if (!title) {
    redirect("/mobile/tasks?view=inbox&error=missing_title");
  }

  const id = crypto.randomUUID();
  const supabase = getSupabaseServiceClient();

  const insert: Database["public"]["Tables"]["tasks"]["Insert"] = {
    id,
    organization_id: session.organization.id,
    created_by_user_id: session.user.id,
    title,
    is_inbox: true,
    is_shared: false,
  };
  const { error } = await supabase.from("tasks").insert(insert);
  if (error) {
    redirect("/mobile/tasks?view=inbox&error=save_failed");
  }
  const { error: pError } = await supabase.from("task_participants").insert({
    task_id: id,
    user_id: session.user.id,
    role: "author",
  });
  if (pError) {
    await supabase.from("tasks").delete().eq("id", id);
    redirect("/mobile/tasks?view=inbox&error=save_failed");
  }

  redirect("/mobile/tasks?view=inbox&created=1");
}

// 오늘 도쿄 날짜의 종일 due_at 으로 빠르게 만든다 — 오늘 탭에 바로 나타난다.
export async function quickCreateTodayTask(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const title = cleanText(formData.get("title"));
  if (!title) {
    redirect("/mobile/tasks?view=today&error=missing_title");
  }

  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const dueAt = new Date(`${todayYmd}T00:00:00+09:00`).toISOString();
  const id = crypto.randomUUID();
  const supabase = getSupabaseServiceClient();

  const insert: Database["public"]["Tables"]["tasks"]["Insert"] = {
    id,
    organization_id: session.organization.id,
    created_by_user_id: session.user.id,
    title,
    due_at: dueAt,
    all_day: true,
    is_inbox: false,
    is_shared: false,
  };
  const { error } = await supabase.from("tasks").insert(insert);
  if (error) {
    redirect("/mobile/tasks?view=today&error=save_failed");
  }
  const { error: pError } = await supabase.from("task_participants").insert({
    task_id: id,
    user_id: session.user.id,
    role: "author",
  });
  if (pError) {
    await supabase.from("tasks").delete().eq("id", id);
    redirect("/mobile/tasks?view=today&error=save_failed");
  }

  redirect("/mobile/tasks?view=today&created=1");
}

// 내일 도쿄 날짜의 종일 due_at 으로 빠르게 만든다 — 내일 탭에 바로 나타난다.
export async function quickCreateTomorrowTask(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const title = cleanText(formData.get("title"));
  if (!title) {
    redirect("/mobile/tasks?view=tomorrow&error=missing_title");
  }

  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const [ty, tm, td] = todayYmd.split("-").map(Number);
  const tomorrowYmd = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);
  const dueAt = new Date(`${tomorrowYmd}T00:00:00+09:00`).toISOString();
  const id = crypto.randomUUID();
  const supabase = getSupabaseServiceClient();

  const insert: Database["public"]["Tables"]["tasks"]["Insert"] = {
    id,
    organization_id: session.organization.id,
    created_by_user_id: session.user.id,
    title,
    due_at: dueAt,
    all_day: true,
    is_inbox: false,
    is_shared: false,
  };
  const { error } = await supabase.from("tasks").insert(insert);
  if (error) {
    redirect("/mobile/tasks?view=tomorrow&error=save_failed");
  }
  const { error: pError } = await supabase.from("task_participants").insert({
    task_id: id,
    user_id: session.user.id,
    role: "author",
  });
  if (pError) {
    await supabase.from("tasks").delete().eq("id", id);
    redirect("/mobile/tasks?view=tomorrow&error=save_failed");
  }

  redirect("/mobile/tasks?view=tomorrow&created=1");
}

export async function createTask(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const title = cleanText(formData.get("title"));
  if (!title) {
    redirect("/mobile/tasks/new?error=missing_title");
  }

  const description = cleanText(formData.get("description"));
  let scheduledDate = cleanText(formData.get("scheduledDate"));
  const dueDate = cleanText(formData.get("dueDate"));
  const time = cleanText(formData.get("time"));
  const durationRaw = cleanText(formData.get("durationMinutes"));
  const priorityRaw = cleanText(formData.get("priority"));
  const repeatRaw = cleanText(formData.get("repeat"));
  const priority = PRIORITIES.has(priorityRaw) ? priorityRaw : "normal";
  // 생성에는 이전 규칙이 없으므로 `custom` 은 새로 지정할 수 없다(→ null).
  const repeat = resolveRecurrenceRule(repeatRaw, null);
  // 반복에는 날짜 기준점이 필요하다. 날짜 없는 반복은 오늘을 기준으로 삼는다(Todoist). 거절하지 않는다.
  if (repeat && !scheduledDate && !dueDate) scheduledDate = tokyoToday();
  const tags = parseStringArray(cleanText(formData.get("tagsJson")))
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
  const requestedShare = parseStringArray(cleanText(formData.get("shareJson")));
  // 지시로 보내기 — 대상자의 일정으로 잡히고 지시자의 "오늘" 목록에는 들어가지 않는다.
  const directive = cleanText(formData.get("directive")) === "1";
  // 안전 상한(20). 실제 할 일별 상한(일반 5 / 프로젝트 20)은 insert 때 적용한다.
  // 우리 `{org}/task-images/` 저장소 객체만 받는다(2026-10-26, lib/task-images).
  const imageUrls = sanitizeTaskImageUrls(
    formData.getAll("imageUrls").map((v) => String(v)),
    true,
    session.organization.id,
  );
  const ctxPropertyId = cleanText(formData.get("ctxPropertyId")) || null;
  const ctxRoomId = cleanText(formData.get("ctxRoomId")) || null;
  const ctxReservationId = cleanText(formData.get("ctxReservationId")) || null;
  const ctxGuestName = cleanText(formData.get("ctxGuestName")) || null;
  // 연결 id 는 이 조직 것만(2026-10-28) — 서비스 키 insert 라 다른 조직 예약 id 를 막아 줄 곳이 여기뿐이다.
  if (
    !(await linkedContextBelongsToOrg(session.organization.id, {
      propertyId: ctxPropertyId,
      roomId: ctxRoomId,
      reservationId: ctxReservationId,
    }))
  ) {
    redirect("/mobile/tasks/new?error=forbidden");
  }

  // 비어 있지 않은 날짜 · 시각은 실제로 있는 값이어야 한다(2026-10-28) — 조용히 버리거나 굴리지 않는다.
  if (
    (scheduledDate && !isValidYmd(scheduledDate)) ||
    (dueDate && !isValidYmd(dueDate)) ||
    (time && !isValidHm(time))
  ) {
    redirect("/mobile/tasks/new?error=save_failed");
  }
  // 특정 시각에는 날짜 기준점이 필요하다 — 조용히 버리지 말고 거절한다.
  if (taskTimeWithoutDate({ scheduledDate, dueDate, time })) {
    redirect("/mobile/tasks/new?error=time_needs_date");
  }
  // 날짜/시각 저장 규칙은 하나로 공유한다(lib/tasks normalizeTaskDateTime 참고).
  const { scheduledDate: sched, dueAt, allDay, timeLabel } = normalizeTaskDateTime({
    scheduledDate,
    dueDate,
    time,
  });
  // 소요 시간은 시간 블록 길이(1–1440분)이고 시각이 있을 때만 의미가 있다.
  const durationParsed = /^\d+$/.test(durationRaw) ? Number(durationRaw) : null;
  const durationMinutes =
    durationParsed && durationParsed >= 1 && durationParsed <= 1440 ? durationParsed : null;
  const finalDuration = timeLabel ? durationMinutes : null;
  const anchorDate = taskAnchorDateInput({ scheduledDate: sched, dueAt });
  if (taskNeedsRecurrenceDate(repeat, anchorDate)) {
    redirect("/mobile/tasks/new?error=repeat_needs_date");
  }

  // 프로젝트 할 일 연결(선택). 있으면 할 일이 프로젝트에 속한다: 보는 사람이
  // 참여자인지(RLS 범위 읽기로 증명) 섹션이 그 프로젝트 것인지 검증한다.
  // 프로젝트 할 일은 개별 공유가 되지 않는다 — 공유는 프로젝트 멤버십이 관리한다.
  const projectIdRaw = cleanText(formData.get("projectId")) || null;
  const sectionIdRaw = cleanText(formData.get("sectionId")) || null;
  let linkedProjectId: string | null = null;
  let linkedSectionId: string | null = null;
  if (projectIdRaw) {
    const project = await getProjectDetail(session, projectIdRaw);
    if (!project) {
      redirect("/mobile/tasks?view=projects");
    }
    linkedProjectId = projectIdRaw;
    linkedSectionId =
      sectionIdRaw && project.sections.some((s) => s.id === sectionIdRaw) ? sectionIdRaw : null;
  }

  // 공유 대상은 조직의 활성 멤버로 검증한다(실패 시 닫힘). 프로젝트 할 일에는 하지 않는다.
  let shareIds: string[] = [];
  if (!linkedProjectId && requestedShare.length > 0) {
    const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
    shareIds = Array.from(new Set(requestedShare)).filter(
      (uid) => uid !== session.user.id && allowed.has(uid),
    );
  }

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
    is_inbox: false,
    is_shared: shareIds.length > 0,
    // 지시(작성자=지시자, 참여자=대상). 대상이 없으면 지시가 성립하지 않으므로 함께 건다 —
    // 콘솔 `createConsoleTask` 와 같은 규칙(`is_directive = isDirective && 대상 1명 이상`).
    is_directive: directive && shareIds.length > 0,
    recurrence_rule: repeat,
    recurrence_series_id: recurrenceSeriesId,
    recurrence_instance_date: recurrenceSeriesId ? anchorDate : null,
    tags,
    // 프로젝트 할 일은 사진 20장까지, 일반 할 일은 기본 5장.
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
    redirect("/mobile/tasks/new?error=save_failed");
  }

  // 작성자 행은 아래 참여자 행과 반드시 같은 키를 가져야 한다. PostgREST 는 배열 전체의
  // 키 합집합으로 다중 행 INSERT 하나를 만들고, 행에서 빠진 키는
  // 컬럼 기본값을 무시하고 NULL 로 채운다. 그래서 `is_first_recipient` 가 빠진 작성자 행은
  // NULL 을 써서, 공유가 포함될 때마다 NOT NULL 제약을 어긴다. 형태를 통일해 둔다.
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
  const { error: pError } = await supabase.from("task_participants").insert(participantRows);
  if (pError) {
    await supabase.from("tasks").delete().eq("id", id);
    redirect("/mobile/tasks/new?error=save_failed");
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

  // 프로젝트 할 일은 프로젝트 상세로, 일반 할 일은 새 할 일을 연다.
  if (linkedProjectId) {
    redirect(`/mobile/tasks/projects/${linkedProjectId}`);
  }
  redirect(`/mobile/tasks/${id}?created=1`);
}
