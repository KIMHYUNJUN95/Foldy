"use server";

import { redirect } from "next/navigation";
import type { OrganizationRole } from "@/config/roles";
import { organizationRoles } from "@/config/roles";
import { memberCapabilities } from "@/lib/capabilities-server";
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
// 서버 글자 수 상한(2026-10-26) — 클라이언트 입력 제한만 믿지 않는다.
const maxAnnouncementTitleLength = 200;
const maxAnnouncementContentLength = 10000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(v: string): boolean {
  return UUID_RE.test(v);
}

const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9]$/;

// announcement-images 버킷의 Storage 객체 경로를 파싱하고 검증한다.
// 유효하면 세 경로 조각을, 아니면 null 을 돌려준다.
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

  // 권한 키 `announcement.create` — 역할 기본(아르바이트 빼고) + 개인 부여 · 차단(2026-10-21).
  return (await memberCapabilities(organizationId, userId)).includes("announcement.create");
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
  // developer_super_admin 은 모든 조직의 공지를 관리할 수 있다.
  if (await isPlatformAdmin(userId)) {
    return true;
  }

  // 권한 키로 판정(2026-10-21) — 남의 공지까지 = `announcement.manage`(역할 기본 대표 · 전무 · 오피스),
  // 내 공지 = 작성 권한 `announcement.create` 이 아직 있을 때. 비활성 · 멤버 아님이면 빈 목록이라 false.
  const caps = await memberCapabilities(announcement.organization_id, userId);
  if (caps.includes("announcement.manage")) return true;
  return announcement.created_by_user_id === userId && caps.includes("announcement.create");
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
    // 고아 파일은 purgeOrphanAnnouncementImages 가 정리한다.
    console.error("[cleanupStoragePaths] Storage remove failed:", error.message);
  }
}

// Supabase 공개 URL 에서 Storage 객체 경로를 뽑는다.
// announcement-images 버킷에 속하지 않는 URL 은 null 을 돌려준다.
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

// 클라이언트가 보낸 URL 목록에서 검증된 Storage 경로만 뽑는다.
// 제출된 조직 · 공지 ID 와 구조가 맞는 경로만 남긴다.
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

// Storage 에는 올라갔지만 DB 에 저장되지 않은 공지 이미지를 지운다.
// 이 Supabase 프로젝트, announcement-images 버킷,
// 제출된 조직 ID, 제출된 공지 ID 에 속하는 경로만 지운다.
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

// 클라이언트가 올린 이미지 URL 이 우리 Supabase 프로젝트,
// announcement-images 버킷에 속하고 제출된 조직 · 공지 ID 와 맞는지 검증한다.
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

// 업로드 묶음이 중간에 실패했을 때 일부만 올라간 이미지를 정리하려고
// 클라이언트가 호출하는 서버 액션.
// announcementId 매개변수로 정리 범위를 특정 업로드 세션에 고정한다 —
// 그 공지의 경로 중, 사용자가 만들 수 있는 한 조직 아래 것만 지운다.
export async function cleanupAnnouncementImagePaths(
  announcementId: string,
  paths: string[],
) {
  if (paths.length === 0) return;
  if (paths.length > maxAnnouncementImages) return;
  if (!isValidUUID(announcementId)) return;

  const userId = await getCurrentUserId();
  if (!userId) return;

  // 이미 있는 공지(수정 중 업로드 실패)면: 관리 권한이 있고, 지금 공지가 쓰는 사진이 아닌 경로만 지운다(2026-10-26).
  const existing = await getAnnouncement(announcementId);
  if (existing) {
    if (!(await canManageAnnouncement(userId, existing))) return;
    const inUse = new Set(
      existing.image_urls
        .map((u) => extractStoragePath(u))
        .filter((p): p is string => !!p),
    );
    if (paths.some((p) => inUse.has(p) || p.split("/")[0] !== existing.organization_id)) return;
  }

  // 모든 경로가 구조상 유효하고 제출된 announcementId 에 속해야 한다.
  // 경로 하나라도 검증에 실패하면 요청 전체를 거부한다 — 아무것도 지우지 않는다.
  const parsedPaths = paths.map((p) => {
    const parsed = parseAnnouncementImagePath(p);
    return parsed !== null && parsed.announcementId === announcementId ? p : null;
  });
  if (parsedPaths.some((p) => p === null)) return;
  const validPaths = parsedPaths as string[];

  // 모든 경로는 정확히 한 조직에 속해야 한다.
  // 여러 조직이 섞여 있으면 조직 간 정리를 막으려고 거부한다.
  const orgIds = [...new Set(validPaths.map((p) => p.split("/")[0]!))];
  if (orgIds.length !== 1) return;

  const orgId = orgIds[0]!;

  // 현재 사용자가 그 조직에서 공지를 만들 수 있는지 확인한다.
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
    title.length > maxAnnouncementTitleLength ||
    content.length > maxAnnouncementContentLength ||
    !announcementId ||
    !isValidUUID(announcementId) ||
    !["draft", "published"].includes(status) ||
    !["everyone", "roles"].includes(targetScope) ||
    (targetScope === "roles" && targetRoles.length === 0)
  ) {
    await cleanupSubmittedAnnouncementImages(imageUrls, organizationId, announcementId);
    announcementsRedirect("error=invalid_announcement");
  }

  // 제출된 모든 이미지 URL 의 구조를 검증한다
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

  // DB 행 삭제 성공. 이제 붙어 있던 Storage 이미지를 정리한다.
  // 이미 지워진 파일을 가리키는 행이 남지 않도록
  // Storage 정리는 DB 삭제 뒤에 한다. 정리에 실패해도 삭제를 되돌리지 않는다.
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
        // TODO: 로깅 시스템이 갖춰지면 구조화된 로깅으로 바꾼다.
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
// Admin 공지 관리 콘솔 — 클라이언트 구동 액션 (리다이렉트 대신
// 리다이렉트 대신 결과를 돌려준다(콘솔이 토스트 + router.refresh() 를 제자리에서 하도록).
// 위와 같은 검증 · 권한 · 알림 헬퍼를 재사용한다.
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

