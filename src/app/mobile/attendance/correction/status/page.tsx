import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { AttendanceCorrectionStatus } from "@/components/attendance/attendance-correction-status";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getCorrectionRequestView } from "@/lib/attendance-corrections";
import { getDictionary } from "@/lib/i18n";

type PageProps = {
  searchParams: Promise<{ id?: string }>;
};

// Attendance / 근태 — correction request status (Step 6). Shows one of the user's OWN requests by `?id=`
// (or the latest). Self-scoped server-side; an id that isn't the user's resolves to null → no leak.
// See docs/product/21-attendance-payroll-workflow.md and docs/product/24-attendance-workflow.md.
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

  // No request found (new user, or an id that isn't theirs) → send to the form rather than leak/empty.
  if (!request) {
    redirect("/mobile/attendance/correction");
  }

  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={dict.attendance.corrStatusPageTitle} hideBottomNav>
      <AttendanceCorrectionStatus request={request} locale={session.user.preferredLanguage} />
    </MobileShell>
  );
}
