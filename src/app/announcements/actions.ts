"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Role } from "@/config/roles";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type AnnouncementRow = Database["public"]["Tables"]["announcements"]["Row"];
type AnnouncementCommentRow =
  Database["public"]["Tables"]["announcement_comments"]["Row"];
type MembershipRow = Pick<
  Database["public"]["Tables"]["memberships"]["Row"],
  "organization_id" | "role"
>;

// Only allow /admin/announcements/{uuid} or /mobile/announcements/{uuid}.
// Any other value is replaced with "/" to prevent open-redirect attacks.
const RETURN_TO_PATTERN =
  /^\/(?:admin|mobile)\/announcements\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function sanitizeReturnTo(raw: string): string {
  return RETURN_TO_PATTERN.test(raw) ? raw : "/";
}

function extractReturnToAnnouncementId(returnTo: string): string | null {
  const match = RETURN_TO_PATTERN.exec(returnTo);
  return match?.[1]?.toLowerCase() ?? null;
}

function redirectWithQuery(returnTo: string, query: string): never {
  redirect(`${returnTo}?${query}`);
}

async function getCurrentUserId() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

async function getCurrentRole(userId: string): Promise<Role | null> {
  const service = getSupabaseServiceClient();

  const { data: platformAdminResult } = await service
    .from("platform_admins")
    .select("role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  const platformAdmin = platformAdminResult as { role: Role } | null;

  if (platformAdmin) {
    return platformAdmin.role;
  }

  const { data: membershipResult } = await service
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const membership = membershipResult as { role: Role } | null;

  return membership?.role ?? null;
}

async function getAnnouncement(announcementId: string) {
  const { data } = await getSupabaseServiceClient()
    .from("announcements")
    .select(
      "id, organization_id, target_scope, target_roles, status, allow_comments",
    )
    .eq("id", announcementId)
    .maybeSingle();

  return data as Pick<
    AnnouncementRow,
    | "allow_comments"
    | "id"
    | "organization_id"
    | "status"
    | "target_roles"
    | "target_scope"
  > | null;
}

async function getAnnouncementComment(commentId: string) {
  const { data } = await getSupabaseServiceClient()
    .from("announcement_comments")
    .select(
      "id, organization_id, announcement_id, user_id, content, created_at, updated_at, deleted_at",
    )
    .eq("id", commentId)
    .maybeSingle();

  return data as AnnouncementCommentRow | null;
}

const MAX_COMMENT_LENGTH = 2000;

async function getMembership(
  userId: string,
  organizationId: string,
) {
  const { data } = await getSupabaseServiceClient()
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  return data as MembershipRow | null;
}

function canCommentOnAnnouncement(
  role: Role,
  membership: MembershipRow | null,
  announcement: NonNullable<Awaited<ReturnType<typeof getAnnouncement>>>,
) {
  if (role === "developer_super_admin") {
    return true;
  }

  if (!membership) {
    return false;
  }

  if (announcement.target_scope === "everyone") {
    return true;
  }

  return announcement.target_roles.includes(membership.role);
}

export async function createAnnouncementComment(formData: FormData) {
  const userId = await getCurrentUserId();
  const returnTo = sanitizeReturnTo(String(formData.get("returnTo") ?? ""));

  if (!userId) {
    redirect(`/auth/login?next=${encodeURIComponent(returnTo)}`);
  }

  const announcementId = String(formData.get("announcementId") ?? "");
  const content = String(formData.get("content") ?? "").trim();

  // 댓글은 2000자까지(2026-10-26, 서버 상한) — 넘으면 「내용을 확인하세요」 오류.
  if (!announcementId || !content || content.length > MAX_COMMENT_LENGTH) {
    redirectWithQuery(returnTo, "error=comment_invalid");
  }

  // Verify returnTo points to the same announcement as the form's announcementId
  const returnToId = extractReturnToAnnouncementId(returnTo);
  if (!returnToId || returnToId !== announcementId.toLowerCase()) {
    redirectWithQuery(returnTo, "error=comment_invalid");
  }

  const [role, announcement] = await Promise.all([
    getCurrentRole(userId),
    getAnnouncement(announcementId),
  ]);

  if (!role || !announcement) {
    redirectWithQuery(returnTo, "error=comment_invalid");
  }

  if (!announcement.allow_comments || announcement.status !== "published") {
    redirectWithQuery(returnTo, "error=comments_disabled");
  }

  const membership =
    role === "developer_super_admin"
      ? null
      : await getMembership(userId, announcement.organization_id);

  if (!canCommentOnAnnouncement(role, membership, announcement)) {
    redirectWithQuery(returnTo, "error=comment_forbidden");
  }

  const { error } = await getSupabaseServiceClient()
    .from("announcement_comments")
    .insert({
      announcement_id: announcement.id,
      content,
      organization_id: announcement.organization_id,
      user_id: userId,
    });

  if (error) {
    redirectWithQuery(returnTo, "error=comment_failed");
  }

  revalidatePath(returnTo);
  redirectWithQuery(returnTo, "commentSaved=1");
}

export async function updateAnnouncementComment(formData: FormData) {
  const userId = await getCurrentUserId();
  const returnTo = sanitizeReturnTo(String(formData.get("returnTo") ?? ""));

  if (!userId) {
    redirect(`/auth/login?next=${encodeURIComponent(returnTo)}`);
  }

  const commentId = String(formData.get("commentId") ?? "");
  const content = String(formData.get("content") ?? "").trim();

  if (!commentId || !content || content.length > MAX_COMMENT_LENGTH) {
    redirectWithQuery(returnTo, "error=comment_invalid");
  }

  const comment = await getAnnouncementComment(commentId);

  if (!comment || comment.deleted_at) {
    redirectWithQuery(returnTo, "error=comment_not_found");
  }

  if (comment.user_id !== userId) {
    redirectWithQuery(returnTo, "error=comment_forbidden");
  }

  // Verify returnTo points to the same announcement as the comment
  const returnToId = extractReturnToAnnouncementId(returnTo);
  if (!returnToId || returnToId !== comment.announcement_id.toLowerCase()) {
    redirectWithQuery(returnTo, "error=comment_not_found");
  }

  const announcement = await getAnnouncement(comment.announcement_id);

  if (!announcement || announcement.organization_id !== comment.organization_id) {
    redirectWithQuery(returnTo, "error=comment_not_found");
  }

  const role = await getCurrentRole(userId);
  const membership =
    role === "developer_super_admin"
      ? null
      : await getMembership(userId, announcement.organization_id);

  if (!role || !canCommentOnAnnouncement(role, membership, announcement)) {
    redirectWithQuery(returnTo, "error=comment_forbidden");
  }

  const { error } = await getSupabaseServiceClient()
    .from("announcement_comments")
    .update({ content })
    .eq("id", comment.id)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) {
    redirectWithQuery(returnTo, "error=comment_update_failed");
  }

  revalidatePath(returnTo);
  redirectWithQuery(returnTo, "commentUpdated=1");
}

