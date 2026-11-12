"use server";

import { redirect } from "next/navigation";
import { createTaskRecord } from "@/lib/task-create";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

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

  // 검사 · 저장은 공용 `createTaskRecord`(손님 메시지 「업무 만들기」와 같은 함수, 2026-11-13) — 폼 값만 읽고 결과를 예전 주소로 보낸다.
  const result = await createTaskRecord(session, {
    title: cleanText(formData.get("title")),
    description: cleanText(formData.get("description")),
    scheduledDate: cleanText(formData.get("scheduledDate")),
    dueDate: cleanText(formData.get("dueDate")),
    time: cleanText(formData.get("time")),
    durationMinutes: cleanText(formData.get("durationMinutes")),
    priority: cleanText(formData.get("priority")),
    repeat: cleanText(formData.get("repeat")),
    tags: parseStringArray(cleanText(formData.get("tagsJson"))),
    shareUserIds: parseStringArray(cleanText(formData.get("shareJson"))),
    // 지시로 보내기 — 대상자의 일정으로 잡히고 지시자의 "오늘" 목록에는 들어가지 않는다.
    directive: cleanText(formData.get("directive")) === "1",
    imageUrls: formData.getAll("imageUrls").map((v) => String(v)),
    ctxPropertyId: cleanText(formData.get("ctxPropertyId")) || null,
    ctxRoomId: cleanText(formData.get("ctxRoomId")) || null,
    ctxReservationId: cleanText(formData.get("ctxReservationId")) || null,
    ctxGuestName: cleanText(formData.get("ctxGuestName")) || null,
    projectId: cleanText(formData.get("projectId")) || null,
    sectionId: cleanText(formData.get("sectionId")) || null,
  });

  if (!result.ok) {
    if (result.error === "project_not_found") redirect("/mobile/tasks?view=projects");
    redirect(`/mobile/tasks/new?error=${result.error}`);
  }
  // 프로젝트 할 일은 프로젝트 상세로, 일반 할 일은 새 할 일을 연다.
  if (result.projectId) {
    redirect(`/mobile/tasks/projects/${result.projectId}`);
  }
  redirect(`/mobile/tasks/${result.id}?created=1`);
}
