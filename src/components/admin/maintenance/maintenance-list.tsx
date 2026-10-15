"use client";

// Admin 수리·점검 console — 목록·이력 뷰와 완료 뷰. 두 뷰가 같은 필터바(기간 + 드롭다운 + 검색)를
// 공유하고, 완료 뷰만 상태 드롭다운을 빼고 완료시각·완료 처리 컬럼을 더 보여준다.
// Data is real (src/lib/admin-maintenance.ts) as of 2026-07-14.
import { LiveWash } from "@/components/shared/live-wash";
import { CheckCircle2, History, Search, TriangleAlert, X } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { AdminMaintenanceReport } from "@/lib/admin-maintenance";
import type {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
} from "@/lib/maintenance-constants";
import {
  ACTIVE_LIST_STATUS,
  CATEGORY_ORDER,
  MAINT_CATEGORY,
  MAINT_PRIORITY,
  MAINT_STATUS,
  PRIORITY_ORDER,
  buildingOptionsOf,
  fmtDate,
  fmtDateTime,
  fmtElapsed,
  isActive,
  locationLabel,
  parseTs,
  reporterOptionsOf,
} from "./maintenance-console-data";
import {
  CategoryChip,
  PriorityBadge,
  ReporterAvatar,
  StatusPill,
  copyOf,
  localeTagOf,
  type MaintCopy,
} from "./maintenance-console-shared";

export type MaintFilters = {
  status: MaintenanceStatus | "all";
  priority: MaintenancePriority | "all";
  category: MaintenanceCategory | "all";
  building: string;
  reporter: string;
  from: string;
  to: string;
  query: string;
};

type ListProps = {
  scope: "list" | "done";
  reports: AdminMaintenanceReport[];
  allReports: AdminMaintenanceReport[];
  t: MaintCopy;
  sharedLabels: Dictionary["admin"]["shared"];
  locale: Locale;
  filters: MaintFilters;
  onFilterChange: <K extends keyof MaintFilters>(key: K, value: MaintFilters[K]) => void;
  onRangeChange: (from: string, to: string) => void;
  onClearFilters: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loadError?: boolean;
  onRetry: () => void;
};