export async function deleteAnnouncementComment(formData: FormData) {
  const userId = await getCurrentUserId();
  const returnTo = sanitizeReturnTo(String(formData.get("returnTo") ?? ""));

  if (!userId) {
    redirect(`/auth/login?next=${encodeURIComponent(returnTo)}`);
  }

  const commentId = String(formData.get("commentId") ?? "");

  if (!commentId) {
    redirectWithQuery(returnTo, "error=comment_invalid");
  }

  const comment = await getAnnouncementComment(commentId);

  if (!comment || comment.deleted_at) {
    redirectWithQuery(returnTo, "error=comment_not_found");
  }

  if (comment.user_id !== userId) {
    redirectWithQuery(returnTo, "error=comment_forbidden");
  }

  // Verify returnTo points to the same announcement as the comment
  const returnToId = extractReturnToAnnouncementId(returnTo);
  if (!returnToId || returnToId !== comment.announcement_id.toLowerCase()) {
    redirectWithQuery(returnTo, "error=comment_not_found");
  }

  const announcement = await getAnnouncement(comment.announcement_id);

  if (!announcement || announcement.organization_id !== comment.organization_id) {
    redirectWithQuery(returnTo, "error=comment_not_found");
  }

  const role = await getCurrentRole(userId);
  const membership =
    role === "developer_super_admin"
      ? null
      : await getMembership(userId, announcement.organization_id);

  if (!role || !canCommentOnAnnouncement(role, membership, announcement)) {
    redirectWithQuery(returnTo, "error=comment_forbidden");
  }

  const { error } = await getSupabaseServiceClient()
    .from("announcement_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", comment.id)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) {
    redirectWithQuery(returnTo, "error=comment_delete_failed");
  }

  revalidatePath(returnTo);
  redirectWithQuery(returnTo, "commentDeleted=1");
}
