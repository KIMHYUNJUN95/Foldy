import { notFound, redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getBugReportDetail, isBugReportReviewer } from "@/lib/bug-reports";
import { getDictionary } from "@/lib/i18n";
import { BugDetailClient } from "./bug-detail-client";
import { isPlatformDeveloper } from "@/config/roles";

type PageProps = { params: Promise<{ id: string }> };

export default async function MobileBugDetailPage({ params }: PageProps) {
  const { id } = await params;

  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=/mobile/bugs/${id}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const bug = await getBugReportDetail(session, id);
  if (!bug) {
    notFound();
  }

  const isReviewer = isBugReportReviewer(session);
  const viewerIsAuthor = bug.reportedByUserId === session.user.id;
  const copy = getDictionary(session.user.preferredLanguage).bugs;

  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="bugs" badges={navBadges} title={copy.title}>
      <BugDetailClient
        copy={copy}
        bug={bug}
        viewerIsAuthor={viewerIsAuthor}
        isDeveloper={isPlatformDeveloper(session.user.role)}
        isReviewer={isReviewer}
      />
    </MobileShell>
  );
}
