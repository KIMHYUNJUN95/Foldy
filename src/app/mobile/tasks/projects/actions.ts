"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notifyProjectMembers } from "@/lib/notifications/create";
import { getProjectDetail, type ProjectDetailData } from "@/lib/projects";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getShareableUsers } from "@/lib/tasks";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { bestEffortWrite, mustWrite } from "@/lib/db-write-guard";
import {
  cleanupRemovedTaskImages,
  cleanupRemovedTaskUpdateImages,
  collectProjectImageUrls,
} from "@/lib/task-images";
import type { Database } from "@/types/database";

type Session = NonNullable<Awaited<ReturnType<typeof getCurrentAppSession>>>;

const PROJECTS_PATH = "/mobile/tasks?view=projects";
const detailPath = (id: string, error?: string) =>
  `/mobile/tasks/projects/${id}${error ? `?error=${error}` : ""}`;

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

// getProjectDetail 은 RLS 범위 클라이언트를 쓰므로, null 이 아닌 결과는 행동하는 사용자가
// 프로젝트 참여자임을 증명한다. 소유자 전용 액션은 `project.viewerCanManage`(소유자 또는 플랫폼 개발자)를 추가로 확인한다.
async function requireProject(
  projectId: string,
): Promise<{ session: Session; project: ProjectDetailData }> {
  const session = await requireSession();
  const project = await getProjectDetail(session, projectId);
  if (!project) {
    redirect(PROJECTS_PATH);
  }
  return { session, project };
}

// 요청된 초대 대상을 조직의 활성 구성원과 대조한다(실패 시 막음). 본인은 뺀다.
async function validateInvitees(session: Session, requested: string[]): Promise<string[]> {
  if (requested.length === 0) return [];
  const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
  return Array.from(new Set(requested)).filter(
    (uid) => uid !== session.user.id && allowed.has(uid),
  );
}

export async function createProject(formData: FormData) {
  const session = await requireSession();
  const title = cleanText(formData.get("title"));
  if (!title) {
    redirect(`${PROJECTS_PATH}&error=missing_title`);
  }
  const description = cleanText(formData.get("description")) || null;
  const shareOn = cleanText(formData.get("share")) === "on";
  const inviteIds = shareOn
    ? await validateInvitees(session, parseStringArray(cleanText(formData.get("shareJson"))))
    : [];

  const id = crypto.randomUUID();
  const supabase = getSupabaseServiceClient();

  const insert: Database["public"]["Tables"]["projects"]["Insert"] = {
    id,
    organization_id: session.organization.id,
    created_by_user_id: session.user.id,
    title,
    description,
    is_shared: inviteIds.length > 0,
  };
  const { error } = await supabase.from("projects").insert(insert);
  if (error) {
    redirect(`${PROJECTS_PATH}&error=save_failed`);
  }

  // 소유자 행과 초대된 구성원 행은 같은 키 모양을 쓴다(여러 행 insert 에서 PostgREST 가
  // 빠진 키를 NULL 로 채우는 점은 tasks-create 메모 참고).
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
    redirect(`${PROJECTS_PATH}&error=save_failed`);
  }

  if (inviteIds.length > 0) {
    await notifyProjectMembers(supabase, {
      organizationId: session.organization.id,
      projectId: id,
      recipientUserIds: inviteIds,
      actorUserId: session.user.id,
      dedupeBase: `project_shared:${id}`,
      payload: { projectId: id, projectTitle: title, actorUserId: session.user.id, event: "shared" },
    });
  }

  redirect(detailPath(id));
}

