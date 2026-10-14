"use server";

import { redirect } from "next/navigation";
import type { OrganizationRole, Role } from "@/config/roles";
import { organizationRoles } from "@/config/roles";
import { announcementCreatorRoles } from "@/lib/admin-announcements";
import { getPublicSupabaseEnv } from "@/lib/env";
import { getAnnouncementReadSummary } from "@/lib/announcements";
import { createImportantAnnouncementNotifications } from "@/lib/notifications/create";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type AnnouncementInsert =
  Database["public"]["Tables"]["announcements"]["Insert"];
type AnnouncementRow = Database["public"]["Tables"]["announcements"]["Row"];
type AnnouncementStatus = Database["public"]["Enums"]["announcement_status"];
type AnnouncementTargetScope =
  Database["public"]["Enums"]["announcement_target_scope"];

const announcementImageBucket = "announcement-images";
const maxAnnouncementImages = 5;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(v: string): boolean {
  return UUID_RE.test(v);
}

const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9]$/;

// Parse and validate a Storage object path for the announcement-images bucket.
// Returns the three path segments if valid, null otherwise.
function parseAnnouncementImagePath(
  path: string,
): { orgId: string; announcementId: string; filename: string } | null {
  const segments = path.split("/");
  if (segments.length !== 3) return null;
  const [orgId, announcementId, filename] = segments as [string, string, string];
  if (
    !isValidUUID(orgId) ||
    !isValidUUID(announcementId) ||
    filename.length < 3 ||
    filename.length > 160 ||
    !SAFE_FILENAME_RE.test(filename)
  ) {
    return null;
  }
  return { orgId, announcementId, filename };
}

async function getCurrentUserId() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

async function isPlatformAdmin(userId: string) {
  const service = getSupabaseServiceClient();

  const { data: platformAdminResult } = await service
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  return Boolean(platformAdminResult);
}

async function canCreateInOrganization(
  userId: string,
  organizationId: string,
) {
  if (await isPlatformAdmin(userId)) {
    return true;
  }

  const { data } = await getSupabaseServiceClient()
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .neq("role", "part_time_staff")
    .maybeSingle();

  const membership = data as { role: Role } | null;

  return Boolean(
    membership &&
      (announcementCreatorRoles as readonly Role[]).includes(membership.role),
  );
}

async function getAnnouncement(announcementId: string) {
  const { data } = await getSupabaseServiceClient()
    .from("announcements")
    .select(
      "id, organization_id, title, content, created_by_user_id, target_scope, target_roles, status, is_important, is_pinned, show_popup_on_app_open, popup_until, allow_comments, image_urls, published_at, archived_at, created_at, updated_at",
    )
    .eq("id", announcementId)
    .maybeSingle();

  return data as AnnouncementRow | null;
}

async function announcementExists(announcementId: string) {
  const { data } = await getSupabaseServiceClient()
    .from("announcements")
    .select("id")
    .eq("id", announcementId)
    .maybeSingle();

  return Boolean(data);
}

async function canManageAnnouncement(
  userId: string,
  announcement: AnnouncementRow,
) {
  // developer_super_admin can manage announcements across all organizations.
  if (await isPlatformAdmin(userId)) {
    return true;
  }

  // All other users must have an active membership in the announcement's organization.
  // We fetch the role so we can apply per-role rules in one query.
  const { data } = await getSupabaseServiceClient()
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", announcement.organization_id)
    .eq("status", "active")
    .maybeSingle();

  if (!data) {
    return false;
  }

  const membershipRole = (data as { role: Role }).role;

  // owner / office_admin can manage any announcement in their organization.
  if (
    membershipRole === "owner" ||
    membershipRole === "senior_managing_director" ||
    membershipRole === "office_admin"
  ) {
    return true;
  }

  // Announcement authors can manage their own announcements only if they still
  // hold an active, non-part_time_staff membership in the organization.
  if (
    membershipRole !== "part_time_staff" &&
    announcement.created_by_user_id === userId
  ) {
    return true;
  }

  return false;
}

