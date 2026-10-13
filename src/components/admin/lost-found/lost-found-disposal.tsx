"use client";

// Admin 분실물 console — 「폐기 내역」 보기. 화이트 리디자인(2026-10-14, 시안 LFDisposed-PC): 위에 90일 자동 삭제
// 안내 한 줄, 아래 폐기일 · 품목 · 위치 · 방식(자동/수동) · 삭제 예정 · 남은 날. 삭제 임박(D-7)은 빨간 글자.
import { TriangleAlert } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminLostItemVM } from "@/lib/admin-lost-found";
import { fmtDate, tpl, type LFFilters } from "./lost-found-console-data";
import { LFState, type LFCopy } from "./lost-found-console-shared";

type DisposalProps = {
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

export function LostFoundDisposal({
  items,
  t,
  locale,
  filters,
  onClearFilters,
  selectedId,
  onSelect,
  loadError,
  onRetry,
}: DisposalProps) {
  if (loadError) {
    return <LFState icon={<TriangleAlert aria-hidden="true" />} title={t.errT} sub={t.errS} action={t.retry} onAction={onRetry} />;
  }

  const rows = items
    .filter((i) => {
      if (i.status !== "disposed") return false;
      const day = i.disposedDate ?? "";
      if (day < filters.from || day > filters.to) return false;
      return filters.building === "all" || i.buildingLabel === filters.building;
    })
    .sort((a, b) => (a.deleteDaysLeft ?? 0) - (b.deleteDaysLeft ?? 0));

  return (
    <>
      <p className="lfw-note">
        <TriangleAlert aria-hidden="true" />
        {t.disposalBanner}
      </p>
      {rows.length ? (
        <div className="lfw-grid lfw-grid--disp">
          <div className="lfw-gh">
            <span>{t.colDisposedAt}</span>
            <span>{t.colItem}</span>
            <span>{t.colPlace}</span>
            <span>{t.colDisposeMode}</span>
            <span className="r">{t.colDeleteBy}</span>
            <span className="r">{t.colLeft}</span>
          </div>
          {rows.map((i) => {
            const left = i.deleteDaysLeft ?? 0;
            return (
              <button type="button" key={i.id} className={`lfw-gr${selectedId === i.id ? " on" : ""}`} onClick={() => onSelect(i.id)}>
                <b className="num">{i.disposedDate ? fmtDate(i.disposedDate, locale) : "—"}</b>
                <span className="ell">{i.itemName}</span>
                <span className="ell">
                  {i.buildingLabel} · {i.room ?? t.buildingWhole}
                </span>
                <span className={i.isAutoDisposed ? "dim" : ""}>
                  {i.isAutoDisposed ? t.modeAuto : `${t.modeManual} · ${i.handledByName ?? ""}`}
                </span>
                <span className="r num">{i.deleteDate ? fmtDate(i.deleteDate, locale) : "—"}</span>
                <span className={`r num${i.isDeleteSoon ? " danger" : " dim"}`}>
                  {left === 0 ? t.delToday : tpl(t.delDaysLeft, left)}
                  {i.isDeleteSoon && left > 0 ? ` · ${t.soonDel}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <LFState title={t.disposalEmptyT} sub={t.disposalEmptyS} action={t.clearFilter} onAction={onClearFilters} />
      )}
    </>
  );
}
