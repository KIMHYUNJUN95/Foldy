import { redirect } from "next/navigation";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getOnboardingState } from "@/lib/onboarding";
import { getBoardPost, getBoardTags } from "@/lib/board-queries";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { isOrgTopAdmin } from "@/config/roles";
import { BoardEditClient } from "./board-edit-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * 글 수정 (Page 4).
 *
 * 2026-08-07까지 이 라우트는 「곧 제공될 예정」 안내만 띄우는 자리표시였다. 액션 시트의 「글 수정」
 * 은 **작성자에게 평범한 메뉴로 보이는데** 눌러도 아무것도 못 고쳐서, 사용자 입장에서는 고장난
 * 버튼이었다. 서버 액션(`updateBoardPost`)은 그때도 있었고 없던 것은 폼뿐이었다.
 *
 * 권한은 여기서 한 번, 서버 액션에서 다시 검사한다. 여기 검사는 «남의 글 수정 화면이 열리지
 * 않게» 하는 UI 규칙이고, 진짜 방어는 액션에 있다.
 */
export default async function BoardEditPage({ params }: PageProps) {
  const { id } = await params;
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=/mobile/board/${id}/edit`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const post = await getBoardPost({ session, id });
  // 없는 글이든 남의 글이든 **상세로 돌려보낸다.** 「권한 없음」 화면을 따로 띄우면 남의 글이
  // 존재한다는 사실만 알려 주는 셈이고, 목록으로 보내면 보고 있던 맥락을 잃는다.
  if (!post) redirect("/mobile/board");
  if (post.authorId !== session.user.id) redirect(`/mobile/board/${id}`);

  const dictionary = getDictionary(session.user.preferredLanguage);
  // 작성 경로(`createBoardPost`)와 같은 고정 권한. 두 경로가 갈리면 수정으로 우회할 수 있다.
  const canPin =
    isOrgTopAdmin(session.user.role) || session.user.role === "office_admin";

  const [tags, navBadges] = await Promise.all([
    getBoardTags(session),
    getMobileNavBadges(),
  ]);

  // 화이트 리디자인(2026-10-15): 글쓰기와 같은 셸 안 한 장 폼. 아래 탭은 숨긴다.
  return (
    <MobileShell activeItem="board" badges={navBadges} hideBottomNav title="">
      <BoardEditClient
        canPin={canPin}
        tagSuggestions={tags}
        copy={dictionary.board}
        initial={{
          title: post.title,
          content: post.content,
          tags: post.tags,
          imageUrls: post.imageUrls,
          fileAttachments: post.fileAttachments,
          isPinned: post.isPinned,
        }}
        orgId={session.organization.id}
        postId={post.id}
      />
    </MobileShell>
  );
}