function normalizeTargetRoles(formData: FormData) {
  return formData
    .getAll("targetRoles")
    .map(String)
    .filter((role): role is OrganizationRole =>
      (organizationRoles as readonly string[]).includes(role),
    );
}

async function cleanupStoragePaths(paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await getSupabaseServiceClient()
    .storage.from(announcementImageBucket)
    .remove(paths);
  if (error) {
    // Orphaned files will be caught by purgeOrphanAnnouncementImages.
    console.error("[cleanupStoragePaths] Storage remove failed:", error.message);
  }
}

// Extract the Storage object path from a Supabase public URL.
// Returns null for URLs that do not belong to the announcement-images bucket.
function extractStoragePath(publicUrl: string): string | null {
  try {
    const storageUrl = new URL(publicUrl);
    const supabaseUrl = new URL(getPublicSupabaseEnv().url);
    const prefix = `/storage/v1/object/public/${announcementImageBucket}/`;

    if (
      storageUrl.protocol !== "https:" ||
      storageUrl.hostname !== supabaseUrl.hostname ||
      !storageUrl.pathname.startsWith(prefix)
    ) {
      return null;
    }

    const encodedPath = storageUrl.pathname.slice(prefix.length);

    if (!encodedPath) {
      return null;
    }

    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

// Extract validated Storage paths from a client-submitted URL list,
// keeping only paths that structurally match the submitted org and announcement IDs.
function getValidatedAnnouncementImagePaths(
  imageUrls: string[],
  organizationId: string,
  announcementId: string,
): string[] {
  return imageUrls.flatMap((url) => {
    const path = extractStoragePath(url);
    if (!path) return [];
    const parsed = parseAnnouncementImagePath(path);
    if (!parsed) return [];
    if (parsed.orgId !== organizationId || parsed.announcementId !== announcementId)
      return [];
    return [path];
  });
}

// Remove announcement images that were uploaded to Storage but not persisted to the DB.
// Only deletes paths that belong to this Supabase project, the announcement-images bucket,
// the submitted organization ID, and the submitted announcement ID.
async function cleanupSubmittedAnnouncementImages(
  imageUrls: string[],
  organizationId: string,
  announcementId: string,
) {
  if (!isValidUUID(organizationId) || !isValidUUID(announcementId)) return;
  if (await announcementExists(announcementId)) return;
  const paths = getValidatedAnnouncementImagePaths(
    imageUrls,
    organizationId,
    announcementId,
  );
  await cleanupStoragePaths(paths);
}

// Validate that an image URL uploaded by the client belongs to our Supabase project,
// the announcement-images bucket, and matches the submitted org and announcement IDs.
function isValidAnnouncementImageUrl(
  url: string,
  organizationId: string,
  announcementId: string,
): boolean {
  const path = extractStoragePath(url);
  if (!path) return false;
  const parsed = parseAnnouncementImagePath(path);
  if (!parsed) return false;
  return parsed.orgId === organizationId && parsed.announcementId === announcementId;
}

function announcementsRedirect(query: string): never {
  redirect(`/admin/announcements?${query}`);
}

// Server action called by the client to clean up partially-uploaded images
// when an upload batch fails mid-way.
// The announcementId parameter pins the cleanup to a specific upload session —
// only paths for that announcement under one org the user can create in are removed.
export async function cleanupAnnouncementImagePaths(
  announcementId: string,
  paths: string[],
) {
  if (paths.length === 0) return;
  if (paths.length > maxAnnouncementImages) return;
  if (!isValidUUID(announcementId)) return;

  const userId = await getCurrentUserId();
  if (!userId) return;

  if (await announcementExists(announcementId)) return;

  // Every path must be structurally valid and belong to the submitted announcementId.
  // If ANY path fails validation, reject the entire request — delete nothing.
  const parsedPaths = paths.map((p) => {
    const parsed = parseAnnouncementImagePath(p);
    return parsed !== null && parsed.announcementId === announcementId ? p : null;
  });
  if (parsedPaths.some((p) => p === null)) return;
  const validPaths = parsedPaths as string[];

  // All paths must belong to exactly one organization.
  // Reject if multiple orgs appear to prevent cross-org cleanup.
  const orgIds = [...new Set(validPaths.map((p) => p.split("/")[0]!))];
  if (orgIds.length !== 1) return;

  const orgId = orgIds[0]!;

  // Verify the current user is allowed to create announcements in that organization.
  if (!(await canCreateInOrganization(userId, orgId))) return;

  await cleanupStoragePaths(validPaths);
}

export async function createAnnouncement(formData: FormData) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/auth/login?next=/admin/announcements");
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  const announcementId = String(formData.get("announcementId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const status = String(formData.get("status") ?? "draft") as AnnouncementStatus;
  const targetScope = String(
    formData.get("targetScope") ?? "everyone",
  ) as AnnouncementTargetScope;
  const targetRoles = normalizeTargetRoles(formData);
  const imageUrls = formData
    .getAll("imageUrls")
    .map(String)
    .filter(Boolean);

  if (!organizationId || !isValidUUID(organizationId)) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    announcementsRedirect("error=invalid_organization");
  }

  if (
    !title ||
    !content ||
    !announcementId ||
    !isValidUUID(announcementId) ||
    !["draft", "published"].includes(status) ||
    !["everyone", "roles"].includes(targetScope) ||
    (targetScope === "roles" && targetRoles.length === 0)
  ) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    announcementsRedirect("error=invalid_announcement");
  }

  // Validate URL structure for all submitted image URLs
  if (
    imageUrls.length > maxAnnouncementImages ||
    imageUrls.some(
      (url) => !isValidAnnouncementImageUrl(url, organizationId, announcementId),
    )
  ) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    announcementsRedirect("error=invalid_images");
  }

  if (!(await canCreateInOrganization(userId, organizationId))) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    announcementsRedirect("error=forbidden");
  }

  const now = new Date().toISOString();
  const announcement: AnnouncementInsert = {
    allow_comments: formData.get("allowComments") === "on",
    content,
    created_by_user_id: userId,
    id: announcementId,
    image_urls: imageUrls,
    is_important: formData.get("isImportant") === "on",
    is_pinned: formData.get("isPinned") === "on",
    organization_id: organizationId,
    published_at: status === "published" ? now : null,
    show_popup_on_app_open: formData.get("showPopup") === "on",
    status,
    target_roles: targetScope === "roles" ? targetRoles : [],
    target_scope: targetScope,
    title,
  };

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("announcements")
    .insert(announcement);

  if (error) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    announcementsRedirect("error=save_failed");
  }

  if (announcement.status === "published" && announcement.is_important) {
    await createImportantAnnouncementNotifications(service, {
      organizationId,
      announcementId,
      announcementTitle: title,
      actorUserId: userId,
      targetScope,
      targetRoles,
    });
  }

  announcementsRedirect("created=1");
}

