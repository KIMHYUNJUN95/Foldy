"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight, Building2, ChevronRight, Link2 } from "lucide-react";
import type { Dictionary } from "@/lib/i18n";
import { localizePropertyName } from "@/lib/room-label-normalization";
import type { LinkedTaskContext } from "@/lib/tasks";

type Copy = Pick<
  Dictionary["tasks"],
  | "contextBuildingOnlyLinked"
  | "contextGoToReservation"
  | "contextLinkedSection"
  | "contextChannelDirect"
  | "contextPickerNightsUnit"
  | "contextPickerRoomSuffix"
  | "contextRoomOnlyLinked"
>;

/**
 * Deep-link target into the reservation calendar. The calendar only accepts `property` (canonical
 * name) + `month` (YYYY-MM) — there is no per-reservation highlight — so a linked task lands on its
 * building, scrolled to the reservation's check-in month (or the current month for room-only links).
 */
function calendarHref(context: LinkedTaskContext): string | null {
  if (!context.propertyName) return null;
  const params = new URLSearchParams({ property: context.propertyName });
  if (context.checkinDate) params.set("month", context.checkinDate.slice(0, 7));
  if (context.reservationId) params.set("reservationId", context.reservationId);
  return `/mobile/calendar?${params.toString()}`;
}

function ChannelBadge({ channel, directLabel }: { channel: LinkedTaskContext["channel"]; directLabel: string }) {
  if (!channel) return null;
  if (channel === "airbnb")
    return (
      <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-extrabold text-rose-700">
        Airbnb
      </span>
    );
  if (channel === "booking")
    return (
      <span className="inline-flex items-center rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-extrabold text-cyan-700">
        Booking
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">
      {directLabel}
    </span>
  );
}

function ymdToMD(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}`;
}

export function LinkedContextBlock({
  buildingLabels,
  copy,
  context,
}: {
  buildingLabels: Record<string, string>;
  copy: Copy;
  context: LinkedTaskContext;
}) {
  const router = useRouter();
  const href = calendarHref(context);

  const localizedPropertyName = context.propertyName
    ? localizePropertyName(context.propertyName, buildingLabels)
    : null;
  // For Okubo-style buildings, getCanonicalRoomLabel returns the property name as the room label.
  // Suppress the room portion in that case to avoid "大久保A · 大久保A号室" redundancy.
  const showRoom = context.roomLabel && context.roomLabel !== context.propertyName;
  const nameStr = [
    localizedPropertyName,
    showRoom ? `${context.roomLabel}${copy.contextPickerRoomSuffix}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const dateStr =
    context.checkinDate && context.checkoutDate
      ? `${ymdToMD(context.checkinDate)} – ${ymdToMD(context.checkoutDate)}${context.nightsCount ? ` · ${context.nightsCount}${copy.contextPickerNightsUnit}` : ""}`
      : null;
  const contextSummary = context.roomLabel
    ? copy.contextRoomOnlyLinked
    : copy.contextBuildingOnlyLinked;

  const displayName = nameStr || localizedPropertyName || context.guestName || "—";

  return (
    <div className="mt-4">
      {/* Section header */}
      <div className="mb-[9px] ml-0.5 flex items-center gap-[7px]">
        <Link2 className="size-[15px] text-primary" aria-hidden="true" />
        <span className="text-[12.5px] font-extrabold text-foreground">
          {copy.contextLinkedSection}
        </span>
      </div>

      {/* lctx card — tappable only when it can deep-link to the reservation calendar */}
      <button
        className="flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-opacity disabled:cursor-default enabled:cursor-pointer enabled:active:opacity-80"
        disabled={!href}
        onClick={href ? () => router.push(href) : undefined}
        style={{
          border: "1px solid color-mix(in oklab, #7a52e6 22%, #ececf0)",
          background: "linear-gradient(150deg, rgb(122 82 230 / 0.07), #ffffff)",
        }}
        type="button"
      >
        {/* lctx__ic */}
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-primary"
          style={{
            border: "1px solid color-mix(in oklab, #7a52e6 20%, #ececf0)",
          }}
        >
          <Building2 className="size-[23px]" aria-hidden="true" />
        </span>

        {/* lctx__b */}
        <div className="min-w-0 flex-1">
          {/* lctx__n */}
          <div className="flex items-center gap-1.5 text-[15px] font-extrabold tracking-[-0.01em] text-foreground">
            {nameStr ? (
              <>
                    <span>{localizedPropertyName}</span>
                    {showRoom ? (
                      <>
                        <span className="font-normal text-muted-foreground/40">·</span>
                        <span>
                          {context.roomLabel}
                          {copy.contextPickerRoomSuffix}
                        </span>
                      </>
                    ) : null}
              </>
            ) : (
              <span>{displayName}</span>
            )}
          </div>

          {/* lctx__s */}
          {(context.channel || context.guestName || dateStr) ? (
            <div className="mt-[5px] flex flex-wrap items-center gap-[7px] text-[11.5px] font-semibold text-muted-foreground">
              <ChannelBadge channel={context.channel} directLabel={copy.contextChannelDirect} />
              {context.guestName ? <span>{context.guestName}</span> : null}
              {dateStr ? <span>{dateStr}</span> : null}
            </div>
          ) : context.propertyName ? (
            <div className="mt-[5px] text-[11.5px] font-semibold text-muted-foreground">
              {contextSummary}
            </div>
          ) : null}

          {/* lctx__go — only when the card can navigate */}
          {href ? (
            <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-extrabold text-primary">
              <ArrowUpRight className="size-[13px]" aria-hidden="true" />
              {copy.contextGoToReservation}
            </div>
          ) : null}
        </div>

        {/* lctx__chev */}
        {href ? (
          <ChevronRight className="size-[18px] shrink-0 text-primary" aria-hidden="true" />
        ) : null}
      </button>
    </div>
  );
}
