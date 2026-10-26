import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { AttendanceCorrectionForm } from "@/components/attendance/attendance-correction-form";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import {
  getSessionCorrectionContext,
  listActiveAttendanceSites,
  listMyCorrectionRequests,
} from "@/lib/attendance-corrections";
import { getDictionary } from "@/lib/i18n";

type PageProps = {
  searchParams: Promise<{ sessionId?: string }>;
};

// 근태 — 정정 요청 폼(Step 6). 선택 사항인 `?sessionId=` 가 요청을 본인 세션 하나에
// 연결한다. 없으면 세션 없는 예외 요청이다. 본인 범위.
// docs/product/21-attendance-payroll-workflow.md 와 docs/product/24-attendance-workflow.md 참고.
export default async function MobileAttendanceCorrectionPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/correction")}`);
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
  const sessionId = params.sessionId?.trim() || null;
  const [navBadges, sites, myRequests, context] = await Promise.all([
    navBadgesPromise,
    listActiveAttendanceSites(session.organization.id, bcp47Locale),
    listMyCorrectionRequests(session.organization.id, session.user.id, bcp47Locale),
    sessionId
      ? getSessionCorrectionContext(session.organization.id, session.user.id, sessionId, bcp47Locale)
      : Promise.resolve(null),
  ]);

  // 본인 것이 아닌 sessionId 는 컨텍스트가 null 로 풀린다 → 예외 요청으로 처리한다
  // (다른 사용자의 세션 존재 여부를 노출하지 않음).
  const effectiveSessionId = context ? sessionId : null;

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={dict.attendance.corrPageTitle} hideBottomNav wide>
      <AttendanceCorrectionForm
        organizationId={session.organization.id}
        sessionId={effectiveSessionId}
        sessionContext={
          context
            ? {
                dateLabel: context.dateLabel,
                clockInTime: context.clockInTime,
                clockOutTime: context.clockOutTime,
                siteName: context.siteName,
              }
            : null
        }
        sites={sites}
        myRequests={myRequests}
        locale={session.user.preferredLanguage}
      />
    </MobileShell>
  );
}