export async function updateAnnouncementStatus(formData: FormData) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/auth/login?next=/admin/announcements");
  }

  const announcementId = String(formData.get("announcementId") ?? "");
  const nextStatus = String(formData.get("status") ?? "") as AnnouncementStatus;

  if (
    !announcementId ||
    !isValidUUID(announcementId) ||
    !["draft", "published", "archived"].includes(nextStatus)
  ) {
    announcementsRedirect("error=invalid_announcement");
  }

  const announcement = await getAnnouncement(announcementId);
  if (!announcement) {
    announcementsRedirect("error=invalid_announcement");
  }

  if (!(await canManageAnnouncement(userId, announcement))) {
    announcementsRedirect("error=forbidden");
  }

  const now = new Date().toISOString();
  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("announcements")
    .update({
      archived_at: nextStatus === "archived" ? now : null,
      published_at: nextStatus === "published" ? now : announcement.published_at,
      status: nextStatus,
    })
    .eq("id", announcementId);

  if (error) {
    announcementsRedirect("error=save_failed");
  }

  if (
    nextStatus === "published" &&
    announcement.status !== "published" &&
    announcement.is_important
  ) {
    await createImportantAnnouncementNotifications(service, {
      organizationId: announcement.organization_id,
      announcementId: announcement.id,
      announcementTitle: announcement.title,
      actorUserId: userId,
      targetScope: announcement.target_scope,
      targetRoles: announcement.target_roles,
    });
  }

  announcementsRedirect("statusUpdated=1");
}

