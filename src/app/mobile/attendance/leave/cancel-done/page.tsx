import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { LeaveCancelDone } from "@/components/attendance/leave-cancel-done";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";

// C3 · 취소 완료 — 잔여 연차 복구 안내. 전체 화면(하단 탭바 숨김).
export default async function MobileLeaveCancelDonePage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; days?: string }>;
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
  const days = Number(params.days ?? 0);

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={copy.appTitle} hideBottomNav>
      <LeaveCancelDone
        copy={copy}
        period={params.start && params.end ? `${params.start} – ${params.end}` : "-"}
        days={Number.isFinite(days) ? days : 0}
      />
    </MobileShell>
  );
}