// datetime-local 값("YYYY-MM-DDTHH:mm", 초는 있어도 됨)에는 시간대 정보가 없어서
// `new Date()` 는 *서버* 타임존(운영에서는 UTC) 기준으로 해석한다. 콘솔 폼은
// 도쿄 벽시계 시각("팝업 노출 종료일")을 묻기 때문에, 시간대 정보 없는 값은
// 여기서 Asia/Tokyo(+09:00)로 해석하고, 이미 명시적 오프셋이나
// `Z` 가 붙은 값은 그대로 통과시킨다.
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
    title.length > maxAnnouncementTitleLength ||
    content.length > maxAnnouncementContentLength ||
    !["draft", "published"].includes(status) ||
    !["everyone", "roles"].includes(targetScope) ||
    (targetScope === "roles" && targetRoles.length === 0)
  ) {
    // 새 글이면 방금 올린 사진이 고아가 되지 않게 치운다(수정이면 아래 편집 경로가 따로 정리).
    if (announcementId && isValidUUID(announcementId) && input.organizationId && isValidUUID(input.organizationId)) {
      await cleanupSubmittedAnnouncementImages(imageUrls, input.organizationId, announcementId);
    }
    return { ok: false, error: "invalid_announcement" };
  }

  const service = getSupabaseServiceClient();
  const existing = await getAnnouncement(announcementId);
  const now = new Date().toISOString();
  const popupUntil = normalizeConsolePopupUntil(input.showPopup, input.popupUntil);

  if (existing) {
    // 수정 경로 — 조직은 바꿀 수 없으므로 저장된 조직 기준으로 검증한다.
    const organizationId = existing.organization_id;
    // 이번 저장에서 새로 올라온 사진(원래 목록에 없던 것) — 저장이 실패하면 고아가 되므로 치운다(2026-10-26).
    const newlyUploaded = getValidatedAnnouncementImagePaths(
      imageUrls.filter((u) => !existing.image_urls.includes(u)),
      organizationId,
      announcementId,
    );
    if (
      imageUrls.length > maxAnnouncementImages ||
      imageUrls.some(
        (url) => !isValidAnnouncementImageUrl(url, organizationId, announcementId),
      )
    ) {
      // 권한 확인 전에는 지우지 않는다 — 남의 공지 폴더를 지우는 통로가 되면 안 된다.
      if (await canManageAnnouncement(userId, existing)) await cleanupStoragePaths(newlyUploaded);
      return { ok: false, error: "invalid_images" };
    }
    if (!(await canManageAnnouncement(userId, existing))) {
      return { ok: false, error: "forbidden" };
    }

    const wasPublished = existing.status === "published";
    // 수정 폼은 draft/published 만 만들므로 행이 보관됨으로 남지 않는다.
    // 오래된 타임스탬프가 남지 않도록 수정 뒤에는 archived_at 을 무조건 비운다.
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

    if (error) {
      await cleanupStoragePaths(newlyUploaded);
      return { ok: false, error: "save_failed" };
    }

    // 편집에서 뺀 사진은 DB가 더 이상 가리키지 않게 된 뒤에 서버에서 지운다(2026-10-26) —
    // 우리 조직 · 이 공지 폴더 경로만.
    const removedPaths = getValidatedAnnouncementImagePaths(
      existing.image_urls.filter((u) => !imageUrls.includes(u)),
      organizationId,
      announcementId,
    );
    await cleanupStoragePaths(removedPaths);

    // 게시된 공지를 «중요»로 올리거나 대상 역할을 넓히면 새로 대상이 된 사람에게도 알린다(2026-10-26).
    // 알림 중복 키가 사람마다 있어 이미 받은 사람에게는 다시 가지 않는다.
    const nextRoles = targetScope === "roles" ? targetRoles : [];
    const sameRoles =
      existing.target_roles.length === nextRoles.length &&
      existing.target_roles.every((r) => (nextRoles as string[]).includes(r));
    const targetChanged = existing.target_scope !== targetScope || !sameRoles;
    if (
      status === "published" &&
      input.isImportant &&
      (!wasPublished || !existing.is_important || targetChanged)
    ) {
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

  // 생성 경로.
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
