import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SuggestionsDetail } from "@/components/suggestions/suggestions-detail";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSuggestionDetail } from "@/lib/suggestions-queries";

type PageProps = { params: Promise<{ id: string }> };

// 직원 건의 / 피드백함 — 상세 스레드 (역할 인식). Step 4 (2026-06-16): 실제
// 데이터에 연결; 단일 상세 컴포넌트가 수신자 / 작성자 / 참조자 화면을 그린다.
// docs/product/22-staff-suggestions-workflow.md 참고.
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

  // 참여자 전용: 찾을 수 없거나 열람자가 작성자/수신자/참조자가 아니면 null 을 돌려준다.
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
