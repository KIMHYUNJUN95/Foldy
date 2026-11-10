"use client";

// Admin 주문·비품 console — 「배송 캘린더」 보기. 화이트 리디자인(2026-10-14, 시안 OrderCal-PC):
// 월~일 달력(세로선 없음 · 주 사이 가로선만), 칸마다 그날 배송 칩(품목 · 건물), 오늘은 보라 동그라미,
// 고른 날은 옅은 보라 바탕. 오른쪽에 그날 배송 목록(제목 · 건물 · 신청자 · 상태). 기간 배송은 걸친 날마다 칩.
// 건물 고르기는 보기 줄(orders-console.tsx)에서 — 여기엔 이미 좁혀진 orders 가 온다.
import { PackageOpen, TriangleAlert } from "lucide-react";
import { AdminMonthPicker, type AdminMonthPickerLabels } from "@/components/admin/shared/admin-month-picker";
import type { Locale } from "@/lib/i18n";
import type { AdminOrderVM } from "@/lib/admin-orders";
import { STATUS, dateToNum, delivOnDate, iso, sortForBoard, tpl, WD } from "./orders-console-data";
import { copyOf, localeTagOf, type OrdersCopy } from "./orders-console-shared";

export type CalMonth = { y: number; m: number };

type CalendarProps = {
  orders: AdminOrderVM[];
  t: OrdersCopy;
  locale: Locale;
  todayKey: string;
  calMonth: CalMonth;
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

/**
 * 보기 줄(orders-console.tsx)에 놓는 달 이동 — 공용 `AdminMonthPicker`(CLAUDE.md 4a, 2026-11-10: 예전엔 여기서 ‹ › 를 따로 그렸다)
 * + 「오늘」(이번 달로 가면서 오늘을 고른다). 주소는 바꾸지 않는다(`onSelect`).
 */
export function OrdersMonthNav({
  t,
  locale,
  todayKey,
  calMonth,
  onCalMonthChange,
  onToday,
  labels,
}: {
  t: OrdersCopy;
  locale: Locale;
  todayKey: string;
  calMonth: CalMonth;
  onCalMonthChange: (next: CalMonth) => void;
  onToday: () => void;
  labels: AdminMonthPickerLabels;
}) {
  const isThisMonth = calMonth.y === +todayKey.slice(0, 4) && calMonth.m === +todayKey.slice(5, 7) - 1;
  return (
    <span className="ow-mnav">
      <AdminMonthPicker
        basePath="/admin/orders"
        labels={labels}
        localeTag={localeTagOf(locale)}
        onSelect={(ym) => onCalMonthChange({ y: +ym.slice(0, 4), m: +ym.slice(5, 7) - 1 })}
        ym={monthKeyOf(calMonth)}
      />
      {!isThisMonth ? (
        <button type="button" className="ow-link" onClick={onToday}>
          {t.calToday}
        </button>
      ) : null}
    </span>
  );
}

export function OrdersCalendar({
  orders,
  t,
  locale,
  todayKey,
  calMonth,
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
