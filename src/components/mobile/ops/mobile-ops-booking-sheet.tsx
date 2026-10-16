"use client";

import { useMemo, useState, useTransition } from "react";
import { submitManualBooking } from "@/app/admin/ops/calendar/actions";
import {
  bookingErrorText,
  type BookingPanelCopy,
  type BookingPanelRate,
  type BookingPanelRoom,
} from "@/components/admin/ops/ops-booking-panel";
import { useRoomAvailability } from "@/components/admin/ops/use-room-availability";
import {
  MobileStayDates,
  MobileStepper,
  MswField,
  MswPhoneInput,
  MswSuccess,
  mdWeekday,
  useSuccessThen,
} from "@/components/mobile/ops/mobile-ops-form";
import { stayNights, validateManualBooking } from "@/lib/ops-manual-booking";

/**
 * 모바일 수기 예약 시트 — Claude Design 시안 `5a 예약 상세 · 수기 예약 시트 v3`(5e, 2026-10-02 사용자 확정).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「모바일 판매 캘린더」 → 예약 시트 v3
 *
 * **서버 경로 · 검사는 데스크톱 수기 예약 패널과 같다**(`submitManualBooking` · `validateManualBooking` · 빈방 읽기
 * `useRoomAvailability`). 모양만 모바일로: 격자에서 고른 객실 · 기간이 그대로 들어오고(날짜는 앱 날짜 시트로 바꿀 수 있다),
 * 빈방 확인 줄 · 인원 −/+ · 「요금으로 채우기」(채널별 합계 칩 — 누르면 총액에) · 전화 · 이메일 · 메모(선택).
 * 만들어지면 부모가 시트를 닫고 알림(「예약 만듦 · 이름 N박」 + 「열기」)을 띄운다.
 */

export type MobileBookingSheetCopy = BookingPanelCopy & {
  mbkAllFree: string;
  mOptional: string;
  today: string;
  mwBookTitle: string;
  mwRatesTotal: string;
  mwDone: string;
};

/** 「요금으로 채우기」 뒤 조정 % — 데스크톱 수기 예약 패널과 같은 값. */
const ADJUST_PRESETS = [-10, -5, 0, 5, 10] as const;

type Channel = "airbnb" | "booking";

