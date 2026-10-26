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

// 근태 — GPS + QR 캡처 (출근 또는 퇴근). 3단계: 실제 액션에 연결됨.
//
// 진입 경로 세 가지:
//   1. 앱 안     — `?mode=in|out`, 카메라를 열어 현장 QR 을 스캔한다 (기존 흐름).
//   2. QR 링크   — `?token=att_…`, 인쇄된 현장 QR 을 폰 기본 카메라로 스캔해서 들어온다.
//                   카메라는 출근/퇴근을 구분하지 못하므로, 첫 화면에서
//                   건물을 보여주고 직원이 직접 고르게 한다.
//   3. 기억된 기기에서 QR 링크 — (2)와 같지만 인증 세션이 없다. iOS 는 QR 을 Safari 에서 열고,
//                   Safari 는 설치된 PWA 의 로그인을 공유하지 않으므로, 한 번 출근한 적 있는 기기는
// 이미 출근한 적 있는 기기는 출퇴근 打刻 에 한해서만 신뢰된다. 그 외 모든 기능은
//                   이 앱의 나머지는 여전히 실제 세션이 필요하다.
// 참고: docs/product/24-attendance-workflow.md → "QR Deep Link" / "Trusted Device".
export default async function MobileAttendanceCapturePage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  const mode = params.mode === "out" ? "out" : "in";
  // QR 링크가 리디렉션 체인을 거치며 전체 URL 을 실어 올 수 있으므로 두 형태 모두 받는다.
  const token = typeof params.token === "string" ? extractAttendanceToken(params.token) : null;
  // 로그인을 거쳐도 토큰을 유지한다 — 그렇지 않으면 로그아웃 상태에서 QR 을 스캔한 직원이
  // 인증 후 빈 캡처 화면으로 가서 다시 스캔해야 한다.
  const selfPath = token
    ? `/mobile/attendance/capture?token=${encodeURIComponent(token)}`
    : `/mobile/attendance/capture?mode=${mode}`;

  const authed = state.status === "ready" && session && hasOrganizationContext(session);

  // 기억된 기기: QR 링크 진입에서만 조회하며, 화면에 보여주는 용도로만 쓴다
  // 출근/퇴근 선택기. 다른 접근 권한은 주지 않는다 — 나머지 모든 경로는 세션 게이트를 유지한다.
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
  // 이 화면은 어차피 하단 내비를 숨기므로, 신뢰 기기 경로에서는 배지 조회를 건너뛴다.
  // 범위를 잡을 세션이 없기 때문이다.
  const navBadges = authed ? await navBadgesPromise : undefined;

  // 표시 전용 조회: 방금 스캔한 건물을 직원에게 알려준다. 실제 검증(유효 토큰, 활성 현장,
  // 같은 조직, 반경 안 GPS)은 모두 제출 액션에서 그대로 수행하므로,
  // 오래된 토큰은 거기서 실패할 뿐이다.
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
