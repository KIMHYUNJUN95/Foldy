"use server";

import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getBoardFeed } from "@/lib/board-queries";
import type { BoardPost } from "@/components/board/board-types";

const PAGE_SIZE = 15;

export type LoadMoreBoardResult =
  | { posts: BoardPost[]; nextCursor: string | null }
  | { error: string };

/** 고정되지 않은 게시글의 다음 페이지를 불러온다(커서 = 마지막으로 불러온 created_at). */
export async function loadMoreBoardPosts(params: {
  category: string | null;
  before: string;
}): Promise<LoadMoreBoardResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const { posts, nextCursor } = await getBoardFeed({
    session,
    category: params.category,
    limit: PAGE_SIZE,
    before: params.before,
  });
  return { posts, nextCursor };
}
