// 게시판 신고 · 차단 — server-only 조회 (2026-10-06, 앱 출시 준비 B4).
//
// 두 표(`board_reports` · `user_blocks`)는 service-role 전용이라 여기서만 읽는다. 게시판 피드 · 상세 쿼리는
// `getBoardHiddenFor()` 결과로 「내가 신고한 글 · 댓글」과 「내가 차단한 사람의 글 · 댓글」을 걸러 낸다.
// 문서: docs/product/23-board-workflow.md → 「신고 · 차단」.

import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const BOARD_REPORT_REASONS = ["spam", "harassment", "inappropriate", "privacy", "other"] as const;
export type BoardReportReason = (typeof BOARD_REPORT_REASONS)[number];

export function isBoardReportReason(value: unknown): value is BoardReportReason {
  return typeof value === "string" && (BOARD_REPORT_REASONS as readonly string[]).includes(value);
}

export type BoardHiddenSet = {
  blockedUserIds: Set<string>;
  hiddenPostIds: Set<string>;
  hiddenCommentIds: Set<string>;
};

const EMPTY_HIDDEN: BoardHiddenSet = {
  blockedUserIds: new Set(),
  hiddenPostIds: new Set(),
  hiddenCommentIds: new Set(),
};

/** 이 사용자에게 숨길 것: 내가 차단한 사람 · 내가 신고한 글 · 댓글. 실패하면 아무것도 숨기지 않는다(게시판이 비면 안 된다). */
export async function getBoardHiddenFor(session: AppSession): Promise<BoardHiddenSet> {
  try {
    const service = getSupabaseServiceClient();
    const orgId = session.organization.id;
    const uid = session.user.id;
    const [blocks, reports] = await Promise.all([
      service
        .from("user_blocks")
        .select("blocked_user_id")
        .eq("organization_id", orgId)
        .eq("blocker_user_id", uid),
      service
        .from("board_reports")
        .select("target_type, post_id, comment_id")
        .eq("organization_id", orgId)
        .eq("reporter_user_id", uid)
        // 스스로 거둔 신고(신고 취소)는 다시 보인다.
        .neq("status", "withdrawn"),
    ]);
    if (blocks.error || reports.error) return EMPTY_HIDDEN;

    const hidden: BoardHiddenSet = {
      blockedUserIds: new Set((blocks.data ?? []).map((b) => b.blocked_user_id)),
      hiddenPostIds: new Set(),
      hiddenCommentIds: new Set(),
    };
    for (const r of reports.data ?? []) {
      if (r.target_type === "post") hidden.hiddenPostIds.add(r.post_id);
      else if (r.comment_id) hidden.hiddenCommentIds.add(r.comment_id);
    }
    return hidden;
  } catch {
    return EMPTY_HIDDEN;
  }
}

/** 신고 처리 권한 — 권한 키 `board.moderate`(기본 owner · office_admin, 개인 부여 · 차단 가능). */
export function canModerateBoard(session: AppSession): boolean {
  return session.capabilities.includes("board.moderate");
}

/** 처리 대기 중인 신고 대상 수(같은 대상의 여러 신고는 1건). 처리 권한이 없으면 0. */
export async function countPendingBoardReports(session: AppSession): Promise<number> {
  if (!canModerateBoard(session)) return 0;
  try {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from("board_reports")
      .select("target_type, post_id, comment_id")
      .eq("organization_id", session.organization.id)
      .eq("status", "pending");
    if (error) return 0;
    return new Set((data ?? []).map((r) => `${r.target_type}:${r.comment_id ?? r.post_id}`)).size;
  } catch {
    return 0;
  }
}

export type PendingBoardReport = {
  key: string;
  targetType: "post" | "comment";
  postId: string;
  commentId: string | null;
  authorName: string;
  preview: string;
  reasons: BoardReportReason[];
  notes: string[];
  count: number;
  latestAt: string;
  // ↓ PC 신고 콘솔 상세 패널용(2026-10-15, 화이트 리디자인). 모바일은 위 필드만 쓴다.
  /** 글 제목(댓글이면 그 댓글이 달린 글의 제목). */
  postTitle: string | null;
  /** 원문 전체(글 본문 · 댓글 내용), 4,000자까지. */
  body: string;
  imageUrls: string[];
  /** 글의 태그. 댓글이면 빈 배열. */
  tags: string[];
  /** 대상(글 · 댓글)이 쓰인 시각. */
  targetCreatedAt: string;
  /** 사유별 신고 수(많은 순). */
  reasonCounts: { reason: BoardReportReason; count: number }[];
  /** 메모와 그 신고 시각(최신순). */
  noteItems: { note: string; at: string }[];
  /** 글에 반응한 사람 수 · 남아 있는 댓글 수. 댓글이 대상이면 null. */
  reactionCount: number | null;
  commentCount: number | null;
};