export function MobileOpsBookingSheet({
  checkIn,
  checkOut,
  copy,
  localeTag,
  onCancel,
  onCreated,
  rateAt,
  room,
  today,
}: {
  checkIn: string;
  checkOut: string;
  copy: MobileBookingSheetCopy;
  localeTag: string;
  onCancel: () => void;
  /** 성공 — 부모가 시트를 닫고 알림. `reservationId` 가 있으면 알림의 「열기」로 상세를 연다. */
  onCreated: (created: { guestName: string; nights: number; reservationId: string | null }) => void;
  rateAt: (date: string) => BookingPanelRate;
  room: BookingPanelRoom;
  today: string;
}) {
  // 요청 키 — 패널을 연 동안 하나. 같은 키로는 서버가 예약을 한 번만 만든다(실패 뒤 다시 눌러도 중복 없음).
  const [requestKey] = useState(() => crypto.randomUUID());
  const [arrival, setArrival] = useState(checkIn);
  const [departure, setDeparture] = useState(checkOut);
  const [guestName, setGuestName] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [filledFrom, setFilledFrom] = useState<Channel | null>(null);
  const [percent, setPercent] = useState(0);
  const [numAdult, setNumAdult] = useState(1);
  const [numChild, setNumChild] = useState(0);
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [comments, setComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { done, succeed } = useSuccessThen();

  const nights = useMemo(() => stayNights(arrival, departure), [arrival, departure]);
  const availability = useRoomAvailability({
    roomIds: room.roomIds,
    roomKey: room.key,
    seedMonths: [checkIn.slice(0, 7), checkOut.slice(0, 7)],
    today,
  });
  const taken = availability.takenIn(nights);

  const rates = useMemo(() => {
    const rows = nights.map((night) => ({ night, ...rateAt(night) }));
    const sum = (channel: Channel) => {
      const known = rows.filter((row) => row[channel] !== null);
      return { partial: known.length !== rows.length, total: known.reduce((acc, row) => acc + (row[channel] ?? 0), 0) };
    };
    return { airbnb: sum("airbnb"), booking: sum("booking"), rows };
  }, [nights, rateAt]);

  const parsedPrice = totalPrice.trim() === "" ? null : Number(totalPrice);
  const input = { arrival, departure, guestName, numAdult, numChild, roomKey: room.key, totalPrice: parsedPrice };
  const localInvalid = validateManualBooking(input, today);

  const submit = () => {
    setError(null);
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
        // 만들어짐 — 초록 체크(햅틱) 뒤 부모가 시트를 닫고 알림(「열기」).
        succeed(() => onCreated({ guestName: guestName.trim(), nights: nights.length, reservationId: result.reservationId }));
        return;
      }
      setError(bookingErrorText(copy, result));
    });
  };

  const fill = (channel: Channel) => {
    setFilledFrom(channel);
    setPercent(0);
    setTotalPrice(String(rates[channel].total));
  };
  const adjust = (next: number) => {
    setPercent(next);
    if (filledFrom) setTotalPrice(String(Math.round(rates[filledFrom].total * (1 + next / 100))));
  };
  const money = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
  const anyRate = rates.airbnb.total > 0 || rates.booking.total > 0;
  const anyPartial = rates.airbnb.partial || rates.booking.partial;
  const optional = (label: string) => `${label} · ${copy.mOptional}`;

  return (
    <div className="msw">
      <div className="msw-body">
        <div className="msw-head">
          <div className="msw-head__t">
            <h3>{copy.mwBookTitle}</h3>
            <p>
              {[room.propertyName, room.label, `${arrival.slice(5).replace("-", "/")} → ${departure.slice(5).replace("-", "/")}`, copy.mbNights.replace("{n}", String(nights.length))]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <MobileStayDates
          arrival={arrival}
          checkInLabel={copy.mbCheckIn}
          checkOutLabel={copy.mbCheckOut}
          departure={departure}
          labels={{ nextMonth: copy.dateNext, prevMonth: copy.datePrev, today: copy.today }}
          locale={localeTag}
          onChange={(from, to) => {
            setArrival(from);
            setDeparture(to);
            setFilledFrom(null);
            setPercent(0);
          }}
          today={today}
        />
        {taken.length > 0 ? (
          <div className="msw-alert" role="alert">
            {copy.mbErrNightsTaken.replace("{dates}", taken.map((night) => night.slice(5).replace("-", "/")).join(", "))}
          </div>
        ) : availability.failed ? (
          <div className="msw-alert warn">{copy.mbAvailFailed}</div>
        ) : (
          <div className="msw-okline">{copy.mbkAllFree.replace("{n}", String(nights.length))}</div>
        )}

        <MswField label={copy.mbGuest}>
          <input
            autoComplete="off"
            className="msw-in"
            enterKeyHint="next"
            onChange={(event) => setGuestName(event.target.value)}
            placeholder={copy.mbGuestPlaceholder}
            type="text"
            value={guestName}
          />
        </MswField>

        <div className="msw-steps">
          <MobileStepper label={copy.mbAdults} min={1} onChange={setNumAdult} value={numAdult} />
          <MobileStepper label={copy.mbChildren} min={0} onChange={setNumChild} value={numChild} />
        </div>

        <div className="msw-two">
          <MswField label={optional(copy.mbEmail)}>
            <input
              autoComplete="email"
              className="msw-in"
              enterKeyHint="next"
              inputMode="email"
              onChange={(event) => setGuestEmail(event.target.value)}
              placeholder="name@mail.com"
              type="email"
              value={guestEmail}
            />
          </MswField>
          <MswField label={optional(copy.mbPhone)}>
            {/* 입력하며 자동 하이픈. 보내는 값은 숫자와 맨 앞 + 만. */}
            <MswPhoneInput onChange={setGuestPhone} placeholder="+81" value={guestPhone} />
          </MswField>
        </div>

        {nights.length > 0 && anyRate && (
          <div className="msw-step-sub">
            <div className="msw-sec">
              <span>{copy.mbFillFrom}</span>
              <small>{copy.mwRatesTotal.replace("{n}", String(nights.length))}</small>
            </div>
            <div className="msw-fills">
              {(["airbnb", "booking"] as const).map((channel) => {
                const rate = rates[channel];
                const disabled = rate.total <= 0;
                return (
                  <button
                    aria-pressed={filledFrom === channel}
                    className={`msw-fill${filledFrom === channel ? " on" : ""}`}
                    disabled={disabled}
                    key={channel}
                    onClick={() => fill(channel)}
                    type="button"
                  >
                    <span>{channel === "airbnb" ? copy.mbAirbnb : copy.mbBooking}</span>
                    <b>
                      {disabled ? "—" : money(rate.total)}
                      {rate.partial && !disabled ? "*" : ""}
                    </b>
                  </button>
                );
              })}
            </div>
            {filledFrom && (
              <div className="msw-adj">
                <span>{copy.mbAdjust}</span>
                <div className="msw-grid five">
                  {ADJUST_PRESETS.map((preset) => (
                    <button
                      aria-pressed={percent === preset}
                      className={`msw-opt${percent === preset ? " on" : ""}`}
                      key={preset}
                      onClick={() => adjust(preset)}
                      type="button"
                    >
                      {preset > 0 ? `+${preset}` : preset < 0 ? `−${Math.abs(preset)}` : "0"}%
                    </button>
                  ))}
                </div>
              </div>
            )}
            {anyPartial && <span className="msw-field__hint">{copy.mbRatesPartial}</span>}
            {/* 밤별 내역은 2박 이상일 때만, 접어서(데스크톱과 같다). */}
            {nights.length > 1 && (
              <details className="msw-nightly">
                <summary>
                  {copy.mbRates} · {copy.mbNights.replace("{n}", String(nights.length))}
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
                        <td>{mdWeekday(row.night, localeTag)}</td>
                        <td>{row.airbnb === null ? "—" : money(row.airbnb)}</td>
                        <td>{row.booking === null ? "—" : money(row.booking)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}

        <MswField hint={copy.mbTotalHint} label={copy.mbTotal}>
          <span className="msw-money sm">
            <input
              inputMode="numeric"
              onChange={(event) => {
                setTotalPrice(event.target.value.replace(/[^\d]/g, ""));
                setFilledFrom(null);
                setPercent(0);
              }}
              placeholder={copy.mbTotalPlaceholder}
              type="text"
              value={totalPrice === "" ? "" : Number(totalPrice).toLocaleString("ja-JP")}
            />
          </span>
        </MswField>

        <MswField label={optional(copy.mbComments)}>
          <textarea
            className="msw-in"
            onChange={(event) => setComments(event.target.value)}
            placeholder={copy.mbCommentsPlaceholder}
            rows={2}
            value={comments}
          />
        </MswField>

        {error && (
          <div className="msw-alert" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="msw-foot two">
        <button className="msw-btn ghost" disabled={pending} onClick={onCancel} type="button">
          {copy.mbCancel}
        </button>
        <button
          className="msw-btn"
          disabled={pending || localInvalid !== null || taken.length > 0}
          onClick={submit}
          type="button"
        >
          {copy.mbSubmit}
        </button>
      </div>
      {done && <MswSuccess label={copy.mwDone} />}
    </div>
  );
}
