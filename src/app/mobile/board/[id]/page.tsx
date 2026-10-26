import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getOnboardingState } from "@/lib/onboarding";
import { getBoardPost, ensureBoardPostRead, hasReadBoardPost } from "@/lib/board-queries";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { MobileShell } from "@/components/shell/mobile-shell";
import { isPlatformDeveloper } from "@/config/roles";
import { BoardDetailClient } from "./board-detail-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function BoardPostPage({ params }: PageProps) {
  const { id } = await params;

  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=/mobile/board/${id}`);
  }

  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const [post, alreadyRead] = await Promise.all([getBoardPost({ session, id }), hasReadBoardPost(session, id)]);
  if (!post) {
    notFound();
  }

  // 읽음 기록은 응답을 보낸 뒤에 쓴다(`after`). 메뉴 배지는 그 전에 셌으므로, 배지가 세던 글(남의 글 · 안 읽음)
  // 이면 이 화면의 배지에서 하나 빼 — 열자마자 배지가 줄어드는 동작은 그대로다.
  const countedAsUnread = alreadyRead === false && post.authorId !== session.user.id;
  if (alreadyRead !== true) {
    after(() => ensureBoardPostRead(session, id));
  }

  const rawNavBadges = await navBadgesPromise;
  const navBadges = countedAsUnread
    ? { ...rawNavBadges, board: Math.max(0, (rawNavBadges.board ?? 0) - 1) }
    : rawNavBadges;
  const copy = getDictionary(session.user.preferredLanguage).board;

  // MobileShell + hideBottomNav — 건의함 상세 페이지와 같은 패턴으로 상단 크롬
  // (햄버거 + 워드마크 + 알림 벨)이 상세 화면 전반에서 일관되게 한다. 하단
  // 탭 바는 숨겨서 댓글 입력창이 화면 맨 아래에 겹침 없이 놓이게 한다.
  return (
    <MobileShell activeItem="board" badges={navBadges} title={copy.title} hideBottomNav>
      <BoardDetailClient
        post={post}
        viewerId={session.user.id}
        canManage={session.capabilities.includes("board.manage")}
        canEditAny={isPlatformDeveloper(session.user.role)}
        organizationId={session.organization.id}
        locale={session.user.preferredLanguage}
        copy={copy}
      />
    </MobileShell>
  );
}
