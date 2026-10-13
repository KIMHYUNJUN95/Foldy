"use client";

// Admin 분실물 console — 「반환」 보기. 화이트 리디자인(2026-10-14, 시안 LFReturn-PC): 반환완료만 모은 표.
// 위에 기간 숫자 셋(이 기간 반환 · 배송 · 직접 수령), 줄을 고르면 오른쪽 패널에 처리 기록 · 복원.
// (폐기는 「폐기 내역」 보기가 따로 있다.)
import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminLostItemVM } from "@/lib/admin-lost-found";
import { fmtDateTime, parseTs, type LFFilters } from "./lost-found-console-data";
import { LFState, type LFCopy } from "./lost-found-console-shared";

type DoneProps = {
  items: AdminLostItemVM[];
  t: LFCopy;
  locale: Locale;
  filters: LFFilters;
  onClearFilters: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loadError?: boolean;
  onRetry: () => void;
};

export function LostFoundDone({ items, t, locale, filters, onClearFilters, selectedId, onSelect, loadError, onRetry }: DoneProps) {
  if (loadError) {
    return <LFState icon={<TriangleAlert aria-hidden="true" />} title={t.errT} sub={t.errS} action={t.retry} onAction={onRetry} />;
  }

  const inPeriod = items.filter((i) => {
    if (i.status !== "returned") return false;
    const day = (i.handledAt ?? i.foundAt).split(" ")[0];
    if (day < filters.from || day > filters.to) return false;
    return filters.building === "all" || i.buildingLabel === filters.building;
  });
  const rows = inPeriod
    .filter((i) => filters.method === "all" || i.returnMethod === filters.method)
    .sort((a, b) => (parseTs(b.handledAt ?? b.foundAt) ?? 0) - (parseTs(a.handledAt ?? a.foundAt) ?? 0));
  const delivery = inPeriod.filter((i) => i.returnMethod === "delivery").length;
  const pickup = inPeriod.filter((i) => i.returnMethod === "pickup").length;

  return (
    <>
      <div className="wkpis lfw-kpis lfw-kpis--3">
        <div className="wkpi">
          <span className="wkpi__k">{t.kpiRetPeriod}</span>
          <span className="wkpi__v">
            {inPeriod.length}
            <small>{t.countUnit}</small>
          </span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{t.methodDelivery}</span>
          <span className="wkpi__v">
            {delivery}
            <small>{t.countUnit}</small>
          </span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{t.methodPickup}</span>
          <span className="wkpi__v">
            {pickup}
            <small>{t.countUnit}</small>
          </span>
        </div>
      </div>

      {rows.length ? (
        <div className="lfw-grid lfw-grid--ret">
          <div className="lfw-gh">
            <span>{t.colReturnedAt}</span>
            <span>{t.colItem}</span>
            <span>{t.colPlace}</span>
            <span>{t.colMethod}</span>
            <span>{t.colTracking}</span>
            <span className="r">{t.colBy}</span>
          </div>
          {rows.map((i) => (
            <button type="button" key={i.id} className={`lfw-gr${selectedId === i.id ? " on" : ""}`} onClick={() => onSelect(i.id)}>
              <b className="num">{fmtDateTime(i.handledAt, locale)}</b>
              <span className="ell">{i.itemName}</span>
              <span className="ell">
                {i.buildingLabel} · {i.room ?? t.buildingWhole}
              </span>
              <span>{i.returnMethod === "delivery" ? t.methodDelivery : i.returnMethod === "pickup" ? t.methodPickup : "—"}</span>
              <span className={`ell${i.returnTrackingNo ? "" : " dim"}`}>{i.returnTrackingNo || "—"}</span>
              <span className="r ell">{i.handledByName ?? t.sysAuto}</span>
            </button>
          ))}
        </div>
      ) : (
        <LFState
          icon={<CheckCircle2 aria-hidden="true" />}
          title={t.doneEmptyT}
          sub={t.doneEmptyS}
          action={t.clearFilter}
          onAction={onClearFilters}
        />
      )}
    </>
  );
}
