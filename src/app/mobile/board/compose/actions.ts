"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { isOrgTopAdminOrPlatform } from "@/config/roles";
import type { FileAttachment } from "@/components/board/board-types";
import { areOwnBoardImageUrls, isBoardUuid, sanitizeBoardAttachments } from "@/app/mobile/board/board-storage-guard";
import type { Database, Json } from "@/types/database";

type BoardPostInsert = Database["public"]["Tables"]["board_posts"]["Insert"];

export type CreateBoardPostParams = {
  id: string;
  title: string | null;
  content: string;
  tags: string[];
  imageUrls: string[];
  fileAttachments: FileAttachment[];
  isPinned: boolean;
  allowComments: boolean;
};

export type CreateBoardPostResult =
  | { id: string }
  | { error: string };

export async function createBoardPost(
  params: CreateBoardPostParams,
): Promise<CreateBoardPostResult> {
  const { id, title, content, tags, imageUrls, fileAttachments, isPinned, allowComments } = params;

  if (!content.trim()) return { error: "content_required" };
  if (imageUrls.length > 5) return { error: "too_many_photos" };
  if (fileAttachments.length > 5) return { error: "too_many_files" };

  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const orgId = session.organization.id;

  // 사진 · 첨부는 업로드 함수가 만든 모양(이 조직 · 이 글 폴더)만 받는다(2026-10-26) — 남의 조직 파일 경로를 첨부로
  // 끼워 서명 URL 을 받아 가거나, 외부 URL 을 사진으로 넣지 못하게.
  if (!isBoardUuid(id)) return { error: "invalid_id" };
  if (!areOwnBoardImageUrls(imageUrls, orgId, id, "board-posts")) return { error: "invalid_image" };
  const safeAttachments = sanitizeBoardAttachments(fileAttachments, orgId, id);
  if (!safeAttachments) return { error: "invalid_attachment" };

  const canPin =
    isOrgTopAdminOrPlatform(session.user.role) ||
    session.user.role === "office_admin";

  const shouldPin = isPinned && canPin;
  const service = getSupabaseServiceClient();

  const insertData: BoardPostInsert = {
    id,
    organization_id: orgId,
    created_by_user_id: user.id,
    title: title?.trim() || null,
    content: content.trim(),
    tags,
    image_urls: imageUrls,
    file_attachments: safeAttachments as unknown as Json,
    is_pinned: shouldPin,
    pinned_at: shouldPin ? new Date().toISOString() : null,
    pinned_by_user_id: shouldPin ? user.id : null,
    allow_comments: allowComments,
  };

  const { error } = await service.from("board_posts").insert(insertData);
  if (error) return { error: "save_failed" };

  revalidatePath("/mobile/board");

  return { id };
}