export async function deleteProject(formData: FormData) {
  const id = cleanText(formData.get("projectId"));
  const { session, project } = await requireProject(id);
  if (!project.viewerCanManage) {
    redirect(detailPath(id, "forbidden"));
  }
  const supabase = getSupabaseServiceClient();
  // 지우기 전에 프로젝트 할 일(소프트 삭제된 것 포함)의 사진 · 메모 사진 경로를 모은다(2026-10-28 · 메모 사진 2026-10-29) —
  // cascade 가 행만 지우고 스토리지 파일은 남겨, 아무도 가리키지 않는 사진이 쌓였다.
  const { taskImageUrls, updateImageUrls } = await collectProjectImageUrls(supabase, id, session.organization.id);
  // cascade 가 참여자, 섹션, 프로젝트 할 일을 지운다(FK on delete cascade).
  // 실패하면 목록으로 보내지 않는다(2026-10-26) — 「지워졌다」고 믿게 한 뒤 다시 나타나는 것을 막는다.
  const deleted = await mustWrite(
    "project: delete",
    supabase.from("projects").delete().eq("id", id).eq("organization_id", session.organization.id),
  );
  if (!deleted) redirect(detailPath(id, "delete_failed"));
  // 행이 지워진 뒤에 지운다 — 공용 정리 헬퍼가 «조직의 다른 할 일이 아직 쓰는 파일»은 남긴다.
  await cleanupRemovedTaskImages(supabase, taskImageUrls, session.organization.id);
  await cleanupRemovedTaskUpdateImages(supabase, updateImageUrls, session.organization.id);
  redirect(PROJECTS_PATH);
}

export async function addProjectSection(formData: FormData) {
  const id = cleanText(formData.get("projectId"));
  const title = cleanText(formData.get("title"));
  const { project } = await requireProject(id);
  if (!project.viewerCanManage) {
    redirect(detailPath(id, "forbidden"));
  }
  if (!title) {
    redirect(detailPath(id, "missing_title"));
  }
  const nextOrder = project.sections.reduce(
    (max, s) => Math.max(max, (s.sortOrder ?? 0) + 1),
    0,
  );
  const supabase = getSupabaseServiceClient();
  const added = await mustWrite(
    "project section: insert",
    supabase.from("project_sections").insert({
      project_id: id,
      title,
      sort_order: nextOrder,
    }),
  );
  if (!added) redirect(detailPath(id, "save_failed"));
  redirect(detailPath(id));
}

export async function renameProjectSection(formData: FormData) {
  const id = cleanText(formData.get("projectId"));
  const sectionId = cleanText(formData.get("sectionId"));
  const title = cleanText(formData.get("title"));
  const { project } = await requireProject(id);
  if (!project.viewerCanManage) {
    redirect(detailPath(id, "forbidden"));
  }
  if (!title || !project.sections.some((s) => s.id === sectionId)) {
    redirect(detailPath(id, "missing_title"));
  }
  const supabase = getSupabaseServiceClient();
  const renamed = await mustWrite(
    "project section: rename",
    supabase.from("project_sections").update({ title }).eq("id", sectionId).eq("project_id", id),
  );
  if (!renamed) redirect(detailPath(id, "save_failed"));
  redirect(detailPath(id));
}

export async function deleteProjectSection(formData: FormData) {
  const id = cleanText(formData.get("projectId"));
  const sectionId = cleanText(formData.get("sectionId"));
  const { project } = await requireProject(id);
  if (!project.viewerCanManage || !project.sections.some((s) => s.id === sectionId)) {
    redirect(detailPath(id, "forbidden"));
  }
  const supabase = getSupabaseServiceClient();
  // 명세: 섹션을 삭제하면 그 안의 할 일도 삭제한다. 섹션을 지우기 전에 소프트 삭제한다
  // (삭제 정책의 나머지와 동일 — 읽기는 deleted_at 으로 거름).
  // 하위 작업 정리가 실패했는데 섹션만 지우면 그 작업들은 **없는 섹션을 가리킨 채 남는다** —
  // 어느 목록에도 안 뜨고 되돌릴 단서도 없다. 콘솔 `deleteConsoleProjectSection` 과 같은 판단.
  const cleared = await mustWrite(
    "section delete: soft-delete child tasks",
    supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("project_id", id)
      .eq("section_id", sectionId),
  );
  if (!cleared) redirect(detailPath(id, "save_failed"));
  // 섹션 행이 지워지면 FK(`on delete set null`)가 그 할 일들의 section_id 를 비운다. 그래서 나중에 그중
  // 하나를 되살리면(restoreTask) **섹션 없는 프로젝트 할 일**로 돌아오고, 프로젝트 화면의 「섹션 없음」
  // 묶음(모바일 `unsectioned` · 콘솔 기본 묶음)에 그대로 보인다 — 없는 섹션을 가리키는 상태는 생기지 않는다.
  const removed = await mustWrite(
    "project section: delete",
    supabase.from("project_sections").delete().eq("id", sectionId).eq("project_id", id),
  );
  if (!removed) redirect(detailPath(id, "delete_failed"));
  redirect(detailPath(id));
}

