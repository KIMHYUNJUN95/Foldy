import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getOnboardingState } from "@/lib/onboarding";
import { canModerateBoard, listPendingBoardReports } from "@/lib/board-moderation";
import { getDictionary } from "@/lib/i18n";
import { BoardReportsClient } from "./board-reports-client";

/**
 * 게시판 신고 처리 (2026-10-06, owner · office_admin). 대상별로 묶은 대기 신고를 줄로 보여 주고(화이트 리디자인 2026-10-15)
 * 「삭제」 / 「문제없음」으로 닫는다. 폰 1열 · 폴드 2열 · 태블릿 3열(`wide`).
 * 문서: docs/product/23-board-workflow.md → 「신고 · 차단」.
 */
export default async function BoardReportsPage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);

  if (state.status === "unauthenticated") redirect("/auth/login?next=/mobile/board/reports");
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!canModerateBoard(session)) redirect("/mobile/board");

  const [reports, navBadges] = await Promise.all([listPendingBoardReports(session), navBadgesPromise]);
  const dictionary = getDictionary(session.user.preferredLanguage);
  const copy = dictionary.board;

  return (
    <MobileShell activeItem="board" badges={navBadges} title={copy.reportsMobileTitle} wide>
      <BoardReportsClient
        copy={copy}
        hint={dictionary.boardReportsWhite.hint}
        locale={session.user.preferredLanguage}
        reasonN={dictionary.boardReportsWhite.reasonN}
        reports={reports}
      />
    </MobileShell>
  );
}