export async function deleteAnnouncement(formData: FormData) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/auth/login?next=/admin/announcements");
  }

  const announcementId = String(formData.get("announcementId") ?? "");

  if (!announcementId || !isValidUUID(announcementId)) {
    announcementsRedirect("error=invalid_announcement");
  }

  const announcement = await getAnnouncement(announcementId);
  if (!announcement) {
    announcementsRedirect("error=invalid_announcement");
  }

  if (!(await canManageAnnouncement(userId, announcement))) {
    announcementsRedirect("error=forbidden");
  }

  const { error } = await getSupabaseServiceClient()
    .from("announcements")
    .delete()
    .eq("id", announcementId);

  if (error) {
    announcementsRedirect("error=save_failed");
  }

  // DB row deleted successfully. Now clean up attached Storage images.
  // Storage cleanup runs after DB deletion to avoid leaving a row that points
  // to already-deleted files. A cleanup failure does not roll back the deletion.
  if (announcement.image_urls.length > 0) {
    const storagePaths = getValidatedAnnouncementImagePaths(
      announcement.image_urls,
      announcement.organization_id,
      announcement.id,
    );

    if (storagePaths.length > 0) {
      const { error: storageError } = await getSupabaseServiceClient()
        .storage.from(announcementImageBucket)
        .remove(storagePaths);

      if (storageError) {
        // TODO: Replace with structured logging once a logging system is in place.
        console.error(
          "[deleteAnnouncement] Storage cleanup failed for announcement",
          announcementId,
          storageError.message,
        );
      }
    }
  }

  announcementsRedirect("deleted=1");
}

// ===========================================================================
// Admin 공지 관리 콘솔 — client-driven actions (return a result instead of
// redirecting, so the console can toast + router.refresh() in place).
// Reuses the same validation / permission / notification helpers as above.
// ===========================================================================

export type AnnouncementConsoleResult =
  | { ok: true }
  | { ok: false; error: string };

type SaveAnnouncementConsoleInput = {
  announcementId: string;
  organizationId: string;
  title: string;
  content: string;
  status: "draft" | "published";
  targetScope: "everyone" | "roles";
  targetRoles: string[];
  imageUrls: string[];
  isImportant: boolean;
  isPinned: boolean;
  showPopup: boolean;
  popupUntil: string | null;
};

function normalizeConsoleTargetRoles(roles: string[]): OrganizationRole[] {
  return roles.filter((role): role is OrganizationRole =>
    (organizationRoles as readonly string[]).includes(role),
  );
}

