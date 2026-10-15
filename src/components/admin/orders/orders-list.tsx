"use client";

// Admin 주문·비품 console — 「전체 기록」 보기. 화이트 리디자인(2026-10-14, 시안 OrderAll-PC): 상자 없는 표 —
// 요청일 · 제목(긴급이면 빨간 「긴급」) · 건물 · 요청자 · 상태(거절은 회색) · 배송. 고르기 · 검색 · 기간은
// 콘솔(orders-console.tsx)이 적용해 행만 넘겨준다. 예전 「완료」 보기는 여기 상태 고르기로 합쳤다.
import { LiveWash } from "@/components/shared/live-wash";
import { SearchX, TriangleAlert } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminOrderVM } from "@/lib/admin-orders";
import { STATUS } from "./orders-console-data";
import { copyOf, type OrdersCopy } from "./orders-console-shared";

type ListProps = {
  rows: AdminOrderVM[];
  t: OrdersCopy;
  locale: Locale;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearFilters: () => void;
  loadError?: boolean;
  onRetry: () => void;
};

/** "YYYY-MM-DD" → "10/9" (요일 없는 짧은 표기 · 도쿄 날짜 키 그대로). */
export function shortDate(d: string): string {
  return `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
}

export function delivShort(o: AdminOrderVM): string | null {
  if (!o.deliv) return null;
  return o.deliv.mode === "range" ? `${shortDate(o.deliv.start)}–${shortDate(o.deliv.end)}` : shortDate(o.deliv.date);
}

export function OrdersList({ rows, t, selectedId, onSelect, onClearFilters, loadError, onRetry }: ListProps) {
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

  if (!rows.length) {
    return (
      <div className="lfw-empty">
        <SearchX aria-hidden="true" />
        <b>{t.emptyListT}</b>
        <span>{t.emptyListS}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClearFilters}>
          {t.clearFilter}
        </button>
      </div>
    );
  }

  return (
    <div className="lfw-grid ow-grid">
      <div className="lfw-gh">
        <span>{t.wColReqDate}</span>
        <span>{t.colTitle}</span>
        <span>{t.wColBuilding}</span>
        <span>{t.colReporter}</span>
        <span>{t.colStatus}</span>
        <span className="r">{t.wColDeliv}</span>
      </div>
      <div className="lfw-rows">
        <LiveWash move sig={rows.map((o) => o.id).join(",")}>{rows.map((o) => {
          const deliv = delivShort(o);
          return (
            <button
              key={o.id} data-live={o.id}
              type="button"
              className={`lfw-gr${selectedId === o.id ? " on" : ""}`}
              onClick={() => onSelect(o.id)}
            >
              <b className="num">{shortDate(o.reqDate)}</b>
              <span className="ell ow-gr__t">
                {o.urgency === "high" ? <em className="ow-urg">{t.urgent}</em> : null}
                <span className="strong">{o.title}</span>
              </span>
              <span className="ell">{o.buildingLabel}</span>
              <span className="ell">{o.reporterName}</span>
              <span className={o.status === "closed" ? "dim" : ""}>
                {o.status === "closed" ? t.wStClosed : copyOf(t, STATUS[o.status].key)}
              </span>
              <span className="r num">{deliv ?? <span className="dim">—</span>}</span>
            </button>
          );
        })}</LiveWash>
      </div>
    </div>
  );
}
