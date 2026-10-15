import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMyBugReports } from "@/lib/bug-reports";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getOnboardingState } from "@/lib/onboarding";
import { getDictionary } from "@/lib/i18n";
import { BugComposeClient } from "./bug-compose-client";

// 새 버그 신고 — 화이트 리디자인(2026-10-15, 시안 Bug-Phone). 예전엔 셸 없이 가짜 머리를 그렸다 → 이제 MobileShell 안.
// See docs/product/25-bug-report-workflow.md 「화이트 리디자인 — 모바일」.
export default async function MobileBugComposePage() {
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/bugs/new");
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const copy = getDictionary(session.user.preferredLanguage).bugs;
  const [mine, navBadges] = await Promise.all([getMyBugReports(session), getMobileNavBadges()]);

  return (
    <MobileShell activeItem="bugs" badges={navBadges} title={copy.title}>
      <BugComposeClient copy={copy} myCount={mine.length} />
    </MobileShell>
  );
}
