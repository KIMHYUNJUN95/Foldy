"use client";

// Admin 분실물 console — 「전체 기록」 보기. 화이트 리디자인(2026-10-14, 시안 LFAll-PC): 진행 중과 완료를 한 표에.
// 기간(등록일) · 상태 · 건물 · 신고자 · 검색은 위 보기 줄에서 고른다. 등록일 최신 순.
import { LiveWash } from "@/components/shared/live-wash";
import { Search, TriangleAlert } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminLostItemVM } from "@/lib/admin-lost-found";
import { fmtDateTime, locationLabel, parseTs, type LFFilters } from "./lost-found-console-data";
import { LFState, categoryLabel, statusLabel, type LFCopy } from "./lost-found-console-shared";

type ListProps = {
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

const STATUS_TONE: Record<AdminLostItemVM["status"], string> = {
  registered: "",
  stored: "",
  disposal_scheduled: "danger",
  returned: "ok",
  disposed: "dim",
};

export function LostFoundList({ items, t, locale, filters, onClearFilters, selectedId, onSelect, loadError, onRetry }: ListProps) {
  if (loadError) {
    return <LFState icon={<TriangleAlert aria-hidden="true" />} title={t.errT} sub={t.errS} action={t.retry} onAction={onRetry} />;
  }

  const q = filters.query.trim().toLowerCase();
  const rows = items
    .filter((i) => {
      const day = i.foundAt.split(" ")[0];
      if (day < filters.from || day > filters.to) return false;
      if (filters.status !== "all" && i.status !== filters.status) return false;
      if (filters.building !== "all" && i.buildingLabel !== filters.building) return false;
      if (filters.reporter !== "all" && i.reporterId !== filters.reporter) return false;
      if (
        q &&
        !(
          i.itemName.toLowerCase().includes(q) ||
          locationLabel(i, t.buildingWhole).toLowerCase().includes(q) ||
          i.reporterName.toLowerCase().includes(q) ||
          (i.guest?.name.toLowerCase().includes(q) ?? false)
        )
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (parseTs(b.foundAt) ?? 0) - (parseTs(a.foundAt) ?? 0));

  if (!rows.length) {
    return (
      <LFState icon={<Search aria-hidden="true" />} title={t.emptyListT} sub={t.emptyListS} action={t.clearFilter} onAction={onClearFilters} />
    );
  }

  return (
    <>
      <div className="lfw-count">
        <b>
          {rows.length}
          {t.countUnit}
        </b>
        <span>{t.allHint}</span>
      </div>
      <div className="lfw-grid lfw-grid--all">
        <div className="lfw-gh">
          <span>{t.colRegAt}</span>
          <span>{t.colItem}</span>
          <span>{t.colPlace}</span>
          <span>{t.pCategory}</span>
          <span>{t.colReporter}</span>
          <span className="r">{t.colStatus}</span>
        </div>
        <LiveWash move sig={rows.map((i) => i.id).join(",")}>{rows.map((i) => (
          <button type="button" key={i.id} data-live={i.id} className={`lfw-gr${selectedId === i.id ? " on" : ""}`} onClick={() => onSelect(i.id)}>
            <b className="num">{fmtDateTime(i.foundAt, locale)}</b>
            <span className="ell strong">{i.itemName}</span>
            <span className="ell">
              {i.buildingLabel} · {i.room ?? t.buildingWhole}
            </span>
            <span className="ell dim2">{categoryLabel(i.category, t)}</span>
            <span className="ell">{i.reporterName}</span>
            <span className={`r st ${STATUS_TONE[i.status]}`}>{statusLabel(i.status, t)}</span>
          </button>
        ))}</LiveWash>
      </div>
    </>
  );
}
