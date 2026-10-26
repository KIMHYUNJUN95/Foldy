import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { AttendancePay } from "@/components/attendance/attendance-pay";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getMonthlyPayView } from "@/lib/attendance-pay";
import { getDictionary } from "@/lib/i18n";

type PageProps = {
  searchParams: Promise<{ ym?: string }>;
};

function currentTokyoYm(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

// 출퇴근 / 근태 — 본인 월 시급 급여 (Step 10, 예상 급여). 본인 조회 전용: 인증된
// 사용자로 서버에서 범위를 건다. 기존 디자인 언어로 만든 새 화면이다 (급여 프레임은 없었다).
// docs/product/21-attendance-payroll-workflow.md 와 docs/product/24-attendance-workflow.md 참고.
export default async function MobileAttendancePayPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/pay")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const dict = getDictionary(session.user.preferredLanguage);
  const currentYm = currentTokyoYm();
  const rawYm = /^\d{4}-\d{2}$/.test(params.ym ?? "") ? (params.ym as string) : currentYm;
  // 미래 월 직접 입력 차단: 현재 Tokyo 월보다 큰 경우 현재 월로 clamp
  const ym = rawYm > currentYm ? currentYm : rawYm;
  const [navBadges, view] = await Promise.all([
    navBadgesPromise,
    getMonthlyPayView(session.organization.id, session.user.id, ym, session.user.preferredLanguage),
  ]);

  return (
    // 넓은 화면(2026-10-05): 태블릿 가로 = 급여 카드 | 일별 표(`attendance.css` `.att--pay`).
    <MobileShell activeItem="attendance" badges={navBadges} split title={dict.attendance.payPageTitle}>
      <AttendancePay view={view} currentYm={currentYm} locale={session.user.preferredLanguage} />
    </MobileShell>
  );
}
