import { notFound, redirect } from "next/navigation";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getOnboardingState } from "@/lib/onboarding";
import { getBoardPost, ensureBoardPostRead } from "@/lib/board-queries";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { MobileShell } from "@/components/shell/mobile-shell";
import { BoardDetailClient } from "./board-detail-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

const MANAGER_ROLES = new Set(["owner", "office_admin"]);

export default async function BoardPostPage({ params }: PageProps) {
  const { id } = await params;

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

  const post = await getBoardPost({ session, id });
  if (!post) {
    notFound();
  }

  // Read receipt (server-side, no revalidate) — mirrors ensureAnnouncementRead. The nav unread badge
  // recomputes on the next request.
  await ensureBoardPostRead(session, id);

  const navBadges = await getMobileNavBadges();
  const copy = getDictionary(session.user.preferredLanguage).board;

  // MobileShell + hideBottomNav — same pattern as the Suggestions detail page so the top chrome
  // (hamburger + wordmark + notification bell) is consistent across detail surfaces. The bottom
  // tab bar is hidden so the comment composer can sit at the viewport bottom without overlap.
  return (
    <MobileShell activeItem="board" badges={navBadges} title={copy.title} hideBottomNav>
      <BoardDetailClient
        post={post}
        viewerId={session.user.id}
        canManage={MANAGER_ROLES.has(session.user.role)}
        organizationId={session.organization.id}
        locale={session.user.preferredLanguage}
        copy={copy}
      />
    </MobileShell>
  );
}