// A datetime-local value ("YYYY-MM-DDTHH:mm", optionally with seconds) carries no
// timezone, so `new Date()` would resolve it against the *server's* zone — UTC in
// production. The console form asks for a Tokyo wall clock ("팝업 노출 종료일"), so a
// naive value is interpreted as Asia/Tokyo (+09:00) here; anything already carrying
// an explicit offset or `Z` is passed through untouched.
const NAIVE_LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function normalizeConsolePopupUntil(
  showPopup: boolean,
  popupUntil: string | null,
): string | null {
  if (!showPopup || !popupUntil) return null;
  const value = NAIVE_LOCAL_DATETIME_RE.test(popupUntil)
    ? `${popupUntil}+09:00`
    : popupUntil;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function saveAnnouncementConsole(
  input: SaveAnnouncementConsoleInput,
): Promise<AnnouncementConsoleResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "forbidden" };

  const title = input.title.trim();
  const content = input.content.trim();
  const status = input.status;
  const targetScope = input.targetScope;
  const targetRoles = normalizeConsoleTargetRoles(input.targetRoles);
  const imageUrls = input.imageUrls.filter(Boolean);
  const announcementId = input.announcementId;

  if (!announcementId || !isValidUUID(announcementId)) {
    return { ok: false, error: "invalid_announcement" };
  }
  if (
    !title ||
    !content ||
    !["draft", "published"].includes(status) ||
    !["everyone", "roles"].includes(targetScope) ||
    (targetScope === "roles" && targetRoles.length === 0)
  ) {
    return { ok: false, error: "invalid_announcement" };
  }

  const service = getSupabaseServiceClient();
  const existing = await getAnnouncement(announcementId);
  const now = new Date().toISOString();
  const popupUntil = normalizeConsolePopupUntil(input.showPopup, input.popupUntil);

  if (existing) {
    // Edit path — organization is immutable; validate against the stored org.
    const organizationId = existing.organization_id;
    if (
      imageUrls.length > maxAnnouncementImages ||
      imageUrls.some(
        (url) => !isValidAnnouncementImageUrl(url, organizationId, announcementId),
      )
    ) {
      return { ok: false, error: "invalid_images" };
    }
    if (!(await canManageAnnouncement(userId, existing))) {
      return { ok: false, error: "forbidden" };
    }

    const wasPublished = existing.status === "published";
    // The edit form only produces draft/published, so the row never stays archived
    // after an edit — clear archived_at unconditionally to avoid a stale timestamp.
    const { error } = await service
      .from("announcements")
      .update({
        archived_at: null,
        content,
        image_urls: imageUrls,
        is_important: input.isImportant,
        is_pinned: input.isPinned,
        popup_until: popupUntil,
        published_at:
          status === "published" ? (existing.published_at ?? now) : existing.published_at,
        show_popup_on_app_open: input.showPopup,
        status,
        target_roles: targetScope === "roles" ? targetRoles : [],
        target_scope: targetScope,
        title,
      })
      .eq("id", announcementId);

    if (error) return { ok: false, error: "save_failed" };

    if (status === "published" && !wasPublished && input.isImportant) {
      await createImportantAnnouncementNotifications(service, {
        organizationId,
        announcementId,
        announcementTitle: title,
        actorUserId: userId,
        targetScope,
        targetRoles,
      });
    }
    return { ok: true };
  }

  // Create path.
  const organizationId = input.organizationId;
  if (!organizationId || !isValidUUID(organizationId)) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    return { ok: false, error: "invalid_organization" };
  }
  if (
    imageUrls.length > maxAnnouncementImages ||
    imageUrls.some(
      (url) => !isValidAnnouncementImageUrl(url, organizationId, announcementId),
    )
  ) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    return { ok: false, error: "invalid_images" };
  }
  if (!(await canCreateInOrganization(userId, organizationId))) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    return { ok: false, error: "forbidden" };
  }

  const { error } = await service.from("announcements").insert({
    allow_comments: false,
    content,
    created_by_user_id: userId,
    id: announcementId,
    image_urls: imageUrls,
    is_important: input.isImportant,
    is_pinned: input.isPinned,
    organization_id: organizationId,
    popup_until: popupUntil,
    published_at: status === "published" ? now : null,
    show_popup_on_app_open: input.showPopup,
    status,
    target_roles: targetScope === "roles" ? targetRoles : [],
    target_scope: targetScope,
    title,
  });

  if (error) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    return { ok: false, error: "save_failed" };
  }

  if (status === "published" && input.isImportant) {
    await createImportantAnnouncementNotifications(service, {
      organizationId,
      announcementId,
      announcementTitle: title,
      actorUserId: userId,
      targetScope,
      targetRoles,
    });
  }
  return { ok: true };
}

