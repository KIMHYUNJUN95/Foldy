"use client";

import { useRouter } from "next/navigation";
import { Building2, Calendar, ChevronRight, Link2, Pencil, X } from "lucide-react";
import type { Dictionary } from "@/lib/i18n";
import { localizePropertyName } from "@/lib/room-label-normalization";

type Copy = Dictionary["tasks"];

// Context that can be linked to a task — UUIDs (persisted on the task row) plus display fields
// (shown in the link card; resolved from the UUIDs/reservation on read).
export type LinkedContext = {
  propertyId: string | null;
  roomId: string | null;
  propertyName: string | null;
  roomLabel: string | null;
  reservationId: string | null; // null = building-only / room-only / guest-direct link
  guestName: string | null;
  channel: "airbnb" | "booking" | "direct" | null;
  checkinDate: string | null; // YYYY-MM-DD Tokyo
  checkoutDate: string | null; // YYYY-MM-DD Tokyo
};

function fmtShortDate(ymd: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${ymd}T00:00:00+09:00`));
}

function ChannelBadge({ channel, directLabel }: { channel: LinkedContext["channel"]; directLabel: string }) {
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

function calendarHref(value: LinkedContext): string | null {
  if (!value.propertyName) return null;
  const params = new URLSearchParams({ property: value.propertyName });
  if (value.checkinDate) params.set("month", value.checkinDate.slice(0, 7));
  if (value.reservationId) params.set("reservationId", value.reservationId);
  return `/mobile/calendar?${params.toString()}`;
}

export function ContextLinkSection({
  buildingLabels,
  copy,
  locale,
  onClear,
  onOpenPicker,
  value,
}: {
  buildingLabels: Record<string, string>;
  copy: Copy;
  locale: string;
  onClear: () => void;
  onOpenPicker: () => void;
  value: LinkedContext | null;
}) {
  const router = useRouter();
  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!value) {
    return (
      <button
        className="flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-border bg-background/40 px-4 py-3.5 text-left transition-colors active:bg-slate-50"
        onClick={onOpenPicker}
        type="button"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-primary/[0.08] text-primary">
          <Link2 className="size-[19px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold text-foreground">{copy.contextLinkBtn}</span>
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{copy.contextLinkHint}</span>
        </span>
        <ChevronRight className="size-[17px] shrink-0 text-muted-foreground/50" aria-hidden="true" />
      </button>
    );
  }

  // ── Filled state ─────────────────────────────────────────────────────────────
  const localizedPropertyName = value.propertyName
    ? localizePropertyName(value.propertyName, buildingLabels)
    : null;
  // For Okubo-style buildings, getCanonicalRoomLabel returns the property name as the room label.
  // In that case, suppress the room portion to avoid "大久保A · 大久保A号室" redundancy.
  const showRoom = value.roomLabel && value.roomLabel !== value.propertyName;
  const nameStr = [
    localizedPropertyName,
    showRoom ? `${value.roomLabel}${copy.contextPickerRoomSuffix}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const dateStr =
    value.checkinDate && value.checkoutDate
      ? `${fmtShortDate(value.checkinDate, locale)} – ${fmtShortDate(value.checkoutDate, locale)}`
      : null;
  const hasReservation = !!(value.reservationId || value.guestName);
  const contextSummary = value.roomLabel
    ? copy.contextRoomOnlyLinked
    : copy.contextBuildingOnlyLinked;

  return (
    <div
      className="rounded-2xl border bg-gradient-to-br from-primary/[0.07] to-surface shadow-[0_8px_28px_-18px_hsl(223_46%_32%/0.28)]"
      style={{ borderColor: "color-mix(in oklab, #7a52e6 22%, #ececf0)" }}
    >
      {/* Top row — icon + names + X */}
      <div className="flex items-start gap-3 p-3.5">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border bg-surface text-primary"
          style={{ borderColor: "color-mix(in oklab, #7a52e6 18%, #ececf0)" }}
        >
          <Building2 className="size-[19px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-extrabold tracking-[-0.01em] text-foreground">
            {nameStr || "—"}
          </p>
          {hasReservation ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <ChannelBadge channel={value.channel} directLabel={copy.contextChannelDirect} />
              {value.guestName ? (
                <span className="text-[11.5px] font-semibold text-muted-foreground">
                  {value.guestName}
                </span>
              ) : null}
              {dateStr ? (
                <span className="text-[11.5px] font-semibold text-muted-foreground">{dateStr}</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-0.5 text-[11.5px] font-semibold text-muted-foreground">
              {contextSummary}
            </p>
          )}
        </div>
        <button
          aria-label={copy.contextLinkRemove}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors active:bg-slate-200"
          onClick={onClear}
          type="button"
        >
          <X className="size-[13px]" aria-hidden="true" />
        </button>
      </div>

      {/* Bottom actions */}
      <div
        className="flex gap-2 border-t px-3.5 pb-3.5 pt-2.5"
        style={{ borderColor: "color-mix(in oklab, #7a52e6 12%, #ececf0)" }}
      >
        <button
          className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-border bg-surface text-[12px] font-bold text-muted-foreground transition-colors active:bg-slate-50"
          onClick={onOpenPicker}
          type="button"
        >
          <Pencil className="size-3" aria-hidden="true" />
          {copy.contextLinkChange}
        </button>
        {value.reservationId ? (
          <button
            className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-border bg-surface text-[12px] font-bold text-muted-foreground transition-colors active:bg-slate-50"
            onClick={() => {
              const href = calendarHref(value);
              if (href) router.push(href);
            }}
            type="button"
          >
            <Calendar className="size-3" aria-hidden="true" />
            {copy.contextLinkViewRes}
          </button>
        ) : null}
      </div>

      {/* Hint */}
      <p className="mx-3.5 mb-3 text-[11px] leading-[1.55] text-muted-foreground/80">
        {copy.contextLinkFilledHint}
      </p>
    </div>
  );
}
