"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  notifyBoardCommentMentions,
  notifyBoardPostAuthor,
} from "@/lib/notifications/create";
import {
  getActiveOrgMemberIds,
  searchMentionableMembers,
  validateMentionTargets,
} from "@/lib/board-queries";
import { isOrgTopAdminOrPlatform, isPlatformDeveloper } from "@/config/roles";
import { BOARD_MAX_FILES, BOARD_MAX_IMAGES } from "@/lib/board";
import type { AvatarColor, FileAttachment } from "@/components/board/board-types";
import type { Database, Json } from "@/types/database";
import { bestEffortWrite } from "@/lib/db-write-guard";
import {
  areOwnBoardImageUrls,
  isOwnBoardAttachmentPath,
  sanitizeBoardAttachments,
} from "@/app/mobile/board/board-storage-guard";

// The mention-sheet client component imports this type from the same module it calls
// (`searchMentions`). A `export type { ... }` re-export is stripped by Turbopack's "use server"
// bundler (treated as a runtime export and pruned), so the type is declared locally and kept in
// shape with `MentionableMember` in src/lib/board-queries.ts.
export type MentionableMember = {
  id: string;
  name: string;
  role: string | null;
  avatarColor: AvatarColor;
};

const ALLOWED_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "😢"]);

type ActionResult = { ok: true } | { error: string };

type PostMeta = {
  organization_id: string;
  created_by_user_id: string;
  title: string | null;
  is_pinned: boolean;
  allow_comments: boolean;
};

/** Resolve the post row (service-role) and verify it belongs to the viewer's org. Null on mismatch. */
async function loadPostMeta(postId: string, orgId: string): Promise<PostMeta | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("board_posts")
    .select("organization_id, created_by_user_id, title, is_pinned, allow_comments")
    .eq("id", postId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const post = data as unknown as PostMeta;
  if (post.organization_id !== orgId) return null;
  return post;
}

function revalidateBoard(postId: string) {
  revalidatePath(`/mobile/board/${postId}`);
  revalidatePath("/mobile/board");
}

/** Idempotent read receipt. Safe to call repeatedly. */
export async function markBoardPostRead(postId: string): Promise<ActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const post = await loadPostMeta(postId, session.organization.id);
  if (!post) return { error: "not_found" };

  const service = getSupabaseServiceClient();
  await bestEffortWrite(
    "board_post_reads: upsert",
    service.from("board_post_reads").upsert(
      { post_id: postId, user_id: session.user.id, read_at: new Date().toISOString() },
      { ignoreDuplicates: true, onConflict: "post_id,user_id" },
    )
  );
  revalidatePath("/mobile/board");
  return { ok: true };
}

export type AddBoardCommentOptions = {
  /** Validated server-side: each id must be an active same-org member, caller excluded. */
  mentionedUserIds?: string[];
  /** @ALL mention — fans out to every active org member instead of individuals. */
  mentionAll?: boolean;
};

/**
 * Add a comment (≤3 images, pre-uploaded by the client). Notifies the post author, and any
 * @mentioned users / @ALL fan-out. The mention author is always excluded from notifications.
 * When `mentionAll` is true, individual `mentioned` notifications are suppressed for the same
 * comment to avoid double-notifying recipients (single `mention_all` per user instead).
 */
