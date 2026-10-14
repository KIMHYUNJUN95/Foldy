"use client";

// Admin 주문·비품 console — 「배송 캘린더」 보기. 화이트 리디자인(2026-10-14, 시안 OrderCal-PC):
// 월~일 달력(세로선 없음 · 주 사이 가로선만), 칸마다 그날 배송 칩(품목 · 건물), 오늘은 보라 동그라미,
// 고른 날은 옅은 보라 바탕. 오른쪽에 그날 배송 목록(제목 · 건물 · 신청자 · 상태). 기간 배송은 걸친 날마다 칩.
// 건물 고르기는 보기 줄(orders-console.tsx)에서 — 여기엔 이미 좁혀진 orders 가 온다.
import { ChevronLeft, ChevronRight, PackageOpen, TriangleAlert } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminOrderVM } from "@/lib/admin-orders";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { STATUS, dateToNum, delivOnDate, fmtMonth, iso, sortForBoard, tpl, WD } from "./orders-console-data";
import { copyOf, type OrdersCopy } from "./orders-console-shared";

export type CalMonth = { y: number; m: number };

type CalendarProps = {
  orders: AdminOrderVM[];
  t: OrdersCopy;
  locale: Locale;
  todayKey: string;
  calMonth: CalMonth;
  onCalMonthChange: (next: CalMonth) => void;
  calSel: string | null;
  onCalSelChange: (v: string | null) => void;
  onSelectOrder: (id: string) => void;
  loadError?: boolean;
  onRetry: () => void;
};

const MAX_CHIPS = 2;

function monthKeyOf(m: CalMonth): string {
  return `${m.y}-${String(m.m + 1).padStart(2, "0")}`;
}

function shift(m: CalMonth, delta: number): CalMonth {
  const key = shiftMonthKey(monthKeyOf(m), delta);
  return { y: +key.slice(0, 4), m: +key.slice(5, 7) - 1 };
}

export function OrdersCalendar({
  orders,
  t,
  locale,
  todayKey,
  calMonth,
  onCalMonthChange,
  calSel,
  onCalSelChange,
  onSelectOrder,
  loadError,
  onRetry,
}: CalendarProps) {
  if (loadError) {
    return (
      <div className="lfw-empty">
        <TriangleAlert aria-hidden="true" />
        <b>{t.errT}</b>
        <span>{t.errS}</span>
        <button type="button" className="btn btn--pri btn--sm" onClick={onRetry}>
          {t.retry}
        </button>
      </div>
    );
  }

  const { y, m } = calMonth;
  const ordered = orders.filter((o) => o.status === "ordered" && o.deliv);
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Mon = 0
  const cells: ({ key: string; d: number } | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ key: iso(y, m, i + 1), d: i + 1 })),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const wd = Array.from({ length: 7 }, (_, i) => WD[locale][(i + 1) % 7]);

  const dayList = calSel ? sortForBoard(ordered.filter((o) => delivOnDate(o.deliv, calSel))) : [];
  const diff = calSel ? dateToNum(calSel) - dateToNum(todayKey) : null;
  const rel = diff === 0 ? t.calToday : diff === 1 ? t.wTomorrow : null;
  const selLabel = calSel
    ? new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
        new Date(dateToNum(calSel) * 86400000),
      )
    : "";

  return (
    <div className="ow-cal">
      <div className="ow-cal__main">
        <div className="ow-cal__head">
          <button type="button" className="ow-navb" aria-label={t.wPrevMonth} onClick={() => onCalMonthChange(shift(calMonth, -1))}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <b className="num">{fmtMonth(y, m, locale)}</b>
          <button type="button" className="ow-navb" aria-label={t.wNextMonth} onClick={() => onCalMonthChange(shift(calMonth, 1))}>
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ow-link"
            onClick={() => {
              onCalMonthChange({ y: +todayKey.slice(0, 4), m: +todayKey.slice(5, 7) - 1 });
              onCalSelChange(todayKey);
            }}
          >
            {t.calToday}
          </button>
        </div>
        <div className="ow-cal__wd">
          {wd.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div className="ow-cal__wk" key={wi}>
            {week.map((c, ci) =>
              c ? (
                <button
                  key={c.key}
                  type="button"
                  className={`ow-day${calSel === c.key ? " on" : ""}${c.key === todayKey ? " is-today" : ""}`}
                  onClick={() => onCalSelChange(c.key)}
                >
                  <span className="ow-day__n num">{c.d}</span>
                  {(() => {
                    const list = sortForBoard(ordered.filter((o) => delivOnDate(o.deliv, c.key)));
                    return (
                      <>
                        {list.slice(0, MAX_CHIPS).map((o) => (
                          <span key={o.id} className={`ow-chip${o.urgency === "high" ? " is-urg" : ""}`}>
                            {o.items[0]?.name ?? o.title} · {o.buildingLabel}
                          </span>
                        ))}
                        {list.length > MAX_CHIPS ? <span className="ow-day__more">+{list.length - MAX_CHIPS}</span> : null}
                      </>
                    );
                  })()}
                </button>
              ) : (
                <span key={`x${ci}`} className="ow-day is-blank" aria-hidden="true" />
              ),
            )}
          </div>
        ))}
      </div>

      <aside className="ow-cal__side" aria-live="polite">
        {calSel ? (
          <>
            <span className="ow-cal__kick">{t.wDelivKicker}</span>
            <b className="ow-cal__date">{selLabel}</b>
            <span className="ow-cal__sub">
              {tpl(t.wDayCount, { n: dayList.length })}
              {rel ? ` · ${rel}` : ""}
            </span>
            {dayList.length ? (
              <div className="ow-cal__list">
                {dayList.map((o) => (
                  <button key={o.id} type="button" className="ow-cal__row" onClick={() => onSelectOrder(o.id)}>
                    <b>
                      {o.urgency === "high" ? <em className="ow-urg">{t.urgent}</em> : null}
                      {o.title}
                    </b>
                    <span>
                      {o.buildingLabel} · {tpl(t.wReqBy, { who: o.reporterName })} · {copyOf(t, STATUS[o.status].key)}
                      {o.deliv?.mode === "range"
                        ? ` · ${+o.deliv.start.slice(5, 7)}/${+o.deliv.start.slice(8)}–${+o.deliv.end.slice(5, 7)}/${+o.deliv.end.slice(8)}`
                        : ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="ow-cal__empty">
                <PackageOpen aria-hidden="true" />
                {t.calNoDeliv}
              </div>
            )}
          </>
        ) : (
          <div className="ow-cal__empty">{t.wCalPick}</div>
        )}
      </aside>
    </div>
  );
}
