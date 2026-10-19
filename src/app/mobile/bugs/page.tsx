import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import {
  getMyBugReports,
  getOrgBugReports,
  isBugReportReviewer,
} from "@/lib/bug-reports";
import { getDictionary } from "@/lib/i18n";
import { BugsListClient } from "./bugs-list-client";

export default async function MobileBugsPage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/bugs");
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const isReviewer = isBugReportReviewer(session);
  const copy = getDictionary(session.user.preferredLanguage).bugs;

  const [reports, navBadges] = await Promise.all([
    isReviewer ? getOrgBugReports(session) : getMyBugReports(session),
    navBadgesPromise,
  ]);

  return (
    <MobileShell activeItem="bugs" badges={navBadges} title={copy.title} split>
      <SplitList detail="bugs">
        <BugsListClient copy={copy} reports={reports} isReviewer={isReviewer} />
      </SplitList>
    </MobileShell>
  );
}