export function MaintenanceList({
  scope,
  reports,
  allReports,
  t,
  sharedLabels,
  locale,
  filters,
  onFilterChange,
  onRangeChange,
  onClearFilters,
  selectedId,
  onSelect,
  loadError,
  onRetry,
}: ListProps) {
  const localeTag = localeTagOf(locale);
  const buildingOptions = buildingOptionsOf(allReports);
  const reporterOptions = reporterOptionsOf(allReports);

  const toolbar = (
    <div className="ctoolbar filterbar">
      <AdminDateRangePicker
        from={filters.from}
        to={filters.to}
        onChange={onRangeChange}
        localeTag={localeTag}
        ariaLabel={sharedLabels.pickRange}
        labels={{
          prevMonth: sharedLabels.datePrevMonth,
          nextMonth: sharedLabels.dateNextMonth,
          thisMonth: sharedLabels.dateThisMonth,
          reset: sharedLabels.dateReset,
          typeStart: sharedLabels.dateTypeStart,
          typeEnd: sharedLabels.dateTypeEnd,
          pickYear: sharedLabels.datePickYear,
          pickMonth: sharedLabels.datePickMonth,
          apply: sharedLabels.dateApply,
        }}
      />
      {scope === "list" ? (
        <AdmDropdown
          size="sm"
          value={filters.status}
          onChange={(v) => onFilterChange("status", v as MaintenanceStatus | "all")}
          ariaLabel={t.colStatus}
          options={[
            { value: "all", label: t.allStatus },
            ...ACTIVE_LIST_STATUS.map((s) => ({ value: s, label: copyOf(t, MAINT_STATUS[s].key) })),
          ]}
        />
      ) : null}
      <AdmDropdown
        size="sm"
        value={filters.priority}
        onChange={(v) => onFilterChange("priority", v as MaintenancePriority | "all")}
        ariaLabel={t.colPriority}
        options={[
          { value: "all", label: t.allPriority },
          ...PRIORITY_ORDER.map((p) => ({ value: p, label: copyOf(t, MAINT_PRIORITY[p].key) })),
        ]}
      />
      <AdmDropdown
        size="sm"
        value={filters.category}
        onChange={(v) => onFilterChange("category", v as MaintenanceCategory | "all")}
        ariaLabel={t.colCategory}
        options={[
          { value: "all", label: t.allCategory },
          ...CATEGORY_ORDER.map((c) => ({ value: c, label: copyOf(t, MAINT_CATEGORY[c].key) })),
        ]}
      />
      <AdmDropdown
        size="sm"
        value={filters.building}
        onChange={(v) => onFilterChange("building", v)}
        ariaLabel={t.pLocation}
        options={[
          { value: "all", label: t.allProp },
          ...buildingOptions.map((b) => ({ value: b, label: b })),
        ]}
      />
      <AdmDropdown
        size="sm"
        value={filters.reporter}
        onChange={(v) => onFilterChange("reporter", v)}
        ariaLabel={t.colReporter}
        options={[
          { value: "all", label: t.allReporter },
          ...reporterOptions.map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
      <div className="qsearch qsearch--inline">
        <span className="ic">
          <Search aria-hidden="true" />
        </span>
        <input
          placeholder={t.search}
          value={filters.query}
          onChange={(e) => onFilterChange("query", e.target.value)}
        />
        {filters.query ? (
          <button type="button" className="qsearch__clear" onClick={() => onFilterChange("query", "")}>
            <span className="ic">
              <X aria-hidden="true" />
            </span>
          </button>
        ) : null}
      </div>
      <span className="ctoolbar__spacer" />
    </div>
  );

  if (loadError) {
    return (
      <>
        {toolbar}
        <div className="card">
          <div className="state">
            <div className="state__ic err">
              <TriangleAlert aria-hidden="true" />
            </div>
            <div className="state__t">{t.errT}</div>
            <div className="state__s">{t.errS}</div>
            <button type="button" className="btn btn--pri btn--sm" style={{ marginTop: 16 }} onClick={onRetry}>
              {t.retry}
            </button>
          </div>
        </div>
      </>
    );
  }

  const q = filters.query.trim().toLowerCase();
  const rows = reports
    .filter((r) => {
      if (scope === "done" ? r.status !== "closed" : r.status === "closed") return false;
      const day = (scope === "done" ? (r.completedAt ?? r.createdAt) : r.createdAt).split(" ")[0];
      if (day < filters.from || day > filters.to) return false;
      if (scope === "list" && filters.status !== "all" && r.status !== filters.status) return false;
      if (filters.priority !== "all" && r.priority !== filters.priority) return false;
      if (filters.category !== "all" && r.category !== filters.category) return false;
      if (filters.building !== "all" && r.buildingLabel !== filters.building) return false;
      if (filters.reporter !== "all" && r.reporterId !== filters.reporter) return false;
      if (
        q &&
        !(
          r.title.toLowerCase().includes(q) ||
          locationLabel(r, t.buildingOnly).toLowerCase().includes(q) ||
          r.reporterName.toLowerCase().includes(q)
        )
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const key = (r: AdminMaintenanceReport) =>
        scope === "done" ? (r.completedAt ?? r.createdAt) : r.createdAt;
      return (parseTs(key(b)) ?? 0) - (parseTs(key(a)) ?? 0);
    });

  if (!rows.length) {
    return (
      <>
        {toolbar}
        <div className="card">
          <div className="state">
            <div className={`state__ic ${scope === "done" ? "ok" : "empty"}`}>
              {scope === "done" ? <CheckCircle2 aria-hidden="true" /> : <History aria-hidden="true" />}
            </div>
            <div className="state__t">{scope === "done" ? t.doneEmptyT : t.emptyListT}</div>
            <div className="state__s">{scope === "done" ? t.doneEmptyS : t.emptyListS}</div>
            <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 16 }} onClick={onClearFilters}>
              {t.clearFilter}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {toolbar}
      <div className="hmeta">
        <b style={{ color: "var(--ink-soft)" }}>
          {rows.length}
          {t.countUnit}
        </b>
        <span className="sep" />
        {scope === "done" ? t.doneHint : `${fmtDate(filters.from, locale)} – ${fmtDate(filters.to, locale)}`}
      </div>
      <div className="card" style={{ overflow: "auto" }}>
        <LiveWash move sig={rows.map((r) => r.id).join(",")}>
        <table className="qtbl mtbl">
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>{t.colId}</th>
              <th>{t.colPriority}</th>
              <th>{t.colCategory}</th>
              <th>{t.colTitle}</th>
              {scope === "list" ? <th>{t.colStatus}</th> : null}
              <th>{t.colReporter}</th>
              {scope === "done" ? <th>{t.colBy}</th> : null}
              <th>{t.colCreated}</th>
              <th>{scope === "done" ? t.colCompleted : t.colElapsed}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                data-live={r.id}
                className={[r.status === "cancelled" ? "is-cancelled" : "", selectedId === r.id ? "sel" : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(r.id)}
              >
                <td style={{ paddingLeft: 16 }}>
                  <span className="tt-id">{r.shortId}</span>
                </td>
                <td>
                  <PriorityBadge priority={r.priority} t={t} />
                </td>
                <td>
                  <CategoryChip category={r.category} t={t} />
                </td>
                <td>
                  <span className="tt-title">{r.title}</span>
                  <div className="tt-loc">
                    {locationLabel(r, t.buildingOnly)}
                    {scope === "list" && r.occupied ? (
                      <>
                        {" · "}
                        <span style={{ color: "var(--warn)", fontWeight: 800 }}>{t.occupied}</span>
                      </>
                    ) : null}
                  </div>
                </td>
                {scope === "list" ? (
                  <td>
                    <StatusPill status={r.status} t={t} />
                  </td>
                ) : null}
                <td>
                  <span className="who">
                    <ReporterAvatar id={r.reporterId} name={r.reporterName} className="who__av" />
                    <span className="who__nm">{r.reporterName}</span>
                  </span>
                </td>
                {scope === "done" ? (
                  <td>
                    {r.completedByName ? (
                      <span className="who">
                        <ReporterAvatar id={r.completedByName} name={r.completedByName} className="who__av" />
                        <span className="who__nm">{r.completedByName}</span>
                      </span>
                    ) : (
                      <span className="dim-cell">—</span>
                    )}
                  </td>
                ) : null}
                <td className="dim-cell mono">{fmtDateTime(r.createdAt, locale)}</td>
                <td>
                  {scope === "done" ? (
                    <span className="el-cell" style={{ color: "var(--done)" }}>
                      <span className="ic">
                        <CheckCircle2 aria-hidden="true" />
                      </span>
                      {fmtDateTime(r.completedAt ?? r.updatedAt, locale)}
                    </span>
                  ) : (
                    <span className={`el-cell${r.aging ? " is-late" : ""}`}>
                      {r.aging ? (
                        <span className="ic">
                          <TriangleAlert aria-hidden="true" />
                        </span>
                      ) : null}
                      {isActive(r) ? fmtElapsed(r.createdAt, locale) : "—"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </LiveWash>
      </div>
    </>
  );
}
