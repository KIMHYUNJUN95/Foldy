import { notFound, redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { ReviewDetail } from "@/components/complaints/review-detail";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import { canWriteComplaint } from "@/lib/complaints";
import { getExternalReview } from "@/lib/external-reviews";
import { getStoredTranslations } from "@/lib/review-translate";

type PageProps = { params: Promise<{ id: string }> };

// 외부 리뷰 — 화면 2 (읽기 전용 상세). 참고: docs/product/25-complaint-workflow.md.
export default async function MobileReviewDetailPage({ params }: PageProps) {
  const [state, session, { id }] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/complaints/reviews/${id}`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const review = await getExternalReview({ session, id });
  if (!review) notFound();

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const [translations, navBadges] = await Promise.all([
    getStoredTranslations({ externalReviewId: id, targetLocale: locale }),
    getMobileNavBadges(),
  ]);

  return (
    <MobileShell activeItem="complaints" badges={navBadges} title={dict.complaints.pageTitle}>
      <ReviewDetail
        review={review}
        locale={locale}
        canConvert={canWriteComplaint(session)}
        initialTranslations={translations}
      />
    </MobileShell>
  );
}