/**
 * 순서 저장 · 멤버 초대 결과(2026-10-28, 화면과의 공용 약속) — 예상된 실패는 throw · redirect 하지 않고
 * 이 모양으로 돌려준다. 화면이 실패를 알리고 낙관적 변경을 되돌린다.
 */
export type ProjectActionResult = { ok: true } | { ok: false; reason: "forbidden" | "invalid" | "error" };

/** redirect 없이 세션 + 프로젝트를 확인한다(결과를 돌려주는 액션용). 멤버가 아니면 null. */
async function resolveProjectForResult(
  projectId: string,
): Promise<{ session: Session; project: ProjectDetailData } | null> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  const project = await getProjectDetail(session, projectId);
  if (!project) return null;
  return { session, project };
}

// 프로젝트 섹션의 수동 드래그 순서 변경을 저장한다. `orderedIds` 는 섹션 id 를 위에서 아래
// 새 순서로 담은 것이며, 각 행의 sort_order 를 인덱스(0..n)로 설정한다. 소유자 전용.
export async function reorderProjectSections(
  projectId: string,
  orderedIds: string[],
): Promise<ProjectActionResult> {
  try {
    const id = String(projectId ?? "").trim();
    if (!id) return { ok: false, reason: "invalid" };
    const resolved = await resolveProjectForResult(id);
    if (!resolved || !resolved.project.viewerCanManage) return { ok: false, reason: "forbidden" };
    const valid = new Set(resolved.project.sections.map((s) => s.id));
    const ids = Array.from(
      new Set((orderedIds ?? []).map((s) => String(s).trim()).filter((s) => valid.has(s))),
    );
    if (ids.length === 0) return { ok: false, reason: "invalid" };
    const supabase = getSupabaseServiceClient();
    const results = await Promise.all(
      ids.map((sectionId, index) =>
        supabase
          .from("project_sections")
          .update({ sort_order: index })
          .eq("id", sectionId)
          .eq("project_id", id),
      ),
    );
    revalidatePath(detailPath(id));
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      console.error("[reorderProjectSections] failed:", failed.error.message);
      return { ok: false, reason: "error" };
    }
    return { ok: true };
  } catch (error) {
    console.error("[reorderProjectSections] failed:", error);
    return { ok: false, reason: "error" };
  }
}

/**
 * 멤버 초대(소유자 전용). 화면이 FormData 를 직접 만들어 부르므로 redirect 대신 결과를 돌려준다
 * (2026-10-28) — 예전엔 실패해도 `?error=` 로 같은 화면에 돌아올 뿐이라 시트에서는 알 수 없었다.
 * 새로 들어갈 사람이 없으면(이미 멤버 · 조직 밖) 바꿀 것이 없으므로 성공이다.
 */
