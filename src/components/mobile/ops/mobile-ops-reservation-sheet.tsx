"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarDays, Check, ChevronRight, ChevronUp, TriangleAlert } from "lucide-react";
import {
  loadReservationMoveMonth,
  loadReservationMoveTargets,
  submitReservationMove,
  type ReservationMoveTarget,
} from "@/app/admin/ops/calendar/actions";
import {
  reservationMoveErrorText,
  type MovedReservation,
  type MoveRoom,
} from "@/components/admin/ops/ops-reservation-move";
import {
  loadReservationDetail,
  submitReservationCancel,
  submitReservationEdit,
} from "@/app/admin/ops/calendar/actions";
import { useRoomAvailability } from "@/components/admin/ops/use-room-availability";
import { reservationCancelErrorText, type ReservationCardCopy } from "@/components/admin/ops/ops-reservation-panel";
import { CHANNEL_NAME, reservationEditErrorText } from "@/components/admin/ops/ops-reservation-edit";
import {
  MobileStayDates,
  MobileStepper,
  MswField,
  MswPhoneInput,
  MswSuccess,
  mdWeekday,
  useSuccessThen,
} from "@/components/mobile/ops/mobile-ops-form";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone-format";
import {
  diffBookingEdit,
  isChannelBooking,
  validateBookingEdit,
  type BookingEditDraft,
} from "@/lib/ops-booking-edit";
import type { OpsCalendarBar } from "@/lib/ops-calendar";
import { stayNights } from "@/lib/ops-manual-booking";
import { MobileMoveCalendar, addDaysKey } from "@/components/mobile/ops/mobile-move-calendar";
import type { OpsReservationDetail } from "@/lib/ops-reservation-detail";

/**
 * 모바일 예약 시트 — 상세 · 수정 · 취소. Claude Design 시안 `5a 예약 상세 · 수기 예약 시트 v3`(5a~5d, 2026-10-02 사용자 확정).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「모바일 판매 캘린더」 → 예약 시트 v3
 *
 * **데이터 · 서버 경로는 데스크톱 예약 패널과 같다**(`loadReservationDetail` · `submitReservationEdit` ·
 * `submitReservationCancel`, 수정 규칙 `ops-booking-edit` — 채널 예약은 날짜 잠김). 모양만 모바일로:
 *
 * - 위: 이름 · 객실 · 채널/박/인원 · 숙박(체크인 ─ N박 ─ 체크아웃 · 도착 예정) · 금액(총액 + 수수료 · 실수령 · 1박 평균) ·
 *   **빠른 연락**(전화 걸기 · 메일 쓰기 · 예약번호 복사) · 손님 요청.
 * - 접힌 묶음: 손님 정보 · 예약 정보(머리에 한 줄 요약) · 내부 메모 · 채널 메시지.
 * - 불러오는 동안은 최종 배치와 같은 자리표시(시트 높이 고정이라 다 와도 튀지 않는다).
 * - 수정: 인원 −/+ · 수기 예약만 날짜(앱 날짜 시트) · 채널 예약은 날짜 잠김 줄. 취소: 빨간 카드 + 사유.
 * - 저장 · 취소가 되면 부모가 시트를 닫고 알림을 띄운다.
 */

export type MobileReservationSheetCopy = ReservationCardCopy & {
  mrArrival: string;
  mrRefCopy: string;
  mrGuestInfo: string;
  mrBookingInfo: string;
  mrBookedSummary: string;
  mrDates: string;
  mrCancelHead: string;
  mrCancelBig: string;
  dateNext: string;
  datePrev: string;
  today: string;
  mwCancelAsk: string;
  mwRoom: string;
  mwDone: string;
  mvFreeHere: string;
  mvRoomsHead: string;
  mvDateChange: string;
  mvDateRepick: string;
  mvDateFold: string;
  mvDateSame: string;
  mvDateWas: string;
  mvDatePicking: string;
  mvCalHint: string;
  mvCalFull: string;
  mvCalApply: string;
  mvCalCancel: string;
  mvListBasis: string;
  mvListChecking: string;
  mvSending: string;
  mvSubmitDate: string;
};

