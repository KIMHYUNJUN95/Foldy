import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { LeaveForm } from "@/components/attendance/leave-form";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMyLeaveRequest } from "@/lib/annual-leave-requests-server";
import { getMyAnnualLeaveSummary, LeaveReadError } from "@/lib/annual-leave-server";
import { getDictionary } from "@/lib/i18n";

// L2 · 연차 신청서 작성. 스티키 하단 액션(임시 저장 · 신청 제출)을 쓰므로 hideBottomNav.
// ?id=<requestId> 로 열면 해당 draft를 이어쓰기 — draft가 아니면(이미 제출/처리됨) 무시하고 새 폼.
export default async function MobileLeaveNewPage({
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
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/leave/new")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const navBadges = await navBadgesPromise;
  const dict = getDictionary(session.user.preferredLanguage);
  const userName = session.user.name?.trim() || dict.attendance.userFallback;

  const service = getSupabaseServiceClient();
  const [draftRequest, summary] = await Promise.all([
    params.id ? getMyLeaveRequest(service, session.organization.id, session.user.id, params.id) : Promise.resolve(null),
    // 잔여는 신청 화면의 미리보기일 뿐 — 읽기 실패면 미리보기 없이 연다(서버가 신청 때 다시 확인한다, 2026-11-11).
    getMyAnnualLeaveSummary(service, session.organization.id, session.user.id).catch((error: unknown) => {
      if (!(error instanceof LeaveReadError)) throw error;
      console.error("[mobile/attendance/leave/new]", error.message);
      return null;
    }),
  ]);
  const draft = draftRequest?.status === "draft" ? draftRequest : null;

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={dict.leave.formTitle} hideBottomNav wide>
      <LeaveForm locale={session.user.preferredLanguage} userName={userName} draft={draft} remaining={summary?.baseRemaining ?? null} />
    </MobileShell>
  );
}