export async function inviteProjectMembers(formData: FormData): Promise<ProjectActionResult> {
  try {
    const id = cleanText(formData.get("projectId"));
    if (!id) return { ok: false, reason: "invalid" };
    const resolved = await resolveProjectForResult(id);
    if (!resolved || !resolved.project.viewerCanManage) return { ok: false, reason: "forbidden" };
    const { session, project } = resolved;
    const existing = new Set(project.members.map((m) => m.userId));
    const requested = await validateInvitees(
      session,
      parseStringArray(cleanText(formData.get("shareJson"))),
    );
    const newIds = requested.filter((uid) => !existing.has(uid));
    if (newIds.length === 0) return { ok: true };
    const supabase = getSupabaseServiceClient();
    const hadFirst = project.members.some((m) => m.isFirstRecipient);
    const rows: Database["public"]["Tables"]["project_participants"]["Insert"][] = newIds.map(
      (uid, index) => ({
        project_id: id,
        user_id: uid,
        role: "member",
        is_first_recipient: !hadFirst && index === 0,
        added_by_user_id: session.user.id,
      }),
    );
    const { error } = await supabase.from("project_participants").insert(rows);
    if (error) {
      console.error("[inviteProjectMembers] insert failed:", error.message);
      return { ok: false, reason: "error" };
    }
    await bestEffortWrite(
      "project: mark shared after invite",
      supabase.from("projects").update({ is_shared: true }).eq("id", id),
    );
    await notifyProjectMembers(supabase, {
      organizationId: session.organization.id,
      projectId: id,
      recipientUserIds: newIds,
      actorUserId: session.user.id,
      dedupeBase: `project_shared:${id}`,
      payload: { projectId: id, projectTitle: project.title, actorUserId: session.user.id, event: "shared" },
    });
    revalidatePath(detailPath(id));
    return { ok: true };
  } catch (error) {
    console.error("[inviteProjectMembers] failed:", error);
    return { ok: false, reason: "error" };
  }
}

export async function removeProjectMember(formData: FormData) {
  const id = cleanText(formData.get("projectId"));
  const targetUserId = cleanText(formData.get("userId"));
  const { project } = await requireProject(id);
  if (!project.viewerCanManage) {
    redirect(detailPath(id, "forbidden"));
  }
  // 소유자 / 작성자는 이 경로로 제거할 수 없다.
  if (targetUserId === project.createdByUserId) {
    redirect(detailPath(id, "forbidden"));
  }
  const supabase = getSupabaseServiceClient();
  // 실패하면 빠진 척하지 않는다(2026-10-28).
  const removed = await mustWrite(
    "project_participants: remove member",
    supabase.from("project_participants").delete().eq("project_id", id).eq("user_id", targetUserId),
  );
  if (!removed) redirect(detailPath(id, "save_failed"));
  const remainingMembers = project.members.filter(
    (m) => m.role !== "owner" && m.userId !== targetUserId,
  ).length;
  if (remainingMembers === 0) {
    await bestEffortWrite(
      "project: clear is_shared after last member left",
      supabase.from("projects").update({ is_shared: false }).eq("id", id),
    );
  }
  redirect(detailPath(id));
}

export async function leaveProject(formData: FormData) {
  const id = cleanText(formData.get("projectId"));
  const { session, project } = await requireProject(id);
  // 소유자는 나갈 수 없다 — 대신 프로젝트를 삭제한다.
  if (project.viewerIsOwner) {
    redirect(detailPath(id, "forbidden"));
  }
  const supabase = getSupabaseServiceClient();
  // 실패하면 목록으로 보내지 않는다(2026-10-28) — 나간 줄 알았는데 프로젝트가 그대로 남아 있게 된다.
  const left = await mustWrite(
    "project_participants: leave",
    supabase.from("project_participants").delete().eq("project_id", id).eq("user_id", session.user.id),
  );
  if (!left) redirect(detailPath(id, "save_failed"));
  const remainingMembers = project.members.filter(
    (m) => m.role !== "owner" && m.userId !== session.user.id,
  ).length;
  if (remainingMembers === 0) {
    await bestEffortWrite(
      "project: clear is_shared after last member left",
      supabase.from("projects").update({ is_shared: false }).eq("id", id),
    );
  }
  redirect(PROJECTS_PATH);
}
