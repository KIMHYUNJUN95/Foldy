"use client";

// Admin 수리·점검 console — 현황 보드. Three status columns (접수 / 처리중 / 무효); 완료(closed)는
// 누적 데이터라 별도 "완료" 뷰에서만 본다. Data is real (src/lib/admin-maintenance.ts) as of 2026-07-14.
import { Check, Search } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminMaintenanceReport } from "@/lib/admin-maintenance";
import {
  BOARD_ORDER,
  MAINT_PRIORITY,
  MAINT_STATUS,
  fmtDateTime,
  fmtElapsed,
  isActive,
  locationLabel,
  sortForBoard,
} from "./maintenance-console-data";
import { categoryLabel, copyOf, priorityLabel, type MaintCopy } from "./maintenance-console-shared";

type BoardProps = {
  reports: AdminMaintenanceReport[];
  t: MaintCopy;
  locale: Locale;
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearQuery: () => void;
  loading?: boolean;
};

function MaintCard({
  report,
  t,
  locale,
  selected,
  onSelect,
}: {
  report: AdminMaintenanceReport;
  t: MaintCopy;
  locale: Locale;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const cls = [
    "mcard",
    `is-${MAINT_STATUS[report.status].cls}`,
    report.aging ? "is-aging" : "",
    selected ? "sel" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      onClick={() => onSelect(report.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(report.id);
        }
      }}
    >
      {/* 화이트 리디자인(2026-10-13, 시안 Maint-PC): 한 줄 머리(우선순위 · 분류 · 재실 중) → 제목 → 호실 · 건물 → 신고자 | 사진 · 경과. */}
      <div className="mcard__kick">
        <span className={`mcard__pri is-${MAINT_PRIORITY[report.priority].cls}`}>{priorityLabel(report.priority, t)}</span>
        <span>{categoryLabel(report.category, t)}</span>
        {report.occupied ? <span className="mcard__occ">{t.occupied}</span> : null}
      </div>
      <div className="mcard__title">{report.title}</div>
      <div className="mcard__loc">
        {report.room ? (
          <>
            <b className="mono">{report.room}</b> {report.buildingLabel}
          </>
        ) : (
          <>
            <b>{t.buildingOnly}</b> {report.buildingLabel}
          </>
        )}
      </div>
      <div className="mcard__foot">
        <span className="mcard__rep">{report.reporterName}</span>
        <span className={`mcard__el${isActive(report) && report.aging ? " is-late" : ""}`}>
          {report.photos.length > 0 ? `${t.photoN.replace("{n}", String(report.photos.length))} · ` : ""}
          {isActive(report) ? fmtElapsed(report.createdAt, locale) : fmtDateTime(report.completedAt ?? report.updatedAt, locale)}
        </span>
      </div>
    </div>
  );
}

export function MaintenanceBoard({
  reports,
  t,
  locale,
  query,
  selectedId,
  onSelect,
  onClearQuery,
  loading,
}: BoardProps) {
  if (loading) {
    return (
      <div className="mboard-wrap">
        <div className="mskel-grid">
          {[0, 1, 2].map((i) => (
            <div className="mskel-col" key={i}>
              <div className="mskel-bar" />
              <div className="mskel-card" />
              <div className="mskel-card" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matched = reports.filter((r) => {
    if (r.status === "closed") return false;
    if (!q) return true;
    return (
      r.title.toLowerCase().includes(q) ||
      locationLabel(r, t.buildingOnly).toLowerCase().includes(q) ||
      r.reporterName.toLowerCase().includes(q) ||
      (r.room ? r.room.toLowerCase().includes(q) : false)
    );
  });

  if (!matched.length) {
    return (
      <div className="card">
        <div className="state">
          <div className="state__ic empty">
            <Search aria-hidden="true" />
          </div>
          <div className="state__t">{t.emptyBoardT}</div>
          <div className="state__s">{t.emptyBoardS}</div>
          {q ? (
            <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 16 }} onClick={onClearQuery}>
              {t.clearFilter}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mboard-wrap">
      <div className="mbkgrid">
        {BOARD_ORDER.map((status) => {
          const meta = MAINT_STATUS[status];
          const items = sortForBoard(matched.filter((r) => r.status === status));
          return (
            <section className={`mbkcol mbkcol--${meta.cls}`} key={status}>
              <div className="mbkcol__h">
                <i className="mbkcol__dot" aria-hidden="true" />
                <span className="mbkcol__t">{copyOf(t, meta.key)}</span>
                <span className="mbkcol__c">{items.length}</span>
              </div>
              <div className="mbkcol__body">
                {items.length ? (
                  items.map((r) => (
                    <MaintCard
                      key={r.id}
                      report={r}
                      t={t}
                      locale={locale}
                      selected={selectedId === r.id}
                      onSelect={onSelect}
                    />
                  ))
                ) : (
                  <div className="mnone">
                    <span className="ic">
                      <Check aria-hidden="true" />
                    </span>
                    {t.colNone}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
