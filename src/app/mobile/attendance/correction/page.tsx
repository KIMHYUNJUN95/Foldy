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

// Attendance / 근태 — correction request form (Step 6). Optional `?sessionId=` ties the request to one
// of the user's own sessions; without it, it's a session-less exception request. Self-scoped.
// See docs/product/21-attendance-payroll-workflow.md and docs/product/24-attendance-workflow.md.
export default async function MobileAttendanceCorrectionPage({ searchParams }: PageProps) {
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
    getMobileNavBadges(),
    listActiveAttendanceSites(session.organization.id, bcp47Locale),
    listMyCorrectionRequests(session.organization.id, session.user.id, bcp47Locale),
    sessionId
      ? getSessionCorrectionContext(session.organization.id, session.user.id, sessionId, bcp47Locale)
      : Promise.resolve(null),
  ]);

  // A sessionId that isn't the user's own resolves to null context → treat as an exception request
  // (do not leak another user's session existence).
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
