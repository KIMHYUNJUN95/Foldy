"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import type { OpsRecentBooking } from "@/lib/ops-calendar";
import {
  RECENT_BOOKINGS_DEFAULT_HOURS,
  RECENT_BOOKINGS_MAX_SPAN_DAYS,
  tokyoDateOf,
  tokyoMs,
  tokyoParts,
} from "@/lib/ops-recent-bookings-range";
import { ListLoading } from "./ops-price-wins-panel";
import { useBuildingName } from "@/components/shared/building-names";
import "./ops-calendar-tools-white.css";

/**
 * 최근 예약 목록 — 오른쪽 사이드 패널(모바일은 같은 것을 하단 시트에 담는다). 2026-10-05.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「최근 예약」
 *
 * 가격 개입 성공 목록(`ops-price-wins-panel.tsx`)과 같은 뼈대 — 머리(건수 · 시간대) · 한 줄 = 예약 하나(방 · 숙박 ·
 * 채널 · 손님 · 금액 · 몇 시간 전) · 누르면 예약 상세. 머리의 「기간 바꾸기」로 시작 · 끝(도쿄 날짜 + 시각)을 정한다
 * — **날짜만**(콘솔 공용 범위 달력 `AdminDateRangePicker`): 시작일 0시부터 끝날 24시까지, 끝이 오늘이면 지금까지
 * (2026-10-05 사용자 결정 「시각은 자정으로 통일」).
 *
 * 화이트 리디자인(2026-10-16, 시안 SalesRecent-PC · Phone): 머리 「N건 · 24시간」 + 빠른 시간대 탭(1 · 6 · 24 · 48시간 ·
 * 3일 — 48시간 = 기본) + 날짜로 고르기(기존 범위 달력). 빠른 탭은 「지금부터 N시간 전 ~ 지금」을 직접 지정으로 보낸다
 * (`onApplyRange` — 서버가 끝을 지금으로 자른다). 줄 = 채널 점 · 손님 · 금액 / 객실 · 숙박 · 몇 분(시간) 전 / 채널 · 예약 시각.
 */

export type RecentBookingsCopy = {
  rbTitle: string;
  rbCount: string;
  rbNow: string;
  rbEdit: string;
  rbReset: string;
  rbDefaultNote: string;
  rbCustomNote: string;
  rbInvalid: string;
  rbEmpty: string;
  rbAgo: string;
  rbScopeNote: string;
  rbAgoMin: string;
  rbPresetHours: string;
  rbPresetDays: string;
  pwAllProperties: string;
  pwLoading: string;
  pwBookedAt: string;
  rcClose: string;
  datePrev: string;
  dateNext: string;
  dateThisMonth: string;
  dateReset: string;
  dateApply: string;
};

const CHANNEL_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking.com", manual: "Direct" };
const money = (value: number) => `¥${Math.round(value).toLocaleString()}`;
const shortDate = (date: string) => date.slice(5).replace("-", "/");