export async function setAnnouncementStatusConsole(
  announcementId: string,
  nextStatus: "draft" | "published" | "archived",
): Promise<AnnouncementConsoleResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "forbidden" };
  if (
    !announcementId ||
    !isValidUUID(announcementId) ||
    !["draft", "published", "archived"].includes(nextStatus)
  ) {
    return { ok: false, error: "invalid_announcement" };
  }

  const announcement = await getAnnouncement(announcementId);
  if (!announcement) return { ok: false, error: "invalid_announcement" };
  if (!(await canManageAnnouncement(userId, announcement))) {
    return { ok: false, error: "forbidden" };
  }

  const now = new Date().toISOString();
  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("announcements")
    .update({
      archived_at: nextStatus === "archived" ? now : null,
      published_at:
        nextStatus === "published" ? now : announcement.published_at,
      status: nextStatus,
    })
    .eq("id", announcementId);

  if (error) return { ok: false, error: "save_failed" };

  if (
    nextStatus === "published" &&
    announcement.status !== "published" &&
    announcement.is_important
  ) {
    await createImportantAnnouncementNotifications(service, {
      organizationId: announcement.organization_id,
      announcementId: announcement.id,
      announcementTitle: announcement.title,
      actorUserId: userId,
      targetScope: announcement.target_scope,
      targetRoles: announcement.target_roles,
    });
  }
  return { ok: true };
}

export async function deleteAnnouncementConsole(
  announcementId: string,
): Promise<AnnouncementConsoleResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "forbidden" };
  if (!announcementId || !isValidUUID(announcementId)) {
    return { ok: false, error: "invalid_announcement" };
  }

  const announcement = await getAnnouncement(announcementId);
  if (!announcement) return { ok: false, error: "invalid_announcement" };
  if (!(await canManageAnnouncement(userId, announcement))) {
    return { ok: false, error: "forbidden" };
  }

  const { error } = await getSupabaseServiceClient()
    .from("announcements")
    .delete()
    .eq("id", announcementId);

  if (error) return { ok: false, error: "save_failed" };

  if (announcement.image_urls.length > 0) {
    const storagePaths = getValidatedAnnouncementImagePaths(
      announcement.image_urls,
      announcement.organization_id,
      announcement.id,
    );
    if (storagePaths.length > 0) {
      const { error: storageError } = await getSupabaseServiceClient()
        .storage.from(announcementImageBucket)
        .remove(storagePaths);
      if (storageError) {
        console.error(
          "[deleteAnnouncementConsole] Storage cleanup failed for announcement",
          announcementId,
          storageError.message,
        );
      }
    }
  }
  return { ok: true };
}

export type AnnouncementReadStatusResult =
  | {
      ok: true;
      readers: { id: string; name: string; readAt: string | null; role: string }[];
      unreadUsers: { id: string; name: string; role: string }[];
    }
  | { ok: false; error: string };

export async function getAnnouncementReadStatusConsole(
  announcementId: string,
): Promise<AnnouncementReadStatusResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "forbidden" };
  if (!announcementId || !isValidUUID(announcementId)) {
    return { ok: false, error: "invalid_announcement" };
  }

  const announcement = await getAnnouncement(announcementId);
  if (!announcement) return { ok: false, error: "invalid_announcement" };
  if (!(await canManageAnnouncement(userId, announcement))) {
    return { ok: false, error: "forbidden" };
  }

  const summary = await getAnnouncementReadSummary(announcement);
  return {
    ok: true,
    readers: summary.readers.map((reader) => ({
      id: reader.id,
      name: reader.name,
      readAt: reader.readAt,
      role: reader.role,
    })),
    unreadUsers: summary.unreadUsers.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
    })),
  };
}
