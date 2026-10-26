import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { AttendanceHome } from "@/components/attendance/attendance-home";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import {
  getAbandonedSessions,
  getCurrentOpenSession,
  hasOpenReminderResponseToday,
  isPastReminderTimeTokyo,
} from "@/lib/attendance-sessions";
import { getMonthlyPayView } from "@/lib/attendance-pay";
import { loadOwnWeeklyLimit } from "@/lib/staff-documents/weekly-limit-server";
import { getDictionary } from "@/lib/i18n";
import { canViewRoster } from "@/config/roles";
import { residenceCardNotice } from "@/lib/staff-documents/expiry";
import { loadOwnResidenceCardDaysLeft } from "@/lib/staff-documents/server";

type PageProps = {
  searchParams: Promise<{ state?: string }>;
};

// `?state=` 는 디자인 미리보기용 덮어쓰기다 (휴게/로딩은 여전히 정적 디자인 미리보기로 렌더됨).
// 이 값이 없으면 홈은 실제 세션 데이터(대기 vs 근무 중)로 렌더된다.
const PREVIEW_STATES = ["idle", "open", "break", "loading"] as const;

// 근태 — 홈 (링 히어로 시계). 3단계: 실제 열린 세션 상태에 연결됨.
// 참고: docs/product/24-attendance-workflow.md, docs/product/21-attendance-payroll-workflow.md.
export default async function MobileAttendancePage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const navBadges = await navBadgesPromise;

  // 명시적 `?state=` 는 디자인 미리보기 전환기를 계속 동작하게 한다 (정적 화면, 실제 데이터 없음).
  const previewState = PREVIEW_STATES.includes((params.state ?? "") as (typeof PREVIEW_STATES)[number])
    ? (params.state as (typeof PREVIEW_STATES)[number])
    : null;

  // 월간 급여 미리보기용 도쿄 연월
  const tokyoYM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(new Date())
    .slice(0, 7);

  // 실제 상태: 휴게가 열린 세션 → 휴게 중, 열린 세션 → 근무 중, 그 외 → 출근 전.
  // 월간 급여 뷰를 병렬로 가져온다 (미리보기 모드에서는 생략, 오류는 조용히 처리).
  const [openSession, monthlyPayView, abandonedSessions, weeklyLimit, idCardDaysLeft] = previewState
    ? [null, null, [], null, null]
    : await Promise.all([
        getCurrentOpenSession(session.organization.id, session.user.id, session.user.preferredLanguage),
        getMonthlyPayView(
          session.organization.id,
          session.user.id,
          tokyoYM,
          session.user.preferredLanguage,
        ).catch(() => null),
        // 퇴근을 안 찍고 넘어간 날들. 본인이 알아야 정정 요청을 낼 수 있다(2026-08-04).
        getAbandonedSessions(session.organization.id, session.user.id).catch(() => []),
        // 「주 28시간」(docs/product/41 R4) — 자격외활동 대상자 본인에게 최근 7일이 24시간 이상이면 안내. 대상이 아니면 null.
        loadOwnWeeklyLimit(session.organization.id, session.user.id),
        // 본인 재류카드 만료 · 30일 안 안내(docs/product/41 「만료 표시」). 실패하면 null(안내 없음).
        loadOwnResidenceCardDaysLeft(session.organization.id, session.user.id),
      ]);
  const homeState =
    previewState ??
    (openSession ? (openSession.openBreakStartedAt ? "break" : "open") : "idle");

  // 18:30 미종료 근무 알림: 근무 세션이 아직 열려 있고 사용자가 아직 답하지 않았다면
  // 도쿄 날짜 기준 하루에 한 번만 표시한다. 디자인 미리보기 모드에서는 숨긴다.
  let reminderOpenSessionId: string | null = null;
  if (!previewState && openSession && isPastReminderTimeTokyo()) {
    const answered = await hasOpenReminderResponseToday(session.organization.id, session.user.id);
    if (!answered) reminderOpenSessionId = openSession.id;
  }

  // 홈 바로가기 카드에 표시할 월간 근무 시간 / 급여를 포맷한다.
  // 월급제(시급 데이터 없음)이거나 값이 0이면 건너뛴다.
  let monthHours: string | null = null;
  let monthPay: string | null = null;
  if (monthlyPayView && !monthlyPayView.salariedOnly) {
    if (monthlyPayView.totalPaidMinutes > 0) {
      const h = Math.floor(monthlyPayView.totalPaidMinutes / 60);
      const m = monthlyPayView.totalPaidMinutes % 60;
      monthHours = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    const gross = monthlyPayView.finalization?.gross ?? monthlyPayView.expectedGross;
    if (gross > 0) {
      monthPay = `¥${gross.toLocaleString("ja-JP")}`;
    }
  }

  const canSeeRoster = canViewRoster();
  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const name = session.user.name?.trim() || dict.attendance.userFallback;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const todayLabel = new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date());

  return (
    // 넓은 화면(2026-10-05): 태블릿 가로는 폭을 풀고 화면이 두 칸(링 · 버튼 | 바로가기)을 그린다(`attendance.css` `.att--home`).
    <MobileShell activeItem="attendance" badges={navBadges} split title={dict.attendance.pageTitle}>
      <AttendanceHome
        state={homeState}
        todayLabel={todayLabel}
        userInitial={name.slice(0, 1)}
        userName={name}
        locale={locale}
        openSession={
          openSession
            ? {
                clockInAt: openSession.clockInAt,
                clockInTimeLabel: openSession.clockInTimeLabel,
                siteName: openSession.siteName,
                openBreakStartedAt: openSession.openBreakStartedAt,
                closedBreakSeconds: openSession.closedBreakSeconds,
                breakCount: openSession.breakCount,
              }
            : null
        }
        abandonedDates={abandonedSessions.map((a) => a.operatingDate)}
        reminderOpenSessionId={reminderOpenSessionId}
        monthHours={monthHours}
        monthPay={monthPay}
        canSeeRoster={canSeeRoster}
        weeklyLimit={weeklyLimit}
        idCardNotice={residenceCardNotice(idCardDaysLeft)}
      />
    </MobileShell>
  );
}
