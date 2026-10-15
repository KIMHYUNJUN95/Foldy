"use client";

// Admin 주문·비품 console — 「처리 중」 보기. 화이트 리디자인(2026-10-14, 시안 Order-PC):
// 이번 주 배송 7칸(월~일, 오늘 옅은 보라) → 승인 대기 · 주문 대기 두 묶음. 줄은 상자 없이 가로선만,
// 오른쪽 끝 글자 버튼(승인 · 주문 처리)으로 바로 처리 창을 연다. 진하게 칠한 버튼은 상세 패널에만 둔다.
import { LiveWash } from "@/components/shared/live-wash";
import { CircleCheck, TriangleAlert } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminOrderVM } from "@/lib/admin-orders";
import { delivOnDate, iso, parseTs, sortForBoard, tpl, weekWindow, WD } from "./orders-console-data";
import type { OrdersCopy } from "./orders-console-shared";
import type { OrdActionKind } from "./orders-detail-panel";

type QueueProps = {
  orders: AdminOrderVM[];
  t: OrdersCopy;
  locale: Locale;
  todayKey: string;
  selectedId: string | null;
  loadError?: boolean;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onAction: (kind: OrdActionKind, id: string) => void;
  onOpenCalendar: () => void;
};

/** 요청 시각(도쿄 "YYYY-MM-DD HH:MM")부터 지금까지 — 「방금 · n시간 전 · n일 전」. */
export function ageText(reqAt: string, t: OrdersCopy): string {
  const then = parseTs(reqAt);
  if (then === null) return "";
  const nowTokyo = Math.floor(Date.now() / 60000) + 9 * 60;
  const mins = Math.max(0, nowTokyo - then);
  if (mins < 60) return t.wAgoNow;
  if (mins < 24 * 60) return tpl(t.wAgoH, { n: Math.floor(mins / 60) });
  return tpl(t.wAgoD, { n: Math.floor(mins / (24 * 60)) });
}

function itemLine(o: AdminOrderVM): string {
  return o.items.map((it) => it.name).join(" · ");
}

export function OrdersQueue({ orders, t, locale, todayKey, selectedId, loadError, onRetry, onSelect, onAction, onOpenCalendar }: QueueProps) {
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

  const w = weekWindow(todayKey);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date((w.from + i) * 86400000);
    const key = iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const list = orders.filter((o) => o.status === "ordered" && delivOnDate(o.deliv, key));
    return { key, date: d.getUTCDate(), dow: WD[locale][(i + 1) % 7], list };
  });
  const startLabel = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(w.from * 86400000));
  const endLabel = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(new Date((w.from + 6) * 86400000));

  const requested = sortForBoard(orders.filter((o) => o.status === "requested"));
  const approved = sortForBoard(orders.filter((o) => o.status === "approved"));
  const groups = [
    { key: "requested", title: t.kpiRequested, hint: t.wGrpRequestedHint, rows: requested, act: "approve" as const, actLabel: t.actApprove },
    { key: "approved", title: t.kpiApproved, hint: t.wGrpApprovedHint, rows: approved, act: "process" as const, actLabel: t.actProcess },
  ];

  return (
    <div className="ow-queue">
      <section className="ow-week" aria-label={t.wWeekT}>
        <div className="ow-sech">
          <b>{t.wWeekT}</b>
          <span className="num">
            {startLabel} – {endLabel}
          </span>
          <button type="button" className="ow-link" onClick={onOpenCalendar}>
            {t.wToCal} →
          </button>
        </div>
        <div className="ow-week__grid">
          {days.map((d) => (
            <div key={d.key} className={`ow-wd${d.key === todayKey ? " is-today" : ""}`}>
              <span className="ow-wd__h">
                <span>{d.dow}</span>
                <b className="num">{d.date}</b>
              </span>
              {d.list.slice(0, 2).map((o) => (
                <button key={o.id} type="button" className="ow-wd__it" onClick={() => onSelect(o.id)}>
                  {o.items[0]?.name ?? o.title}
                </button>
              ))}
              {d.list.length > 2 ? <span className="ow-wd__more">+{d.list.length - 2}</span> : null}
            </div>
          ))}
        </div>
      </section>

      {requested.length + approved.length === 0 ? (
        <div className="lfw-empty">
          <CircleCheck aria-hidden="true" />
          <b>{t.wQueueEmptyT}</b>
          <span>{t.wQueueEmptyS}</span>
        </div>
      ) : (
        groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <section key={g.key} className="ow-grp">
              <div className="ow-grp__h">
                <b>{g.title}</b>
                <span className="num">{g.rows.length}</span>
                <span className="ow-grp__hint">{g.hint}</span>
              </div>
              <div className="lfw-rows">
                <LiveWash move sig={g.rows.map((o) => o.id).join(",")}>{g.rows.map((o) => {
                  const age = ageText(o.reqAt, t);
                  return (
                    <div
                      key={o.id} data-live={o.id}
                      className={`lfw-tr ow-qr${selectedId === o.id ? " on" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(o.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(o.id);
                        }
                      }}
                    >
                      <span className="lfw-tr__txt">
                        <span className="ow-qr__t">
                          {o.urgency === "high" ? <em className="ow-urg">{t.urgent}</em> : null}
                          <b>{o.title}</b>
                        </span>
                        <span>{itemLine(o)}</span>
                      </span>
                      <span className="lfw-tr__loc">
                        <b>{o.buildingLabel}</b>
                      </span>
                      <span className="ow-qr__who">{o.reporterName}</span>
                      <span className="ow-qr__age num" suppressHydrationWarning>
                        {g.key === "approved" ? tpl(t.wReqAgo, { t: age }) : age}
                      </span>
                      <button
                        type="button"
                        className="ow-act"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAction(g.act, o.id);
                        }}
                      >
                        {g.actLabel}
                      </button>
                    </div>
                  );
                })}</LiveWash>
              </div>
            </section>
          ))
      )}
    </div>
  );
}
