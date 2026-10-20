"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  OpsReservationMoveForm,
  type MovedReservation,
  type MoveRoom,
  type ReservationMoveCopy,
} from "@/components/admin/ops/ops-reservation-move";
import { Check, Copy, X } from "lucide-react";
import {
  loadReservationDetail,
  submitReservationCancel,
  type CancelReservationResult,
} from "@/app/admin/ops/calendar/actions";
import { useRouter } from "next/navigation";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import {
  OpsReservationEditForm,
  type ReservationEditCopy,
} from "@/components/admin/ops/ops-reservation-edit";
import type { OpsCalendarBar } from "@/lib/ops-calendar";
import type { OpsReservationDetail } from "@/lib/ops-reservation-detail";
import { formatPhoneDisplay } from "@/lib/phone-format";
import { spwDate, type SpwCopy } from "@/components/admin/ops/ops-price-panel";
import "./ops-calendar-panels-white.css";

/**
 * 예약 상세 — 막대를 누르면 **오른쪽 사이드 패널**로 뜬다. **취소는 여기서만** 한다.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 상세」 · 「예약 취소」
 * 원본: `BuildingCalendar.jsx` 의 `ReservationDetailModal` + `window.confirm`
 *
 * ## 가져올 수 있는 것은 전부 보여준다 (2026-09-28)
 *
 * 처음에는 객실·채널·날짜 세 줄뿐인 가운데 카드였다. 콘솔의 상세는 전부 공용 `.panel` 이고,
 * 무엇보다 **손님에게 연락하거나 채널과 이야기하려면** 연락처·채널 예약번호·요청 사항이
 * 필요하다(사용자 지적). 막대를 누르면 그 한 건만 서버에서 읽어(`loadReservationDetail`)
 * 손님 · 금액 · 메시지 · 예약 이력을 섹션으로 나눠 보여준다. **빈 값은 줄째 숨긴다.**
 *
 * 머리글(손님·방·날짜·채널)은 격자가 이미 들고 있으므로 **읽기를 기다리지 않고** 바로 그린다.
 *
 * ## 되돌릴 수 없다
 *
 * 취소는 **채널에도 그대로 나가고**, Beds24 에서 다시 `confirmed` 로 돌려도 손님에게 간
 * 취소 통지는 취소되지 않는다. 저쪽은 `window.confirm` 으로 한 번 물었다. 우리도 한 번 묻되
 * **무엇이 취소되는지**(손님·날짜)를 그 자리에 적는다 — 브라우저 기본 창에는 그게 안 들어간다.
 *
 * ## 사유는 선택이다
 *
 * 저쪽은 사유를 아예 안 받는다. 우리는 받되 **비워도 된다** — 필수로 만들면 급할 때
 * 아무 글자나 넣게 되고, 그러면 사유 칸이 쓸모없어진다. 적으면 Beds24 주석에 남는다.
 *
 * ## 이미 취소된 예약에는 버튼이 없다
 *
 * 다시 눌러 봐야 주석만 덧씌워진다. 「취소만 보기」에서 열면 상세만 보인다.
 */

export type ReservationCardCopy = ReservationEditCopy & ReservationMoveCopy & {
  reEdit: string;
  reSaved: string;
  rcTitle: string;
  rcNights: string;
  rcChannel: string;
  rcCancelled: string;
  rcCancel: string;
  rcCancelConfirm: string;
  rcCancelWarning: string;
  rcReason: string;
  rcReasonPlaceholder: string;
  rcKeep: string;
  rcClose: string;
  rcPending: string;
  rcDone: string;
  rcErrForbidden: string;
  rcErrNotFound: string;
  rcErrAlreadyCancelled: string;
  rcErrNoBookingId: string;
  rcErrBeds24: string;
  rcErrCooldown: string;
  rcErrNotApplied: string;
  rpTitle: string;
  rpLoading: string;
  rpLoadFailed: string;
  rpSectionStay: string;
  rpCheckIn: string;
  rpCheckOut: string;
  rpArrivalTime: string;
  rpLeadTime: string;
  rpGuests: string;
  rpGuestsValue: string;
  rpSectionMoney: string;
  rpTotal: string;
  rpCommission: string;
  rpNet: string;
  rpPerNight: string;
  rpRate: string;
  rpMoneyCancelled: string;
  rpSectionGuest: string;
  rpEmail: string;
  rpPhone: string;
  rpMobile: string;
  rpCountry: string;
  rpCountryFromPhone: string;
  rpLanguage: string;
  rpAddress: string;
  rpSectionMessages: string;
  rpComments: string;
  rpNotes: string;
  rpChannelMessage: string;
  rpSectionBooking: string;
  rpChannelRef: string;
  rpBeds24Id: string;
  rpGroup: string;
  rpFlag: string;
  rpBookedAt: string;
  rpModifiedAt: string;
  rpCancelledAt: string;
  rpCopy: string;
  rpCopied: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  manual: "Direct",
};

