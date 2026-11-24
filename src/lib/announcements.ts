import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AppSession } from "@/lib/session";
import type { Database } from "@/types/database";
import type { OrganizationRole } from "@/config/roles";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { countsTowardRead } from "@/lib/announcement-display";
import { selectPopupCandidates } from "@/lib/announcement-rules";

type OrgRoleMap = Map<string, OrganizationRole>;

/**
 * target_scope / target_roles 기준으로 사용자에게 보이는 공지만 반환한다.
 * 플랫폼 관리자(developer_super_admin)는 모든 필터를 건너뛴다.
 * 전체 대상 공지는 멤버십이 있으면 충분하다.
 * 역할 대상 공지는 해당 조직에서의 사용자 역할이 target_roles 에 있어야 한다.
 */
export function filterAnnouncementsByTargetVisibility<
  T extends Pick<
    AnnouncementRow,
    "organization_id" | "target_scope" | "target_roles"
  >,
>(
  announcements: T[],
  isPlatformAdmin: boolean,
  membershipRoleByOrgId: OrgRoleMap,
): T[] {
  if (isPlatformAdmin) return announcements;

  return announcements.filter((a) => {
    const userRole = membershipRoleByOrgId.get(a.organization_id);
    if (!userRole) return false;
    if (a.target_scope === "everyone") return true;
    return (a.target_roles as OrganizationRole[]).includes(userRole);
  });
}

type AnnouncementRow = Pick<
  Database["public"]["Tables"]["announcements"]["Row"],
  | "id"
  | "image_urls"
  | "organization_id"
  | "title"
  | "content"
  | "created_by_user_id"
  | "target_scope"
  | "target_roles"
  | "status"
  | "is_important"
  | "is_pinned"
  | "show_popup_on_app_open"
  | "popup_until"
  | "allow_comments"
  | "published_at"
  | "archived_at"
  | "created_at"
  | "updated_at"
>;

type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "name"
>;
type MembershipRow = Pick<
  Database["public"]["Tables"]["memberships"]["Row"],
  "role" | "user_id"
>;
type AnnouncementCommentRow = Pick<
  Database["public"]["Tables"]["announcement_comments"]["Row"],
  | "announcement_id"
  | "content"
  | "created_at"
  | "deleted_at"
  | "id"
  | "organization_id"
  | "updated_at"
  | "user_id"
>;
type AnnouncementReadRow = Pick<
  Database["public"]["Tables"]["announcement_reads"]["Row"],
  "read_at" | "user_id"
>;
type PopupDismissalRow = Pick<
  Database["public"]["Tables"]["announcement_popup_dismissals"]["Row"],
  "announcement_id" | "hide_until"
>;

export type AnnouncementReaderItem = AnnouncementRow & {
  author_name: string;
  comment_count: number;
  organization_name: string;
};

export type AnnouncementReadSummary = {
  readCount: number;
  readers: AnnouncementReadUser[];
  unreadCount: number;
  unreadUsers: AnnouncementReadUser[];
};

export type AnnouncementReadUser = {
  id: string;
  name: string;
  readAt: string | null;
  role: OrganizationRole;
};

const announcementSelect =
  "id, organization_id, title, content, created_by_user_id, target_scope, target_roles, status, is_important, is_pinned, show_popup_on_app_open, popup_until, allow_comments, image_urls, published_at, archived_at, created_at, updated_at";

async function getAuthorNames(authorIds: string[]) {
  if (authorIds.length === 0) {
    return new Map<string, string>();
  }

  const service = getSupabaseServiceClient();
  const { data } = await service
    .from("profiles")
    .select("id, name")
    .in("id", authorIds);
  const profiles = (data ?? []) as ProfileRow[];

  return new Map(profiles.map((profile) => [profile.id, profile.name]));
}

async function getAnnouncementCommentCounts(announcementIds: string[]) {
  if (announcementIds.length === 0) {
    return new Map<string, number>();
  }

  const service = getSupabaseServiceClient();
  const { data } = await service
    .from("announcement_comments")
    .select("announcement_id")
    .in("announcement_id", announcementIds)
    .is("deleted_at", null);
  const rows = (data ?? []) as Pick<AnnouncementCommentRow, "announcement_id">[];
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.announcement_id, (counts.get(row.announcement_id) ?? 0) + 1);
  }

  return counts;
}

