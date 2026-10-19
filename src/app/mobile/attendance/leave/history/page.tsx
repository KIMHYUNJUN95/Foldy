import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { LeaveHistory } from "@/components/attendance/leave-history";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listMyLeaveRequests } from "@/lib/annual-leave-requests-server";
import { getDictionary } from "@/lib/i18n";

// L4 · 신청 내역 — 상태 필터 + 이력 리스트. 스티키 하단 액션(연차 신청하기)을 쓰므로 hideBottomNav.
export default async function MobileLeaveHistoryPage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/leave/history")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const navBadges = await navBadgesPromise;
  const copy = getDictionary(session.user.preferredLanguage).leave;
  const requests = await listMyLeaveRequests(
    getSupabaseServiceClient(),
    session.organization.id,
    session.user.id,
  );

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={copy.histTitle}>
      <LeaveHistory locale={session.user.preferredLanguage} requests={requests} />
    </MobileShell>
  );
}
