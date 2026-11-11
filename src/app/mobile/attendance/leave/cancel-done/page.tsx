import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { LeaveCancelDone } from "@/components/attendance/leave-cancel-done";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMyLeaveRequest } from "@/lib/annual-leave-requests-server";

// C3 · 취소 완료 — 잔여 연차 복구 안내. 전체 화면(하단 탭바 숨김).
// 기간 · 일수는 주소 값을 그대로 찍지 않고 **본인 신청을 서버에서 다시 읽는다**(2026-11-11) — 주소를 고치면 아무 숫자나 보였다.
export default async function MobileLeaveCancelDonePage({
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
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/leave/cancel-done")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const navBadges = await navBadgesPromise;
  const copy = getDictionary(session.user.preferredLanguage).leave;
  const request =
    typeof params.id === "string" && params.id
      ? await getMyLeaveRequest(getSupabaseServiceClient(), session.organization.id, session.user.id, params.id)
      : null;
  // 취소된 본인 신청이 아니면 보여 줄 것이 없다 — 내역으로.
  if (!request || request.status !== "cancelled") redirect("/mobile/attendance/leave/history");

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={copy.appTitle} hideBottomNav>
      <LeaveCancelDone
        copy={copy}
        period={`${request.startDate} – ${request.endDate}`}
        days={request.daysCount}
      />
    </MobileShell>
  );
}
