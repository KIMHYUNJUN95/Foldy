"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { isOrgTopAdminOrPlatform } from "@/config/roles";
import type { FileAttachment } from "@/components/board/board-types";
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
    file_attachments: fileAttachments as unknown as Json,
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
