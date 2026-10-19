import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SuggestionsDetail } from "@/components/suggestions/suggestions-detail";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSuggestionDetail } from "@/lib/suggestions-queries";

type PageProps = { params: Promise<{ id: string }> };

// Staff Suggestions / Feedback Box — detail thread (role-aware). Step 4 (2026-06-16): wired to real
// data; the single detail component renders the recipient / author / referenced treatments.
// See docs/product/22-staff-suggestions-workflow.md.
export default async function MobileSuggestionDetailPage({ params }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, { id }] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/suggestions/${id}`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  // Participant-only: returns null when not found or the viewer isn't author/recipient/referenced.
  const detail = await getSuggestionDetail(session, id);
  if (!detail) {
    redirect("/mobile/suggestions");
  }

  const navBadges = await navBadgesPromise;
  const copy = getDictionary(session.user.preferredLanguage).mobile.suggestions;

  return (
    <MobileShell activeItem="suggestions" badges={navBadges} title={copy.detailTitle}>
      <SuggestionsDetail
        copy={copy}
        data={detail}
        locale={session.user.preferredLanguage}
        organizationId={session.organization.id}
        viewerUserId={session.user.id}
      />
    </MobileShell>
  );
}