/**
 * 처리 대기 신고를 대상별로 묶어 최신순으로. 대상이 이미 지워졌으면(작성자 · 관리자 삭제) 그 신고는 「삭제됨」으로
 * 정리하고 목록에서 뺀다.
 */
export async function listPendingBoardReports(session: AppSession): Promise<PendingBoardReport[]> {
  if (!canModerateBoard(session)) return [];
  const service = getSupabaseServiceClient();
  const orgId = session.organization.id;

  const { data, error } = await service
    .from("board_reports")
    .select("id, target_type, post_id, comment_id, reason, note, created_at, target_author_user_id")
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error || !data || data.length === 0) return [];

  const postIds = Array.from(new Set(data.map((r) => r.post_id)));
  const commentIds = Array.from(
    new Set(data.map((r) => r.comment_id).filter((id): id is string => Boolean(id))),
  );
  const authorIds = Array.from(
    new Set(data.map((r) => r.target_author_user_id).filter((id): id is string => Boolean(id))),
  );

  const [posts, comments, profiles] = await Promise.all([
    service
      .from("board_posts")
      .select("id, title, content, deleted_at, image_urls, tags, created_at")
      .in("id", postIds),
    commentIds.length
      ? service.from("board_comments").select("id, content, deleted_at, image_urls, created_at").in("id", commentIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            content: string;
            deleted_at: string | null;
            image_urls: string[];
            created_at: string;
          }[],
          error: null,
        }),
    authorIds.length
      ? service.from("profiles").select("id, name").in("id", authorIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);

  // 글이 대상인 신고만 — 반응한 사람 수 · 남아 있는 댓글 수(상세 패널 메타 줄). 실패하면 null 로 둔다.
  const postTargetIds = Array.from(new Set(data.filter((r) => r.target_type !== "comment").map((r) => r.post_id)));
  const [reactionRows, commentRows] = postTargetIds.length
    ? await Promise.all([
        service.from("board_reactions").select("post_id, user_id").in("post_id", postTargetIds),
        service.from("board_comments").select("post_id").in("post_id", postTargetIds).is("deleted_at", null),
      ])
    : [null, null];
  const reactorsByPost = new Map<string, Set<string>>();
  for (const row of reactionRows?.error ? [] : (reactionRows?.data ?? [])) {
    let set = reactorsByPost.get(row.post_id);
    if (!set) reactorsByPost.set(row.post_id, (set = new Set()));
    set.add(row.user_id);
  }
  const commentsByPost = new Map<string, number>();
  for (const row of commentRows?.error ? [] : (commentRows?.data ?? [])) {
    commentsByPost.set(row.post_id, (commentsByPost.get(row.post_id) ?? 0) + 1);
  }

  const postMap = new Map((posts.data ?? []).map((p) => [p.id, p]));
  const commentMap = new Map((comments.data ?? []).map((c) => [c.id, c]));
  const nameMap = new Map((profiles.data ?? []).map((p) => [p.id, p.name]));

  const groups = new Map<string, PendingBoardReport>();
  const goneReportIds: string[] = [];

  for (const r of data) {
    const targetType = r.target_type === "comment" ? "comment" : "post";
    const post = postMap.get(r.post_id);
    const comment = r.comment_id ? commentMap.get(r.comment_id) : undefined;
    const gone =
      !post || post.deleted_at || (targetType === "comment" && (!comment || comment.deleted_at));
    if (gone) {
      goneReportIds.push(r.id);
      continue;
    }

    const key = `${targetType}:${r.comment_id ?? r.post_id}`;
    let group = groups.get(key);
    if (!group) {
      const preview =
        targetType === "comment" ? (comment?.content ?? "") : (post?.title || post?.content || "");
      group = {
        key,
        targetType,
        postId: r.post_id,
        commentId: r.comment_id,
        authorName: (r.target_author_user_id && nameMap.get(r.target_author_user_id)) || "",
        preview: preview.slice(0, 600),
        reasons: [],
        notes: [],
        count: 0,
        latestAt: r.created_at,
        postTitle: post?.title || null,
        body: ((targetType === "comment" ? comment?.content : post?.content) ?? "").slice(0, 4000),
        imageUrls: (targetType === "comment" ? comment?.image_urls : post?.image_urls) ?? [],
        tags: targetType === "post" ? (post?.tags ?? []) : [],
        targetCreatedAt: (targetType === "comment" ? comment?.created_at : post?.created_at) ?? r.created_at,
        reasonCounts: [],
        noteItems: [],
        reactionCount:
          targetType === "post" && reactionRows && !reactionRows.error
            ? (reactorsByPost.get(r.post_id)?.size ?? 0)
            : null,
        commentCount:
          targetType === "post" && commentRows && !commentRows.error ? (commentsByPost.get(r.post_id) ?? 0) : null,
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (isBoardReportReason(r.reason)) {
      if (!group.reasons.includes(r.reason)) group.reasons.push(r.reason);
      const hit = group.reasonCounts.find((x) => x.reason === r.reason);
      if (hit) hit.count += 1;
      else group.reasonCounts.push({ reason: r.reason, count: 1 });
    }
    if (r.note) {
      group.notes.push(r.note);
      group.noteItems.push({ note: r.note, at: r.created_at });
    }
  }
  for (const group of groups.values()) group.reasonCounts.sort((a, b) => b.count - a.count);

  if (goneReportIds.length > 0) {
    // best-effort 정리 — 실패해도 다음 조회에서 다시 걸러진다.
    await service
      .from("board_reports")
      .update({ status: "removed", resolved_at: new Date().toISOString() })
      .in("id", goneReportIds);
  }

  return Array.from(groups.values());
}

export type BlockedUser = { id: string; name: string };

/** 내가 차단한 사용자 목록(계정 → 보안). */
export async function listMyBlockedUsers(session: AppSession): Promise<BlockedUser[]> {
  try {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from("user_blocks")
      .select("blocked_user_id, created_at")
      .eq("organization_id", session.organization.id)
      .eq("blocker_user_id", session.user.id)
      .order("created_at", { ascending: false });
    if (error || !data || data.length === 0) return [];
    const ids = data.map((b) => b.blocked_user_id);
    const { data: profiles } = await service.from("profiles").select("id, name").in("id", ids);
    const names = new Map((profiles ?? []).map((p) => [p.id, p.name]));
    return ids.map((id) => ({ id, name: names.get(id) ?? "" }));
  } catch {
    return [];
  }
}

export type MyBoardReport = {
  id: string;
  targetType: "post" | "comment";
  postId: string;
  authorName: string;
  preview: string;
  reason: BoardReportReason;
  status: "pending" | "dismissed";
  createdAt: string;
};

/**
 * 내가 신고한 글 · 댓글 중 아직 남아 있는 것(계정 → 보안 「신고한 글 · 댓글」). 신고 취소로 다시 볼 수 있다.
 * 관리자가 삭제한 것(`removed`) · 이미 취소한 것(`withdrawn`) · 작성자가 지운 것은 보여 줄 대상이 없어 뺀다.
 */
export async function listMyBoardReports(session: AppSession): Promise<MyBoardReport[]> {
  try {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from("board_reports")
      .select("id, target_type, post_id, comment_id, reason, status, created_at, target_author_user_id")
      .eq("organization_id", session.organization.id)
      .eq("reporter_user_id", session.user.id)
      .in("status", ["pending", "dismissed"])
      .order("created_at", { ascending: false });
    if (error || !data || data.length === 0) return [];

    const postIds = Array.from(new Set(data.map((r) => r.post_id)));
    const commentIds = data.map((r) => r.comment_id).filter((id): id is string => Boolean(id));
    const authorIds = Array.from(
      new Set(data.map((r) => r.target_author_user_id).filter((id): id is string => Boolean(id))),
    );
    const [posts, comments, profiles] = await Promise.all([
      service.from("board_posts").select("id, title, content, deleted_at").in("id", postIds),
      commentIds.length
        ? service.from("board_comments").select("id, content, deleted_at").in("id", commentIds)
        : Promise.resolve({ data: [] as { id: string; content: string; deleted_at: string | null }[] }),
      authorIds.length
        ? service.from("profiles").select("id, name").in("id", authorIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const postMap = new Map((posts.data ?? []).map((p) => [p.id, p]));
    const commentMap = new Map((comments.data ?? []).map((c) => [c.id, c]));
    const nameMap = new Map((profiles.data ?? []).map((p) => [p.id, p.name]));

    const out: MyBoardReport[] = [];
    for (const r of data) {
      const post = postMap.get(r.post_id);
      if (!post || post.deleted_at) continue;
      const comment = r.comment_id ? commentMap.get(r.comment_id) : undefined;
      if (r.target_type === "comment" && (!comment || comment.deleted_at)) continue;
      if (!isBoardReportReason(r.reason)) continue;
      out.push({
        id: r.id,
        targetType: r.target_type === "comment" ? "comment" : "post",
        postId: r.post_id,
        authorName: (r.target_author_user_id && nameMap.get(r.target_author_user_id)) || "",
        preview: (r.target_type === "comment" ? comment?.content : post.title || post.content)?.slice(0, 80) ?? "",
        reason: r.reason,
        status: r.status === "dismissed" ? "dismissed" : "pending",
        createdAt: r.created_at,
      });
    }
    return out;
  } catch {
    return [];
  }
}
