import { redirect } from "next/navigation";
import { LinenReturnCreateForm } from "@/components/linen-return/linen-return-create-form";
import { LinenBuildingSwitch } from "@/components/linen-return/linen-building-switch";
import "@/components/linen-return/linen-mobile.css";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getActiveLinenItems, getLinenBuildings, getLinenBuildingStats, isKnownBuilding } from "@/lib/linen-returns";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = {
  searchParams: Promise<{ building?: string; error?: string }>;
};

export default async function LinenReturnNewPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  const building = (params.building ?? "").trim();

  if (state.status === "unauthenticated") {
    redirect(
      `/auth/login?next=${encodeURIComponent(`/mobile/linen-return/new?building=${encodeURIComponent(building)}`)}`,
    );
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  if (!building || !(await isKnownBuilding(session, building))) {
    redirect("/mobile/linen-return");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.linenReturn;
  const buildingLabel = localizePropertyName(building, dict.cleaning.buildingLabels);

  const [items, navBadges, allBuildings, stats] = await Promise.all([
    getActiveLinenItems(session, building),
    navBadgesPromise,
    getLinenBuildings(session),
    getLinenBuildingStats(session),
  ]);
  const today = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" }).format(new Date());
  const buildingOptions = allBuildings.map((name) => ({
    name,
    label: localizePropertyName(name, dict.cleaning.buildingLabels),
    monthCount: stats[name]?.count ?? 0,
  }));

  const serverError = params.error ? copy.errors[params.error] ?? copy.errors.save_failed : null;

  return (
    <MobileShell
      activeItem="linen-return"
      badges={navBadges}
      hideBottomNav
      title={copy.createTitle}
    >
      {/* 화이트 리디자인(2026-10-14, 시안 LinenNew-Phone · Linen-Fold): 「반품 등록 · 날짜 · 등록자」 + 건물 이름(눌러서 바꾸기) → ± 품목. */}
      <div className="lnw lnw--form">
        <div className="lnw-head">
          <span className="lnw-kick" suppressHydrationWarning>
            {copy.wNewKick.replace("{date}", today).replace("{who}", session.user.name)}
          </span>
          <LinenBuildingSwitch
            basePath="/mobile/linen-return/new"
            buildings={buildingOptions}
            copy={copy}
            current={building}
            currentLabel={buildingLabel}
          />
        </div>
      <LinenReturnCreateForm
        building={building}
        buildingLabel={buildingLabel}
        copy={copy}
        imgCopy={dict.requestImages}
        items={items}
        organizationId={session.organization.id}
        reporterName={session.user.name}
        serverError={serverError}
      />
      </div>
    </MobileShell>
  );
}
