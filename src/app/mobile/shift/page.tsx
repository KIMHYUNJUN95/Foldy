import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { MyShiftView } from "@/components/mobile/shift/my-shift-view";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { addDays, isMonthKey, monthOf } from "@/lib/cleaning-assign/day-state";
import { loadMyShift } from "@/lib/cleaning-assign/data";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 내 시프트(모바일 · 알바) — 일할 날을 눌러 신청, 다시 누르면 취소. 배정된 날은 「취소 요청」. 개인 URL 없이 로그인한 그대로.
 * 폰 · 폴드 · 태블릿(태블릿 가로는 오른쪽에 그날 칸). docs/product/37-cleaning-shift-assignment.md 「4-1」
 */
export default async function MobileShiftPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([getOnboardingState(), getCurrentAppSession(), searchParams]);
  if (state.status === "unauthenticated") redirect("/auth/login?next=/mobile/shift");
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!session.capabilities.includes("cleaning.work")) redirect("/mobile");

  const locale = session.user.preferredLanguage;
  const copy = getCleaningAssignCopy(locale);
  const today = getCleaningOperatingDateKey();
  const thisMonth = monthOf(today);
  const ym = isMonthKey(params.ym) ? params.ym! : thisMonth;
  const data = await loadMyShift(getSupabaseServiceClient(), session.organization.id, session.user.id, session.user.role, ym, today);
  const buildingLabels = getDictionary(locale).cleaning.buildingLabels;
  const props = [...new Set(data.details.flatMap((d) => d.rooms.map((r) => r.propertyName)))];
  const propertyLabels = Object.fromEntries(props.map((name) => [name, localizePropertyName(name, buildingLabels)]));
  // 20일부터 다음 달 신청 안내(막지 않는다 — 마감 없음).
  const nextYm = monthOf(addDays(`${thisMonth}-01`, 40));
  const showNextBanner = Number(today.slice(8)) >= 20 && ym === thisMonth;
  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="shift" badges={navBadges} title={copy.myShiftTitle} wide>
      <MyShiftView
        copy={copy}
        locale={locale}
        ym={ym}
        today={today}
        nextYm={showNextBanner ? nextYm : null}
        days={data.days}
        details={data.details}
        upcoming={data.upcoming}
        summary={data.summary}
        propertyLabels={propertyLabels}
      />
    </MobileShell>
  );
}
