"use client";

// Admin 분실물 console — 「보관 중」 보기. 화이트 리디자인(2026-10-14, 시안 LF-PC): 상태 3칸 보드 대신
// 자동 폐기까지 남은 날 순으로 한 줄씩 세운 「보관 타임라인」. 줄마다 품목 · 위치 · 보관 경과 막대 · D-day.
// 종결(반환 · 폐기)은 「반환」 · 「폐기 내역」 보기에서만 본다.
import { LiveWash } from "@/components/shared/live-wash";
import Image from "next/image";
import { Search } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminLostItemVM } from "@/lib/admin-lost-found";
import { fmtDate, isActive, sortForBoard, tpl, type LFFilters } from "./lost-found-console-data";
import { CATEGORY_ICON, categoryLabel, type LFCopy } from "./lost-found-console-shared";

type BoardProps = {
  items: AdminLostItemVM[];
  t: LFCopy;
  locale: Locale;
  filters: LFFilters;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearFilters: () => void;
};

/** 보관 경과 막대 — 지난 날 / (지난 날 + 남은 날). 만료면 100%. */
export function storageTotal(item: AdminLostItemVM): number {
  return Math.max(1, item.storedDays + Math.max(item.daysLeft, 0));
}

export function dueText(item: AdminLostItemVM, t: LFCopy, locale: Locale): string {
  if (item.isExtended && !item.isDueSoon && !item.isExpired) return fmtDate(item.dueDate, locale);
  if (item.daysLeft < 0) return tpl(t.dOver, Math.abs(item.daysLeft));
  return tpl(t.dueOn, item.daysLeft);
}

function Row({
  item,
  t,
  locale,
  selected,
  onSelect,
}: {
  item: AdminLostItemVM;
  t: LFCopy;
  locale: Locale;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const CatIcon = CATEGORY_ICON[item.category];
  const total = storageTotal(item);
  const pct = Math.min(100, Math.round((item.storedDays / total) * 100));
  const tone = item.isExpired || item.isDueSoon ? "is-soon" : item.isExtended ? "is-ext" : "";
  const meta = [
    categoryLabel(item.category, t),
    item.isExtended ? tpl(t.extUntil, fmtDate(item.dueDate, locale)) : item.guest?.name ?? item.reporterName,
    item.photoCount ? `${t.pPhotos} ${item.photoCount}` : null,
  ].filter(Boolean);

  return (
    <button type="button" className={`lfw-tr${selected ? " on" : ""}`} onClick={() => onSelect(item.id)} data-live={item.id}>
      <span className="lfw-tr__item">
        <span className="lfw-thumb">
          {item.photos[0] ? (
            <Image alt="" src={item.photos[0]} fill sizes="40px" />
          ) : (
            <CatIcon aria-hidden="true" />
          )}
        </span>
        <span className="lfw-tr__txt">
          <b>{item.itemName}</b>
          <span>{meta.join(" · ")}</span>
        </span>
      </span>
      <span className="lfw-tr__loc">
        {item.room ? <b className="mono">{item.room}</b> : null} {item.room ? item.buildingLabel : `${item.buildingLabel} · ${t.buildingWhole}`}
      </span>
      <span className="lfw-tr__bar">
        <span className="lfw-bar">
          <i className={tone} style={{ width: `${pct}%` }} />
        </span>
        <span className="lfw-tr__days">
          {item.storedDays}/{total}
          {t.days}
        </span>
      </span>
      <span className={`lfw-tr__due ${tone}`}>{dueText(item, t, locale)}</span>
    </button>
  );
}

export function LostFoundBoard({ items, t, locale, filters, selectedId, onSelect, onClearFilters }: BoardProps) {
  const rows = sortForBoard(
    items.filter(
      (i) =>
        isActive(i) &&
        (filters.building === "all" || i.buildingLabel === filters.building) &&
        (filters.category === "all" || i.category === filters.category),
    ),
  );
  const filtered = filters.building !== "all" || filters.category !== "all";

  return (
    <section className="lfw-tl">
      <div className="lfw-tl__h">
        <b>{t.tlTitle}</b>
        <span>{t.tlSort}</span>
        <span className="lfw-tl__rule">{t.tlRule}</span>
      </div>
      {rows.length ? (
        <>
          <div className="lfw-th">
            <span>{t.colItem}</span>
            <span>{t.colPlace}</span>
            <span>{t.colElapsed}</span>
            <span>{t.colAutoDue}</span>
          </div>
          <div className="lfw-rows">
            <LiveWash move sig={rows.map((i) => i.id).join(",")}>
              {rows.map((i) => (
                <Row key={i.id} item={i} t={t} locale={locale} selected={selectedId === i.id} onSelect={onSelect} />
              ))}
            </LiveWash>
          </div>
        </>
      ) : (
        <div className="lfw-empty">
          <Search aria-hidden="true" />
          <b>{t.emptyBoardT}</b>
          <span>{t.emptyBoardS}</span>
          {filtered ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClearFilters}>
              {t.clearFilter}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
