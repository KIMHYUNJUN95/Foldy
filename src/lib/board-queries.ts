// 게시판 (자유 게시판) — 서버 전용 피드 + 상세 쿼리 (Pages 2–3).
//
// `src/lib/board.ts` 와 분리해 둔다. 그 모듈은 BROWSER Supabase 클라이언트를 쓰고
// 클라이언트 컴포넌트(작성기)가 가져오기 때문이다. 거기에 서버 클라이언트 / `next/headers` 를 끌어오면
// 서버 전용 코드가 클라이언트 번들로 딸려 들어간다. suggestions.ts ↔ suggestions-queries.ts 분리를 따른다.
// 가시성/조직 격리는 RLS 가 강제하고, 모든 쿼리는 session.organization.id 로도 범위를 건다.

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

// 사용자 id 에서 결정적으로 정한 아바타 색조 (겹쳐 쌓인 반응자/댓글 아바타에 변화를 준다).
const AVATAR_COLORS: AvatarColor[] = ["default", "green", "blue", "red"];
function avatarColorFor(userId: string): AvatarColor {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash + userId.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

const FEED_COLS =
  "id, title, content, tags, image_urls, file_attachments, is_pinned, pinned_at, allow_comments, created_at, created_by_user_id";

// 게시판 전반에서 쓰는 이모지 순서 (반응 바와 같다). 반응은 이 순서로 돌려준다.
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

/** 작성자 사용자 id 모음의 표시 이름 + 현지화된 역할 라벨을 해석한다. */
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

/** 원본 게시글 행을 BoardPost 객체(작성자, 댓글 수, 반응, 안 읽음)로 채운다. */
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
      // 본인 글은 읽은 것으로 보고, 아니면 읽음 행이 생길 때까지 안 읽음이다.
      isUnread: row.created_by_user_id !== uid && !readSet.has(row.id),
      // 목록 배지는 첫 번째 태그를 글의 "카테고리"로 쓴다.
      category: row.tags && row.tags.length > 0 ? row.tags[0] : null,
    } satisfies BoardPost;
  });
}

/**
 * 현재 조직의 게시판 피드. 고정 글이 먼저 (pinned_at DESC, 첫
 * 페이지에서만 전부 가져옴), 그다음 고정되지 않은 글 (created_at DESC)을 `before` (= 마지막 비고정
 * created_at)로 커서 페이지네이션한다. `category` 는 `tags` 배열에 그 값이 있는 글만 거른다. 소프트 삭제 제외.
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

  // 고정 글: 첫 페이지에서만 (중복을 피하려고 페이지네이션 때는 생략).
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

  // 고정되지 않은 글: (created_at, id) DESC 키셋 페이지네이션. `id` 동률 처리가 순서를
  // 안정적으로 만들고, 엄격한 `<` 커서가 페이지 경계에서 created_at 이 똑같은 글을
  // 조용히 빠뜨리는 일을 막는다. 커서는 두 필드를 `${created_at}|${id}` 로 인코딩한다.
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

/** 조직의 삭제되지 않은 글 전체에서 고유한 태그 값 (필터 칩용), 개수 제한 + 정렬. */
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
 * 현재 사용자의 안 읽은 게시글: 본인이 쓰지 않았고 읽음 행이 없는
 * 삭제되지 않은 조직 글. countUnreadAnnouncements 를 따르며, 스키마가 없으면 0 으로 닫힌다.
 */
