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

// 멘션 시트 클라이언트 컴포넌트는 이 타입을 자신이 호출하는 같은 모듈
// (`searchMentions`)에서 가져온다. `export type { ... }` 재export 는 Turbopack 의 "use server"
// 번들러가 런타임 export 로 보고 제거해 버리므로, 타입은 여기서 로컬로 선언하고
// src/lib/board-queries.ts 의 `MentionableMember` 와 모양을 맞춰 둔다.
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

/** 게시글 행을 조회(service-role)하고 보는 사람의 조직 소속인지 확인한다. 불일치면 null. */
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

/** 멱등한 읽음 처리. 반복 호출해도 안전하다. */
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
  /** 서버에서 검증: 각 id 는 같은 조직의 활성 멤버여야 하며 작성자는 제외. */
  mentionedUserIds?: string[];
  /** @ALL 멘션 — 개인이 아니라 조직의 모든 활성 멤버에게 알림이 퍼진다. */
  mentionAll?: boolean;
};

/**
 * 댓글 추가(이미지 3장 이하, 클라이언트가 미리 업로드). 게시글 작성자와 @멘션된
 * 사용자 / @ALL 대상에게 알린다. 멘션 작성자는 항상 알림에서 제외된다.
 * `mentionAll` 이 true 면 같은 댓글에 대한 개별 `mentioned` 알림은 억제해
 * 수신자에게 이중 알림이 가지 않게 한다(사용자당 `mention_all` 한 건만).
 */
export async function addBoardComment(
  postId: string,
  content: string,
  imageUrls: string[] = [],
  options: AddBoardCommentOptions = {},
): Promise<ActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  // board_comments.content CHECK 가 빈 텍스트를 허용하지 않으므로 댓글에는 텍스트가 있어야 한다(사진은
  // 선택 보충). 이미지만 있는 댓글은 DB 제약을 위반한다.
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

  // 서버 측 멘션 검증: 같은 조직의 활성 멤버가 아니거나 작성자 본인인
  // id 는 버린다. id 가 잘못돼도 댓글을 거부하지는 않고, 저장도 알림도 하지
  // 않을 뿐이다. 이렇게 하면 오래된 클라이언트(예: 자동완성이 반환한 뒤 비활성화된 멤버)가
  // 정상 댓글을 막지 못한다.
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

  // 멘션 알림 페이로드({actor} 본문 자리)용으로 댓글 작성자 표시 이름을 한 번만 조회한다.
  let actorName: string | null = null;
  if (mentionAll || validatedMentions.length > 0) {
    // profiles 는 `id`(= auth 사용자 id)가 키이며 `user_id` 컬럼은 없다.
    const { data: profile } = await service
      .from("profiles")
      .select("name")
      .eq("id", session.user.id)
      .maybeSingle();
    actorName = (profile as { name: string | null } | null)?.name ?? null;
  }

  // 멘션 수신자를 먼저 구해 두면, 작성자가 이미 멘션으로 포함된 경우
  // 게시글 작성자 알림을 건너뛸 수 있다(한 댓글에 한 사용자에게 알림 두 개가 가는 것을 방지).
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

  // 작성자 알림: 위에서 @멘션/@ALL 로 이미 알린 경우에는 건너뛴다.
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
 * 댓글 입력창의 멘션 자동완성. 이름이 `query` 로 시작하는 같은 조직의 활성 멤버를
 * 최대 20명 반환한다(호출자 제외). 조직 컨텍스트가 없으면 []을 반환하고, 클라이언트는
 * 이를 "일치 없음"으로 취급한다.
 */
export async function searchMentions(query: string): Promise<MentionableMember[]> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return [];
  return searchMentionableMembers(session, query, 20);
}

/**
 * 게시글 파일 첨부용 단기 서명 다운로드 URL 발급. `board-attachments`
 * 버킷은 비공개라 서명 URL 이 필요하다. 요청한 storage `path` 가 실제로 해당 게시글(같은 조직,
 * 삭제되지 않은)의 첨부 중 하나인지 서명 전에 확인한다 — 보는 사람이 임의 경로에
 * 서명을 받을 수 없다. `download` 옵션은 원래 파일명으로 Content-Disposition: attachment 를
 * 설정해, 모바일과 데스크톱 브라우저 모두에서 미리보기가 아니라 다운로드가 되게 한다.
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

/** 댓글 소프트 삭제. 댓글 작성자 또는 owner/office_admin. */
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

/** 반응 토글: 없으면 추가, 있으면 삭제. 허용된 목록 밖의 이모지는 거부한다. */
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
    // upsert + ignoreDuplicates 로 동시에 두 번 탭해도 PK 위반 없이 멱등하게 처리된다.
    const { error } = await service
      .from("board_reactions")
      .upsert({ post_id: postId, user_id: session.user.id, emoji }, {
        ignoreDuplicates: true,
        onConflict: "post_id,user_id,emoji",
      });
    if (error) return { error: "save_failed" };
  }

  // 반응 수는 피드 행에도 표시되므로 두 화면 모두 revalidate 한다.
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

/** 게시글 수정. 작성자만 가능(플랫폼 개발자는 모든 게시글 수정 가능, 2026-10-23). 고정 플래그 수정 가능(pinned_at/by 와 일관되게 유지). */
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

/** 게시글 소프트 삭제. 작성자 또는 owner/office_admin. */
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
