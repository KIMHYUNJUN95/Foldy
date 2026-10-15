import { redirect } from "next/navigation";
import { MobileAutomation } from "@/components/mobile/ops/mobile-automation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { canAccessAdminWeb } from "@/config/roles";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { getAutomationPageData } from "@/lib/automation/console-data";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

/**
 * 모바일 자동화 — 데스크톱 `/admin/ops/automation` 의 모바일판(2026-10-15, 시안 AutoM-Phone · AutoM-Fold · AutoM-Tablet).
 *
 * 도메인 계약: `docs/product/36-automation-control.md` → 「모바일 자동화」
 *
 * **데이터는 데스크톱과 같다**(`getAutomationPageData`). 모바일에서도 PC 가 하는 일을 다 한다 — 켜기 · 미리보기 · 지금 보내기 ·
 * 실행 기록 · 설정 · 담당자. 고른 자동화는 `?job=<jobKey>`, 탭은 `&tab=preview|history|settings|assign` — 폰에서 목록 → 상세가
 * 진짜 이동이라 화면 스와이프 뒤로가기가 목록으로 돌아온다.
 *
 * 권한은 모바일 가동률 · 매출과 같은 두 조건 — `ops_admin.access` + 관리자 웹 역할. 없으면 모바일 홈으로. 설정 · 발송은
 * 서버 액션이 `automation.manage` 를 다시 본다(화면 잠금은 편의).
 */
export const dynamic = "force-dynamic";

const BASE_PATH = "/mobile/ops/automation";

export default async function MobileAutomationPage() {
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);
  if (state.status === "unauthenticated") redirect(`/auth/login?next=${encodeURIComponent(BASE_PATH)}`);
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!canAccessOpsAdmin(session) || !canAccessAdminWeb(session.user.role)) redirect("/mobile");

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const [data, badges] = await Promise.all([getAutomationPageData(session, locale), getMobileNavBadges()]);

  return (
    // `split` — 폴드는 가운데 760px(화면이 다시 540px 로 모은다), 태블릿 가로는 폭 전부를 화면 CSS 가 목록 330px | 상세로 나눈다.
    // 고른 자동화 · 탭은 화면이 주소(`useSearchParams`)에서 읽는다 — 목록 → 상세 이동에 서버를 다시 부르지 않는다.
    <MobileShell activeItem="ops-automation" badges={badges} split title={dictionary.automation.title}>
      <MobileAutomation copy={dictionary.automation} data={data} locale={locale} localeTag={adminLocaleTag(locale)} />
    </MobileShell>
  );
}
