import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { AttendanceCapture } from "@/components/attendance/attendance-capture";
import { extractAttendanceToken } from "@/lib/attendance-qr";
import { getSiteNameByActiveQrToken } from "@/lib/attendance-sites";
import { resolveTrustedDevice } from "@/lib/attendance-trusted-device";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary, resolveLocale } from "@/lib/i18n";

type PageProps = {
  searchParams: Promise<{ mode?: string; token?: string }>;
};

// Attendance / 근태 — GPS + QR capture (clock-in or clock-out). Step 3: wired to real actions.
//
// Three entry paths:
//   1. In-app     — `?mode=in|out`, opens the camera and scans the site QR (original flow).
//   2. QR link    — `?token=att_…`, reached by scanning the printed site QR with the phone's own
//                   camera. The camera can't tell clock-in from clock-out, so the landing state
//                   shows the building and lets the staff member pick.
//   3. QR link on a REMEMBERED DEVICE — same as (2) but with no auth session. iOS opens the QR in
//                   Safari, which does not share the installed PWA's login, so a device that has
//                   already clocked in once is trusted for 출퇴근 打刻 only. Everything else on
//                   this app still requires a real session.
// See docs/product/24-attendance-workflow.md → "QR Deep Link" / "Trusted Device".
export default async function MobileAttendanceCapturePage({ searchParams }: PageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  const mode = params.mode === "out" ? "out" : "in";
  // A QR link may carry the whole URL through a redirect chain; accept either shape.
  const token = typeof params.token === "string" ? extractAttendanceToken(params.token) : null;
  // Round-trip the token through login — otherwise a signed-out staff member who scanned the QR
  // lands on a blank capture screen after authenticating and has to scan again.
  const selfPath = token
    ? `/mobile/attendance/capture?token=${encodeURIComponent(token)}`
    : `/mobile/attendance/capture?mode=${mode}`;

  const authed = state.status === "ready" && session && hasOrganizationContext(session);

  // Remembered device: only ever consulted for the QR-link entry, and only to render the
  // 출근/퇴근 picker. It grants no other access — every other route keeps its session gate.
  const trusted = !authed && token ? await resolveTrustedDevice() : null;

  if (!authed && !trusted) {
    if (state.status === "unauthenticated") {
      redirect(`/auth/login?next=${encodeURIComponent(selfPath)}`);
    }
    if (state.status !== "ready" || !session) {
      redirect("/onboarding");
    }
    redirect("/mobile/unavailable");
  }

  const organizationId = authed ? session!.organization.id : trusted!.organizationId;
  const locale = authed
    ? session!.user.preferredLanguage
    : resolveLocale((await cookies()).get("stayops_locale")?.value);
  const dict = getDictionary(locale);
  // The bottom nav is hidden on this screen anyway; skip the badge queries on the trusted-device
  // path since there is no session to scope them with.
  const navBadges = authed ? await getMobileNavBadges() : undefined;

  // Display-only lookup: it tells the staff member which building they just scanned. Every real
  // check (active token, active site, same org, GPS inside the radius) still runs in the submit
  // action, so a stale token simply fails there.
  const qrSiteName = token
    ? await getSiteNameByActiveQrToken(organizationId, token, locale)
    : null;

  const title = token
    ? dict.attendance.qrLandingTitle
    : mode === "out"
      ? dict.attendance.captureOutTitle
      : dict.attendance.captureInTitle;

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={title} hideBottomNav>
      <AttendanceCapture
        locale={locale}
        mode={mode}
        qrSiteName={qrSiteName}
        qrToken={token}
        trustedDeviceName={trusted ? trusted.userName : null}
        userName={authed ? (session!.user.name ?? "") : (trusted?.userName ?? "")}
      />
    </MobileShell>
  );
}
