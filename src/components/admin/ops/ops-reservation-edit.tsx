"use client";

import { useState, useTransition } from "react";
import {
  submitReservationEdit,
  type ReservationEditResult,
} from "@/actions/ops-calendar";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { useRoomAvailability } from "@/components/admin/ops/use-room-availability";
import {
  isChannelBooking,
  diffBookingEdit,
  validateBookingEdit,
  type BookingEditChannel,
  type BookingEditDraft,
  type BookingEditError,
} from "@/lib/ops-booking-edit";
import { MAX_STAY_NIGHTS, stayNights } from "@/lib/ops-manual-booking";
import type { OpsReservationDetail } from "@/lib/ops-reservation-detail";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone-format";
import type { SpwCopy } from "@/components/admin/ops/ops-price-panel";
import "./ops-calendar-panels-white.css";

/**
 * 예약 수정 — 예약 상세 패널 안에서 **본문과 하단을 바꿔 끼운다.**
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 수정」
 * 규칙: `src/lib/ops-booking-edit.ts`
 *
 * - **채널 예약(Airbnb·Booking.com)은 날짜 칸이 없다** — 채널이 주인이라 여기서 바꾸면 어긋난다.
 *   이유를 그 자리에 적는다. **총액은 고친다** — 손님 청구액은 안 바뀌고 매출 기록만 바뀐다는
 *   것을 칸 아래에 적는다(2026-09-29 사용자 결정).
 * - 메모는 **내부 메모**다. 손님 요청 원문은 건드리지 않는다.
 * - 날짜 피커는 수동 예약과 같은 규칙으로 팔 수 없는 밤을 막되, **이 예약 자신의 밤은 비어 있는
 *   것으로** 본다. 묵고 있는 손님은 원래 체크인(과거)을 그대로 두고 체크아웃만 늘릴 수 있다.
 */

export type ReservationEditCopy = {
  reTitle: string;
  reSave: string;
  reDiscard: string;
  reNotesHint: string;
  reChannelDates: string;
  /** 채널 예약의 총액을 고칠 때 — 손님 청구액은 안 바뀐다. */
  reChannelPriceNote: string;
  reErrNoChanges: string;
  reErrCancelled: string;
  reErrNotApplied: string;
  mbGuest: string;
  mbEmail: string;
  mbPhone: string;
  mbAdults: string;
  mbChildren: string;
  mbCheckIn: string;
  mbCheckOut: string;
  mbNights: string;
  mbTotal: string;
  mbAvailHint: string;
  mbAvailFailed: string;
  mbErrNightsTaken: string;
  mbErrOccupied: string;
  mbErrNoActiveUnit: string;
  mbErrNoGuestName: string;
  mbErrBadDates: string;
  mbErrPastArrival: string;
  mbErrBadPrice: string;
  mbErrBadOccupancy: string;
  mbErrStayTooLong: string;
  rpNotes: string;
  rcPending: string;
  rcErrForbidden: string;
  rcErrNotFound: string;
  rcErrNoBookingId: string;
  rcErrBeds24: string;
  rcErrCooldown: string;
  datePrev: string;
  dateNext: string;
  dateThisMonth: string;
  dateReset: string;
  dateApply: string;
};

export const CHANNEL_NAME: Record<BookingEditChannel, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  manual: "Direct",
};

export function reservationEditErrorText(
  copy: ReservationEditCopy,
  error: BookingEditError | Extract<ReservationEditResult, { ok: false }>["error"],
  dates: string[] = [],
): string {
  const list = dates.map((date) => date.slice(5).replace("-", "/")).join(", ");
  switch (error) {
    case "no_changes":
      return copy.reErrNoChanges;
    case "no_guest_name":
      return copy.mbErrNoGuestName;
    case "bad_occupancy":
      return copy.mbErrBadOccupancy;
    case "bad_dates":
      return copy.mbErrBadDates;
    case "past_arrival":
      return copy.mbErrPastArrival;
    case "stay_too_long":
      return copy.mbErrStayTooLong.replace("{max}", String(MAX_STAY_NIGHTS));
    case "bad_price":
      return copy.mbErrBadPrice;
    case "occupied":
      return copy.mbErrOccupied.replace("{dates}", list);
    case "no_active_unit":
      return copy.mbErrNoActiveUnit.replace("{dates}", list);
    case "cancelled":
      return copy.reErrCancelled;
    case "not_applied":
      return copy.reErrNotApplied;
    case "forbidden":
      return copy.rcErrForbidden;
    case "not_found":
      return copy.rcErrNotFound;
    case "no_booking_id":
      return copy.rcErrNoBookingId;
    case "cooldown":
      return copy.rcErrCooldown;
    default:
      return copy.rcErrBeds24;
  }
}

