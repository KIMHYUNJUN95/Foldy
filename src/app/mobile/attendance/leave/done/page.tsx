import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { LeaveDone } from "@/components/attendance/leave-done";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMyLeaveRequest } from "@/lib/annual-leave-requests-server";
import { getDictionary } from "@/lib/i18n";

// L3 · 제출 완료 · 승인 단계. 스티키 하단 액션(홈 · 신청 내역 보기)을 쓰므로 hideBottomNav.
// ?id=<requestId> 로 방금 제출한 신청 건을 조회 — 없으면(직접 URL 접근 등) 연차 홈으로 되돌린다.
export default async function MobileLeaveDonePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/leave/done")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  if (!params.id) {
    redirect("/mobile/attendance/leave");
  }

  const navBadges = await navBadgesPromise;
  const copy = getDictionary(session.user.preferredLanguage).leave;
  const request = await getMyLeaveRequest(
    getSupabaseServiceClient(),
    session.organization.id,
    session.user.id,
    params.id,
  );

  if (!request) {
    redirect("/mobile/attendance/leave");
  }

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={copy.appTitle} hideBottomNav>
      <LeaveDone copy={copy} request={request} />
    </MobileShell>
  );
}
