import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MaintenanceLinkedForm } from "@/components/cleaning/maintenance-linked-form";
import { MaintenanceCreateForm } from "@/components/requests/maintenance-create-form";
import "@/components/requests/order-form.css";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/lib/i18n";
import { getOnboardingState } from "@/lib/onboarding";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
} from "@/lib/room-label-normalization";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type PageProps = {
  searchParams: Promise<{
    error?: string;
    reservationId?: string;
    sessionId?: string;
  }>;
};

type ReservationPrefill = {
  guestName: string;
  propertyName: string;
  reservationId: string;
  roomLabel: string;
};

export default async function MaintenanceNewPage({ searchParams }: PageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    const basePath = "/mobile/maintenance/new";
    const targetParams = new URLSearchParams();
    if (params.sessionId) targetParams.set("sessionId", params.sessionId);
    if (params.reservationId) targetParams.set("reservationId", params.reservationId);
    const targetPath =
      targetParams.size > 0 ? `${basePath}?${targetParams.toString()}` : basePath;
    redirect(`/auth/login?next=${encodeURIComponent(targetPath)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.maintenance;
  const imgCopy = dict.requestImages;

  const isLinkedMode = !!params.sessionId;
  let linkedSessionValid = false;
  let defaultRoom = "";
  let cleaningSessionId = "";
  let reservationPrefill: ReservationPrefill | null = null;

  const supabase = await getSupabaseServerClient();

  if (isLinkedMode) {
    const { data } = await supabase
      .from("cleaning_sessions")
      .select("id, room_label")
      .eq("id", params.sessionId!)
      .eq("organization_id", session.organization.id)
      .eq("staff_user_id", session.user.id)
      .maybeSingle();

    const linked = data as { id: string; room_label: string } | null;
    if (linked) {
      linkedSessionValid = true;
      defaultRoom = linked.room_label;
      cleaningSessionId = linked.id;
    }
  }

  if (params.reservationId) {
    const { data } = await supabase
      .from("reservations")
      .select("id, guest_name, property_name, room_label")
      .eq("id", params.reservationId)
      .eq("organization_id", session.organization.id)
      .maybeSingle();

    const linkedReservation = data as Pick<
      Database["public"]["Tables"]["reservations"]["Row"],
      "id" | "guest_name" | "property_name" | "room_label"
    > | null;

    if (linkedReservation) {
      const propertyName = getCanonicalPropertyName(linkedReservation.property_name);
      const roomLabel =
        getCanonicalRoomLabel(propertyName, linkedReservation.room_label) ??
        linkedReservation.room_label.trim();

      reservationPrefill = {
        guestName: linkedReservation.guest_name,
        propertyName,
        reservationId: linkedReservation.id,
        roomLabel,
      };
      defaultRoom = roomLabel;
    }
  }

  const catalog = await getActiveRoomCatalogServer(session.organization.id);

  const errorMessage =
    !isLinkedMode || linkedSessionValid
      ? params.error
        ? (copy.errors[params.error] ?? copy.errors.save_failed ?? params.error)
        : null
      : null;

  const navBadges = await getMobileNavBadges();

  return (
    <MobileShell activeItem="requests" badges={navBadges} hideBottomNav title={copy.mobileTitle}>
      {/* 화이트 리디자인(2026-10-14, 시안 MaintNew-Phone · MaintNew-Fold): 상자 없는 제목 줄 → 폼. 폴드 · 태블릿은 520px 가운데 열. */}
      <div className="ofw-page">
        <div className="ofw-head">
          {isLinkedMode && linkedSessionValid ? <span className="ofw-kick">{copy.fromCleaning}</span> : null}
          <h1>{copy.wHeading}</h1>
          <p>{copy.wSub}</p>
        </div>

        {reservationPrefill ? (
          <div className="ofw-linked">
            <p>{dict.tasks.contextLinkedSection}</p>
            <dl>
              <div className="flex items-start justify-between gap-3">
                <dt className="font-semibold text-muted-foreground">
                  {dict.cleaning.manualBuildingLabel}
                </dt>
                <dd className="font-black">
                  {dict.cleaning.buildingLabels[reservationPrefill.propertyName] ??
                    reservationPrefill.propertyName}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="font-semibold text-muted-foreground">{copy.room}</dt>
                <dd className="font-black">{reservationPrefill.roomLabel}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="font-semibold text-muted-foreground">
                  {dict.admin.calendar.guestName}
                </dt>
                <dd className="font-black">{reservationPrefill.guestName}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="font-semibold text-muted-foreground">
                  {dict.mobile.calendarReservationId}
                </dt>
                <dd className="font-mono text-xs font-semibold">
                  {reservationPrefill.reservationId}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        {isLinkedMode && !linkedSessionValid ? (
          <>
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
              {copy.errors.invalid_session}
            </div>
            <Link href="/mobile/cleaning">
              <Button className="h-12 w-full rounded-xl" type="button" variant="secondary">
                <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
                {copy.backToCleaning}
              </Button>
            </Link>
          </>
        ) : (
          <>
            {errorMessage ? <p className="ofw-error" role="alert">{errorMessage}</p> : null}

            {isLinkedMode ? (
              <MaintenanceLinkedForm
                buildingLabels={dict.cleaning.buildingLabels}
                cleaningSessionId={cleaningSessionId}
                copy={copy}
                defaultRoom={defaultRoom}
                imgCopy={imgCopy}
                initialPropertyName={reservationPrefill?.propertyName ?? ""}
                linkedGuestName={reservationPrefill?.guestName ?? ""}
                linkedReservationId={reservationPrefill?.reservationId ?? ""}
                organizationId={session.organization.id}
                reporterName={session.user.name}
                roomCatalog={catalog || []}
              />
            ) : (
              <MaintenanceCreateForm
                buildingLabels={dict.cleaning.buildingLabels}
                cleaningSessionId={cleaningSessionId}
                copy={copy}
                defaultRoom={defaultRoom}
                imgCopy={imgCopy}
                initialPropertyName={reservationPrefill?.propertyName ?? ""}
                linkedGuestName={reservationPrefill?.guestName ?? ""}
                linkedReservationId={reservationPrefill?.reservationId ?? ""}
                organizationId={session.organization.id}
                reporterName={session.user.name}
                roomCatalog={catalog || []}
              />
            )}

            {/* 청소에서 넘어온 경우에만 청소로 돌아가기(일반 신고는 화면 스와이프로 뒤로). */}
            {isLinkedMode ? (
              <Link href="/mobile/cleaning">
                <Button className="h-12 w-full rounded-xl" type="button" variant="secondary">
                  <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
                  {copy.backToCleaning}
                </Button>
              </Link>
            ) : null}
          </>
        )}
      </div>
    </MobileShell>
  );
}
