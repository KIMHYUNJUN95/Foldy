"use client";

// 예약 옮기기 — 예약 상세 패널의 「객실 옮기기」(2026-10-19 사용자 확정 · 시안 SalesMovePick-PC · SalesMoveManualPick-PC).
// 같은 건물 줄마다 그 날짜에 옮길 수 있는가를 보여 주고, 고르면 서버(`submitReservationMove`)가 다시 확인해 Beds24 에서
// **같은 예약**을 옮긴다. 채널 예약은 날짜 고정, 직접 · 수기는 체크인을 옮길 수 있다(박수 · 금액 그대로).
// 끌어서 옮기기(격자)도 같은 서버 동작과 같은 문구(`reservationMoveErrorText`)를 쓴다.
import { useEffect, useMemo, useState, useTransition } from "react";
import { Check } from "lucide-react";
import {
  loadReservationMoveTargets,
  submitReservationMove,
  type ReservationMoveResult,
  type ReservationMoveTarget,
} from "@/actions/ops-calendar";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { MAX_STAY_NIGHTS, stayNights } from "@/lib/ops-manual-booking";
import type { OpsCalendarBar } from "@/lib/ops-calendar";

export type ReservationMoveCopy = {
  mvButton: string;
  mvTitleManual: string;
  mvChannelNote: string;
  mvManualNote: string;
  mvKeepDates: string;
  mvCurrent: string;
  mvFree: string;
  mvBooked: string;
  mvBookedNoName: string;
  mvUnsellable: string;
  mvChecking: string;
  mvKeep: string;
  mvSubmit: string;
  mvPick: string;
  mvPending: string;
  mvDone: string;
  mvUndo: string;
  mvUndone: string;
  mvErrOtherBuilding: string;
  mvErrSamePlace: string;
  mvErrPastStay: string;
  mvErrLoad: string;
  mvConfirmTitle: string;
  mvNow: string;
  mvTo: string;
  mvConfirmNote: string;
  /** 채널 예약의 날짜를 옮길 때(2026-10-20) — 채널 예약 내용은 그대로라는 사실을 적는다. */
  mvConfirmNoteChannelDates: string;
  mvConfirmNoteManual: string;
  mvHoldHint: string;
  mvDragging: string;
  mvDragChannel: string;
  mvDragManual: string;
  mvDragBlocked: string;
  mvDragEsc: string;
  // 기존 문구 재사용
  mbCheckIn: string;
  mbCheckOut: string;
  mbErrOccupied: string;
  mbErrNoActiveUnit: string;
  mbErrUnitChanges: string;
  mbErrRoomBusy: string;
  mbErrPastArrival: string;
  mbErrBadDates: string;
  mbErrStayTooLong: string;
  reChannelDates: string;
  reErrNotApplied: string;
  reErrCancelled: string;
  rcErrForbidden: string;
  rcErrNotFound: string;
  rcErrNoBookingId: string;
  rcErrCooldown: string;
  rcErrBeds24: string;
  dateApply: string;
  dateNext: string;
  datePrev: string;
  dateReset: string;
  dateThisMonth: string;
};

/** 같은 건물의 한 줄 — 격자가 넘긴다. */
export type MoveRoom = { roomKey: string; roomIds: string[]; label: string };

/** 끝난 옮기기 — 격자가 토스트 · 되돌리기에 쓴다(되돌리기 = 원래 줄 · 날짜로 다시 옮기기). */
export type MovedReservation = {
  reservationId: string;
  guestName: string;
  from: { room: MoveRoom; arrival: string; departure: string };
  to: { room: MoveRoom; arrival: string; departure: string };
};

const CHANNEL_NAME: Record<string, string> = { airbnb: "Airbnb", booking: "Booking.com", manual: "", other: "" };

/** 채널 이름(「Airbnb」 · 「Booking.com」) — 끌어 옮기기 확인 상자도 쓴다. 없으면 받은 값 그대로. */
export function channelDisplayName(channel: string): string {
  return CHANNEL_NAME[channel] || channel;
}