function withAnnouncementMeta(
  announcements: AnnouncementRow[],
  authorNames: Map<string, string>,
  commentCounts: Map<string, number>,
  organizationName: string,
) {
  return announcements.map((announcement) => ({
    ...announcement,
    author_name: authorNames.get(announcement.created_by_user_id) ?? "",
    comment_count: commentCounts.get(announcement.id) ?? 0,
    organization_name: organizationName,
  }));
}

export async function getVisibleAnnouncements(session: AppSession) {
  if (session.organization.id === "platform") {
    return [] as AnnouncementReaderItem[];
  }

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("announcements")
    .select(announcementSelect)
    .eq("organization_id", session.organization.id)
    .eq("status", "published")
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const announcements = (data ?? []) as AnnouncementRow[];
  const [authorNames, commentCounts] = await Promise.all([
    getAuthorNames([...new Set(announcements.map((announcement) => announcement.created_by_user_id))]),
    getAnnouncementCommentCounts(announcements.map((announcement) => announcement.id)),
  ]);

  return withAnnouncementMeta(
    announcements,
    authorNames,
    commentCounts,
    session.organization.name,
  );
}

export async function getHomeImportantAnnouncement(session: AppSession) {
  if (session.organization.id === "platform") {
    return null;
  }

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("announcements")
    .select("id, title, content")
    .eq("organization_id", session.organization.id)
    .eq("status", "published")
    .eq("is_important", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    (data as Pick<AnnouncementRow, "id" | "title" | "content"> | null) ?? null
  );
}

/**
 * 앱을 켰을 때(홈) 띄울 팝업 공지(2026-11-12) — 게시 중 · 나를 대상으로 하는(읽기 정책) 팝업 공지 중
 * 끝나지 않았고 · 읽지 않았고 · 7일 숨기지 않은 것. 목록 화면과 같은 규칙(selectPopupCandidates).
 * 실패하면 빈 목록 — 홈을 막지 않는다.
 */
export async function getHomePopupAnnouncements(session: AppSession) {
  if (session.organization.id === "platform") return [];
  try {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase
      .from("announcements")
      .select("id, organization_id, title, content, image_urls, is_important, published_at, show_popup_on_app_open, popup_until")
      .eq("organization_id", session.organization.id)
      .eq("status", "published")
      .eq("show_popup_on_app_open", true)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Pick<
      AnnouncementRow,
      | "id"
      | "organization_id"
      | "title"
      | "content"
      | "image_urls"
      | "is_important"
      | "published_at"
      | "show_popup_on_app_open"
      | "popup_until"
    >[];
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [dismissedIds, readIds] = await Promise.all([
      getPopupDismissals(session.user.id, ids),
      getReadAnnouncementIds(session.user.id, ids),
    ]);
    return selectPopupCandidates(rows, { dismissedIds, readIds, now: new Date() }).map((row) => ({
      content: row.content,
      id: row.id,
      imageUrls: row.image_urls,
      isImportant: row.is_important,
      organizationId: row.organization_id,
      publishedAt: row.published_at,
      title: row.title,
    }));
  } catch {
    return [];
  }
}

export async function getVisibleAnnouncementById(
  session: AppSession,
  id: string,
) {
  if (session.organization.id === "platform") {
    return null;
  }

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("announcements")
    .select(announcementSelect)
    .eq("organization_id", session.organization.id)
    .eq("status", "published")
    .eq("id", id)
    .maybeSingle();
  const announcement = data as AnnouncementRow | null;

  if (!announcement) {
    return null;
  }

  const [authorNames, commentCounts] = await Promise.all([
    getAuthorNames([announcement.created_by_user_id]),
    getAnnouncementCommentCounts([announcement.id]),
  ]);
  const [readerAnnouncement] = withAnnouncementMeta(
    [announcement],
    authorNames,
    commentCounts,
    session.organization.name,
  );

  return readerAnnouncement;
}

export async function getAnnouncementReadAt(
  announcementId: string,
  userId: string,
) {
  const service = getSupabaseServiceClient();
  const { data } = await service
    .from("announcement_reads")
    .select("read_at")
    .eq("announcement_id", announcementId)
    .eq("user_id", userId)
    .maybeSingle();
  const read = data as Pick<AnnouncementReadRow, "read_at"> | null;

  return read?.read_at ?? null;
}

