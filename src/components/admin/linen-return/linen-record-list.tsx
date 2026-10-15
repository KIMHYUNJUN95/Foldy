"use client";

// Admin 린넨 반품 콘솔 — 「기록」 뷰. 화이트 리디자인(2026-10-14, 시안 Linen-PC): 상자 없는 표 —
// 등록 일시(요일 아래) · 건물 · 반품 품목(요약 + 아래 전체 품목·수량) · 총 수량 · 등록자. 아바타 색 동그라미는 뺐다(hallmark 점검).
// 행을 잘라서 애매한 단일 품목으로 보이게 하지 않는다: 요약 아래에 항상 전체 품목·수량을 나열하고,
// 품목 필터가 걸리면 해당 품목 전용 수량 열을 덧붙인다. See docs/product/19-linen-defect-workflow.md.
import { LiveWash } from "@/components/shared/live-wash";
import type { AdminLinenRecordVM } from "@/lib/admin-linen-returns";
import type { Dictionary } from "@/lib/i18n";
import { dayOf, quantityOfItem, summaryOf, timeOf, tpl, weekdayLabel } from "./linen-console-data";

export type LinenCopy = Dictionary["linenReturn"];

type Props = {
  records: AdminLinenRecordVM[];
  t: LinenCopy["console"];
  units: Pick<LinenCopy, "quantityUnit" | "kindsUnit" | "summaryMore">;
  localeTag: string;
  /** linen_items.id 또는 "all" — 전용 열 기준. */
  itemFilter: string;
  itemFilterName: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function LinenRecordList({ records, t, units, localeTag, itemFilter, itemFilterName, selectedId, onSelect }: Props) {
  const showItemColumn = itemFilter !== "all";
  const totalQuantity = records.reduce((sum, r) => sum + r.totalQuantity, 0);

  return (
    <div className={`lfw-grid lnp-grid${showItemColumn ? " has-item" : ""}`}>
      <div className="lfw-count">
        <b>{tpl(t.wSummaryLine, { n: records.length })}</b>
        <span>{tpl(t.wSummaryRest, { q: totalQuantity })}</span>
      </div>
      <div className="lfw-gh">
        <span>{t.colRegisteredAt}</span>
        <span>{t.colBuilding}</span>
        <span>{t.colItems}</span>
        {showItemColumn ? <span className="r">{itemFilterName}</span> : null}
        <span className="r">{t.colTotalQty}</span>
        <span>{t.colRegistrant}</span>
      </div>
      <div className="lfw-rows">
        <LiveWash move sig={records.map((record) => record.id).join(",")}>{records.map((record) => {
          const day = dayOf(record.registeredAt);
          return (
            <button
              className={`lfw-gr${selectedId === record.id ? " on" : ""}`}
              key={record.id} data-live={record.id}
              onClick={() => onSelect(record.id)}
              type="button"
            >
              <span className="lnp-when num">
                <b>{`${day.slice(5, 7)}.${day.slice(8, 10)} ${timeOf(record.registeredAt)}`}</b>
                <span>{weekdayLabel(day, localeTag)}</span>
              </span>
              <span className="ell">{record.buildingLabel}</span>
              <span className="lnp-items">
                <b>{summaryOf(record, units.summaryMore, units.kindsUnit)}</b>
                <span>{record.lines.map((line) => `${line.name} ${line.quantity}`).join(" · ")}</span>
              </span>
              {showItemColumn ? <span className="r num lnp-q">{quantityOfItem(record, itemFilter)}</span> : null}
              <span className="r num lnp-q">{record.totalQuantity}</span>
              <span className="ell">{record.registrantName}</span>
            </button>
          );
        })}</LiveWash>
      </div>
    </div>
  );
}
