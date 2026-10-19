import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import {
  SuggestionsCompose,
  type SuggestionComposeInitial,
} from "@/components/suggestions/suggestions-compose";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSuggestionDetail } from "@/lib/suggestions-queries";
import { getShareableUsers } from "@/lib/tasks";
import { withDisplayRoles } from "@/lib/platform-developers";

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

// Staff Suggestions — author edit of a `submitted` suggestion. Reuses the compose form in edit mode.
// Guard: only the author may edit, and only while status is `submitted`; otherwise bounce to detail.
export default async function MobileSuggestionEditPage({ params, searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, { id }, sp] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/suggestions/${id}/edit`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const detail = await getSuggestionDetail(session, id);
  if (!detail) {
    redirect("/mobile/suggestions");
  }
  // Author-only, submitted-only (server action re-checks too).
  if (detail.viewerRole !== "author" || detail.status !== "submitted") {
    redirect(`/mobile/suggestions/${id}`);
  }

  const dict = getDictionary(session.user.preferredLanguage);
  const [users, navBadges] = await Promise.all([getShareableUsers(session).then(withDisplayRoles), navBadgesPromise]);
  const byId = new Map(users.map((u) => [u.id, u]));

  const initial: SuggestionComposeInitial = {
    recipient:
      byId.get(detail.recipient.id) ??
      { id: detail.recipient.id, name: detail.recipient.name, role: "" },
    references: detail.references.map(
      (r) => byId.get(r.id) ?? { id: r.id, name: r.name, role: "" },
    ),
    title: detail.title,
    body: detail.body,
    category: detail.category ?? "",
    ctx:
      detail.propertyId || detail.roomId
        ? {
            propertyId: detail.propertyId,
            propertyName: detail.propertyName,
            roomId: detail.roomId,
            roomLabel: detail.roomLabel,
          }
        : null,
    imageUrls: detail.imageUrls,
  };

  return (
    <MobileShell
      activeItem="suggestions"
      badges={navBadges}
      title={dict.mobile.suggestions.editTitle}
      hideBottomNav
    >
      <SuggestionsCompose
        buildingLabels={dict.cleaning.buildingLabels}
        copy={dict.mobile.suggestions}
        editId={id}
        initial={initial}
        organizationId={session.organization.id}
        pickerCopy={dict.tasks}
        roleLabels={dict.roles}
        serverError={sp.error ?? null}
        users={users}
      />
    </MobileShell>
  );
}
