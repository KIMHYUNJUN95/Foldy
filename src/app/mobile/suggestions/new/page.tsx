import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SuggestionsCompose } from "@/components/suggestions/suggestions-compose";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getShareableUsers } from "@/lib/tasks";
import { withDisplayRoles } from "@/lib/platform-developers";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

// Staff Suggestions / Feedback Box — Frame 2 (compose). Step 2 (2026-06-16): wired to a real create
// flow via createStaffSuggestion. See docs/product/22-staff-suggestions-workflow.md.
export default async function MobileSuggestionsNewPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/suggestions/new")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);

  const [users, navBadges] = await Promise.all([
    getShareableUsers(session).then(withDisplayRoles),
    navBadgesPromise,
  ]);

  return (
    <MobileShell
      activeItem="suggestions"
      badges={navBadges}
      title={dict.mobile.suggestions.composeTitle}
      hideBottomNav
    >
      <SuggestionsCompose
        buildingLabels={dict.cleaning.buildingLabels}
        copy={dict.mobile.suggestions}
        organizationId={session.organization.id}
        pickerCopy={dict.tasks}
        roleLabels={dict.roles}
        serverError={params.error ?? null}
        users={users}
      />
    </MobileShell>
  );
}
