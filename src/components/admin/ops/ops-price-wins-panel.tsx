"use client";

import { X } from "lucide-react";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import type { OpsPriceConversion } from "@/lib/ops-calendar";
import {
  PRICE_ATTRIBUTION_WINDOW_HOURS,
} from "@/lib/ops-price-attribution";
import "./ops-calendar-tools-white.css";

/**
 * 가격 개입 성공 목록 — 오른쪽 사이드 패널.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「가격 개입 전환」
 * 원본: 저쪽 캘린더 「Price-Driven Bookings」 모달
 *
 * 한 줄 = 예약 하나: 어느 방·어느 숙박 · 누가 · **그 예약의 방·날짜에서 얼마를 바꿨나(±%)** ·
 * **몇 시간 만에 들어왔나**. 누르면 예약 상세가 열린다.
 *
 * 저쪽 목록은 캘린더에 보이는 기간의 숙박만 담아 나머지는 다른 화면에 있었다. 여기는 **가격을 바꾼
 * 시각 기준 최근 90일 전체**다(창과 무관).
 *
 * 화이트 리디자인(2026-10-16, 시안 SalesWins-PC · Phone): 줄 = 손님(굵게) · 예약 시각 / 객실 · 숙박 →
 * 「이전 → **이후** ±%」 / 채널 · 바꾼 박 · 누가 · 몇 시간 만에. 모양은 `ops-calendar-tools-white.css` 의 `stw-*`.
 */

export type PriceWinsCopy = {
  pwTitle: string;
  pwSubtitle: string;
  pwAllProperties: string;
  pwCount: string;
  pwAverage: string;
  pwNights: string;
  pwHours: string;
  pwBookedAt: string;
  pwEmpty: string;
  pwLoading: string;
  pwScopeNote: string;
  pwHoursAfter: string;
  pwTapHint: string;
  rcClose: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  manual: "Direct",
};

const money = (value: number) => `¥${Math.round(value).toLocaleString()}`;

function stamp(iso: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

const shortDate = (date: string) => date.slice(5).replace("-", "/");

export function OpsPriceWinsPanel({
  conversions,
  copy,
  localeTag,
  onClose,
  onOpenReservation,
  propertyName,
  windowLabel,
}: {
  /**
   * **`null` 이면 아직 받는 중이다** — 가격 개입 판정은 격자가 그린 뒤 서버 액션으로 따로 온다
   * (2026-09-30 속도).
   */
  conversions: OpsPriceConversion[] | null;
  copy: PriceWinsCopy;
  localeTag: string;
  onClose: () => void;
  onOpenReservation: (conversion: OpsPriceConversion) => void;
  /** 건물 필터. 없으면 전체. */
  propertyName: string | null;
  /** 보고 있는 창(「9/28–10/27」) — 목록은 이 창 안 숙박만이다(2026-10-02). */
  windowLabel: string;
}) {
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { quietRestore: true });
  const list = conversions ?? [];
  const averageHours =
    list.length > 0
      ? Math.round((list.reduce((sum, row) => sum + row.hoursToBooking, 0) / list.length) * 10) / 10
      : null;

  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside
        aria-label={copy.pwTitle}
        aria-modal="true"
        className="panel stw-panel stw-pw"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="panel__h stw-h">
          <div className="stw-h__row">
            <div className="stw-h__txt">
              <span className="stw-h__kicker">
                {copy.pwTitle} · {propertyName ?? copy.pwAllProperties}
              </span>
              <b className="stw-h__title">
                {conversions ? copy.pwCount.replace("{n}", String(list.length)) : copy.pwLoading}
                {averageHours !== null && (
                  <span className="stw-h__aside"> · {copy.pwAverage.replace("{h}", String(averageHours))}</span>
                )}
              </b>
              <span className="stw-h__sub">
                {copy.pwSubtitle
                  .replace("{h}", String(PRICE_ATTRIBUTION_WINDOW_HOURS))
                  .replace("{range}", windowLabel)}
              </span>
            </div>
            <button aria-label={copy.rcClose} className="panel__x stw-x" onClick={onClose} type="button">
              <X />
            </button>
          </div>
        </div>

        <div className="panel__body stw-body">
          {conversions === null ? (
            <ListLoading label={copy.pwLoading} />
          ) : list.length === 0 ? (
            <p className="stw-empty">{copy.pwEmpty}</p>
          ) : (
            <ul className="stw-list">
              {list.map((row, index) => {
                const down = row.delta !== null && row.delta < 0;
                const up = row.delta !== null && row.delta > 0;
                return (
                  <li className="stw-item is-row" key={row.reservationId} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
                    <button className="stw-row" onClick={() => onOpenReservation(row)} type="button">
                      <span className="stw-row__l">
                        <b className="stw-row__name">{row.guestName}</b>
                        <span className="stw-row__sub">
                          {row.propertyName} {row.roomLabel} · {shortDate(row.checkIn)} → {shortDate(row.checkOut)}
                        </span>
                        <span className="stw-row__meta">
                          {[
                            CHANNEL_LABEL[row.channel] ?? row.channel,
                            copy.pwNights.replace("{n}", String(row.nights)),
                            row.changedBy,
                            copy.pwHoursAfter.replace("{h}", String(row.hoursToBooking)),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="stw-row__r">
                        <span className="stw-row__time">{stamp(row.bookedAt, localeTag)}</span>
                        {/* 얼마를 바꿨나 — 그 예약의 방·날짜에서만 뽑은 값이다(추정 아님). */}
                        <span className="stw-row__price">
                          <span className="stw-row__from">{row.oldAverage !== null ? money(row.oldAverage) : "—"}</span>
                          <span aria-hidden="true"> → </span>
                          <b className={down ? "is-down" : up ? "is-up" : undefined}>
                            {row.newAverage !== null ? money(row.newAverage) : "—"}
                          </b>
                          {row.percent !== null && (
                            <em>
                              {row.percent > 0 ? "+" : row.percent < 0 ? "−" : ""}
                              {Math.abs(row.percent)}%
                            </em>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {list.length > 0 && <p className="stw-hint">{copy.pwTapHint}</p>}
          {/* 무엇이 안 잡히는지 적어 둔다 — 「왜 이 예약은 없지?」가 반드시 나온다. */}
          <p className="stw-note">{copy.pwScopeNote.replace("{h}", String(PRICE_ATTRIBUTION_WINDOW_HOURS))}</p>
        </div>
      </aside>
    </>
  );
}

/** 받는 중 — 글자 + 줄 뼈대(최종 줄 높이). */
export function ListLoading({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="stw-skel">
      <span className="stw-sronly">{label}</span>
      {[0, 1, 2, 3].map((index) => (
        <div className="stw-skel__row" key={index}>
          <span className="w60" />
          <span className="w80" />
        </div>
      ))}
    </div>
  );
}
