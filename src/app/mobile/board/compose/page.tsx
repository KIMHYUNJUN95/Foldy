import { redirect } from "next/navigation";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getOnboardingState } from "@/lib/onboarding";
import { getDictionary } from "@/lib/i18n";
import { getBoardTags } from "@/lib/board-queries";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { isOrgTopAdmin } from "@/config/roles";
import { MobileShell } from "@/components/shell/mobile-shell";
import { BoardComposeClient } from "./board-compose-client";

export default async function BoardComposePage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);
  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/board/compose");
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const dictionary = getDictionary(session.user.preferredLanguage);
  // 작성 경로(`createBoardPost`)와 같은 고정 권한 — 권한 없는 사람에게는 스위치를 그리지 않는다.
  const canPin = isOrgTopAdmin(session.user.role) || session.user.role === "office_admin";
  const [tags, navBadges] = await Promise.all([getBoardTags(session), navBadgesPromise]);

  // 화이트 리디자인(2026-10-15): 셸 안에서 그린다(상단 바 · 화면 스와이프 뒤로가기 · 폴드 레일). 아래 탭은 숨긴다.
  return (
    <MobileShell activeItem="board" badges={navBadges} hideBottomNav title="">
      <BoardComposeClient
        canPin={canPin}
        copy={dictionary.board}
        orgId={session.organization.id}
        tagSuggestions={tags}
      />
    </MobileShell>
  );
}
