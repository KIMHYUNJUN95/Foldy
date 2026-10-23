"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notifyProjectMembers } from "@/lib/notifications/create";
import { getProjectDetail, type ProjectDetailData } from "@/lib/projects";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getShareableUsers } from "@/lib/tasks";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { bestEffortWrite, mustWrite } from "@/lib/db-write-guard";
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

// getProjectDetail uses the RLS-scoped client, so a non-null result proves the acting user is a
// project participant. Owner-only actions additionally check `project.viewerCanManage` (owner or platform developer).
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

// Validate requested invitees against the org's active members (fail closed); drops self.
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

  // Owner row + invited member rows share the same key shape (see the tasks-create note on
  // PostgREST filling omitted keys with NULL across a multi-row insert).
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
  // Cascade removes participants, sections, and project tasks (FKs on delete cascade).
  await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("organization_id", session.organization.id);
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
  // Spec: deleting a section also deletes its tasks. Soft-delete them (consistent with the rest of
  // the deletion policy — reads filter deleted_at) before dropping the section.
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
  await supabase.from("project_sections").delete().eq("id", sectionId).eq("project_id", id);
  redirect(detailPath(id));
}

// Persist a manual drag-reorder of a project's sections. `orderedIds` is the section ids in their
// new top-to-bottom order; each row's sort_order is set to its index (0..n). Owner-only.
export async function reorderProjectSections(projectId: string, orderedIds: string[]) {
  const id = String(projectId ?? "").trim();
  if (!id) return;
  const { project } = await requireProject(id);
  if (!project.viewerCanManage) return;
  const valid = new Set(project.sections.map((s) => s.id));
  const ids = Array.from(
    new Set((orderedIds ?? []).map((s) => String(s).trim()).filter((s) => valid.has(s))),
  );
  if (ids.length === 0) return;
  const supabase = getSupabaseServiceClient();
  await Promise.all(
    ids.map((sectionId, index) =>
      supabase
        .from("project_sections")
        .update({ sort_order: index })
        .eq("id", sectionId)
        .eq("project_id", id),
    ),
  );
  revalidatePath(detailPath(id));
}

export async function inviteProjectMembers(formData: FormData) {
  const id = cleanText(formData.get("projectId"));
  const { session, project } = await requireProject(id);
  if (!project.viewerCanManage) {
    redirect(detailPath(id, "forbidden"));
  }
  const existing = new Set(project.members.map((m) => m.userId));
  const requested = await validateInvitees(
    session,
    parseStringArray(cleanText(formData.get("shareJson"))),
  );
  const newIds = requested.filter((uid) => !existing.has(uid));
  if (newIds.length === 0) {
    redirect(detailPath(id));
  }
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
    redirect(detailPath(id, "save_failed"));
  }
  await supabase.from("projects").update({ is_shared: true }).eq("id", id);
  await notifyProjectMembers(supabase, {
    organizationId: session.organization.id,
    projectId: id,
    recipientUserIds: newIds,
    actorUserId: session.user.id,
    dedupeBase: `project_shared:${id}`,
    payload: { projectId: id, projectTitle: project.title, actorUserId: session.user.id, event: "shared" },
  });
  redirect(detailPath(id));
}

export async function removeProjectMember(formData: FormData) {
  const id = cleanText(formData.get("projectId"));
  const targetUserId = cleanText(formData.get("userId"));
  const { project } = await requireProject(id);
  if (!project.viewerCanManage) {
    redirect(detailPath(id, "forbidden"));
  }
  // The owner / creator is never removable via this path.
  if (targetUserId === project.createdByUserId) {
    redirect(detailPath(id, "forbidden"));
  }
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("project_participants")
    .delete()
    .eq("project_id", id)
    .eq("user_id", targetUserId);
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
  // The owner can't leave — they delete the project instead.
  if (project.viewerIsOwner) {
    redirect(detailPath(id, "forbidden"));
  }
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("project_participants")
    .delete()
    .eq("project_id", id)
    .eq("user_id", session.user.id);
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
