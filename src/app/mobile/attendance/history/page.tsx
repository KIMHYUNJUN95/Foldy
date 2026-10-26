import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { AttendanceHistory } from "@/components/attendance/attendance-history";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getAttendanceHistory, getAttendanceTodaySummary } from "@/lib/attendance-history";
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

// 출퇴근 / 근태 — 본인 출퇴근 이력 (Step 5). 본인 조회 전용: 모든 쿼리는
// 인증된 사용자의 id 로 서버에서 정한다. 클라이언트가 지정하는 대상 사용자는 없다. `?ym=YYYY-MM`
// 파라미터(도쿄)로 영업 월을 고르며, 기본값은 이번 달이다.
// docs/product/21-attendance-payroll-workflow.md 와 docs/product/24-attendance-workflow.md 참고.
export default async function MobileAttendanceHistoryPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/history")}`);
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

  const localeMap: Record<string, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };
  const bcp47Locale = localeMap[session.user.preferredLanguage] ?? "ko-KR";

  const [navBadges, summary, sessions] = await Promise.all([
    navBadgesPromise,
    getAttendanceTodaySummary(session.organization.id, session.user.id),
    getAttendanceHistory(session.organization.id, session.user.id, ym, 60, bcp47Locale),
  ]);

  return (
    // 넓은 화면(2026-10-05): 폴드 날짜 묶음 두 줄 · 태블릿 가로 기록 | 상세 칸(`AttendanceHistory`).
    <MobileShell activeItem="attendance" badges={navBadges} split title={dict.attendance.historyTitle}>
      <AttendanceHistory
        summary={summary}
        sessions={sessions}
        ym={ym}
        currentYm={currentYm}
        locale={session.user.preferredLanguage}
      />
    </MobileShell>
  );
}