function stamp(iso: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

/** 시간대 라벨 — 기본 「10/05 11:20 – 지금」(48시간이라 시각까지), 직접 지정 「10/03 – 지금」 · 「10/03 – 10/04」(끝날 포함). */
export type RecentRange = { from: string; to: string; isDefault: boolean; endsNow: boolean };

export function recentRangeLabel(range: RecentRange, nowLabel: string): string {
  const fromMs = Date.parse(range.from);
  const start = range.isDefault ? `${shortDate(tokyoDateOf(fromMs))} ${tokyoParts(fromMs).time}` : shortDate(tokyoDateOf(fromMs));
  // 끝이 「지금」인지는 서버가 알려 준다(기본이거나, 끝날이 오늘이라 지금으로 잘렸을 때).
  return `${start} – ${range.endsNow ? nowLabel : shortDate(lastDayOf(range))}`;
}

/** 끝(배타 — 다음 날 0시)의 하루 전 = 끝날. */
function lastDayOf(range: RecentRange): string {
  return tokyoDateOf(Date.parse(range.to) - 1);
}

/** 빠른 시간대(시간). 48 = 기본(서버 기본 창). */
const PRESET_HOURS = [1, 6, 24, RECENT_BOOKINGS_DEFAULT_HOURS, 72] as const;

/** 「지금부터 N시간 전 ~ 지금」 — 끝은 한 시간 넉넉히 보내고 서버가 지금으로 자른다(`endsNow` 가 참이 되게). */
function presetRange(hours: number): { from: string; to: string } {
  const now = Date.now();
  return { from: new Date(now - hours * 3_600_000).toISOString(), to: new Date(now + 3_600_000).toISOString() };
}

/** 지금 범위가 빠른 탭 중 하나인가 — 기본이면 48, 직접 지정이 「N시간 전 ~ 지금」이면 N(몇 분 오차 허용). */
function activePreset(range: RecentRange | null): number | null {
  if (!range) return null;
  if (range.isDefault) return RECENT_BOOKINGS_DEFAULT_HOURS;
  if (!range.endsNow) return null;
  const hours = (Date.parse(range.to) - Date.parse(range.from)) / 3_600_000;
  return PRESET_HOURS.find((preset) => Math.abs(preset - hours) < 0.1) ?? null;
}

export function OpsRecentBookingsPanel({
  bookings,
  copy,
  localeTag,
  onApplyRange,
  onClose,
  onOpenReservation,
  onResetRange,
  propertyName,
  range,
}: {
  /** `null` = 받는 중. */
  bookings: OpsRecentBooking[] | null;
  copy: RecentBookingsCopy;
  localeTag: string;
  onApplyRange: (from: string, to: string) => void;
  onClose: () => void;
  onOpenReservation: (booking: OpsRecentBooking) => void;
  onResetRange: () => void;
  propertyName: string | null;
  range: RecentRange | null;
}) {
  // 건물 이름은 보는 사람 언어로 — 모바일 판매 캘린더에서 열릴 때(공급자 밖인 어드민에선 그대로).
  const bName = useBuildingName();
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { quietRestore: true });
  const list = bookings ?? [];
  const [invalid, setInvalid] = useState(false);
  const [nowMsForRange] = useState(() => Date.now());
  const today = tokyoDateOf(nowMsForRange);

  /** 범위 달력에서 고른 날짜 → 시작일 0시 ~ 끝날 다음 날 0시(서버가 지금 이후를 지금으로 자른다). */
  const applyDates = (fromDate: string, toDate: string) => {
    if (!fromDate || !toDate) {
      onResetRange();
      return;
    }
    const fromMs = tokyoMs(fromDate);
    const toMs = tokyoMs(toDate) + 86_400_000;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs - fromMs > RECENT_BOOKINGS_MAX_SPAN_DAYS * 86_400_000) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onApplyRange(new Date(fromMs).toISOString(), new Date(toMs).toISOString());
  };
  const pickerFrom = range ? tokyoDateOf(Date.parse(range.from)) : "";
  const pickerTo = range ? (range.endsNow ? today : lastDayOf(range)) : "";
  // 「N시간 전」의 기준 — 패널을 연 순간(렌더마다 시계를 읽지 않는다).
  const [nowMs] = useState(() => Date.now());
  const preset = activePreset(range);
  const presetLabel = (hours: number) =>
    hours >= 72 ? copy.rbPresetDays.replace("{n}", String(hours / 24)) : copy.rbPresetHours.replace("{n}", String(hours));
  /** 빠른 탭 — 48시간은 기본으로, 나머지는 「지금부터 N시간 전 ~ 지금」. 끝은 넉넉히 보내고 서버가 지금으로 자른다. */
  const applyPreset = (hours: number) => {
    setInvalid(false);
    if (hours === RECENT_BOOKINGS_DEFAULT_HOURS) {
      onResetRange();
      return;
    }
    const { from, to } = presetRange(hours);
    onApplyRange(from, to);
  };
  const ago = (iso: string) => {
    const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
    if (minutes < 60) return copy.rbAgoMin.replace("{m}", String(minutes));
    return copy.rbAgo.replace("{h}", String(Math.round((minutes / 60) * 10) / 10));
  };

  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside aria-label={copy.rbTitle} aria-modal="true" className="panel stw-panel stw-rb" ref={panelRef} role="dialog" tabIndex={-1}>
        <div className="panel__h stw-h">
          <div className="stw-h__row">
            <div className="stw-h__txt">
              <span className="stw-h__kicker">
                {copy.rbTitle} · {propertyName ?? copy.pwAllProperties}
              </span>
              <b className="stw-h__title">
                {bookings ? copy.rbCount.replace("{n}", String(list.length)) : copy.pwLoading}
                {range && (
                  <span className="stw-h__aside">
                    {" · "}
                    {preset !== null ? presetLabel(preset) : recentRangeLabel(range, copy.rbNow)}
                  </span>
                )}
              </b>
              <span className="stw-h__sub">{range ? recentRangeLabel(range, copy.rbNow) : "…"}</span>
            </div>
            <button aria-label={copy.rcClose} className="panel__x stw-x" onClick={onClose} type="button">
              <X />
            </button>
          </div>
          <div className="stw-seg is-fill" role="group" aria-label={copy.rbEdit}>
            {PRESET_HOURS.map((hours) => (
              <button
                aria-pressed={preset === hours}
                className={preset === hours ? "on" : undefined}
                key={hours}
                onClick={() => applyPreset(hours)}
                type="button"
              >
                {presetLabel(hours)}
              </button>
            ))}
          </div>
          <div className="stw-rb__range">
            <AdminDateRangePicker
              ariaLabel={copy.rbEdit}
              from={pickerFrom}
              isDateDisabled={(dateKey) => dateKey > today}
              labels={{
                apply: copy.dateApply,
                nextMonth: copy.dateNext,
                prevMonth: copy.datePrev,
                reset: copy.dateReset,
                thisMonth: copy.dateThisMonth,
              }}
              localeTag={localeTag}
              onChange={applyDates}
              to={pickerTo}
            />
            {range && !range.isDefault && (
              <button className="stw-link" onClick={onResetRange} type="button">
                {copy.rbReset}
              </button>
            )}
          </div>
          {invalid && (
            <p className="stw-msg is-warn" role="alert">
              {copy.rbInvalid}
            </p>
          )}
        </div>

        <div className="panel__body stw-body">
          {bookings === null ? (
            <ListLoading label={copy.pwLoading} />
          ) : list.length === 0 ? (
            <p className="stw-empty">{copy.rbEmpty}</p>
          ) : (
            <ul className="stw-list">
              {list.map((row, index) => (
                <li className="stw-item is-row" key={row.reservationId} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
                  <button className="stw-row has-dot" onClick={() => onOpenReservation(row)} type="button">
                    <i aria-hidden="true" className={`stw-chdot is-${row.channel}`} />
                    <span className="stw-row__l">
                      <b className="stw-row__name">{row.guestName}</b>
                      <span className="stw-row__sub">
                        {bName(row.propertyName)} {row.roomLabel === row.propertyName ? "" : row.roomLabel} · {shortDate(row.checkIn)} → {shortDate(row.checkOut)}
                      </span>
                      <span className="stw-row__meta">
                        {CHANNEL_LABEL[row.channel] ?? row.channel} ·{" "}
                        {copy.pwBookedAt.replace("{time}", stamp(row.bookedAt, localeTag))}
                      </span>
                    </span>
                    <span className="stw-row__r">
                      <b className="stw-row__amt">{row.amount > 0 ? money(row.amount) : "—"}</b>
                      <span className="stw-row__time">{ago(row.bookedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="stw-note">
            {range && !range.isDefault ? copy.rbCustomNote : copy.rbDefaultNote} {copy.rbScopeNote}
          </p>
        </div>
      </aside>
    </>
  );
}