export async function addBoardComment(
  postId: string,
  content: string,
  imageUrls: string[] = [],
  options: AddBoardCommentOptions = {},
): Promise<ActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  // The board_comments.content CHECK requires non-empty text, so a comment must carry text (photos
  // are an optional supplement). Image-only comments would violate the DB constraint.
  const trimmed = content.trim();
  if (!trimmed) return { error: "empty_comment" };
  if (imageUrls.length > 3) return { error: "too_many_photos" };

  const post = await loadPostMeta(postId, session.organization.id);
  if (!post) return { error: "not_found" };
  if (!post.allow_comments) return { error: "comments_disabled" };
  // 댓글 사진도 이 조직 · 이 글의 `board-comments` 폴더에 올린 우리 공개 URL 만(2026-10-26).
  if (!areOwnBoardImageUrls(imageUrls, session.organization.id, postId, "board-comments")) {
    return { error: "invalid_image" };
  }

  // Server-side mention validation: drop any id that is not an active same-org member or that is
  // the author themselves. We do NOT reject the comment when an id is bogus — we just don't persist
  // or notify it. This keeps a stale client (e.g. a member who was deactivated after the autocomplete
  // returned them) from blocking a legitimate comment.
  const mentionAll = Boolean(options.mentionAll);
  const requestedMentions = Array.isArray(options.mentionedUserIds) ? options.mentionedUserIds : [];
  const validatedMentions = mentionAll
    ? []
    : await validateMentionTargets(session, requestedMentions);

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("board_comments")
    .insert({
      post_id: postId,
      organization_id: session.organization.id,
      created_by_user_id: session.user.id,
      content: trimmed,
      image_urls: imageUrls,
      mentioned_user_ids: validatedMentions,
      mention_all: mentionAll,
    })
    .select("id")
    .single();
  if (error) return { error: "save_failed" };

  const commentId = (data as { id: string } | null)?.id ?? crypto.randomUUID();

  // Resolve commenter display name once for mention notification payloads ({actor} body slot).
  let actorName: string | null = null;
  if (mentionAll || validatedMentions.length > 0) {
    // profiles is keyed by `id` (= auth user id); there is no `user_id` column.
    const { data: profile } = await service
      .from("profiles")
      .select("name")
      .eq("id", session.user.id)
      .maybeSingle();
    actorName = (profile as { name: string | null } | null)?.name ?? null;
  }

  // Resolve mention recipients first so we can skip the post-author notification when the author is
  // already covered by a mention (avoids two notifications for the same comment on one user).
  let mentionRecipients: string[] = [];
  if (mentionAll) {
    mentionRecipients = await getActiveOrgMemberIds(session);
  } else if (validatedMentions.length > 0) {
    mentionRecipients = validatedMentions;
  }
  const mentionRecipientSet = new Set(mentionRecipients);

  if (mentionRecipients.length > 0) {
    await notifyBoardCommentMentions(service, {
      organizationId: session.organization.id,
      postId,
      commentId,
      recipientUserIds: mentionRecipients,
      actorUserId: session.user.id,
      mentionAll,
      postTitle: post.title ?? "",
      actorName,
    });
  }

  // Author notification: skip when the author was already notified via @mention/@ALL above.
  const authorAlreadyMentioned =
    post.created_by_user_id === session.user.id || mentionRecipientSet.has(post.created_by_user_id);
  if (!authorAlreadyMentioned) {
    await notifyBoardPostAuthor(service, {
      organizationId: session.organization.id,
      postId,
      authorUserId: post.created_by_user_id,
      actorUserId: session.user.id,
      dedupeBase: `board_comment:${commentId}`,
      payload: {
        postId,
        postTitle: post.title ?? "",
        actorUserId: session.user.id,
        event: "commented",
      },
    });
  }

  revalidateBoard(postId);
  return { ok: true };
}

/**
 * Mention autocomplete for the comment composer. Returns up to 20 active same-org members whose
 * name starts with `query` (caller excluded). Returns [] when there is no org context — client
 * treats it as "no matches".
 */
export async function searchMentions(query: string): Promise<MentionableMember[]> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return [];
  return searchMentionableMembers(session, query, 20);
}

/**
 * Issue a short-lived signed download URL for a board post file attachment. The `board-attachments`
 * bucket is private, so a signed URL is required. We verify the requested storage `path` is actually
 * one of the (same-org, non-deleted) post's attachments before signing — a viewer can never sign an
 * arbitrary path. The `download` option sets Content-Disposition: attachment with the original
 * filename, so it downloads (not previews) on both mobile and desktop browsers.
 */
export async function getBoardAttachmentDownloadUrl(
  postId: string,
  path: string,
): Promise<{ url: string } | { error: string }> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("board_posts")
    .select("organization_id, file_attachments, deleted_at")
    .eq("id", postId)
    .maybeSingle();
  if (error || !data) return { error: "not_found" };

  const post = data as unknown as {
    organization_id: string;
    file_attachments: unknown;
    deleted_at: string | null;
  };
  if (post.deleted_at || post.organization_id !== session.organization.id) {
    return { error: "not_found" };
  }

  const attachments = Array.isArray(post.file_attachments)
    ? (post.file_attachments as Array<{ name: string; url: string }>)
    : [];
  const match = attachments.find((a) => a.url === path);
  if (!match) return { error: "not_found" };
  // 서명 직전에 경로를 한 번 더 본다(2026-10-26) — 저장 검사가 생기기 전에 들어간 행이 남아 있어도 이 조직 · 이 글
  // 폴더 밖의 파일에는 서비스 키로 서명하지 않는다.
  if (!isOwnBoardAttachmentPath(path, session.organization.id, postId)) return { error: "not_found" };

  const { data: signed, error: signErr } = await service.storage
    .from("board-attachments")
    .createSignedUrl(path, 120, { download: match.name });
  if (signErr || !signed?.signedUrl) return { error: "sign_failed" };

  return { url: signed.signedUrl };
}