export function reservationCancelErrorText(copy: ReservationCardCopy, result: Extract<CancelReservationResult, { ok: false }>) {
  switch (result.error) {
    case "forbidden":
      return copy.rcErrForbidden;
    case "not_found":
      return copy.rcErrNotFound;
    case "already_cancelled":
      return copy.rcErrAlreadyCancelled;
    case "no_booking_id":
      return copy.rcErrNoBookingId;
    case "cooldown":
      return copy.rcErrCooldown;
    case "not_applied":
      return copy.rcErrNotApplied;
    default:
      return copy.rcErrBeds24;
  }
}

/** ISO 시각(UTC) → 도쿄 시각. Beds24 는 UTC 로 준다 — 그대로 보이면 9시간 틀린다. */
function stamp(iso: string, localeTag: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  // 「9/24 (수) 21:14」 — 시안 SalesResv-PC. 연도가 다르면 앞에 붙인다.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(at);
  const thisYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric" }).format(new Date());
  return `${day.slice(0, 4) === thisYear ? "" : `${day.slice(0, 4)}/`}${spwDate(day, localeTag)} ${time}`;
}

/** 도쿄 날짜 사이의 일수. 예약이 체크인 며칠 전에 들어왔는가. */
function daysBetween(fromIso: string, toDate: string): number | null {
  const booked = new Date(fromIso);
  if (Number.isNaN(booked.getTime())) return null;
  const bookedDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(booked);
  const diff = Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${bookedDay}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.round(diff / 86_400_000) : null;
}

