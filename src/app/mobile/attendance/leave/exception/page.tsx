import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { LeaveException } from "@/components/attendance/leave-exception";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";

// 섹션 S · 예외 상태 (신청 차단 / 미대상) — 디자인 프리뷰 라우트.
// ?state=missing(기본) | waiting 으로 두 상태를 확인. 이후 실제로는 사용자 상태에 따라 조건부 렌더.
export default async function MobileLeaveExceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/leave/exception")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const navBadges = await navBadgesPromise;
  const copy = getDictionary(session.user.preferredLanguage).leave;
  const variant = params.state === "waiting" ? "waiting" : "missing";

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={copy.appTitle} hideBottomNav>
      <LeaveException locale={session.user.preferredLanguage} variant={variant} />
    </MobileShell>
  );
}