/** 이 사람이 이미 읽은 공지 id — 모바일 목록의 안 읽음 점(2026-10-15 화이트 리디자인). 본인 기록만 읽는다. */
export async function getReadAnnouncementIds(userId: string, announcementIds: string[]): Promise<Set<string>> {
  if (announcementIds.length === 0) return new Set();
  const service = getSupabaseServiceClient();
  const { data } = await service
    .from("announcement_reads")
    .select("announcement_id")
    .eq("user_id", userId)
    .in("announcement_id", announcementIds);
  return new Set(((data ?? []) as { announcement_id: string }[]).map((row) => row.announcement_id));
}

export async function ensureAnnouncementRead(
  announcement: Pick<AnnouncementRow, "id" | "organization_id">,
  userId: string,
) {
  const existingReadAt = await getAnnouncementReadAt(announcement.id, userId);

  if (existingReadAt) {
    return existingReadAt;
  }

  const service = getSupabaseServiceClient();
  const readAt = new Date().toISOString();

  await bestEffortWrite(
    "announcement_reads: upsert",
    service.from("announcement_reads").upsert(
      {
        announcement_id: announcement.id,
        organization_id: announcement.organization_id,
        read_at: readAt,
        user_id: userId,
      },
      {
        ignoreDuplicates: true,
        onConflict: "announcement_id,user_id",
      },
    )
  );

  return (await getAnnouncementReadAt(announcement.id, userId)) ?? readAt;
}

export async function getAnnouncementReadSummary(
  announcement: AnnouncementRow,
): Promise<AnnouncementReadSummary> {
  const service = getSupabaseServiceClient();
  const membershipQuery = service
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", announcement.organization_id)
    .eq("status", "active");
  const { data: membershipData } =
    announcement.target_scope === "roles"
      ? await membershipQuery.in("role", announcement.target_roles)
      : await membershipQuery;
  // 쓴 사람은 「안 읽음」 목록 · 읽음 분모에서 빠진다(2026-11-20, countsTowardRead — 목록 숫자와 같은 판정).
  const memberships = ((membershipData ?? []) as MembershipRow[]).filter((membership) =>
    countsTowardRead(membership.user_id, announcement.created_by_user_id),
  );
  const userIds = memberships.map((membership) => membership.user_id);

  if (userIds.length === 0) {
    return {
      readCount: 0,
      readers: [],
      unreadCount: 0,
      unreadUsers: [],
    };
  }

  const [{ data: profileData }, { data: readData }] = await Promise.all([
    service.from("profiles").select("id, name").in("id", userIds),
    service
      .from("announcement_reads")
      .select("user_id, read_at")
      .eq("announcement_id", announcement.id)
      .in("user_id", userIds),
  ]);
  const profiles = (profileData ?? []) as ProfileRow[];
  const reads = (readData ?? []) as AnnouncementReadRow[];
  const names = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const readUserIds = new Set(reads.map((read) => read.user_id));
  const membershipByUserId = new Map(
    memberships.map((membership) => [membership.user_id, membership.role]),
  );
  const readByUserId = new Map(reads.map((read) => [read.user_id, read.read_at]));
  const readers = userIds
    .filter((userId) => readUserIds.has(userId))
    .map((userId) => ({
      id: userId,
      name: names.get(userId) ?? "",
      readAt: readByUserId.get(userId) ?? null,
      role: membershipByUserId.get(userId) ?? "staff",
    }))
    .filter((user) => user.name);
  const unreadUsers = userIds
    .filter((userId) => !readUserIds.has(userId))
    .map((userId) => ({
      id: userId,
      name: names.get(userId) ?? "",
      readAt: null,
      role: membershipByUserId.get(userId) ?? "staff",
    }))
    .filter((user) => user.name);

  return {
    readCount: readers.length,
    readers,
    unreadCount: unreadUsers.length,
    unreadUsers,
  };
}

export async function getPopupDismissals(
  userId: string,
  announcementIds: string[],
): Promise<Set<string>> {
  if (announcementIds.length === 0) return new Set();

  const service = getSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data } = await service
    .from("announcement_popup_dismissals")
    .select("announcement_id, hide_until")
    .eq("user_id", userId)
    .in("announcement_id", announcementIds)
    .gt("hide_until", now);
  const rows = (data ?? []) as PopupDismissalRow[];

  return new Set(rows.map((row) => row.announcement_id));
}