export function OpsReservationEditForm({
  channel,
  copy,
  detail,
  localeTag,
  onDiscard,
  onSaved,
  reservationId,
  roomIds,
  roomKey,
  today,
}: {
  channel: BookingEditChannel;
  copy: ReservationEditCopy & SpwCopy & { rpGuests: string };
  detail: OpsReservationDetail;
  localeTag: string;
  onDiscard: () => void;
  onSaved: () => void;
  reservationId: string;
  roomIds: string[];
  roomKey: string;
  today: string;
}) {
  const original: BookingEditDraft = {
    arrival: detail.checkIn,
    departure: detail.checkOut,
    email: detail.email ?? "",
    guestName: detail.guestName,
    notes: detail.internalNotes ?? "",
    numAdult: detail.numAdult ?? 1,
    numChild: detail.numChild ?? 0,
    // 보이는 모양(하이픈)으로 시작한다 — 원래 값과 같은 기준으로 비교하니 손대지 않으면 안 보낸다.
    phone: detail.phone ? formatPhoneDisplay(detail.phone) : "",
    totalPrice: detail.price,
  };
  const [draft, setDraft] = useState<BookingEditDraft>(original);
  const [priceText, setPriceText] = useState(original.totalPrice === null ? "" : String(original.totalPrice));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const channelBooking = isChannelBooking(channel);

  const availability = useRoomAvailability({
    allowedStart: original.arrival < today ? original.arrival : undefined,
    excludeReservationId: reservationId,
    roomIds,
    roomKey,
    seedMonths: [original.arrival.slice(0, 7), original.departure.slice(0, 7)],
    today,
  });

  const set = <K extends keyof BookingEditDraft>(key: K, value: BookingEditDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const nights = stayNights(draft.arrival, draft.departure);
  const takenInStay = availability.takenIn(nights);
  const changes = diffBookingEdit(original, draft);
  const localError = validateBookingEdit({ changes, original, today });

  const save = () => {
    if (localError) {
      setMessage(reservationEditErrorText(copy, localError, []));
      return;
    }
    setMessage(copy.rcPending);
    startTransition(async () => {
      const result = await submitReservationEdit({ changes, reservationId, roomIds, roomKey });
      if (result.ok) {
        onSaved();
        return;
      }
      setMessage(reservationEditErrorText(copy, result.error, result.conflictDates));
    });
  };

  /** 총액 칸 표시 — 쉼표. 저장 값은 숫자만. */
  const priceDisplay = priceText === "" ? "" : Number(priceText).toLocaleString("ja-JP");

  const stepper = (label: string, value: number, min: number, key: "numAdult" | "numChild") => (
    <div className="spw-step">
      <span>{label}</span>
      <span className="spw-step__ctl">
        <button
          aria-label={copy.spwMinus.replace("{label}", label)}
          className="spw-step__btn"
          disabled={pending || value <= min}
          onClick={() => set(key, Math.max(min, value - 1))}
          type="button"
        >
          −
        </button>
        <b aria-live="polite" className="spw-step__v" key={value}>
          {value}
        </b>
        <button
          aria-label={copy.spwPlus.replace("{label}", label)}
          className="spw-step__btn"
          disabled={pending}
          onClick={() => set(key, value + 1)}
          type="button"
        >
          +
        </button>
      </span>
    </div>
  );

  return (
    <>
      <div className="spw-pbody">
        {/* ── 숙박 ── 모든 예약(2026-10-20 — 채널 예약 잠금을 풀었다). 채널 예약은 「Beds24 · 캘린더만 바뀌고 채널 예약 내용은 그대로」를 먼저 적는다(조기 퇴실로 남은 밤 열기). */}
        {channelBooking && (
          <p className="spw-info">{copy.reChannelDates.replaceAll("{channel}", CHANNEL_NAME[channel])}</p>
        )}
        <div className="spw-group">
          <span className="spw-label">
            {copy.mbCheckIn} → {copy.mbCheckOut}
          </span>
          <AdminDateRangePicker
            ariaLabel={`${copy.mbCheckIn} → ${copy.mbCheckOut}`}
            from={draft.arrival}
            isDateDisabled={availability.isDateDisabled}
            labels={{
              apply: copy.dateApply,
              nextMonth: copy.dateNext,
              prevMonth: copy.datePrev,
              reset: copy.dateReset,
              thisMonth: copy.dateThisMonth,
            }}
            localeTag={localeTag}
            onChange={(from, to) => {
              set("arrival", from);
              set("departure", to > from ? to : draft.departure);
            }}
            onMonthChange={availability.loadMonths}
            to={draft.departure}
          />
          <p className="spw-note">
            {copy.mbNights.replace("{n}", String(nights.length))}
            {takenInStay.length > 0 && (
              <span className="spw-note__danger">
                {" "}
                {copy.mbErrNightsTaken.replace(
                  "{dates}",
                  takenInStay.map((night) => night.slice(5).replace("-", "/")).join(", "),
                )}
              </span>
            )}
          </p>
          <p className="spw-note">{availability.failed ? copy.mbAvailFailed : copy.mbAvailHint}</p>
        </div>

        <div className="spw-field">
          <label className="spw-field__l" htmlFor="opsre-guest">
            {copy.mbGuest}
          </label>
          <input
            className="spw-field__in"
            id="opsre-guest"
            onChange={(event) => set("guestName", event.target.value)}
            type="text"
            value={draft.guestName}
          />
        </div>
        <div className="spw-field">
          <label className="spw-field__l" htmlFor="opsre-email">
            {copy.mbEmail}
          </label>
          <input
            className="spw-field__in"
            id="opsre-email"
            onChange={(event) => set("email", event.target.value)}
            type="email"
            value={draft.email}
          />
        </div>
        <div className="spw-field">
          <label className="spw-field__l" htmlFor="opsre-phone">
            {copy.mbPhone}
          </label>
          {/* 치는 대로 하이픈. 손대지 않으면 받은 값 그대로 남는다(바뀐 것만 보낸다). */}
          <input
            className="spw-field__in is-mono"
            id="opsre-phone"
            inputMode="tel"
            onChange={(event) => set("phone", formatPhoneInput(event.target.value))}
            type="tel"
            value={draft.phone}
          />
        </div>

        <section className="spw-sect">
          <span className="spw-sec">{copy.rpGuests}</span>
          {stepper(copy.mbAdults, draft.numAdult, 1, "numAdult")}
          {stepper(copy.mbChildren, draft.numChild, 0, "numChild")}
        </section>

        {/* ── 총액 ── 모든 예약. 채널 예약은 「손님 청구액은 안 바뀐다」를 적는다. */}
        <div className="spw-field">
          <label className="spw-field__l" htmlFor="opsre-total">
            {copy.mbTotal}
          </label>
          <input
            autoComplete="off"
            className="spw-field__in is-mono"
            id="opsre-total"
            inputMode="numeric"
            onChange={(event) => {
              const digits = event.target.value.replace(/[^\d]/g, "");
              setPriceText(digits);
              set("totalPrice", digits === "" ? null : Number(digits));
            }}
            type="text"
            value={priceDisplay}
          />
          {channelBooking && (
            <span className="spw-field__hint is-warn">
              {copy.reChannelPriceNote.replaceAll("{channel}", CHANNEL_NAME[channel])}
            </span>
          )}
        </div>

        <div className="spw-field">
          <label className="spw-field__l" htmlFor="opsre-notes">
            {copy.rpNotes}
          </label>
          <textarea
            className="spw-field__area"
            id="opsre-notes"
            onChange={(event) => set("notes", event.target.value)}
            rows={2}
            value={draft.notes}
          />
          <span className="spw-field__hint">{copy.reNotesHint}</span>
        </div>

        {message && (
          <p className="spw-msg is-err" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="spw-foot is-panel">
        <button className="spw-btn" disabled={pending} onClick={onDiscard} type="button">
          {copy.reDiscard}
        </button>
        <button
          className="spw-btn is-primary"
          disabled={pending || localError === "no_changes" || takenInStay.length > 0}
          onClick={save}
          type="button"
        >
          {copy.reSave}
        </button>
      </div>
    </>
  );
}