/** Soft-delete a comment. Comment author OR owner/office_admin. */
export async function deleteBoardComment(commentId: string): Promise<ActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("board_comments")
    .select("post_id, organization_id, created_by_user_id")
    .eq("id", commentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return { error: "not_found" };
  const comment = data as unknown as {
    post_id: string;
    organization_id: string;
    created_by_user_id: string;
  };
  if (comment.organization_id !== session.organization.id) return { error: "forbidden" };

  const isAuthor = comment.created_by_user_id === session.user.id;
  const canManage = session.capabilities.includes("board.manage");
  if (!isAuthor && !canManage) return { error: "forbidden" };

  const { error: delError } = await service
    .from("board_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId);
  if (delError) return { error: "save_failed" };

  revalidateBoard(comment.post_id);
  return { ok: true };
}

/** Toggle a reaction: insert if absent, delete if present. Rejects emojis outside the allowed set. */
export async function toggleBoardReaction(postId: string, emoji: string): Promise<ActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };
  if (!ALLOWED_EMOJIS.has(emoji)) return { error: "invalid_emoji" };

  const post = await loadPostMeta(postId, session.organization.id);
  if (!post) return { error: "not_found" };

  const service = getSupabaseServiceClient();
  const { data: existing } = await service
    .from("board_reactions")
    .select("emoji")
    .eq("post_id", postId)
    .eq("user_id", session.user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await service
      .from("board_reactions")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", session.user.id)
      .eq("emoji", emoji);
    if (error) return { error: "save_failed" };
  } else {
    // upsert + ignoreDuplicates makes a concurrent double-tap idempotent instead of a PK violation.
    const { error } = await service
      .from("board_reactions")
      .upsert({ post_id: postId, user_id: session.user.id, emoji }, {
        ignoreDuplicates: true,
        onConflict: "post_id,user_id,emoji",
      });
    if (error) return { error: "save_failed" };
  }

  // Reaction counts are shown on feed rows too, so revalidate both surfaces.
  revalidateBoard(postId);
  return { ok: true };
}

async function setPinned(postId: string, pinned: boolean): Promise<ActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const post = await loadPostMeta(postId, session.organization.id);
  if (!post) return { error: "not_found" };

  const isAuthor = post.created_by_user_id === session.user.id;
  const canManage = session.capabilities.includes("board.manage");
  if (!isAuthor && !canManage) return { error: "forbidden" };

  const service = getSupabaseServiceClient();
  const patch = pinned
    ? {
        is_pinned: true,
        pinned_at: new Date().toISOString(),
        pinned_by_user_id: session.user.id,
      }
    : { is_pinned: false, pinned_at: null, pinned_by_user_id: null };
  const { error } = await service
    .from("board_posts")
    .update(patch)
    .eq("id", postId);
  if (error) return { error: "save_failed" };

  revalidateBoard(postId);
  return { ok: true };
}

export async function pinBoardPost(postId: string): Promise<ActionResult> {
  return setPinned(postId, true);
}

export async function unpinBoardPost(postId: string): Promise<ActionResult> {
  return setPinned(postId, false);
}

type UpdateBoardPostInput = {
  title?: string | null;
  content?: string;
  tags?: string[];
  /** 최종 사진 목록(남길 기존 URL + 새로 업로드한 URL). 생략하면 손대지 않는다. */
  imageUrls?: string[];
  /** 최종 첨부 목록. 생략하면 손대지 않는다. */
  fileAttachments?: FileAttachment[];
  isPinned?: boolean;
};

