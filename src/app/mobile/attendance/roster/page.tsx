// 출근자 명단 페이지 — **조직 전 구성원이 볼 수 있다**(역할 게이트 없음).
// 근거: `src/config/roles.ts` 의 `rosterViewerRoles` / `canViewRoster()` —
// "roster is not a privileged view"(오늘 누가 근무 중인지는 특권 정보가 아니라는 확정 결정).
//
// 이 주석은 예전에 "매니저/오피스만 접근 가능, cleaningRecordViewerRoles 로 리다이렉트" 라고
// 적혀 있었으나 **그런 리다이렉트 코드는 존재한 적이 없다.** 청소 기록 열람
// (`canViewOthersCleaning`)과 혼동한 서술이라 2026-08-03 에 실제 동작으로 정정했다.
//
// 참고: 근무 중인 구성원의 전화번호와 `tel:` 통화 링크가 함께 노출된다(현장에서 서로 연락하라는
// 것이 이 화면의 목적). 어드민 로스터는 전화번호를 표시하지 않는다.

import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { AttendanceRoster } from "@/components/attendance/attendance-roster";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getAttendanceRoster } from "@/lib/attendance-roster";
import { canViewRoster } from "@/config/roles";
import { getDictionary } from "@/lib/i18n";
import { dayWeeklyRange, loadWeeklyLimitChips } from "@/lib/staff-documents/weekly-limit-server";

type PageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function AttendanceRosterPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [onboardingState, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (onboardingState.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/roster")}`);
  }
  if (onboardingState.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  // 역할 게이트 — 모든 조직 멤버 접근 가능
  if (!canViewRoster()) {
    redirect("/mobile/attendance");
  }

  const todayDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());

  // searchParams에서 날짜 파싱 — 미래/과거 90일 초과는 오늘로 clamp
  let operatingDate = todayDate;
  if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    if (params.date <= todayDate) {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const minDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(ninetyDaysAgo);
      operatingDate = params.date >= minDate ? params.date : todayDate;
    }
  }

  const locale = session.user.preferredLanguage;
  const localeMap: Record<string, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };
  const bcp47Locale = localeMap[locale] ?? "ko-KR";

  // 「주 28시간」 칩(docs/product/41 R4) — 명단은 누구나 보지만 칩은 체류 자격을 드러내므로 `staff_documents.view` 가 있는
  // 사람에게만 실어 보낸다(없으면 읽지도 않는다).
  const [navBadges, rosterDay, weeklyLimit] = await Promise.all([
    navBadgesPromise,
    getAttendanceRoster(session.organization.id, operatingDate, bcp47Locale),
    loadWeeklyLimitChips(session, dayWeeklyRange(operatingDate)),
  ]);

  const dict = getDictionary(locale);

  return (
    // 넓은 화면(2026-10-05): 출근 중 · 퇴근 완료 섹션 나란히 — 태블릿 가로는 폭 전부(`.roster-sections`).
    <MobileShell activeItem="attendance" badges={navBadges} wide title={dict.attendance.rosterPageTitle}>
      <AttendanceRoster
        rosterDay={rosterDay}
        operatingDate={operatingDate}
        todayDate={todayDate}
        locale={locale}
        weeklyLimit={weeklyLimit}
      />
    </MobileShell>
  );
}
