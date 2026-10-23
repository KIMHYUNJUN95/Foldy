"use client";

import { useMemo, useState, useTransition } from "react";
import { X } from "lucide-react";
import { submitManualBooking, type ManualBookingResult } from "@/actions/ops-calendar";
import { useRoomAvailability } from "@/components/admin/ops/use-room-availability";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { MAX_STAY_NIGHTS, stayNights, validateManualBooking } from "@/lib/ops-manual-booking";
import { formatPhoneInput } from "@/lib/phone-format";
import { spwDate, type SpwCopy } from "@/components/admin/ops/ops-price-panel";
import "./ops-calendar-panels-white.css";
import { useBuildingName, useRoomPlaceLabel } from "@/components/shared/building-names";

/**
 * 수동 예약 생성 — **오른쪽 사이드 패널.**
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「수동 예약 생성」
 * 원본: STAY ARI Manager `BuildingCalendar.jsx` → `ManualBookingModal`
 *
 * ## 왜 패널인가 (2026-09-28)
 *
 * 처음에는 중앙 모달이었다. 콘솔의 입력·상세는 전부 공용 `.panel` 프리미티브(오른쪽 패널)를
 * 쓰는데 이것만 가운데 떠 있어 다른 화면과 따로 놀았다(사용자 지적, CLAUDE.md §4).
 * 패널이면 **격자에서 고른 막대가 가려지지 않는다** — 무엇을 만들고 있는지 옆에 그대로 보인다.
 *
 * ## 날짜는 격자에서 이미 골라서 온다
 *
 * `+` 를 누르면 체크인, 이어서 누른 날이 체크아웃이다(저쪽 `handleDateCellClick`).
 * 패널의 범위 피커는 **고치는 용도**다 — 창 밖으로 넘어가는 숙박도 여기서 늘린다.
 *
 * ## 피커에서는 **팔 수 있는 날만** 고른다 (2026-09-28)
 *
 * 이미 예약·블록이 있는 밤, 파는 유닛이 없는 밤은 회색으로 막는다. 체크인을 찍은 뒤에는
 * **그 밤들을 넘어가는 체크아웃**도 막는다(격자와 같은 규칙). 격자가 들고 있는 예약은 화면
 * 창뿐이라, 피커가 여는 달마다 `loadRoomAvailability` 로 읽는다 — 아직 모르는 날도 막는다
 * (모르는 날을 열어 두면 그대로 초과예약이 된다). 서버가 만들기 직전에 한 번 더 막는다.
 *
 * ## 금액은 **총액**이다
 *
 * 1박 단가가 아니다. Beds24 예약 한 건에 붙는 값이 총액이라 그대로 맞춘다(저쪽 라벨도
 * `Total Price`). 그래서 숙박 일수가 바뀌면 고른 기준가를 지운다 — 일수가 달라지면 그 금액은
 * 더 이상 그 숙박의 값이 아니다.
 *
 * ## 요금으로 채우기
 *
 * 총액을 손으로 계산하게 하면 아무도 안 쓴다. **채널별 합계를 고르는 카드 두 장**으로
 * 보여준다. 예전에는 밤별 표와 버튼에 **같은 숫자가 두 번** 나오고 표에 열 이름이 없어서
 * 어느 쪽이 에어비앤비인지 읽을 수 없었다(2026-09-28 지적). 밤별 내역은 2박 이상일 때만
 * 접어서 둔다 — 1박이면 합계가 곧 그 밤이다.
 *
 * 요금을 모르는 밤이 하나라도 있으면 그 채널의 합계는 **추정치**라 고를 수 없다 — 모르는 값을
 * 뺀 숫자를 「제안」으로 내밀면 그게 그대로 청구된다. 채널마다 따로 판정한다.
 *
 * ## 차단은 여기서 안 만든다
 *
 * 저쪽은 손님 이름에 `blackout` / `room block` 이 들어가면 차단을 만들었다. 화면 어디에도
 * 안 적힌 매직 문자열이라 **뺐다**(2026-09-28 사용자 확인). 차단은 전용 모드에서 한다.
 */

