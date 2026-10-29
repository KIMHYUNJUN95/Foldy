import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { AttendanceCorrectionStatus } from "@/components/attendance/attendance-correction-status";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getCorrectionRequestView } from "@/lib/attendance-corrections";
import { getDictionary } from "@/lib/i18n";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { attendanceQueueLiveSources } from "@/lib/live-sources";

type PageProps = {
  searchParams: Promise<{ id?: string }>;
};

// 근태 / Attendance — 정정 요청 상태 (6단계). `?id=` 로 사용자 본인의 요청 하나를 보여준다
// (또는 최신 건). 서버에서 본인 것만 조회하며, 본인 것이 아닌 id 는 null 로 풀려 정보가 새지 않는다.
// 참고: docs/product/21-attendance-payroll-workflow.md, docs/product/24-attendance-workflow.md.
export default async function MobileAttendanceCorrectionStatusPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/correction/status")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const dict = getDictionary(session.user.preferredLanguage);
  const localeMap: Record<string, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };
  const bcp47Locale = localeMap[session.user.preferredLanguage] ?? "ko-KR";
  const requestId = params.id?.trim() || null;
  const request = await getCorrectionRequestView(
    session.organization.id,
    session.user.id,
    requestId,
    bcp47Locale,
  );

  // 요청을 찾지 못함(신규 사용자이거나 본인 것이 아닌 id) → 정보를 흘리거나 빈 화면을 보이지 않고 폼으로 보낸다.
  if (!request) {
    redirect("/mobile/attendance/correction");
  }

  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={dict.attendance.corrStatusPageTitle} hideBottomNav>
      <LiveRefresh sources={attendanceQueueLiveSources(session.organization.id)} />
      <AttendanceCorrectionStatus request={request} locale={session.user.preferredLanguage} />
    </MobileShell>
  );
}
