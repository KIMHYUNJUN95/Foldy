import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { LeaveHome } from "@/components/attendance/leave-home";
import { LeaveException } from "@/components/attendance/leave-exception";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMyAnnualLeaveSummary } from "@/lib/annual-leave-server";
import { countMyPendingLeaveRequests, listMyLeaveRequests } from "@/lib/annual-leave-requests-server";
import { getDictionary } from "@/lib/i18n";

// L1 · 연차 홈 · 현황 — 독립 흐름 랜딩. 잔여/부여/사용 · 최근 신청 · 부여 규칙.
// 스티키 액션 바(달력 · 연차 신청하기)를 쓰므로 앱 하단 탭바는 hideBottomNav로 숨긴다.
// 입사일/잔여 baseline이 없으면(Phase 1 백엔드, migration 202607060001) LeaveException(missing)을 대신 렌더.
export default async function MobileLeavePage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/leave")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const navBadges = await navBadgesPromise;
  const copy = getDictionary(session.user.preferredLanguage).leave;
  const service = getSupabaseServiceClient();
  const summary = await getMyAnnualLeaveSummary(service, session.organization.id, session.user.id);

  let recentSection = null;
  if (summary) {
    const [allRecent, pendingCount] = await Promise.all([
      listMyLeaveRequests(service, session.organization.id, session.user.id, 10),
      countMyPendingLeaveRequests(service, session.organization.id, session.user.id),
    ]);
    const recent = allRecent.filter((r) => r.status !== "draft").slice(0, 3);
    recentSection = (
      <LeaveHome locale={session.user.preferredLanguage} summary={summary} recent={recent} pendingCount={pendingCount} />
    );
  }

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={copy.appTitle} wide>
      {recentSection ?? <LeaveException locale={session.user.preferredLanguage} variant="missing" />}
    </MobileShell>
  );
}
