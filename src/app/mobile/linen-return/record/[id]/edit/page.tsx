import { redirect } from "next/navigation";
import { LinenReturnCreateForm } from "@/components/linen-return/linen-return-create-form";
import "@/components/linen-return/linen-mobile.css";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  canManageLinenRecord,
  getActiveLinenItems,
  getLinenReturnRecordById,
} from "@/lib/linen-returns";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" }).format(new Date(iso));
}

export default async function LinenReturnEditPage({ params, searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, { id }, query] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/linen-return/record/${id}/edit`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const record = await getLinenReturnRecordById(session, id);
  if (!record) {
    redirect("/mobile/linen-return");
  }
  const detailHref = `/mobile/linen-return/record/${id}?building=${encodeURIComponent(record.buildingName)}`;
  if (!canManageLinenRecord(session, record)) {
    redirect(detailHref);
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.linenReturn;
  const buildingLabel = localizePropertyName(record.buildingName, dict.cleaning.buildingLabels);

  const [items, navBadges] = await Promise.all([
    getActiveLinenItems(session, record.buildingName),
    navBadgesPromise,
  ]);

  const serverError = query.error ? copy.errors[query.error] ?? copy.errors.save_failed : null;

  return (
    <MobileShell
      activeItem="linen-return"
      badges={navBadges}
      hideBottomNav
      title={copy.editAction}
    >
      {/* 화이트 리디자인(2026-10-14): 등록 폼과 같은 머리 — 「기록 수정 · 날짜 · 등록자」 + 건물(수정 화면에선 바꾸지 않는다). */}
      <div className="lnw lnw--form">
        <div className="lnw-head">
          <span className="lnw-kick">
            {copy.wEditKick.replace("{date}", formatDay(record.registeredAt, locale)).replace("{who}", record.registrantName)}
          </span>
          <h1 className="lnw-title">{buildingLabel}</h1>
        </div>

      <LinenReturnCreateForm
        building={record.buildingName}
        buildingLabel={buildingLabel}
        copy={copy}
        imgCopy={dict.requestImages}
        initialLines={record.lines.map((line) => ({
          itemId: line.itemId,
          name: line.name,
          quantity: line.quantity,
        }))}
        initialNote={record.note ?? ""}
        initialPhotos={record.imageUrls}
        items={items}
        mode="edit"
        organizationId={session.organization.id}
        recordId={record.id}
        reporterName={record.registrantName}
        serverError={serverError}
        submitLabel={copy.editAction}
      />
      </div>
    </MobileShell>
  );
}
