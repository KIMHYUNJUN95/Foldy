import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BuildingPicker } from "@/components/linen-return/building-picker";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import {
  getLinenBuildings,
  getLinenBuildingStats,
  LINEN_LAST_BUILDING_COOKIE,
} from "@/lib/linen-returns";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = { searchParams: Promise<{ pick?: string }> };

export default async function LinenReturnPickerPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/linen-return")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.linenReturn;

  // 화이트 리디자인(2026-10-14, 시안 Linen-Phone 「마지막 건물로 바로」): 마지막으로 본 건물이 있으면 그 목록으로 바로 연다.
  // 건물은 목록 화면 제목을 눌러 바꾼다. `?pick=1` 이면 예전처럼 건물 카드를 보여 준다.
  const params = await searchParams;
  if (params.pick !== "1") {
    const last = (await cookies()).get(LINEN_LAST_BUILDING_COOKIE)?.value;
    const lastName = last ? decodeURIComponent(last) : "";
    if (lastName && (await getLinenBuildings(session)).includes(lastName)) {
      redirect(`/mobile/linen-return/list?building=${encodeURIComponent(lastName)}`);
    }
  }

  const [buildings, stats, navBadges] = await Promise.all([
    getLinenBuildings(session),
    getLinenBuildingStats(session),
    navBadgesPromise,
  ]);

  return (
    // 넓은 화면(2026-10-05): 건물 카드 폰 2열 · 폴드 3열 · 태블릿 가로 4열(폭 전부).
    <MobileShell activeItem="linen-return" badges={navBadges} split title={copy.eyebrow}>
      <BuildingPicker
        buildingLabels={dict.cleaning.buildingLabels}
        buildings={buildings}
        copy={copy}
        locale={locale}
        stats={stats}
      />
    </MobileShell>
  );
}
