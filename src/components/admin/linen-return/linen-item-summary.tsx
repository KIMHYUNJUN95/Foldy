"use client";

// Admin 린넨 반품 콘솔 — 「품목별 수량」 뷰. 화이트 리디자인(2026-10-14, 시안 LinenItems-PC): 상자 없는 표 —
// 품목 · 수량 막대(채워지며 등장) · 수량 · (건물을 좁혔으면 전체 건물) · 기록 수 · 최종 반품.
// 품목 필터는 이 뷰에서 의도적으로 무시하고(항상 전체 품목), 행을 누르면 그 품목으로 「기록」 뷰를 좁힌다.
// 반품이 없던 품목도 0 으로 남겨(흐리게 · 누를 수 없음) 누락과 구분한다.
import type { AdminLinenItemOption, AdminLinenRecordVM } from "@/lib/admin-linen-returns";
import { aggregateByItem, quantityByItemOf, tpl, type ItemAggregate } from "./linen-console-data";
import type { LinenCopy } from "./linen-record-list";

type Props = {
  /** 현재 조건(기간·건물·등록자)으로 좁혀진 기록. */
  records: AdminLinenRecordVM[];
  /** 같은 기간·등록자 조건의 전체 건물 기록 — 건물을 좁혔을 때 대조 열에 쓴다. */
  allBuildingRecords: AdminLinenRecordVM[];
  catalog: AdminLinenItemOption[];
  t: LinenCopy["console"];
  units: Pick<LinenCopy, "quantityUnit" | "countUnit">;
  /** 건물을 좁혔을 때의 표시 라벨(현지화된 값). null = 전체 건물. */
  buildingLabel: string | null;
  selectedItem: string;
  onSelectItem: (itemId: string) => void;
};

export function LinenItemSummary({ records, allBuildingRecords, catalog, t, buildingLabel, selectedItem, onSelectItem }: Props) {
  const rows: ItemAggregate[] = aggregateByItem(records, catalog);
  const max = rows[0]?.quantity || 1;
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const scoped = buildingLabel !== null;
  const allQuantities = scoped ? quantityByItemOf(allBuildingRecords) : null;

  return (
    <div className={`lfw-grid lnp-items-grid${scoped ? " is-scoped" : ""}`}>
      <div className="lfw-count">
        <span>{tpl(t.wItemsNote, { q: totalQuantity })}</span>
      </div>
      <div className="lfw-gh">
        <span>{t.colItem}</span>
        <span>{scoped ? buildingLabel : t.colQty}</span>
        <span />
        {scoped ? <span className="r">{t.colAllBuildings}</span> : null}
        <span className="r">{t.colRecordCount}</span>
        <span className="r">{t.colLastReturn}</span>
      </div>
      <div className="lfw-rows">
        {rows.map((row) => {
          const zero = row.quantity === 0;
          return (
            <button
              className={`lfw-gr${selectedItem === row.itemId ? " on" : ""}${zero ? " is-zero" : ""}`}
              disabled={zero}
              key={row.itemId}
              onClick={() => onSelectItem(row.itemId)}
              type="button"
            >
              <span className="ell lnp-iname">{row.name}</span>
              <span className="lfw-bar lnp-bar" aria-hidden="true">
                <i style={{ width: `${zero ? 0 : Math.max(3, Math.round((row.quantity / max) * 100))}%` }} />
              </span>
              <b className="r num">{row.quantity}</b>
              {scoped ? <span className="r num">{allQuantities?.get(row.itemId) ?? 0}</span> : null}
              <span className="r num">{tpl(t.metaRecordCount, { n: row.recordCount })}</span>
              <span className="r num">{row.lastAt ? `${+row.lastAt.slice(5, 7)}/${+row.lastAt.slice(8, 10)} ${row.lastAt.slice(11, 16)}` : "—"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
