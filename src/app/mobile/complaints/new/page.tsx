import { redirect } from "next/navigation";
import { ComplaintCreate } from "@/components/complaints/complaint-create";
import type { LinkTarget } from "@/components/complaints/complaint-mock";
import { MobileShell } from "@/components/shell/mobile-shell";
import { canWriteComplaint } from "@/lib/complaints";
import { listComplaintPickerPlaces, listComplaintPickerReservations } from "@/lib/complaint-reservations";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = {
  searchParams: Promise<{
    reservationId?: string;
  }>;
};

export default async function MobileComplaintCreatePage({ searchParams }: PageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  const nextPath = params.reservationId
    ? `/mobile/complaints/new?reservationId=${encodeURIComponent(params.reservationId)}`
    : "/mobile/complaints/new";

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  if (!canWriteComplaint(session.user.role)) {
    redirect("/mobile/complaints");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);

  const [navBadges, pickRows, places] = await Promise.all([
    getMobileNavBadges(),
    listComplaintPickerReservations(session.organization.id, locale),
    listComplaintPickerPlaces(session.organization.id, locale),
  ]);

  const prefilledRow = params.reservationId
    ? pickRows.find((row) => row.reservationId === params.reservationId) ?? null
    : null;

  const initialLinked: LinkTarget | null = prefilledRow
    ? {
        plat: prefilledRow.plat,
        propertyName: prefilledRow.propertyName,
        roomLabel: prefilledRow.roomLabel,
        place: prefilledRow.place,
        guest: prefilledRow.guest,
        guestName: prefilledRow.guest,
        reservationId: prefilledRow.reservationId,
        stay: prefilledRow.stay,
      }
    : null;

  return (
    <MobileShell activeItem="complaints" badges={navBadges} hideBottomNav title={dict.complaints.createTitle}>
      {/* 화이트 리디자인(2026-10-14, 시안 FBNew-Phone): 요청 폼과 같은 520px 가운데 열 · 하단 탭 없음. */}
      <div className="ofw-page">
        <ComplaintCreate initialLinked={initialLinked} locale={locale} pickRows={pickRows} places={places} />
      </div>
    </MobileShell>
  );
}