/** Edit a post. Author only (platform developer may edit any post, 2026-10-23). Pin flag updatable (kept consistent with pinned_at/by). */
export async function updateBoardPost(
  postId: string,
  input: UpdateBoardPostInput,
): Promise<ActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const post = await loadPostMeta(postId, session.organization.id);
  if (!post) return { error: "not_found" };
  if (post.created_by_user_id !== session.user.id && !isPlatformDeveloper(session.user.role)) {
    return { error: "forbidden" };
  }

  const patch: Database["public"]["Tables"]["board_posts"]["Update"] = {};
  if (input.title !== undefined) patch.title = input.title?.trim() || null;
  if (input.content !== undefined) {
    const c = input.content.trim();
    if (!c) return { error: "content_required" };
    patch.content = c;
  }
  if (input.tags !== undefined) patch.tags = input.tags;
  // 작성과 같은 상한을 **서버에서 다시** 건다. 폼이 막고 있더라도 액션은 폼을 신뢰하지 않는다.
  // 경로도 다시 본다(2026-10-26): 이미 이 글에 있던 것은 그대로 두고, 새로 넣는 것은 이 조직 · 이 글 폴더의 업로드 모양만.
  if (input.imageUrls !== undefined || input.fileAttachments !== undefined) {
    const { data: currentRow, error: currentError } = await getSupabaseServiceClient()
      .from("board_posts")
      .select("image_urls, file_attachments")
      .eq("id", postId)
      .maybeSingle();
    if (currentError || !currentRow) return { error: "not_found" };
    const current = currentRow as unknown as { image_urls: string[] | null; file_attachments: unknown };
    if (input.imageUrls !== undefined) {
      if (input.imageUrls.length > BOARD_MAX_IMAGES) return { error: "too_many_photos" };
      const existingImages = new Set(current.image_urls ?? []);
      if (!areOwnBoardImageUrls(input.imageUrls, session.organization.id, postId, "board-posts", existingImages)) {
        return { error: "invalid_image" };
      }
      patch.image_urls = input.imageUrls;
    }
    if (input.fileAttachments !== undefined) {
      if (input.fileAttachments.length > BOARD_MAX_FILES) return { error: "too_many_files" };
      const existingPaths = new Set(
        (Array.isArray(current.file_attachments) ? (current.file_attachments as Array<{ url?: unknown }>) : [])
          .map((item) => item?.url)
          .filter((url): url is string => typeof url === "string"),
      );
      const safeAttachments = sanitizeBoardAttachments(
        input.fileAttachments,
        session.organization.id,
        postId,
        existingPaths,
      );
      if (!safeAttachments) return { error: "invalid_attachment" };
      patch.file_attachments = safeAttachments as unknown as Json;
    }
  }
  if (input.isPinned !== undefined) {
    // **고정 권한은 작성 경로와 같아야 한다.** `createBoardPost` 는 owner/전무/office_admin 에게만
    // 고정을 허용하는데 여기엔 그 검사가 없어서, 일반 직원이 자기 글을 수정하며 상단 고정을 할 수
    // 있었다(2026-08-07 발견). 같은 상태를 바꾸는 두 경로가 다른 권한을 갖고 있으면 안 된다.
    const canPin = isOrgTopAdminOrPlatform(session.user.role) || session.user.role === "office_admin";
    if (!canPin && input.isPinned !== post.is_pinned) return { error: "forbidden" };
  }
  if (input.isPinned !== undefined) {
    if (input.isPinned) {
      patch.is_pinned = true;
      patch.pinned_at = new Date().toISOString();
      patch.pinned_by_user_id = session.user.id;
    } else {
      patch.is_pinned = false;
      patch.pinned_at = null;
      patch.pinned_by_user_id = null;
    }
  }

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("board_posts")
    .update(patch)
    .eq("id", postId);
  if (error) return { error: "save_failed" };

  revalidateBoard(postId);
  return { ok: true };
}

/** Soft-delete a post. Author OR owner/office_admin. */
export async function deleteBoardPost(postId: string): Promise<ActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const post = await loadPostMeta(postId, session.organization.id);
  if (!post) return { error: "not_found" };

  const isAuthor = post.created_by_user_id === session.user.id;
  const canManage = session.capabilities.includes("board.manage");
  if (!isAuthor && !canManage) return { error: "forbidden" };

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("board_posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", postId);
  if (error) return { error: "save_failed" };

  revalidateBoard(postId);
  return { ok: true };
}
