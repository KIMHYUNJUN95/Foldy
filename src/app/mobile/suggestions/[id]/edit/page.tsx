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

// 직원 건의 — `submitted` 상태 건의의 작성자 수정. 작성 폼을 수정 모드로 재사용한다.
// 가드: 작성자만, 상태가 `submitted` 일 때만 수정할 수 있으며 아니면 상세로 돌려보낸다.
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
  // 작성자 전용, submitted 전용(서버 액션도 다시 확인함).
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