export type BookingPanelCopy = {
  mbTitle: string;
  mbCheckIn: string;
  mbCheckOut: string;
  mbNights: string;
  mbGuest: string;
  mbGuestPlaceholder: string;
  mbTotal: string;
  mbTotalPlaceholder: string;
  mbTotalHint: string;
  mbFillFrom: string;
  mbAirbnb: string;
  mbBooking: string;
  mbAdults: string;
  mbChildren: string;
  mbEmail: string;
  mbPhone: string;
  mbComments: string;
  mbCommentsPlaceholder: string;
  mbRates: string;
  mbRatesPartial: string;
  mbAdjust: string;
  mbCancel: string;
  mbClose: string;
  mbSubmit: string;
  mbPending: string;
  mbDone: string;
  /** 「{dates} 는 다른 유닛이 판매 중입니다」 — 날짜를 반드시 같이 적는다. */
  mbErrUnitChanges: string;
  mbErrNoActiveUnit: string;
  mbErrNoRoom: string;
  mbErrNoGuestName: string;
  mbErrBadDates: string;
  mbErrPastArrival: string;
  mbErrBadPrice: string;
  mbErrBadOccupancy: string;
  mbErrStayTooLong: string;
  mbErrForbidden: string;
  mbErrBeds24: string;
  mbErrCooldown: string;
  mbErrDuplicate: string;
  mbErrRoomBusy: string;
  /** 만들어졌는지 모른다 — Beds24 에서 확인하라고 한다. 그냥 다시 누르면 두 번 생길 수 있다. */
  mbErrUnconfirmed: string;
  mbErrOccupied: string;
  /** 패널 안에서 쓴다 — 예약·블록뿐 아니라 판매 중지 밤도 포함하므로 문구가 더 넓다. */
  mbErrNightsTaken: string;
  mbAvailHint: string;
  mbAvailFailed: string;
  datePrev: string;
  dateNext: string;
  dateThisMonth: string;
  dateReset: string;
  dateApply: string;
};

export type BookingPanelRoom = {
  key: string;
  label: string;
  propertyName: string;
  roomIds: string[];
};

/** 밤별 요금. `null` 이면 **모르는 것**이지 0원이 아니다. */
export type BookingPanelRate = { airbnb: number | null; booking: number | null };

type Channel = "airbnb" | "booking";

const PERCENT_PRESETS = [-10, -5, 0, 5, 10];

export function bookingErrorText(copy: BookingPanelCopy, result: Extract<ManualBookingResult, { ok: false }>) {
  const dates = (result.conflictDates ?? []).map((date) => date.slice(5)).join(", ");
  switch (result.error) {
    case "unit_changes":
      return copy.mbErrUnitChanges.replace("{dates}", dates);
    case "no_active_unit":
      return copy.mbErrNoActiveUnit.replace("{dates}", dates);
    case "occupied":
      return copy.mbErrOccupied.replace("{dates}", dates);
    case "no_room":
      return copy.mbErrNoRoom;
    case "no_guest_name":
      return copy.mbErrNoGuestName;
    case "bad_dates":
      return copy.mbErrBadDates;
    case "past_arrival":
      return copy.mbErrPastArrival;
    case "bad_price":
      return copy.mbErrBadPrice;
    case "bad_occupancy":
      return copy.mbErrBadOccupancy;
    case "stay_too_long":
      return copy.mbErrStayTooLong.replace("{max}", String(MAX_STAY_NIGHTS));
    case "forbidden":
      return copy.mbErrForbidden;
    case "cooldown":
      return copy.mbErrCooldown;
    case "duplicate_request":
      return copy.mbErrDuplicate;
    case "room_busy":
      return copy.mbErrRoomBusy;
    case "unconfirmed":
      return copy.mbErrUnconfirmed;
    default:
      return copy.mbErrBeds24;
  }
}

