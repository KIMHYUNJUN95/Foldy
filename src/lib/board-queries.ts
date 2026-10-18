// Board (자유 게시판) — server-only feed + detail queries (Pages 2–3).
//
// Kept SEPARATE from `src/lib/board.ts` because that module uses the BROWSER Supabase client and is
// imported by client components (the composer). Pulling the server client / `next/headers` in there
// would drag server-only code into the client bundle. Mirrors the suggestions.ts ↔ suggestions-queries.ts
// split. Visibility/org-isolation is enforced by RLS; every query also scopes to session.organization.id.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { AppSession } from "@/lib/session";
import type {
  AvatarColor,
  BoardCommentDetail,
  BoardPost,
  BoardPostDetail,
  BoardReaction,
  BoardReactionFace,
  FileAttachment,
} from "@/components/board/board-types";
import { getDictionary } from "@/lib/i18n";
import { displayRoleKey, fetchPlatformDeveloperIds } from "@/lib/platform-developers";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { getBoardHiddenFor, type BoardHiddenSet } from "@/lib/board-moderation";

export type MentionableMember = {
  id: string;
  name: string;
  role: string | null;
  avatarColor: AvatarColor;
};

// Deterministic avatar tint from a user id (adds variety to stacked reactor/comment avatars).
const AVATAR_COLORS: AvatarColor[] = ["default", "green", "blue", "red"];
function avatarColorFor(userId: string): AvatarColor {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash + userId.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

const FEED_COLS =
  "id, title, content, tags, image_urls, file_attachments, is_pinned, pinned_at, allow_comments, created_at, created_by_user_id";

// Emoji order used across the board (matches the reaction bar). Reactions are returned in this order.
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢"] as const;

type PostRow = {
  id: string;
  title: string | null;
  content: string;
  tags: string[];
  image_urls: string[];
  file_attachments: Json;
  is_pinned: boolean;
  pinned_at: string | null;
  allow_comments: boolean;
  created_at: string;
  created_by_user_id: string;
};

type MemberInfo = { name: string; roleLabel: string };

/** Resolve display name + localized role label for a set of author user ids. */
async function fetchAuthorInfo(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userIds: string[],
  locale: AppSession["user"]["preferredLanguage"],
): Promise<Map<string, MemberInfo>> {
  const map = new Map<string, MemberInfo>();
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (ids.length === 0) return map;

  const roles = getDictionary(locale).roles as Record<string, string>;
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, profiles(name)")
    .eq("organization_id", organizationId)
    .in("user_id", ids);
  if (error) return map;

  const devIds = await fetchPlatformDeveloperIds(ids);
  for (const m of (data ?? []) as Array<{
    user_id: string;
    role: string;
    profiles: { name: string } | { name: string }[] | null;
  }>) {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const role = displayRoleKey(m.role, m.user_id, devIds);
    map.set(m.user_id, {
      name: profile?.name ?? "",
      roleLabel: roles[role] ?? role,
    });
  }
  return map;
}

/** Hydrate raw post rows into BoardPost objects (author, comment count, reactions, unread). */
async function hydratePosts(
  supabase: SupabaseClient<Database>,
  session: AppSession,
  rows: PostRow[],
  hidden: BoardHiddenSet,
): Promise<BoardPost[]> {
  if (rows.length === 0) return [];
  const uid = session.user.id;
  const orgId = session.organization.id;
  const postIds = rows.map((r) => r.id);

  const [authorInfo, readsRes, commentsRes, reactionsRes] = await Promise.all([
    fetchAuthorInfo(supabase, orgId, rows.map((r) => r.created_by_user_id), session.user.preferredLanguage),
    supabase.from("board_post_reads").select("post_id").eq("user_id", uid).in("post_id", postIds),
    supabase
      .from("board_comments")
      .select("id, post_id, created_by_user_id")
      .in("post_id", postIds)
      .is("deleted_at", null),
    supabase.from("board_reactions").select("post_id, emoji, user_id").in("post_id", postIds),
  ]);

  const readSet = new Set(
    (readsRes.error ? [] : (readsRes.data ?? [])).map((r) => (r as { post_id: string }).post_id),
  );

  const commentCounts = new Map<string, number>();
  for (const r of commentsRes.error ? [] : (commentsRes.data ?? [])) {
    const row = r as { id: string; post_id: string; created_by_user_id: string };
    // 상세 화면과 같은 수를 보이도록 내가 숨긴 댓글(신고 · 차단)은 세지 않는다.
    if (hidden.hiddenCommentIds.has(row.id) || hidden.blockedUserIds.has(row.created_by_user_id)) continue;
    commentCounts.set(row.post_id, (commentCounts.get(row.post_id) ?? 0) + 1);
  }

  // post_id → emoji → { count, isMine }
  const reactionAgg = new Map<string, Map<string, { count: number; isMine: boolean }>>();
  for (const r of reactionsRes.error ? [] : (reactionsRes.data ?? [])) {
    const row = r as { post_id: string; emoji: string; user_id: string };
    let byEmoji = reactionAgg.get(row.post_id);
    if (!byEmoji) {
      byEmoji = new Map();
      reactionAgg.set(row.post_id, byEmoji);
    }
    const cur = byEmoji.get(row.emoji) ?? { count: 0, isMine: false };
    cur.count += 1;
    if (row.user_id === uid) cur.isMine = true;
    byEmoji.set(row.emoji, cur);
  }

  return rows.map((row) => {
    const info = authorInfo.get(row.created_by_user_id);
    const byEmoji = reactionAgg.get(row.id);
    const reactions: BoardReaction[] = byEmoji
      ? REACTION_EMOJIS.filter((e) => byEmoji.has(e)).map((e) => ({
          emoji: e,
          count: byEmoji.get(e)!.count,
          isMine: byEmoji.get(e)!.isMine,
        }))
      : [];

    return {
      id: row.id,
      title: row.title,
      content: row.content,
      tags: row.tags ?? [],
      imageUrls: row.image_urls ?? [],
      fileAttachments: (row.file_attachments as unknown as FileAttachment[]) ?? [],
      isPinned: row.is_pinned,
      pinnedAt: row.pinned_at,
      allowComments: row.allow_comments,
      createdAt: row.created_at,
      authorName: info?.name ?? "",
      authorId: row.created_by_user_id,
      authorRole: info?.roleLabel ?? "",
      avatarColor: "default",
      commentCount: commentCounts.get(row.id) ?? 0,
      reactions,
      // Own posts are treated as read; otherwise unread until a read row exists.
      isUnread: row.created_by_user_id !== uid && !readSet.has(row.id),
      // The list badge uses the first tag as the post's "category".
      category: row.tags && row.tags.length > 0 ? row.tags[0] : null,
    } satisfies BoardPost;
  });
}

/**
 * Board feed for the current org. Pinned posts first (pinned_at DESC, fetched in full on the first
 * page only), then non-pinned (created_at DESC) cursor-paginated by `before` (= last non-pinned
 * created_at). `category` filters posts whose `tags` array contains the value. Excludes soft-deleted.
 */
export async function getBoardFeed(params: {
  session: AppSession;
  category?: string | null;
  limit: number;
  before?: string | null;
}): Promise<{ posts: BoardPost[]; nextCursor: string | null }> {
  const { session, category, limit, before } = params;
  const supabase = await getSupabaseServerClient();
  const orgId = session.organization.id;

  // Pinned posts: first page only (omitted when paginating to avoid duplicates).
  let pinnedRows: PostRow[] = [];
  if (!before) {
    let pq = supabase
      .from("board_posts")
      .select(FEED_COLS)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("is_pinned", true)
      .order("pinned_at", { ascending: false });
    if (category) pq = pq.contains("tags", [category]);
    const { data, error } = await pq;
    if (!error) pinnedRows = (data ?? []) as PostRow[];
  }

  // Non-pinned posts: keyset pagination on (created_at, id) DESC. The `id` tiebreaker makes the order
  // stable and prevents the strict-`<` cursor from silently dropping posts that share an identical
  // created_at at the page boundary. The cursor encodes both fields as `${created_at}|${id}`.
  let nq = supabase
    .from("board_posts")
    .select(FEED_COLS)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .eq("is_pinned", false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (category) nq = nq.contains("tags", [category]);
  if (before) {
    const sep = before.lastIndexOf("|");
    const beforeCreatedAt = sep >= 0 ? before.slice(0, sep) : before;
    const beforeId = sep >= 0 ? before.slice(sep + 1) : "";
    nq = beforeId
      ? nq.or(
          `created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeId})`,
        )
      : nq.lt("created_at", beforeCreatedAt);
  }
  const { data: nData, error: nErr } = await nq;
  const normalRows = (nErr ? [] : (nData ?? [])) as PostRow[];

  // 커서는 거르기 전 원본 행 기준 — 숨긴 글 때문에 한 페이지가 짧아질 수는 있어도 다음 페이지를 건너뛰지 않는다.
  const last = normalRows[normalRows.length - 1];
  const nextCursor = normalRows.length === limit && last ? `${last.created_at}|${last.id}` : null;

  // 신고 · 차단(2026-10-06): 내가 신고한 글과 내가 차단한 사람의 글은 피드에서 뺀다.
  const hidden = await getBoardHiddenFor(session);
  const visible = (row: PostRow) =>
    !hidden.hiddenPostIds.has(row.id) && !hidden.blockedUserIds.has(row.created_by_user_id);
  const posts = await hydratePosts(
    supabase,
    session,
    [...pinnedRows, ...normalRows].filter(visible),
    hidden,
  );
  return { posts, nextCursor };
}

/** Distinct tag values across the org's non-deleted posts (for the filter chips), capped + sorted. */
export async function getBoardTags(session: AppSession): Promise<string[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("board_posts")
    .select("tags")
    .eq("organization_id", session.organization.id)
    .is("deleted_at", null);
  if (error) return [];

  const freq = new Map<string, number>();
  for (const r of (data ?? []) as { tags: string[] | null }[]) {
    for (const t of r.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([tag]) => tag);
}

/**
 * Unread board posts for the current user: non-deleted org posts not authored by the user and without
 * a read row. Mirrors countUnreadAnnouncements; fails closed to 0 if the schema is not present.
 */
export async function getBoardUnreadCount(session: AppSession): Promise<number> {
  try {
    const supabase = await getSupabaseServerClient();
    const orgId = session.organization.id;
    const uid = session.user.id;

    const { data: posts, error: postsError } = await supabase
      .from("board_posts")
      .select("id, created_by_user_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .returns<{ id: string; created_by_user_id: string }[]>();
    if (postsError) return 0;

    const hidden = await getBoardHiddenFor(session);
    const candidateIds = (posts ?? [])
      .filter(
        (p) =>
          p.created_by_user_id !== uid &&
          !hidden.hiddenPostIds.has(p.id) &&
          !hidden.blockedUserIds.has(p.created_by_user_id),
      )
      .map((p) => p.id);
    if (candidateIds.length === 0) return 0;

    const { data: reads, error: readsError } = await supabase
      .from("board_post_reads")
      .select("post_id")
      .eq("user_id", uid)
      .in("post_id", candidateIds)
      .returns<{ post_id: string }[]>();
    if (readsError) return 0;

    const readSet = new Set((reads ?? []).map((r) => r.post_id));
    return candidateIds.filter((id) => !readSet.has(id)).length;
  } catch {
    return 0;
  }
}

const DETAIL_COLS =
  "id, title, content, tags, image_urls, file_attachments, is_pinned, allow_comments, created_at, created_by_user_id, organization_id, deleted_at";

type DetailRow = PostRow & { organization_id: string; deleted_at: string | null };

/**
 * Full post detail for the viewer: post fields + author + comments (non-deleted, oldest-first) +
 * reactions aggregated with the viewer's isMine flag per emoji + up to 3 reactor faces for the
 * most-used emoji. Returns null when the post does not exist, is soft-deleted, or belongs to another
 * org (RLS is the backstop; the org match is also checked explicitly).
 */
export async function getBoardPost(params: {
  session: AppSession;
  id: string;
}): Promise<BoardPostDetail | null> {
  const { session, id } = params;
  const supabase = await getSupabaseServerClient();
  const orgId = session.organization.id;
  const uid = session.user.id;

  const { data, error } = await supabase
    .from("board_posts")
    .select(DETAIL_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const post = data as unknown as DetailRow;
  if (post.deleted_at || post.organization_id !== orgId) return null;

  // 내가 신고한 글 · 차단한 사람의 글은 링크로 들어와도 보이지 않는다(피드와 같은 규칙).
  const hidden = await getBoardHiddenFor(session);
  if (hidden.hiddenPostIds.has(post.id) || hidden.blockedUserIds.has(post.created_by_user_id)) return null;

  const [comments, reactionRows] = await Promise.all([
    supabase
      .from("board_comments")
      .select("id, content, image_urls, created_at, created_by_user_id")
      .eq("post_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    supabase.from("board_reactions").select("emoji, user_id").eq("post_id", id),
  ]);

  const commentRows = (
    (comments.error ? [] : (comments.data ?? [])) as Array<{
      id: string;
      content: string;
      image_urls: string[];
      created_at: string;
      created_by_user_id: string;
    }>
  ).filter((c) => !hidden.hiddenCommentIds.has(c.id) && !hidden.blockedUserIds.has(c.created_by_user_id));
  const reactions = (reactionRows.error ? [] : (reactionRows.data ?? [])) as Array<{
    emoji: string;
    user_id: string;
  }>;

  // Resolve author + commenter names/roles in one membership lookup.
  const personIds = [post.created_by_user_id, ...commentRows.map((c) => c.created_by_user_id)];
  const authorInfo = await fetchAuthorInfo(supabase, orgId, personIds, session.user.preferredLanguage);

  // Reactions: count + isMine per emoji (fixed order), plus reactor faces for the most-used emoji.
  const countByEmoji = new Map<string, number>();
  const mineByEmoji = new Set<string>();
  const reactorsByEmoji = new Map<string, string[]>();
  const allReactors = new Set<string>();
  for (const r of reactions) {
    countByEmoji.set(r.emoji, (countByEmoji.get(r.emoji) ?? 0) + 1);
    if (r.user_id === uid) mineByEmoji.add(r.emoji);
    if (!reactorsByEmoji.has(r.emoji)) reactorsByEmoji.set(r.emoji, []);
    reactorsByEmoji.get(r.emoji)!.push(r.user_id);
    allReactors.add(r.user_id);
  }

  const reactionList: BoardReaction[] = REACTION_EMOJIS.map((emoji) => ({
    emoji,
    count: countByEmoji.get(emoji) ?? 0,
    isMine: mineByEmoji.has(emoji),
  }));

  let topEmoji: string | null = null;
  let topCount = 0;
  for (const [emoji, count] of countByEmoji) {
    if (count > topCount) {
      topEmoji = emoji;
      topCount = count;
    }
  }
  const topReactorIds = topEmoji ? (reactorsByEmoji.get(topEmoji) ?? []).slice(0, 3) : [];
  const reactionFaces: BoardReactionFace[] = topReactorIds.map((rid) => ({
    initial: (authorInfo.get(rid)?.name ?? "·").slice(0, 1),
    color: avatarColorFor(rid),
  }));
  const firstReactorId = reactionFaces.length > 0 ? topReactorIds[0] : null;

  const commentDetails: BoardCommentDetail[] = commentRows.map((c) => ({
    id: c.id,
    authorId: c.created_by_user_id,
    authorName: authorInfo.get(c.created_by_user_id)?.name ?? "",
    authorRole: authorInfo.get(c.created_by_user_id)?.roleLabel ?? "",
    avatarColor: avatarColorFor(c.created_by_user_id),
    content: c.content,
    imageUrls: c.image_urls ?? [],
    createdAt: c.created_at,
    isOwn: c.created_by_user_id === uid,
  }));

  return {
    id: post.id,
    title: post.title,
    content: post.content,
    tags: post.tags ?? [],
    imageUrls: post.image_urls ?? [],
    fileAttachments: (post.file_attachments as unknown as FileAttachment[]) ?? [],
    isPinned: post.is_pinned,
    allowComments: post.allow_comments,
    createdAt: post.created_at,
    authorId: post.created_by_user_id,
    authorName: authorInfo.get(post.created_by_user_id)?.name ?? "",
    authorRole: authorInfo.get(post.created_by_user_id)?.roleLabel ?? "",
    avatarColor: avatarColorFor(post.created_by_user_id),
    reactions: reactionList,
    reactionFaces,
    reactionTotal: allReactors.size,
    firstReactorName: firstReactorId ? (authorInfo.get(firstReactorId)?.name ?? null) : null,
    comments: commentDetails,
  };
}

/**
 * Mention autocomplete: active same-org members whose display name starts with `query` (case-
 * insensitive, trimmed). Empty query returns the first N members alphabetically (still scoped to the
 * org, still excluding the caller). The caller is always excluded — self-mentions are pointless and
 * would self-notify. Used by the comment composer; capped at 20 to keep the dropdown bounded.
 */
export async function searchMentionableMembers(
  session: AppSession,
  query: string,
  limit = 20,
): Promise<MentionableMember[]> {
  const supabase = await getSupabaseServerClient();
  const trimmed = query.trim();
  const roles = getDictionary(session.user.preferredLanguage).roles as Record<string, string>;

  let q = supabase
    .from("memberships")
    .select("user_id, role, profiles(name)")
    .eq("organization_id", session.organization.id)
    .eq("status", "active");

  // ilike with an escaped prefix; the LIKE meta-chars in the user-supplied query are neutralized so
  // someone typing `%` or `_` cannot turn the search into a wildcard scan.
  if (trimmed) {
    const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`);
    // PostgREST embedded-resource filter: filter `memberships` rows whose joined profile name starts
    // with the query.
    q = q.ilike("profiles.name", `${escaped}%`);
  }

  const { data, error } = await q.limit(Math.max(1, Math.min(limit, 50)));
  if (error) return [];

  const rows = (data ?? []) as Array<{
    user_id: string;
    role: string;
    profiles: { name: string } | { name: string }[] | null;
  }>;
  const devIds = await fetchPlatformDeveloperIds(rows.map((r) => r.user_id));

  return rows
    .map((r) => {
      const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      const role = displayRoleKey(r.role, r.user_id, devIds);
      return {
        id: r.user_id,
        name: profile?.name ?? "",
        role: roles[role] ?? role,
        avatarColor: avatarColorFor(r.user_id),
      } satisfies MentionableMember;
    })
    // Embedded `profiles.name` filter doesn't drop the membership row when the join misses, and the
    // caller is always excluded; both filters happen here in JS.
    .filter((m) => m.id !== session.user.id && (!trimmed || m.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Validate a set of @mention target ids: each must be an active same-org member and must not be the
 * caller. Returns the subset that passed. Used by `addBoardComment` to keep an attacker from sneaking
 * a cross-org id into the mentioned_user_ids array and triggering a notification on someone they
 * shouldn't see.
 */
export async function validateMentionTargets(
  session: AppSession,
  userIds: string[],
): Promise<string[]> {
  const candidates = Array.from(new Set(userIds)).filter(
    (id) => typeof id === "string" && id && id !== session.user.id,
  );
  if (candidates.length === 0) return [];

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", session.organization.id)
    .eq("status", "active")
    .in("user_id", candidates);
  if (error) return [];

  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
}

/** All active same-org member ids (caller excluded). Used to fan out an @ALL mention. */
export async function getActiveOrgMemberIds(session: AppSession): Promise<string[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", session.organization.id)
    .eq("status", "active");
  if (error) return [];
  return ((data ?? []) as Array<{ user_id: string }>)
    .map((r) => r.user_id)
    .filter((id) => id && id !== session.user.id);
}

/**
 * Mark a post read for the current user (idempotent upsert). Service-role write; no revalidation
 * (called during the detail page render, mirroring ensureAnnouncementRead). The nav unread badge
 * recomputes on the next request.
 */
export async function ensureBoardPostRead(session: AppSession, postId: string): Promise<void> {
  try {
    const service = getSupabaseServiceClient();
    await bestEffortWrite(
      "board_post_reads: upsert",
      service.from("board_post_reads").upsert(
        { post_id: postId, user_id: session.user.id, read_at: new Date().toISOString() },
        { ignoreDuplicates: true, onConflict: "post_id,user_id" },
      )
    );
  } catch {
    // best-effort; a missing read row only means the badge stays one higher
  }
}