export function reservationMoveErrorText(
  copy: ReservationMoveCopy,
  result: Extract<ReservationMoveResult, { ok: false }>,
): string {
  const list = (result.conflictDates ?? []).map((date) => date.slice(5).replace("-", "/")).join(", ");
  switch (result.error) {
    case "same_place":
      return copy.mvErrSamePlace;
    case "other_building":
      return copy.mvErrOtherBuilding;
    case "past_stay":
      return copy.mvErrPastStay;
    case "past_arrival":
      return copy.mbErrPastArrival;
    case "bad_dates":
      return copy.mbErrBadDates;
    case "stay_too_long":
      return copy.mbErrStayTooLong.replace("{max}", String(MAX_STAY_NIGHTS));
    case "occupied":
      return copy.mbErrOccupied.replace("{dates}", list);
    case "no_active_unit":
      return copy.mbErrNoActiveUnit.replace("{dates}", list);
    case "unit_changes":
      return copy.mbErrUnitChanges.replace("{dates}", list);
    case "room_busy":
      return copy.mbErrRoomBusy;
    case "not_applied":
      return copy.reErrNotApplied;
    case "cancelled":
      return copy.reErrCancelled;
    case "forbidden":
      return copy.rcErrForbidden;
    case "not_found":
    case "unknown_room":
      return copy.rcErrNotFound;
    case "no_booking_id":
      return copy.rcErrNoBookingId;
    case "cooldown":
      return copy.rcErrCooldown;
    default:
      return copy.rcErrBeds24;
  }
}

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

const shortDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export function OpsReservationMoveForm({
  bar,
  copy,
  currentRoom,
  localeTag,
  onDiscard,
  onMoved,
  rooms,
}: {
  bar: OpsCalendarBar;
  copy: ReservationMoveCopy;
  currentRoom: MoveRoom;
  localeTag: string;
  onDiscard: () => void;
  onMoved: (moved: MovedReservation) => void;
  /** 같은 건물의 줄 전부(지금 줄 포함). */
  rooms: MoveRoom[];
}) {
  const channelName = CHANNEL_NAME[bar.channel] || bar.channel;
  const nights = stayNights(bar.checkIn, bar.checkOut).length;
  const [arrival, setArrival] = useState(bar.checkIn);
  const departure = addDays(arrival, nights);
  const datesChanged = arrival !== bar.checkIn;
  const [targets, setTargets] = useState<Map<string, ReservationMoveTarget> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 날짜가 바뀌면 후보를 다시 읽는다. 날짜를 옮기면 지금 줄도 「다른 날짜의 후보」라 지금 객실로 묶지 않는다.
  useEffect(() => {
    let alive = true;
    void loadReservationMoveTargets({
      arrival,
      currentRoomKey: datesChanged ? "" : currentRoom.roomKey,
      departure,
      reservationId: bar.id,
      rows: rooms.map((room) => ({ roomIds: room.roomIds, roomKey: room.roomKey })),
    }).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setTargets(new Map(result.targets.map((target) => [target.roomKey, target])));
        setLoadFailed(false);
      } else {
        setTargets(new Map());
        setLoadFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [arrival, departure, datesChanged, bar.id, currentRoom.roomKey, rooms]);

  const pickedRoom = useMemo(() => rooms.find((room) => room.roomKey === picked) ?? null, [rooms, picked]);
  // 날짜가 바뀌어 고른 줄이 더는 비어 있지 않으면 고른 것을 푼다(그리는 동안 판단 — effect 로 상태를 다시 쓰지 않는다).
  const pickedOk = !!pickedRoom && targets?.get(pickedRoom.roomKey)?.state === "free";

  const submit = () => {
    if (!pickedRoom || !pickedOk) return;
    setMessage(copy.mvPending);
    startTransition(async () => {
      const result = await submitReservationMove({
        arrival,
        departure,
        reservationId: bar.id,
        targetRoomIds: pickedRoom.roomIds,
        targetRoomKey: pickedRoom.roomKey,
      });
      if (result.ok) {
        onMoved({
          from: { arrival: bar.checkIn, departure: bar.checkOut, room: currentRoom },
          guestName: bar.guestName,
          reservationId: bar.id,
          to: { arrival, departure, room: pickedRoom },
        });
        return;
      }
      setMessage(reservationMoveErrorText(copy, result));
    });
  };

  const stateText = (target: ReservationMoveTarget | undefined) => {
    if (!target) return copy.mvChecking;
    if (target.state === "current") return copy.mvCurrent;
    if (target.state === "free") return copy.mvFree;
    if (target.state === "unsellable") return copy.mvUnsellable;
    return target.clashGuest ? copy.mvBooked.replace("{guest}", target.clashGuest) : copy.mvBookedNoName;
  };

  return (
    <>
      <div className="spw-pbody">
        {/* 날짜는 모든 예약이 옮긴다(2026-10-20 — 채널 예약 잠금을 풀었다). 채널 예약은 「채널 예약 내용은 그대로」. */}
        <div className="spw-group">
          <span className="spw-label">
            {copy.mbCheckIn} → {copy.mbCheckOut}
          </span>
          <AdminDateRangePicker
            ariaLabel={`${copy.mbCheckIn} → ${copy.mbCheckOut}`}
            from={arrival}
            labels={{
              apply: copy.dateApply,
              nextMonth: copy.dateNext,
              prevMonth: copy.datePrev,
              reset: copy.dateReset,
              thisMonth: copy.dateThisMonth,
            }}
            localeTag={localeTag}
            // 박수는 그대로 — 고른 첫날을 체크인으로, 체크아웃은 같은 박수만큼 뒤.
            onChange={(from) => {
              setArrival(from);
              setMessage(null);
            }}
            to={departure}
          />
          <p className="spw-info">
            {bar.channel === "manual" ? copy.mvManualNote : copy.mvChannelNote.replaceAll("{channel}", channelName)}
          </p>
        </div>
        <p className="spw-note">
          {copy.mvKeepDates
            .replace("{in}", shortDay(arrival))
            .replace("{out}", shortDay(departure))
            .replace("{n}", String(nights))}
        </p>

        <section className="spw-sect">
          <span className="spw-sec">{copy.mvPick}</span>
          <div aria-label={copy.mvPick} className="spw-move" role="radiogroup">
            {rooms.map((room) => {
              const target = targets?.get(room.roomKey);
              const free = target?.state === "free";
              const on = picked === room.roomKey && free;
              return free ? (
                <button
                  aria-checked={on}
                  className={`spw-move__row is-free${on ? " on" : ""}`}
                  disabled={pending}
                  key={room.roomKey}
                  onClick={() => {
                    setPicked(room.roomKey);
                    setMessage(null);
                  }}
                  role="radio"
                  type="button"
                >
                  <b>{room.label}</b>
                  <span>{stateText(target)}</span>
                  {on && <Check aria-hidden className="spw-move__ck" />}
                </button>
              ) : (
                <div aria-disabled="true" className="spw-move__row" key={room.roomKey}>
                  <b>{room.label}</b>
                  <span>{stateText(target)}</span>
                </div>
              );
            })}
          </div>
          {loadFailed && <p className="spw-msg is-err">{copy.mvErrLoad}</p>}
        </section>

        {message && (
          <p className={`spw-msg${message === copy.mvPending ? "" : " is-err"}`} role="status">
            {message}
          </p>
        )}
      </div>
      <div className="spw-foot is-panel is-even">
        <button className="spw-btn" disabled={pending} onClick={onDiscard} type="button">
          {copy.mvKeep}
        </button>
        <button className="spw-btn is-primary" disabled={pending || !pickedOk} onClick={submit} type="button">
          {pickedRoom ? copy.mvSubmit.replace("{room}", pickedRoom.label) : copy.mvPick}
        </button>
      </div>
    </>
  );
}