function regionName(code: string, localeTag: string): string {
  try {
    return new Intl.DisplayNames([localeTag], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function languageName(code: string, localeTag: string): string {
  try {
    return new Intl.DisplayNames([localeTag], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const money = (value: number) => `¥${Math.round(value).toLocaleString()}`;

export function OpsReservationPanel({
  bar,
  canWrite = true,
  copy,
  localeTag,
  moveRooms,
  nights,
  onClose,
  onMoved,
  propertyName,
  roomIds,
  roomKey,
  roomLabel,
  today,
}: {
  bar: OpsCalendarBar;
  /** 판매 캘린더를 바꿀 수 있나(`ops_calendar.write`) — 없으면 수정 · 옮기기 · 취소 없이 닫기만(서버도 막는다). */
  canWrite?: boolean;
  copy: ReservationCardCopy & SpwCopy;
  localeTag: string;
  /** 같은 건물의 줄 전부 — 「객실 옮기기」 후보. 비면 버튼을 숨긴다. */
  moveRooms?: MoveRoom[];
  nights: number;
  onClose: () => void;
  /** 옮긴 뒤 — 격자가 토스트 · 되돌리기를 띄운다. */
  onMoved?: (moved: MovedReservation) => void;
  propertyName: string;
  /** 예약 수정의 겹침 검사가 쓴다 — 그 행의 우리 `rooms.id`. */
  roomIds: string[];
  roomKey: string;
  roomLabel: string;
  today: string;
}) {
  const router = useRouter();
  /** 보기 / 고치기. 고치는 동안은 본문·하단을 편집 폼이 차지한다. */
  const [editing, setEditing] = useState(false);
  /** 객실 옮기기(2026-10-19). 옮기는 동안은 본문 · 하단을 옮기기 폼이 차지한다. */
  const [moving, setMoving] = useState(false);
  /** 고친 뒤 상세를 다시 읽게 하는 신호. */
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [detail, setDetail] = useState<OpsReservationDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const cancelBoxRef = useRef<HTMLDivElement | null>(null);

  // 취소 확인은 가운데 창이다(시안 SalesResvCancel-PC). 뜨면 사유 칸에 바로 쓸 수 있게 초점을 옮긴다.
  useEffect(() => {
    if (confirming) cancelBoxRef.current?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true });
  }, [confirming]);
  // Esc · 포커스 · 스크롤 잠금은 콘솔 패널 공용 훅이 한다. 취소를 보내는 중 · 확인 창이 떠 있는 동안은
  // 패널을 닫지 않는다(확인 창의 Esc 는 창만 닫는다).
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: pending || editing || moving || confirming });

  // 누른 한 건만 읽는다. 머리글은 격자 값으로 먼저 그려 두었으므로 기다리는 동안도 비지 않는다.
  useEffect(() => {
    let alive = true;
    void loadReservationDetail(bar.id).then((result) => {
      if (!alive) return;
      if (result.ok) setDetail(result.detail);
      else setLoadFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [bar.id, reloadKey]);

  const cancel = () => {
    setMessage(copy.rcPending);
    startTransition(async () => {
      const result = await submitReservationCancel({ reason, reservationId: bar.id });
      if (result.ok) {
        setMessage(copy.rcDone);
        onClose();
        return;
      }
      setMessage(reservationCancelErrorText(copy, result));
      setConfirming(false);
    });
  };

  const copyValue = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    });
  };

  /** 값이 있는 줄만. 복사가 필요한 값(연락처·번호)에는 복사 버튼을 붙인다. */
  const row = (key: string, label: string, value: ReactNode, copyText?: string | null, mono = false) =>
    value === null || value === undefined || value === "" ? null : (
      <div key={key}>
        <dt>{label}</dt>
        <dd>
          <span className={mono ? "spw-mono" : undefined}>{value}</span>
          {copyText && (
            <button
              aria-label={`${copy.rpCopy} ${label}`}
              className={`spw-copy${copied === key ? " on" : ""}`}
              onClick={() => copyValue(key, copyText)}
              title={copied === key ? copy.rpCopied : copy.rpCopy}
              type="button"
            >
              {copied === key ? <Check aria-hidden /> : <Copy aria-hidden />}
            </button>
          )}
        </dd>
      </div>
    );

  const channelName = detail?.channelName ?? CHANNEL_LABEL[bar.channel] ?? bar.channel;
  const guestCount =
    detail && detail.numAdult !== null
      ? copy.rpGuestsValue
          .replace("{adults}", String(detail.numAdult))
          .replace("{children}", String(detail.numChild ?? 0))
      : null;
  const net =
    detail && detail.price !== null && detail.commission !== null
      ? detail.price - detail.commission
      : null;
  const leadDays = detail?.bookedAt ? daysBetween(detail.bookedAt, bar.checkIn) : null;
  const nightsText = copy.rcNights.replace("{n}", String(nights));
  const shortDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

  return (
    <>
      <div className="panel-scrim" onClick={pending || confirming ? undefined : onClose} />
      <aside
        aria-label={copy.rpTitle}
        aria-modal="true"
        className="panel spw-panel"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="spw-phead">
          {moving ? (
            <div className="spw-head">
              <span className="spw-head__k">
                <i aria-hidden="true" className={`spw-dot is-${bar.channel}`} />
                {channelName} · {propertyName} · {roomLabel}
              </span>
              <b className="spw-head__t">
                {copy.mvTitleManual.replace("{guest}", bar.guestName)}
              </b>
            </div>
          ) : editing && detail ? (
            <div className="spw-head">
              <span className="spw-head__k">{copy.spwReKicker.replace("{channel}", channelName)}</span>
              <b className="spw-head__t">{bar.guestName}</b>
              <span className="spw-head__s">{copy.spwReSub}</span>
            </div>
          ) : (
            <div className="spw-head">
              <span className="spw-head__k">
                <i aria-hidden="true" className={`spw-dot is-${bar.channel}`} />
                {channelName} · {propertyName} · {roomLabel}
              </span>
              <b className="spw-head__t">{bar.guestName}</b>
              <span className="spw-head__s">
                {bar.isCancelled && <span className="spw-tag">{copy.rcCancelled}</span>}
                {[nightsText, guestCount].filter(Boolean).join(" · ")}
              </span>
            </div>
          )}
          <button aria-label={copy.rcClose} className="spw-x" disabled={pending} onClick={onClose} type="button">
            <X aria-hidden="true" />
          </button>
        </div>

        {moving && moveRooms && onMoved ? (
          <OpsReservationMoveForm
            bar={bar}
            copy={copy}
            currentRoom={moveRooms.find((room) => room.roomKey === roomKey) ?? { label: roomLabel, roomIds, roomKey }}
            localeTag={localeTag}
            onDiscard={() => setMoving(false)}
            onMoved={onMoved}
            rooms={moveRooms}
          />
        ) : editing && detail ? (
          <OpsReservationEditForm
            channel={bar.channel}
            copy={copy}
            detail={detail}
            localeTag={localeTag}
            onDiscard={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              setMessage(copy.reSaved);
              // 상세는 다시 읽고, 격자(막대 이름·날짜)는 서버 데이터만 다시 받는다.
              setReloadKey((key) => key + 1);
              router.refresh();
            }}
            reservationId={bar.id}
            roomIds={roomIds}
            roomKey={roomKey}
            today={today}
          />
        ) : (
        <>
        <div className="spw-pbody">
          {/* ── 숙박 ── 격자 값만으로 그린다. 읽기를 기다리지 않는다. */}
          <section className="spw-sect">
            <span className="spw-sec">{copy.rpSectionStay}</span>
            <div className="spw-stay is-line">
              <div>
                <b>{spwDate(bar.checkIn, localeTag)}</b>
                <span>
                  {detail?.arrivalTime
                    ? copy.spwArrival.replace("{label}", copy.rpCheckIn).replace("{time}", detail.arrivalTime)
                    : copy.rpCheckIn}
                </span>
              </div>
              <span className="spw-stay__n">
                <span>{nightsText}</span>
              </span>
              <div className="is-end">
                <b>{spwDate(bar.checkOut, localeTag)}</b>
                <span>{copy.rpCheckOut}</span>
              </div>
            </div>
            {/* 며칠 전에 잡았나 — 막판 예약인지가 가격 판단에 바로 걸린다. */}
            {leadDays !== null && leadDays >= 0 && (
              <p className="spw-note">{copy.rpLeadTime.replace("{n}", String(leadDays))}</p>
            )}
          </section>

          {!detail && !loadFailed && (
            <div aria-busy className="spw-loading">
              <span aria-hidden className="spw-spin" />
              {copy.rpLoading}
            </div>
          )}
          {loadFailed && <p className="spw-msg is-err">{copy.rpLoadFailed}</p>}

          {detail && (
            <>
              {/* ── 금액 ── */}
              {(detail.price !== null || detail.rateDescription) && (
                <section className="spw-sect">
                  <span className="spw-sec">{copy.rpSectionMoney}</span>
                  {detail.price !== null && (
                    <dl className="spw-kv">
                      {row("total", copy.rpTotal, <b>{money(detail.price)}</b>)}
                      {row("commission", copy.rpCommission, detail.commission !== null ? money(detail.commission) : null)}
                      {row("net", copy.rpNet, net !== null ? money(net) : null)}
                      {row("per", copy.rpPerNight, nights > 0 && detail.price > 0 ? money(detail.price / nights) : null)}
                    </dl>
                  )}
                  {/* 취소되면 Beds24 가 금액을 0 으로 바꾼다 — 0원 매출로 오해하지 않게 적는다. */}
                  {bar.isCancelled && detail.price === 0 && <p className="spw-note">{copy.rpMoneyCancelled}</p>}
                  {detail.rateDescription && (
                    <details className="spw-more">
                      <summary>{copy.rpRate}</summary>
                      <p className="spw-pre">{detail.rateDescription}</p>
                    </details>
                  )}
                </section>
              )}

              {/* ── 손님 ── 전화는 하이픈으로 끊어 보이고, 복사는 받은 값 그대로. */}
              <section className="spw-sect">
                <span className="spw-sec">{copy.rpSectionGuest}</span>
                <dl className="spw-kv">
                  {row("email", copy.rpEmail, detail.email, detail.email)}
                  {row("phone", copy.rpPhone, detail.phone ? formatPhoneDisplay(detail.phone) : null, detail.phone)}
                  {row("mobile", copy.rpMobile, detail.mobile ? formatPhoneDisplay(detail.mobile) : null, detail.mobile)}
                  {row(
                    "country",
                    copy.rpCountry,
                    detail.countryCode ? (
                      <>
                        {regionName(detail.countryCode, localeTag)}
                        {/* 채널이 안 준 국가는 전화번호로 추정한 것이다 — 국적과 다를 수 있다. */}
                        {detail.countrySource === "phone" && (
                          <span className="spw-muted"> · {copy.rpCountryFromPhone}</span>
                        )}
                      </>
                    ) : (
                      detail.countryText
                    ),
                  )}
                  {row("lang", copy.rpLanguage, detail.language ? languageName(detail.language, localeTag) : null)}
                  {row("address", copy.rpAddress, detail.address, detail.address)}
                </dl>
              </section>

              {/* ── 메시지 ── 손님 요청이 제일 자주 쓰이므로 펼쳐 두고 채널 메시지는 접는다. */}
              {(detail.guestComments || detail.internalNotes || detail.channelMessage) && (
                <section className="spw-sect">
                  <span className="spw-sec">{copy.rpSectionMessages}</span>
                  {detail.guestComments && (
                    <div className="spw-msgbox">
                      {(detail.internalNotes || detail.channelMessage) && (
                        <span className="spw-msgbox__l">{copy.rpComments}</span>
                      )}
                      <p className="spw-pre">{detail.guestComments}</p>
                    </div>
                  )}
                  {detail.internalNotes && (
                    <div className="spw-msgbox">
                      <span className="spw-msgbox__l">{copy.rpNotes}</span>
                      <p className="spw-pre">{detail.internalNotes}</p>
                    </div>
                  )}
                  {detail.channelMessage && (
                    <details className="spw-more">
                      <summary>{copy.rpChannelMessage}</summary>
                      <p className="spw-pre">{detail.channelMessage}</p>
                    </details>
                  )}
                </section>
              )}

              {/* ── 예약 ── 채널·Beds24 와 이야기할 때 쓰는 번호들. */}
              <section className="spw-sect">
                <span className="spw-sec">{copy.rpSectionBooking}</span>
                <dl className="spw-kv">
                  {row("chan", copy.rcChannel, channelName)}
                  {row("ref", copy.rpChannelRef, detail.channelReference, detail.channelReference, true)}
                  {row("b24", copy.rpBeds24Id, detail.beds24Id, detail.beds24Id, true)}
                  {row("group", copy.rpGroup, detail.groupMasterId, null, true)}
                  {row("flag", copy.rpFlag, detail.flagText)}
                  {row("booked", copy.rpBookedAt, detail.bookedAt ? stamp(detail.bookedAt, localeTag) : null)}
                  {row(
                    "modified",
                    copy.rpModifiedAt,
                    detail.modifiedAt && detail.modifiedAt !== detail.bookedAt
                      ? stamp(detail.modifiedAt, localeTag)
                      : null,
                  )}
                  {row(
                    "cancelled",
                    copy.rpCancelledAt,
                    detail.cancelledAt ? stamp(detail.cancelledAt, localeTag) : null,
                  )}
                </dl>
              </section>
            </>
          )}

          {message && (
            <p className={`spw-msg${message === copy.reSaved ? " is-ok" : " is-err"}`} role="status">
              {message}
            </p>
          )}
        </div>

        <div className="spw-foot is-panel is-even">
          {/* 취소된 예약은 고치지도, 다시 취소하지도 않는다 — 닫기만. 바꾸기 권한이 없어도 닫기만(2026-10-20). */}
          {bar.isCancelled || !canWrite ? (
            <button className="spw-btn is-wide" onClick={onClose} type="button">
              {copy.rcClose}
            </button>
          ) : (
            <>
              <button
                className="spw-btn is-soft"
                // 원래 값이 있어야 무엇이 바뀌었는지 안다 — 상세를 읽은 뒤에만.
                disabled={!detail}
                onClick={() => {
                  setMessage(null);
                  setEditing(true);
                }}
                type="button"
              >
                {/* 「예약 수정」 — 시안 SalesResv-PC. 짧은 「수정」(reEdit)은 모바일 시트가 쓴다. */}
                {copy.reTitle}
              </button>
              {moveRooms && moveRooms.length > 1 && onMoved && (
                <button
                  className="spw-btn is-primary"
                  onClick={() => {
                    setMessage(null);
                    setMoving(true);
                  }}
                  type="button"
                >
                  {copy.mvButton}
                </button>
              )}
              <button className="spw-btn is-soft-danger" onClick={() => setConfirming(true)} type="button">
                {copy.rcCancel}
              </button>
            </>
          )}
        </div>
        </>
        )}

        {/* 무엇이 취소되는지 그 자리에 적는다 — 브라우저 기본 확인창에는 안 들어간다(시안 SalesResvCancel-PC). */}
        {confirming && (
          <div className="spw-modal">
            <div className="spw-modal__scrim" onClick={pending ? undefined : () => setConfirming(false)} />
            <div
              aria-label={copy.spwRcConfirmTitle}
              className="spw-modal__card"
              onKeyDown={(event) => {
                if (event.key === "Escape" && !pending) {
                  event.stopPropagation();
                  setConfirming(false);
                }
              }}
              ref={cancelBoxRef}
              role="alertdialog"
            >
              <b className="spw-modal__t">{copy.spwRcConfirmTitle}</b>
              <dl className="spw-kv is-box">
                <div>
                  <dt>{copy.rpSectionGuest}</dt>
                  <dd>
                    <b>{bar.guestName}</b>
                  </dd>
                </div>
                <div>
                  <dt>{copy.rcTitle}</dt>
                  <dd>
                    {propertyName} · {roomLabel}
                  </dd>
                </div>
                <div>
                  <dt>{copy.rpSectionStay}</dt>
                  <dd>
                    {shortDay(bar.checkIn)} → {shortDay(bar.checkOut)} · {nightsText}
                  </dd>
                </div>
                {detail?.beds24Id && (
                  <div>
                    <dt>{copy.spwRcNumber}</dt>
                    <dd className="spw-mono">{detail.beds24Id}</dd>
                  </div>
                )}
              </dl>
              <div className="spw-field">
                <label className="spw-field__l" htmlFor="opsrp-reason">
                  {copy.rcReason}
                </label>
                <textarea
                  className="spw-field__area"
                  disabled={pending}
                  id="opsrp-reason"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={copy.rcReasonPlaceholder}
                  rows={2}
                  value={reason}
                />
              </div>
              <p className="spw-note is-danger">{copy.rcCancelWarning}</p>
              {message && message !== copy.reSaved && (
                <p className="spw-msg" role="status">
                  {message}
                </p>
              )}
              <div className="spw-foot is-even">
                <button className="spw-btn" disabled={pending} onClick={() => setConfirming(false)} type="button">
                  {copy.rcKeep}
                </button>
                <button className="spw-btn is-danger" disabled={pending} onClick={cancel} type="button">
                  {copy.rcCancelConfirm}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
