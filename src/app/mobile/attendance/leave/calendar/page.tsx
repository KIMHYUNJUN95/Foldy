import { redirect } from "next/navigation";
import { resolveYmParam } from "@/lib/iso-date-param";
import { MobileShell } from "@/components/shell/mobile-shell";
import { LeaveCalendar } from "@/components/attendance/leave-calendar";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listApprovedLeaveForMonth } from "@/lib/annual-leave-requests-server";
import { tokyoToday } from "@/lib/annual-leave";
import { getDictionary } from "@/lib/i18n";

// L5 · 연차 캘린더 — 승인된 연차 자동 기입 월 그리드 + 이번 달 목록. 스티키 하단 액션 없음.
// 전 직원의 승인된 연차만 표시(본인 포함) — `?ym=` 쿼리로 실제 월 이동.
export default async function MobileLeaveCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/leave/calendar")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const navBadges = await navBadgesPromise;
  const copy = getDictionary(session.user.preferredLanguage).leave;
  const today = tokyoToday();
  // 실제 달만(`2026-13` 은 달 이름을 그리다 RangeError) — 공용 `resolveYmParam`(2026-11-11). 휴가는 미리 잡으니 앞으로 2년까지.
  const ym = resolveYmParam(params.ym, today.slice(0, 7), { maxMonthsAhead: 24, maxMonthsBack: 60 });
  const entries = await listApprovedLeaveForMonth(getSupabaseServiceClient(), session.organization.id, ym);

  return (
    // 넓은 화면(2026-10-05): 태블릿 가로 = 달력 | 휴가 목록(`leave.css` `.lv--cal`).
    <MobileShell activeItem="attendance" badges={navBadges} wide title={copy.calTitle}>
      <LeaveCalendar locale={session.user.preferredLanguage} ym={ym} entries={entries} todayDate={today} />
    </MobileShell>
  );
}
