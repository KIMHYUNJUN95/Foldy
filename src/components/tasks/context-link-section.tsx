"use client";

import { useRouter } from "next/navigation";
import { Building2, ChevronRight, Link2, X } from "lucide-react";
import "./tasks-white.css";
import type { Dictionary } from "@/lib/i18n";
import { localizePropertyName } from "@/lib/room-label-normalization";

type Copy = Dictionary["tasks"];

// 할 일에 연결할 수 있는 컨텍스트 — UUID(할 일 행에 저장됨)와 표시용 필드
// (링크 카드에 표시되며, 읽을 때 UUID/예약에서 해석됨).
export type LinkedContext = {
  propertyId: string | null;
  roomId: string | null;
  propertyName: string | null;
  roomLabel: string | null;
  reservationId: string | null; // null = 건물만 / 방만 / 게스트 직접 연결
  guestName: string | null;
  channel: "airbnb" | "booking" | "direct" | null;
  checkinDate: string | null; // YYYY-MM-DD (도쿄)
  checkoutDate: string | null; // YYYY-MM-DD (도쿄)
};

function fmtShortDate(ymd: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${ymd}T00:00:00+09:00`));
}

function channelText(channel: LinkedContext["channel"], directLabel: string): string | null {
  if (!channel) return null;
  return channel === "airbnb" ? "Airbnb" : channel === "booking" ? "Booking" : directLabel;
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
  // 화이트 리디자인(2026-10-15) — 이름표 칸 모양의 버튼 한 줄. 비어 있으면 「연결하기」, 차 있으면 이름 + 회색 한 줄.
  // ── 빈 상태 ──
  if (!value) {
    return (
      <span className="tkw-nf">
        <span className="tkw-nf__l">{copy.contextLink}</span>
        <button className="tkw-nf__in" onClick={onOpenPicker} type="button">
          <Link2 aria-hidden="true" />
          <span className="tkw-nf__v is-ph">
            {copy.contextLinkBtn}
            <small>{copy.contextLinkHint}</small>
          </span>
          <ChevronRight aria-hidden="true" />
        </button>
      </span>
    );
  }

  // ── 채워진 상태 ──
  const localizedPropertyName = value.propertyName
    ? localizePropertyName(value.propertyName, buildingLabels)
    : null;
  // 오쿠보 방식 건물은 getCanonicalRoomLabel 이 숙소 이름을 방 라벨로 돌려준다.
  // 이 경우 "大久保A · 大久保A号室" 처럼 겹치지 않게 방 부분을 생략한다.
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
  const sub = hasReservation
    ? [channelText(value.channel, copy.contextChannelDirect), value.guestName, dateStr].filter(Boolean).join(" · ")
    : contextSummary;

  return (
    <span className="tkw-nf" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="tkw-nf__l">{copy.contextLink}</span>
      <button className="tkw-nf__in" onClick={onOpenPicker} type="button">
        <Building2 aria-hidden="true" style={{ color: "#7a52e6" }} />
        <span className="tkw-nf__v">
          {nameStr || "—"}
          {sub ? <small>{sub}</small> : null}
        </span>
        <span
          aria-label={copy.contextLinkRemove}
          className="tkw-nf__x"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onClear();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <X aria-hidden="true" />
        </span>
      </button>
      <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <button className="tkw-tl" onClick={onOpenPicker} type="button">
          {copy.contextLinkChange}
        </button>
        {value.reservationId ? (
          <button
            className="tkw-tl"
            onClick={() => {
              const href = calendarHref(value);
              if (href) router.push(href);
            }}
            type="button"
          >
            {copy.contextLinkViewRes}
          </button>
        ) : null}
      </span>
      <span className="tkw-hint" style={{ fontSize: 12 }}>
        {copy.contextLinkFilledHint}
      </span>
    </span>
  );
}
