import { redirect } from "next/navigation";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getOnboardingState } from "@/lib/onboarding";
import { getBoardFeed, getBoardTags } from "@/lib/board-queries";
import { countPendingBoardReports } from "@/lib/board-moderation";
import { getDictionary } from "@/lib/i18n";
import { BoardFeedClient } from "./board-feed-client";

const PAGE_SIZE = 15;

type PageProps = {
  searchParams: Promise<{ category?: string }>;
};

export default async function MobileBoardPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/board");
  }

  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const category = params.category?.trim() || null;

  const [feed, tags, navBadges, pendingReportCount] = await Promise.all([
    getBoardFeed({ session, category, limit: PAGE_SIZE }),
    getBoardTags(session),
    navBadgesPromise,
    countPendingBoardReports(session),
  ]);

  return (
    <MobileShell activeItem="board" title="" badges={navBadges} split>
      <SplitList detail="board">
        <BoardFeedClient
          key={category ?? "__all__"}
          locale={session.user.preferredLanguage}
          copy={getDictionary(session.user.preferredLanguage).board}
          initialPosts={feed.posts}
          initialCursor={feed.nextCursor}
          tags={tags}
          selectedCategory={category}
          pendingReportCount={pendingReportCount}
        />
      </SplitList>
    </MobileShell>
  );
}
