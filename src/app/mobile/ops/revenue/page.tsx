import { redirect } from "next/navigation";
import { MobileRevenue } from "@/components/mobile/ops/mobile-revenue";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { MobileShell } from "@/components/shell/mobile-shell";
import { canAccessAdminWeb } from "@/config/roles";
import { toJstDateString } from "@/lib/admin-calendar-dashboard";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { defaultIncludedProperties } from "@/lib/ops-occupancy-summary";
import { normalizeRange } from "@/lib/ops-revenue";
import { getOpsRevenueData } from "@/lib/ops-revenue-server";
import { buildRevenueSummary } from "@/lib/ops-revenue-summary";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

/**
 * 모바일 매출 — 데스크톱 `/admin/ops/revenue` 의 요약판(2026-10-15, 시안 Rev-Phone · Rev-Fold · Rev-Tablet).
 *
 * 도메인 계약: `docs/product/34-metrics-and-automation.md` → 「모바일 매출」
 *
 * **숫자는 데스크톱과 같은 읽기**(`getOpsRevenueData`, 월 모드)다. 모바일은 **월 하나만**(`?ym=YYYY-MM`, 없으면 도쿄 이번 달) ·
 * 합계 건물은 기본값(오쿠보A · 사노 제외)으로 고정. 서버가 요약(`buildRevenueSummary`)까지 내고 결과만 넘긴다.
 *
 * 권한은 모바일 가동률과 같은 두 조건 — `ops_admin.access` + 관리자 웹 역할. 없으면 모바일 홈으로.
 */
export const dynamic = "force-dynamic";

const BASE_PATH = "/mobile/ops/revenue";
const LIVE_KINDS = ["reservations"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MobileRevenuePage({ searchParams }: { searchParams: SearchParams }) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([getOnboardingState(), getCurrentAppSession(), searchParams]);
  if (state.status === "unauthenticated") redirect(`/auth/login?next=${encodeURIComponent(BASE_PATH)}`);
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!canAccessOpsAdmin(session) || !canAccessAdminWeb(session.user.role)) redirect("/mobile");

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const today = toJstDateString(new Date());
  const ym = typeof params.ym === "string" ? params.ym : undefined;
  const range = normalizeRange("month", { ym }, today);

  const [data, badges] = await Promise.all([getOpsRevenueData(session, { mode: "month", range }), navBadgesPromise]);
  const summary = buildRevenueSummary(data, defaultIncludedProperties(data));

  return (
    // `split` — 폴드는 가운데 760px(화면이 다시 540px 로 모은다), 태블릿 가로는 폭 전부를 화면 CSS 가 두 칸으로 나눈다.
    <MobileShell activeItem="ops-revenue" badges={badges} split title={dictionary.opsRevenue.title}>
      {/* 예약 웹훅이 들어오면 새로고침 없이 다시 읽는다 — 데스크톱과 같은 예약 신호만. */}
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <MobileRevenue
        copy={dictionary.opsRevenue.mobile}
        empty={dictionary.opsRevenue.empty}
        localeTag={adminLocaleTag(locale)}
        summary={summary}
        title={dictionary.opsRevenue.title}
      />
    </MobileShell>
  );
}