const CHANNEL_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking.com", manual: "Direct" };
const money = (value: number) => `¥${Math.round(value).toLocaleString("ja-JP")}`;
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function stamp(iso: string, localeTag: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat(localeTag, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(at);
}
function daysBetween(fromIso: string, toDate: string): number | null {
  const booked = new Date(fromIso);
  if (Number.isNaN(booked.getTime())) return null;
  const bookedDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(booked);
  const diff = Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${bookedDay}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.round(diff / 86_400_000) : null;
}
function displayName(code: string, localeTag: string, type: "region" | "language") {
  try {
    return new Intl.DisplayNames([localeTag], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function MobileOpsReservationSheet({
  bar,
  canWrite = true,
  copy,
  localeTag,
  moveRooms,
  nights,
  onCancelled,
  onMoved,
  onSaved,
  propertyName,
  roomIds,
  roomKey,
  roomLabel,
  today,
}: {
  bar: OpsCalendarBar;
  /** 판매 캘린더를 바꿀 수 있나(`ops_calendar.write`) — 없으면 수정 · 옮기기 · 취소 단추가 없다(서버도 막는다). */
  canWrite?: boolean;
  copy: MobileReservationSheetCopy;
  localeTag: string;
  nights: number;
  /** 취소 성공 — 부모가 시트를 닫고 알림. */
  onCancelled: () => void;
  /** 수정 저장 — 부모가 시트를 닫고 알림. */
  onSaved: () => void;
  /** 같은 건물 줄 — 「객실 옮기기」 후보(2026-10-19). 비면 버튼을 숨긴다. */
  moveRooms?: MoveRoom[];
  /** 옮긴 뒤 — 부모가 시트를 닫고 알림. */
  onMoved?: (moved: MovedReservation) => void;
  propertyName: string;
  roomIds: string[];
  roomKey: string;
  roomLabel: string;
  today: string;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "cancel" | "move">("view");
  const [detail, setDetail] = useState<OpsReservationDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { done, succeed } = useSuccessThen();

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
  }, [bar.id]);

  const channelName = detail?.channelName ?? CHANNEL_LABEL[bar.channel] ?? bar.channel;
  const guests =
    detail && detail.numAdult !== null
      ? copy.rpGuestsValue.replace("{adults}", String(detail.numAdult)).replace("{children}", String(detail.numChild ?? 0))
      : null;
  const net = detail && detail.price !== null && detail.commission !== null ? detail.price - detail.commission : null;
  const perNight = detail && detail.price !== null && nights > 0 ? detail.price / nights : null;
  const reference = detail?.channelReference || detail?.beds24Id || null;
  const leadDays = detail?.bookedAt ? daysBetween(detail.bookedAt, bar.checkIn) : null;

  const copyValue = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    });
  };

  const cancel = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitReservationCancel({ reason, reservationId: bar.id });
      if (result.ok) {
        succeed(onCancelled);
        return;
      }
      setError(reservationCancelErrorText(copy, result));
      setMode("view");
    });
  };

  if (mode === "edit" && detail) {
    return (
      <MobileReservationEdit
        bar={bar}
        copy={copy}
        detail={detail}
        localeTag={localeTag}
        onDiscard={() => setMode("view")}
        onSaved={onSaved}
        propertyName={propertyName}
        roomIds={roomIds}
        roomKey={roomKey}
        roomLabel={roomLabel}
        today={today}
      />
    );
  }

  /** 한 줄 — 값이 없으면 줄을 그리지 않는다. 복사는 글자 버튼(아이콘만 있는 버튼 금지). */
  const row = (
    key: string,
    label: string,
    value: React.ReactNode | null,
    copyText?: string | null,
  ) =>
    value ? (
      <div className="msw-kv" key={key}>
        <span className="k">{label}</span>
        <span className="v">
          {value}
          {copyText && (
            <button
              className={`cp${copied === key ? " on" : ""}`}
              onClick={() => copyValue(key, copyText)}
              type="button"
            >
              {copied === key ? copy.rpCopied : copy.rpCopy}
            </button>
          )}
        </span>
      </div>
    ) : null;
  const tel = (raw: string | null) => (raw ? <a href={phoneHref(raw)}>{formatPhoneDisplay(raw)}</a> : null);
  const mono = (text: string | null) => (text ? <span className="mono">{text}</span> : null);

  const countryText = detail?.countryCode ? displayName(detail.countryCode, localeTag, "region") : (detail?.countryText ?? null);
  const languageText = detail?.language ? displayName(detail.language, localeTag, "language") : null;
  const sub = [channelName, `${propertyName} ${roomLabel}`.trim(), copy.rcNights.replace("{n}", String(nights)), guests]
    .filter(Boolean)
    .join(" · ");

  if (mode === "move" && moveRooms && onMoved) {
    return (
      <MobileMoveForm
        bar={bar}
        copy={copy}
        currentRoom={moveRooms.find((room) => room.roomKey === roomKey) ?? { label: roomLabel, roomIds, roomKey }}
        localeTag={localeTag}
        nights={nights}
        onDiscard={() => setMode("view")}
        onMoved={onMoved}
        propertyName={propertyName}
        rooms={moveRooms}
        today={today}
      />
    );
  }

  if (mode === "cancel") {
    return (
      <div className="msw">
        <div className="msw-body">
          <div className="msw-step" key="cancel">
            <span aria-hidden="true" className="msw-cxl-ic">
              <TriangleAlert size={24} strokeWidth={1.8} />
            </span>
            <h3 className="msw-cxl-t">{copy.mwCancelAsk}</h3>
            <div className="msw-sum gray">
              {row("g", copy.rpSectionGuest, <b>{bar.guestName}</b>)}
              {row("r", copy.mwRoom, `${propertyName} · ${roomLabel}`)}
              {row("s", copy.rpSectionStay, `${md(bar.checkIn)} → ${md(bar.checkOut)} · ${copy.rcNights.replace("{n}", String(nights))}`)}
              {row("n", copy.mrRefCopy, mono(reference))}
            </div>
            <MswField label={copy.rcReason}>
              <textarea
                className="msw-in"
                enterKeyHint="done"
                onChange={(event) => setReason(event.target.value)}
                placeholder={copy.rcReasonPlaceholder}
                rows={2}
                value={reason}
              />
            </MswField>
            <p className="msw-cxl-w">{copy.rcCancelWarning}</p>
            {error && (
              <div className="msw-alert" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>
        <div className="msw-foot">
          <button className="msw-btn red" disabled={pending} onClick={cancel} type="button">
            {copy.rcCancelConfirm}
          </button>
          <button className="msw-btn text" disabled={pending} onClick={() => setMode("view")} type="button">
            {copy.rcKeep}
          </button>
        </div>
        {done && <MswSuccess label={copy.mwDone} />}
      </div>
    );
  }

  return (
    <div className="msw">
      <div className="msw-body">
        <div className="msw-step" key="view">
          <div className="msw-head">
            <div className="msw-head__t">
              <h3>{bar.guestName}</h3>
              <p>
                {bar.isCancelled && <span className="cxl">{copy.rcCancelled} · </span>}
                {sub}
              </p>
            </div>
          </div>

          <div className="msw-sect">
            <span className="h">{copy.rpSectionStay}</span>
            <div className="msw-stay">
              <div>
                <b>{mdWeekday(bar.checkIn, localeTag)}</b>
                <small>
                  {copy.rpCheckIn}
                  {detail?.arrivalTime ? ` · ${copy.mrArrival.replace("{time}", detail.arrivalTime)}` : ""}
                </small>
              </div>
              <i aria-hidden="true">
                <span>{copy.rcNights.replace("{n}", String(nights))}</span>
              </i>
              <div className="end">
                <b>{mdWeekday(bar.checkOut, localeTag)}</b>
                <small>{copy.rpCheckOut}</small>
              </div>
            </div>
            {leadDays !== null && leadDays >= 0 && (
              <span className="msw-lead">{copy.rpLeadTime.replace("{n}", String(leadDays))}</span>
            )}
          </div>

          {!detail && !loadFailed && (
            // 최종 배치와 같은 자리표시 — 다 와도 튀지 않는다.
            <div aria-busy="true" className="msw-sect">
              <span className="msw-bone" style={{ height: 12, width: "24%", marginBottom: 10 }} />
              <span className="msw-bone" style={{ height: 18, marginBottom: 10 }} />
              <span className="msw-bone" style={{ height: 18, marginBottom: 10 }} />
              <span className="msw-bone" style={{ height: 18, width: "70%" }} />
            </div>
          )}
          {loadFailed && (
            <div className="msw-alert" role="alert">
              {copy.rpLoadFailed}
            </div>
          )}

          {detail && (
            <>
              {detail.price !== null && (
                <div className="msw-sect">
                  <span className="h">{copy.rpSectionMoney}</span>
                  {row("tot", copy.rpTotal, <b>{money(detail.price)}</b>)}
                  {row("com", copy.rpCommission, detail.commission !== null ? `−${money(detail.commission)}` : "—")}
                  {row("net", copy.rpNet, net !== null ? money(net) : "—")}
                  {row("avg", copy.rpPerNight, perNight !== null ? money(perNight) : "—")}
                  {bar.isCancelled && detail.price === 0 && <p>{copy.rpMoneyCancelled}</p>}
                </div>
              )}

              <div className="msw-sect">
                <span className="h">{copy.rpSectionGuest}</span>
                {/* 이메일 · 전화는 누르면 바로 메일 쓰기 · 전화 걸기(예전 「빠른 연락」 버튼 대신). 전화는 하이픈으로 끊어 보인다. */}
                {row("email", copy.rpEmail, detail.email ? <a href={`mailto:${detail.email}`}>{detail.email}</a> : null, detail.email)}
                {row("phone", copy.rpPhone, tel(detail.phone), detail.phone)}
                {row("mobile", copy.rpMobile, tel(detail.mobile), detail.mobile)}
                {row(
                  "country",
                  copy.rpCountry,
                  countryText ? (
                    <>
                      {countryText}
                      {detail.countrySource === "phone" && <small> · {copy.rpCountryFromPhone}</small>}
                    </>
                  ) : null,
                )}
                {row("lang", copy.rpLanguage, languageText)}
                {row("addr", copy.rpAddress, detail.address)}
              </div>

              {(detail.guestComments || detail.internalNotes || detail.channelMessage) && (
                <div className="msw-sect">
                  <span className="h">{copy.rpSectionMessages}</span>
                  {detail.guestComments && <p>{detail.guestComments}</p>}
                  {detail.internalNotes && (
                    <>
                      <span className="sub">{copy.rpNotes}</span>
                      <p>{detail.internalNotes}</p>
                    </>
                  )}
                  {detail.channelMessage && (
                    <>
                      <span className="sub">{copy.rpChannelMessage}</span>
                      <p>{detail.channelMessage}</p>
                    </>
                  )}
                </div>
              )}

              <div className="msw-sect">
                <span className="h">{copy.rpSectionBooking}</span>
                {row("chan", copy.rcChannel, channelName)}
                {row("ref", copy.rpChannelRef, mono(detail.channelReference), detail.channelReference)}
                {row("b24", copy.rpBeds24Id, mono(detail.beds24Id), detail.beds24Id)}
                {row("group", copy.rpGroup, detail.groupMasterId)}
                {row("flag", copy.rpFlag, detail.flagText)}
                {row("booked", copy.rpBookedAt, detail.bookedAt ? stamp(detail.bookedAt, localeTag) : null)}
                {row("mod", copy.rpModifiedAt, detail.modifiedAt ? stamp(detail.modifiedAt, localeTag) : null)}
                {row("cxl", copy.rpCancelledAt, detail.cancelledAt ? stamp(detail.cancelledAt, localeTag) : null)}
              </div>
            </>
          )}

          {error && (
            <div className="msw-alert" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>

      {!bar.isCancelled && canWrite && (
        <div className={`msw-foot even${moveRooms && moveRooms.length > 1 && onMoved ? " three" : ""}`}>
          <button className="msw-btn soft" disabled={!detail} onClick={() => setMode("edit")} type="button">
            {copy.reTitle}
          </button>
          {moveRooms && moveRooms.length > 1 && onMoved && (
            <button className="msw-btn soft" onClick={() => setMode("move")} type="button">
              {copy.mvButton}
            </button>
          )}
          <button className="msw-btn soft-red" onClick={() => setMode("cancel")} type="button">
            {copy.rcCancel}
          </button>
        </div>
      )}
    </div>
  );
}

/** 수정 — 데스크톱 수정 폼(`OpsReservationEditForm`)과 같은 규칙 · 같은 서버 액션, 모바일 모양. */
function MobileReservationEdit({
  bar,
  copy,
  detail,
  localeTag,
  onDiscard,
  onSaved,
  propertyName,
  roomIds,
  roomKey,
  roomLabel,
  today,
}: {
  bar: OpsCalendarBar;
  copy: MobileReservationSheetCopy;
  detail: OpsReservationDetail;
  localeTag: string;
  onDiscard: () => void;
  onSaved: () => void;
  propertyName: string;
  roomIds: string[];
  roomKey: string;
  roomLabel: string;
  today: string;
}) {
  const channel = bar.channel;
  const original: BookingEditDraft = {
    arrival: detail.checkIn,
    departure: detail.checkOut,
    email: detail.email ?? "",
    guestName: detail.guestName,
    notes: detail.internalNotes ?? "",
    numAdult: detail.numAdult ?? 1,
    numChild: detail.numChild ?? 0,
    phone: detail.phone ?? "",
    totalPrice: detail.price,
  };
  const [draft, setDraft] = useState<BookingEditDraft>(original);
  const [priceText, setPriceText] = useState(original.totalPrice === null ? "" : String(original.totalPrice));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { done, succeed } = useSuccessThen();
  const channelBooking = isChannelBooking(channel);
  const availability = useRoomAvailability({
    allowedStart: original.arrival < today ? original.arrival : undefined,
    excludeReservationId: bar.id,
    roomIds,
    roomKey,
    seedMonths: [original.arrival.slice(0, 7), original.departure.slice(0, 7)],
    today,
  });
  const set = <K extends keyof BookingEditDraft>(key: K, value: BookingEditDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const nights = stayNights(draft.arrival, draft.departure);
  const taken = availability.takenIn(nights);
  const changes = diffBookingEdit(original, draft);
  const localError = validateBookingEdit({ changes, original, today });

  const save = () => {
    if (localError) {
      setError(reservationEditErrorText(copy, localError, []));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitReservationEdit({ changes, reservationId: bar.id, roomIds, roomKey });
      if (result.ok) {
        succeed(onSaved);
        return;
      }
      setError(reservationEditErrorText(copy, result.error, result.conflictDates));
    });
  };

  return (
    <div className="msw">
      <div className="msw-body">
        <div className="msw-step" key="edit">
          <div className="msw-head">
            <div className="msw-head__t">
              <h3>{copy.reTitle}</h3>
              <p>
                {bar.guestName} · {CHANNEL_NAME[channel]} · {propertyName} {roomLabel}
              </p>
            </div>
          </div>

          {/* 채널 예약도 날짜를 바꾼다(2026-10-20 — 전엔 잠갔다). 채널 쪽 예약은 그대로라 「채널에서도 바꿔 주세요」. */}
          {channelBooking && (
            <div className="msw-lock">{copy.reChannelDates.replaceAll("{channel}", CHANNEL_NAME[channel])}</div>
          )}
          <MobileStayDates
            arrival={draft.arrival}
            checkInLabel={copy.mbCheckIn}
            checkOutLabel={copy.mbCheckOut}
            departure={draft.departure}
            labels={{ nextMonth: copy.dateNext, prevMonth: copy.datePrev, today: copy.today }}
            locale={localeTag}
            onChange={(arrival, departure) => setDraft((previous) => ({ ...previous, arrival, departure }))}
            today={today}
          />
          {taken.length > 0 && (
            <span className="msw-field__hint bad">
              {copy.mbErrNightsTaken.replace("{dates}", taken.map((night) => night.slice(5).replace("-", "/")).join(", "))}
            </span>
          )}

          <MswField label={copy.mbGuest}>
            <input className="msw-in" onChange={(event) => set("guestName", event.target.value)} type="text" value={draft.guestName} />
          </MswField>
          <MswField label={copy.mbEmail}>
            <input
              className="msw-in"
              inputMode="email"
              onChange={(event) => set("email", event.target.value)}
              type="email"
              value={draft.email}
            />
          </MswField>
          <MswField label={copy.mbPhone}>
            <MswPhoneInput onChange={(value) => set("phone", value)} value={draft.phone} />
          </MswField>
          <div className="msw-steps">
            <MobileStepper label={copy.mbAdults} min={1} onChange={(value) => set("numAdult", value)} value={draft.numAdult} />
            <MobileStepper label={copy.mbChildren} min={0} onChange={(value) => set("numChild", value)} value={draft.numChild} />
          </div>
          <MswField
            hint={channelBooking ? copy.reChannelPriceNote.replaceAll("{channel}", CHANNEL_NAME[channel]) : null}
            label={copy.mbTotal}
          >
            <span className="msw-money sm">
              <input
                inputMode="numeric"
                onChange={(event) => {
                  const digits = event.target.value.replace(/[^\d]/g, "");
                  setPriceText(digits);
                  set("totalPrice", digits === "" ? null : Number(digits));
                }}
                type="text"
                value={priceText === "" ? "" : Number(priceText).toLocaleString("ja-JP")}
              />
            </span>
          </MswField>
          <MswField hint={copy.reNotesHint} label={copy.rpNotes}>
            <textarea className="msw-in" onChange={(event) => set("notes", event.target.value)} rows={3} value={draft.notes} />
          </MswField>

          {error && (
            <div className="msw-alert" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
      <div className="msw-foot two">
        <button className="msw-btn ghost" disabled={pending} onClick={onDiscard} type="button">
          {copy.reDiscard}
        </button>
        <button
          className="msw-btn"
          disabled={pending || localError === "no_changes" || taken.length > 0}
          onClick={save}
          type="button"
        >
          {copy.reSave}
        </button>
      </div>
      {done && <MswSuccess label={copy.mwDone} />}
    </div>
  );
}

/**
 * 객실 옮기기 — 모바일 시트(2026-10-19, 시안 SalesMovePick-Phone · 「예약 옮기기 · 모바일 날짜 시안」).
 *
 * - 맨 위 **날짜 줄**: 직접 · 수기 예약은 누르면 같은 시트 안에서 달력이 펼쳐진다(`MobileMoveCalendar` — 체크인만 누르면 박수만큼
 *   띠, 빈 객실이 하나도 없는 날은 흐리게). 「정하기」를 누르면 달력이 접히고 객실 목록을 그 날짜로 다시 확인한다(그동안 자리표시).
 *   채널 예약은 자물쇠 · 「날짜 고정」 — 객실만.
 * - 날짜를 옮기면 지금 객실도 후보다(「비어 있음 · 지금 객실」).
 * - 실패하면 이유를 아래에 두고 목록을 다시 읽는다(그사이 찬 객실이 그대로 보이게). 서버 동작 · 문구는 PC 와 같다
 *   (`submitReservationMove` · `reservationMoveErrorText`).
 */
function MobileMoveForm({
  bar,
  copy,
  currentRoom,
  localeTag,
  nights,
  onDiscard,
  onMoved,
  propertyName,
  rooms,
  today,
}: {
  bar: OpsCalendarBar;
  copy: MobileReservationSheetCopy;
  currentRoom: MoveRoom;
  localeTag: string;
  nights: number;
  onDiscard: () => void;
  onMoved: (moved: MovedReservation) => void;
  propertyName: string;
  rooms: MoveRoom[];
  today: string;
}) {
  const manual = bar.channel === "manual";
  const [arrival, setArrival] = useState(bar.checkIn);
  const departure = addDaysKey(arrival, nights);
  const datesChanged = arrival !== bar.checkIn;
  // 달력 — 펼친 동안 고르는 체크인과 보고 있는 달, 달마다 막힌 날.
  const [calendar, setCalendar] = useState<{ draft: string; month: string } | null>(null);
  const [fullByMonth, setFullByMonth] = useState<Map<string, Set<string>>>(() => new Map());
  const [loaded, setLoaded] = useState<{ key: string; targets: Map<string, ReservationMoveTarget> | null } | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 후보 줄 — 날짜가 바뀌면 그 날짜로 다시. 날짜를 옮기면 지금 줄도 다른 날짜의 후보라 「지금 객실」로 묶지 않는다.
  const targetsKey = `${arrival}|${reloadSeq}`;
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
      setLoaded({ key: targetsKey, targets: result.ok ? new Map(result.targets.map((target) => [target.roomKey, target])) : null });
    });
    return () => {
      alive = false;
    };
  }, [arrival, departure, datesChanged, bar.id, currentRoom.roomKey, rooms, targetsKey]);
  const checking = loaded?.key !== targetsKey;
  const targets = checking ? null : (loaded?.targets ?? null);
  const loadFailed = !checking && loaded?.targets === null;

  // 달력이 보여 주는 달의 막힌 날 — 한 번 읽은 달은 다시 읽지 않는다.
  const viewMonth = calendar?.month ?? null;
  useEffect(() => {
    if (!viewMonth || fullByMonth.has(viewMonth)) return;
    let alive = true;
    void loadReservationMoveMonth({
      month: viewMonth,
      nights,
      reservationId: bar.id,
      rows: rooms.map((room) => ({ roomIds: room.roomIds, roomKey: room.roomKey })),
    }).then((result) => {
      if (!alive || !result.ok) return;
      setFullByMonth((previous) => new Map(previous).set(viewMonth, new Set(result.fullDays)));
    });
    return () => {
      alive = false;
    };
  }, [viewMonth, fullByMonth, nights, bar.id, rooms]);

  const pickedRoom = rooms.find((room) => room.roomKey === picked) ?? null;
  const pickedOk = !!pickedRoom && targets?.get(pickedRoom.roomKey)?.state === "free";
  const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const range = (from: string, to: string) => `${short(from)} → ${short(to)}`;
  const stateText = (room: MoveRoom, target: ReservationMoveTarget | undefined) => {
    if (!target) return copy.mvChecking;
    if (target.state === "current") return copy.mvCurrent;
    if (target.state === "free") return datesChanged && room.roomKey === currentRoom.roomKey ? copy.mvFreeHere : copy.mvFree;
    if (target.state === "unsellable") return copy.mvUnsellable;
    return target.clashGuest ? copy.mvBooked.replace("{guest}", target.clashGuest) : copy.mvBookedNoName;
  };
  /** 「원래 {dates}」 — 원래 날짜만 취소선. */
  const was = (template: string) => {
    const [before, after = ""] = template.replace("{n}", String(nights)).split("{dates}");
    return (
      <>
        {before}
        <s>{range(bar.checkIn, bar.checkOut)}</s>
        {after}
      </>
    );
  };

  const submit = () => {
    if (!pickedRoom || !pickedOk) return;
    setError(null);
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
      setError(reservationMoveErrorText(copy, result));
      // 그사이 찬 객실이 목록에 그대로 보이게 다시 읽고, 고른 것은 푼다.
      setPicked(null);
      setReloadSeq((seq) => seq + 1);
    });
  };

  const draftOut = calendar ? addDaysKey(calendar.draft, nights) : departure;
  const opened = calendar !== null;
  const shownIn = opened ? calendar.draft : arrival;
  const shownOut = opened ? draftOut : departure;
  const moved = opened ? calendar.draft !== bar.checkIn : datesChanged;

  return (
    <div className="msw">
      <div className="msw-body">
        <div className="msw-step" key="move">
          <div className="msw-mv-head">
            <b>{copy.mvTitleManual.replace("{guest}", bar.guestName)}</b>
            <span>
              {[CHANNEL_NAME[bar.channel] || null, `${propertyName} ${currentRoom.label}`, range(bar.checkIn, bar.checkOut), copy.rcNights.replace("{n}", String(nights))]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {/* 날짜는 모든 예약이 옮긴다(2026-10-20 — 채널 예약 잠금을 풀었다). */}
          <button
            aria-expanded={opened}
            className={`msw-mv-date${opened || datesChanged ? " is-on" : ""}`}
            disabled={pending}
            onClick={() => {
              setCalendar(opened ? null : { draft: arrival, month: arrival.slice(0, 7) < today.slice(0, 7) ? today.slice(0, 7) : arrival.slice(0, 7) });
              setError(null);
            }}
            type="button"
          >
            <CalendarDays aria-hidden className="msw-mv-date__ic" />
            <span className="msw-mv-date__tx">
              <b>
                {mdWeekday(shownIn, localeTag)} → {mdWeekday(shownOut, localeTag)}
              </b>
              <span>{opened ? (moved ? was(copy.mvDatePicking) : copy.mvDateSame.replace("{n}", String(nights))) : datesChanged ? was(copy.mvDateWas) : copy.mvDateSame.replace("{n}", String(nights))}</span>
            </span>
            <span className="msw-mv-date__act">
              {opened ? copy.mvDateFold : datesChanged ? copy.mvDateRepick : copy.mvDateChange}
              {opened ? <ChevronUp aria-hidden /> : <ChevronRight aria-hidden />}
            </span>
          </button>
          {!manual && (
            <div className="msw-lock">{copy.mvChannelNote.replaceAll("{channel}", CHANNEL_NAME[bar.channel] || bar.channel)}</div>
          )}

          {opened ? (
            <>
              <MobileMoveCalendar
                arrival={calendar.draft}
                fullDays={fullByMonth.get(calendar.month) ?? null}
                labels={{
                  checkIn: copy.mbCheckIn,
                  checkOut: copy.mbCheckOut,
                  full: copy.mvCalFull,
                  nextMonth: copy.dateNext,
                  prevMonth: copy.datePrev,
                }}
                locale={localeTag}
                month={calendar.month}
                nights={nights}
                onMonth={(month) => setCalendar((current) => (current ? { ...current, month } : current))}
                onPick={(draft) => setCalendar((current) => (current ? { ...current, draft } : current))}
                today={today}
              />
              <div className="msw-mc-legend">
                <span>
                  <i aria-hidden className="msw-mc-legend__in" />
                  {copy.mvCalHint.replace("{n}", String(nights))}
                </span>
                <span>
                  <b aria-hidden>14</b>
                  {copy.mvCalFull}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="msw-mv-sec">
                <span>{copy.mvRoomsHead}</span>
                <span className={datesChanged && !checking ? "is-on" : undefined} role={checking ? "status" : undefined}>
                  {(checking ? copy.mvListChecking : copy.mvListBasis).replace("{dates}", range(arrival, departure))}
                </span>
              </div>
              <div aria-busy={checking || pending} aria-label={copy.mvPick} className={`msw-mv-list${pending ? " is-sending" : ""}`} role="radiogroup">
                {rooms.map((room, index) => {
                  if (checking) {
                    return (
                      <div aria-hidden className="msw-mv-row is-skel" key={room.roomKey}>
                        <b>{room.label}</b>
                        <i style={{ width: 70 + (index % 3) * 24 }} />
                      </div>
                    );
                  }
                  const target = targets?.get(room.roomKey);
                  const free = target?.state === "free";
                  const on = free && picked === room.roomKey;
                  return free ? (
                    <button
                      aria-checked={on}
                      className={`msw-mv-row is-free${on ? " on" : ""}`}
                      disabled={pending}
                      key={room.roomKey}
                      onClick={() => {
                        setPicked(room.roomKey);
                        setError(null);
                      }}
                      role="radio"
                      type="button"
                    >
                      <b>{room.label}</b>
                      <span>{stateText(room, target)}</span>
                      {on && <Check aria-hidden className="msw-mv-ck" />}
                    </button>
                  ) : (
                    <div aria-disabled="true" className="msw-mv-row" key={room.roomKey}>
                      <b>{room.label}</b>
                      <span>{stateText(room, target)}</span>
                    </div>
                  );
                })}
              </div>
              {loadFailed && (
                <div className="msw-alert" role="alert">
                  {copy.mvErrLoad}
                </div>
              )}
              {error && (
                <div className="msw-alert" role="alert">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {opened ? (
        <div className="msw-foot two">
          <button className="msw-btn ghost" onClick={() => setCalendar(null)} type="button">
            {copy.mvCalCancel}
          </button>
          <button
            className="msw-btn"
            onClick={() => {
              if (calendar.draft !== arrival) {
                setArrival(calendar.draft);
                setPicked(null);
              }
              setCalendar(null);
            }}
            type="button"
          >
            {copy.mvCalApply.replace("{dates}", range(calendar.draft, draftOut))}
          </button>
        </div>
      ) : (
        <div className="msw-foot two">
          <button className="msw-btn ghost" disabled={pending} onClick={onDiscard} type="button">
            {copy.mvKeep}
          </button>
          <button className="msw-btn" disabled={pending || checking || !pickedOk} onClick={submit} type="button">
            {pending ? (
              <>
                <span aria-hidden className="msw-mv-spin" />
                {copy.mvSending}
              </>
            ) : pickedRoom && pickedOk ? (
              datesChanged ? (
                copy.mvSubmitDate.replace("{room}", pickedRoom.label).replace("{in}", short(arrival))
              ) : (
                copy.mvSubmit.replace("{room}", pickedRoom.label)
              )
            ) : (
              copy.mvPick
            )}
          </button>
        </div>
      )}
    </div>
  );
}