export function OpsBookingPanel({
  checkIn,
  checkOut,
  copy,
  localeTag,
  onClose,
  rateAt,
  room,
  today,
}: {
  checkIn: string;
  checkOut: string;
  copy: BookingPanelCopy & SpwCopy;
  localeTag: string;
  onClose: () => void;
  /** 그 방 그 밤의 요금. 격자가 이미 들고 있는 값을 그대로 넘긴다. */
  rateAt: (date: string) => BookingPanelRate;
  room: BookingPanelRoom;
  today: string;
}) {
  const bName = useBuildingName();
  const bRoom = useRoomPlaceLabel();
  // 요청 키 — 패널을 연 동안 하나. 같은 키로는 서버가 예약을 한 번만 만든다(실패 뒤 다시 눌러도 중복 없음).
  const [requestKey] = useState(() => crypto.randomUUID());
  const [arrival, setArrival] = useState(checkIn);
  const [departure, setDeparture] = useState(checkOut);
  const [guestName, setGuestName] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [numAdult, setNumAdult] = useState(1);
  const [numChild, setNumChild] = useState(0);
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [comments, setComments] = useState("");
  const [basePrice, setBasePrice] = useState<{ value: number; channel: Channel } | null>(null);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Esc · 포커스 · 스크롤 잠금은 콘솔 패널 공용 훅이 한다. 보내는 중에는 닫히지 않는다.
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: pending });

  const nights = useMemo(() => stayNights(arrival, departure), [arrival, departure]);

  // 팔 수 있는 밤 — 격자에서 고른 숙박이 걸친 달부터 읽어 둔다(`use-room-availability.ts`).
  const availability = useRoomAvailability({
    roomIds: room.roomIds,
    roomKey: room.key,
    seedMonths: [checkIn.slice(0, 7), checkOut.slice(0, 7)],
    today,
  });
  const isDateDisabled = availability.isDateDisabled;
  const loadMonths = availability.loadMonths;
  const availFailed = availability.failed;
  /** 지금 잡힌 숙박에 막힌 밤이 끼었나 — 읽기가 늦게 도착해 드러날 수 있다. */
  const takenInStay = availability.takenIn(nights);

  const rates = useMemo(() => {
    const rows = nights.map((night) => ({ night, ...rateAt(night) }));
    const sum = (channel: Channel) => {
      const known = rows.filter((row) => row[channel] !== null);
      return {
        // 모르는 밤이 하나라도 있으면 **추정치**다 — 자동 채우기를 막는 근거가 된다.
        partial: known.length !== rows.length,
        total: known.reduce((acc, row) => acc + (row[channel] ?? 0), 0),
      };
    };
    return { airbnb: sum("airbnb"), booking: sum("booking"), rows };
  }, [nights, rateAt]);

  const changeStay = (from: string, to: string) => {
    setArrival(from);
    // 같은 날을 두 번 고르면 0박이다 — 체크아웃을 다음 날로 밀어 최소 1박을 만든다.
    setDeparture(to > from ? to : nextDay(from));
    // 숙박이 바뀌면 기준가를 버린다. 효과로 지우지 않고 날짜를 바꾸는 자리에서 지운다 —
    // 무엇이 언제 지워지는지가 코드에 그대로 보인다.
    setBasePrice(null);
    setPercent(0);
  };

  const applyBase = (channel: Channel) => {
    const value = rates[channel].total;
    setBasePrice({ channel, value });
    setPercent(0);
    setTotalPrice(String(value));
  };

  const applyPercent = (next: number) => {
    setPercent(next);
    if (basePrice) setTotalPrice(String(Math.round(basePrice.value * (1 + next / 100))));
  };

  const parsedPrice = totalPrice.trim() === "" ? null : Number(totalPrice);
  const input = {
    arrival,
    departure,
    guestName,
    numAdult,
    numChild,
    roomKey: room.key,
    totalPrice: parsedPrice,
  };
  const localInvalid = validateManualBooking(input, today);

  const submit = () => {
    setMessage(copy.mbPending);
    startTransition(async () => {
      const result = await submitManualBooking({
        comments,
        guestEmail,
        guestPhone,
        input,
        requestKey,
        roomIds: room.roomIds,
      });
      if (result.ok) {
        setMessage(copy.mbDone);
        onClose();
        return;
      }
      setMessage(bookingErrorText(copy, result));
    });
  };

  const money = (value: number) => `¥${value.toLocaleString()}`;
  const channelLabel = (channel: Channel) => (channel === "airbnb" ? copy.mbAirbnb : copy.mbBooking);
  const anyPartial = rates.airbnb.partial || rates.booking.partial;
  const nightsText = copy.mbNights.replace("{n}", String(nights.length));
  /** 총액 칸 표시 — 「118500」보다 「118,500」. 저장 값은 숫자만(`totalPrice`). */
  const totalDisplay = totalPrice === "" ? "" : Number(totalPrice).toLocaleString("ja-JP");

  /** 성인 · 어린이 — 숫자칸 대신 − / + (시안 SalesNew-PC). 성인은 1명부터. */
  const stepper = (label: string, value: number, min: number, set: (next: number) => void) => (
    <div className="spw-step">
      <span>{label}</span>
      <span className="spw-step__ctl">
        <button
          aria-label={copy.spwMinus.replace("{label}", label)}
          className="spw-step__btn"
          disabled={pending || value <= min}
          onClick={() => set(Math.max(min, value - 1))}
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
          onClick={() => set(value + 1)}
          type="button"
        >
          +
        </button>
      </span>
    </div>
  );

  return (
    <>
      <div className="panel-scrim" onClick={pending ? undefined : onClose} />
      <aside
        aria-label={copy.mbTitle}
        aria-modal="true"
        className="panel spw-panel"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="spw-phead">
          <div className="spw-head">
            <span className="spw-head__k">{copy.spwMbKicker}</span>
            <b className="spw-head__t">
              {bName(room.propertyName)} · {bRoom(room.label)}
            </b>
            <span className="spw-head__s">{nightsText}</span>
          </div>
          <button aria-label={copy.mbClose} className="spw-x" disabled={pending} onClick={onClose} type="button">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="spw-pbody">
          {/* **숙박은 기간이다.** 격자에서 고른 값이 들어와 있고, 아래 피커로 고친다(CLAUDE.md §4a). */}
          <div className="spw-stay">
            <div>
              <b>{spwDate(arrival, localeTag)}</b>
              <span>{copy.mbCheckIn}</span>
            </div>
            <span className="spw-stay__n">{nightsText}</span>
            <div className="is-end">
              <b>{spwDate(departure, localeTag)}</b>
              <span>{copy.mbCheckOut}</span>
            </div>
          </div>
          <div className="spw-group">
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
              isDateDisabled={isDateDisabled}
              localeTag={localeTag}
              onChange={changeStay}
              onMonthChange={loadMonths}
              to={departure}
            />
            {/* 버튼만 흐려 두면 왜 안 되는지 알 수 없다 — 그 자리에 적는다. */}
            {localInvalid === "bad_dates" && <p className="spw-note is-danger">{copy.mbErrBadDates}</p>}
            {localInvalid === "past_arrival" && <p className="spw-note is-danger">{copy.mbErrPastArrival}</p>}
            {takenInStay.length > 0 && (
              <p className="spw-note is-danger">
                {copy.mbErrNightsTaken.replace(
                  "{dates}",
                  takenInStay.map((night) => night.slice(5).replace("-", "/")).join(", "),
                )}
              </p>
            )}
            <p className="spw-note">{availFailed ? copy.mbAvailFailed : copy.mbAvailHint}</p>
          </div>

          <div className="spw-field">
            <label className="spw-field__l" htmlFor="opsbk-guest">
              {copy.mbGuest}
            </label>
            <input
              aria-required="true"
              className="spw-field__in"
              id="opsbk-guest"
              onChange={(event) => setGuestName(event.target.value)}
              placeholder={copy.mbGuestPlaceholder}
              type="text"
              value={guestName}
            />
          </div>

          <div>
            {stepper(copy.mbAdults, numAdult, 1, setNumAdult)}
            {stepper(copy.mbChildren, numChild, 0, setNumChild)}
          </div>

          <div className="spw-two">
            <div className="spw-field">
              <label className="spw-field__l" htmlFor="opsbk-email">
                {copy.spwOptional.replace("{label}", copy.mbEmail)}
              </label>
              <input
                autoComplete="off"
                className="spw-field__in is-sm"
                id="opsbk-email"
                onChange={(event) => setGuestEmail(event.target.value)}
                placeholder="name@mail.com"
                type="email"
                value={guestEmail}
              />
            </div>
            <div className="spw-field">
              <label className="spw-field__l" htmlFor="opsbk-phone">
                {copy.spwOptional.replace("{label}", copy.mbPhone)}
              </label>
              {/* 치는 대로 하이픈 — `+1-415-555-0142` · `090-1234-5678`(phone-format.ts). */}
              <input
                autoComplete="off"
                className="spw-field__in is-sm is-mono"
                id="opsbk-phone"
                inputMode="tel"
                onChange={(event) => setGuestPhone(formatPhoneInput(event.target.value))}
                placeholder="+81"
                type="tel"
                value={guestPhone}
              />
            </div>
          </div>

          {/* ── 요금으로 채우기 ── 카드 두 장은 총액 칸을 채우는 **바로가기**다. */}
          {nights.length > 0 && (
            <>
              <div className="spw-pcts__h">
                <span className="spw-label">{copy.mbFillFrom}</span>
                <span className="spw-pcts__hint">{copy.spwNightsTotal.replace("{n}", String(nights.length))}</span>
              </div>
              <div className="spw-fill">
                {(["airbnb", "booking"] as const).map((channel) => {
                  const sum = rates[channel];
                  const disabled = sum.partial || sum.total <= 0;
                  const on = basePrice?.channel === channel;
                  return (
                    <button
                      aria-pressed={on}
                      className={`spw-fill__opt${on ? " on" : ""}`}
                      disabled={disabled || pending}
                      key={channel}
                      onClick={() => applyBase(channel)}
                      type="button"
                    >
                      <span>{channelLabel(channel)}</span>
                      <b>{disabled ? "—" : money(sum.total)}</b>
                    </button>
                  );
                })}
              </div>

              {/* 조정 % — 채널 합계를 고른 뒤에 쓴다(그 전에는 기준이 없다). */}
              <div className="spw-adjust">
                <span className="spw-adjust__l">{copy.mbAdjust}</span>
                {PERCENT_PRESETS.map((preset) => (
                  <button
                    aria-pressed={!!basePrice && percent === preset}
                    className={`spw-chip is-sm${basePrice && percent === preset ? " on" : ""}`}
                    disabled={!basePrice || pending}
                    key={preset}
                    onClick={() => applyPercent(preset)}
                    type="button"
                  >
                    {preset > 0 ? `+${preset}` : String(preset).replace("-", "−")}%
                  </button>
                ))}
              </div>

              {anyPartial && <p className="spw-note is-warn">{copy.mbRatesPartial}</p>}

              {/* 밤별 내역은 **2박 이상일 때만**. 1박이면 합계가 곧 그 밤이다. */}
              {nights.length > 1 && (
                <details className="spw-nightly" open>
                  <summary>
                    {copy.mbRates} · {nightsText}
                  </summary>
                  <table>
                    <thead>
                      <tr>
                        <th />
                        <th>{copy.mbAirbnb}</th>
                        <th>{copy.mbBooking}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rates.rows.map((row) => (
                        <tr key={row.night}>
                          <td>{spwDate(row.night, localeTag)}</td>
                          <td>{row.airbnb === null ? "—" : money(row.airbnb)}</td>
                          <td>{row.booking === null ? "—" : money(row.booking)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </>
          )}

          {/* ── 총액 ── 1박 단가가 아니라 숙박 전체. */}
          <div className="spw-field">
            <label className="spw-field__l" htmlFor="opsbk-total">
              {copy.mbTotal}
            </label>
            <input
              aria-required="true"
              autoComplete="off"
              className="spw-field__in is-mono"
              id="opsbk-total"
              inputMode="numeric"
              onChange={(event) => {
                setTotalPrice(event.target.value.replace(/[^\d]/g, ""));
                setBasePrice(null);
                setPercent(0);
              }}
              placeholder={copy.mbTotalPlaceholder}
              type="text"
              value={totalDisplay}
            />
            <span className="spw-field__hint">{copy.mbTotalHint}</span>
          </div>

          <div className="spw-field">
            <label className="spw-field__l" htmlFor="opsbk-comments">
              {copy.spwOptional.replace("{label}", copy.mbComments)}
            </label>
            <textarea
              className="spw-field__area"
              id="opsbk-comments"
              onChange={(event) => setComments(event.target.value)}
              placeholder={copy.mbCommentsPlaceholder}
              rows={2}
              value={comments}
            />
          </div>

          {message && (
            <p className="spw-msg" role="status">
              {message}
            </p>
          )}
        </div>

        <div className="spw-foot is-panel">
          <button className="spw-btn" disabled={pending} onClick={onClose} type="button">
            {copy.mbCancel}
          </button>
          <button
            className="spw-btn is-primary"
            disabled={!!localInvalid || takenInStay.length > 0 || pending}
            onClick={submit}
            type="button"
          >
            {copy.mbSubmit}
          </button>
        </div>
      </aside>
    </>
  );
}

/** `YYYY-MM-DD` 다음 날. 시간대에 안 흔들리도록 UTC 정오로 고정한다. */
function nextDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}
