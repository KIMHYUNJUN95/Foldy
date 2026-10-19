import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { SuggestionsList } from "@/components/suggestions/suggestions-list";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSuggestionListData } from "@/lib/suggestions-queries";

// Staff Suggestions / Feedback Box — Frame 1 (main list). Step 3 (2026-06-16): wired to real
// Sent / Received / Referenced data. See docs/product/22-staff-suggestions-workflow.md.
export default async function MobileSuggestionsPage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/suggestions")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const copy = getDictionary(locale).mobile.suggestions;

  const [data, navBadges] = await Promise.all([
    getSuggestionListData(session),
    navBadgesPromise,
  ]);

  return (
    <MobileShell activeItem="suggestions" badges={navBadges} title={copy.listTitle} split>
      <SplitList detail="suggestions">
        <SuggestionsList copy={copy} data={data} locale={locale} />
      </SplitList>
    </MobileShell>
  );
}