export async function getBoardUnreadCount(session: AppSession): Promise<number> {
  try {
    const supabase = await getSupabaseServerClient();
    const orgId = session.organization.id;
    const uid = session.user.id;

    // 글 · 숨김 · 읽음 세 읽기를 한 번에 — 읽음은 글 id 목록을 기다리지 않고 「이 조직의 지워지지 않은 글」로
    // 조인해 거른다(결과는 예전 `.in(candidateIds)` 와 같다).
    const [postsRes, hidden, readsRes] = await Promise.all([
      supabase
        .from("board_posts")
        .select("id, created_by_user_id")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .returns<{ id: string; created_by_user_id: string }[]>(),
      getBoardHiddenFor(session),
      supabase
        .from("board_post_reads")
        .select("post_id, board_posts!inner(id)")
        .eq("user_id", uid)
        .eq("board_posts.organization_id", orgId)
        .is("board_posts.deleted_at", null)
        .returns<{ post_id: string }[]>(),
    ]);
    const { data: posts, error: postsError } = postsRes;
    if (postsError) return 0;

    const candidateIds = (posts ?? [])
      .filter(
        (p) =>
          p.created_by_user_id !== uid &&
          !hidden.hiddenPostIds.has(p.id) &&
          !hidden.blockedUserIds.has(p.created_by_user_id),
      )
      .map((p) => p.id);
    if (candidateIds.length === 0) return 0;

    const { data: reads, error: readsError } = readsRes;
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
 * 열람자용 게시글 상세: 글 필드 + 작성자 + 댓글(삭제되지 않은 것, 오래된 순) +
 * 이모지별 열람자 isMine 플래그와 함께 집계한 반응 + 가장 많이 쓴
 * 이모지의 반응자 얼굴 최대 3개. 글이 없거나, 소프트 삭제됐거나, 다른
 * 조직 것이면 null 을 돌려준다 (RLS 가 최후 방어선이며, 조직 일치도 명시적으로 확인한다).
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

  // 작성자와 댓글 작성자의 이름/역할을 멤버십 조회 한 번으로 해석한다.
  const personIds = [post.created_by_user_id, ...commentRows.map((c) => c.created_by_user_id)];
  const authorInfo = await fetchAuthorInfo(supabase, orgId, personIds, session.user.preferredLanguage);

  // 반응: 이모지별 개수 + isMine (고정 순서), 그리고 가장 많이 쓴 이모지의 반응자 얼굴.
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
 * 멘션 자동완성: 표시 이름이 `query` 로 시작하는 활성 같은 조직 멤버 (대소문자
 * 무시, 트림). 쿼리가 비면 가나다순 처음 N명을 돌려준다 (여전히 조직 범위이고
 * 호출자는 제외). 호출자는 항상 제외한다 — 자기 멘션은 의미가 없고
 * 스스로에게 알림이 간다. 댓글 작성기가 쓰며, 드롭다운이 무한정 커지지 않게 20개로 제한한다.
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

  // 이스케이프한 접두사로 ilike 한다. 사용자가 넣은 쿼리의 LIKE 메타 문자는 무력화해서
  // `%` 나 `_` 를 입력해도 검색이 와일드카드 스캔으로 바뀌지 않는다.
  if (trimmed) {
    const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`);
    // PostgREST 임베디드 리소스 필터: 조인된 프로필 이름이 쿼리로 시작하는
    // `memberships` 행을 거른다.
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
    // 임베디드 `profiles.name` 필터는 조인이 안 맞아도 멤버십 행을 버리지 않고,
    // 호출자는 항상 제외된다. 두 필터 모두 여기 JS 에서 일어난다.
    .filter((m) => m.id !== session.user.id && (!trimmed || m.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * @mention 대상 id 모음을 검증한다: 각각 활성 같은 조직 멤버여야 하고
 * 호출자가 아니어야 한다. 통과한 부분집합을 돌려준다. `addBoardComment` 가 공격자가
 * mentioned_user_ids 배열에 다른 조직 id 를 몰래 넣어, 볼 수 없어야 할 사람에게
 * 알림이 가게 하는 일을 막으려고 쓴다.
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

/** 활성 같은 조직 멤버 id 전체 (호출자 제외). @ALL 멘션을 퍼뜨릴 때 쓴다. */
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

/** 이 사람이 이 글을 이미 읽었는지 — 상세 화면이 메뉴 배지를 맞추는 데 쓴다. 읽지 못하면 `null`(모름). */
export async function hasReadBoardPost(session: AppSession, postId: string): Promise<boolean | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("board_post_reads")
      .select("post_id")
      .eq("post_id", postId)
      .eq("user_id", session.user.id)
      .maybeSingle();
    return error ? null : Boolean(data);
  } catch {
    return null;
  }
}

/**
 * 현재 사용자에 대해 게시글을 읽음으로 표시한다 (멱등 upsert). service-role 쓰기이며 revalidation 은 없다.
 * 상세 페이지는 이것을 `after()`(응답 후)에서 실행하고, 이미 계산한 배지에서
 * 그 글을 빼므로 열면 배지가 그대로 사라진다.
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
    // 최선 노력: 읽음 행이 없어도 배지가 하나 더 높게 남을 뿐이다
  }
}
