"use client";

// Admin cleaning console — "기록" (history) board: date-range + building/staff/status filter
// toolbar over a flat table of past cleaning records, mirroring clean-views.js historyToolbar()/
// historyBoard(). The date range uses the shared single-field AdminDateRangePicker (matches the
// design handoff's combined "시작일 – 종료일" trigger 1:1, not two separate date fields). Data is
// real (src/lib/admin-cleaning.ts) as of 2026-07-14 — the parent owns fetching a fresh range via
// fetchAdminCleaningHistory; this component only filters/renders whatever range it's given.
import { Search, X } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminExportButtons, type AdminExportLabels } from "@/components/admin/shared/admin-export-buttons";
import type { Locale } from "@/lib/i18n";
import {
  exportCleaningHistoryReport,
  exportCleaningHistoryWorkbook,
  type CleaningHistoryExportRow,
} from "@/app/admin/cleaning/actions";
import type { AdminCleaningHistoryItem } from "@/lib/admin-cleaning";
import { BUILDING_ORDER, fmtDate, toMin, type BuildingKey } from "./cleaning-console-data";
import {
  buildingLabelOf,
  durLabel,
  localeTagOf,
  staffLabelOf,
  typeLabel,
  type ConsoleCopy,
  type StaffDirectory,
} from "./cleaning-console-shared";

/** 이보다 오래 걸린 청소는 「오래 걸림」(빨강) — 시안 KPI 「70분 넘김」(2026-10-13). */
export const LONG_CLEANING_MIN = 70;

function endOf(start: string, dur: number | null): string | null {
  const s = toMin(start);
  if (s == null || dur == null) return null;
  const total = (s + dur) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}/${d}`;
}

/** 세션 상태 축 — 모바일 "상태"(완료/진행중/취소)와 같은 뜻. */
export type HistorySessionStatusFilter = "all" | "done" | "progress" | "cancelled";
/** 완료 유형 축 — 정상 완료 / 관리자 대리 완료. 세션 상태가 아니다. */
export type HistoryCompletionFilter = "all" | "normal" | "proxy";

type HistoryBoardProps = {
  history: AdminCleaningHistoryItem[];
  t: ConsoleCopy;
  sharedLabels: AdminExportLabels;
  buildingLabels: Record<string, string>;
  staffDirectory: StaffDirectory;
  locale: Locale;
  propFilter: BuildingKey | "all";
  onPropFilterChange: (v: BuildingKey | "all") => void;
  staffFilter: string;
  onStaffFilterChange: (v: string) => void;
  sessionStatusFilter: HistorySessionStatusFilter;
  onSessionStatusFilterChange: (v: HistorySessionStatusFilter) => void;
  completionFilter: HistoryCompletionFilter;
  onCompletionFilterChange: (v: HistoryCompletionFilter) => void;
  query: string;
  onQueryChange: (v: string) => void;
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  rangeLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToast: (message: string) => void;
  onClearFilters: () => void;
};

export function HistoryBoard({
  history,
  t,
  sharedLabels,
  buildingLabels,
  staffDirectory,
  locale,
  propFilter,
  onPropFilterChange,
  staffFilter,
  onStaffFilterChange,
  sessionStatusFilter,
  onSessionStatusFilterChange,
  completionFilter,
  onCompletionFilterChange,
  query,
  onQueryChange,
  from,
  to,
  onRangeChange,
  rangeLoading,
  selectedId,
  onSelect,
  onToast,
  onClearFilters,
}: HistoryBoardProps) {
  const localeTag = localeTagOf(locale);
  const q = query.trim().toLowerCase();
  const rows = history.filter((h) => {
    if (h.date < from || h.date > to) return false;
    if (propFilter !== "all" && h.building !== propFilter) return false;
    if (staffFilter !== "all" && h.staffId !== staffFilter) return false;
    if (sessionStatusFilter !== "all" && h.status !== sessionStatusFilter) return false;
    if (completionFilter === "proxy" && !h.proxy) return false;
    if (completionFilter === "normal" && h.proxy) return false;
    if (q) {
      const buildingText = buildingLabelOf(h, buildingLabels).toLowerCase();
      if (!h.room.toLowerCase().includes(q) && !h.staffName.toLowerCase().includes(q) && !buildingText.includes(q)) {
        return false;
      }
    }
    return true;
  });

  const exportRows: CleaningHistoryExportRow[] = rows.map((h) => ({
    date: h.date,
    building: h.building,
    buildingRaw: h.buildingRaw,
    room: h.room,
    type: h.type,
    staffName: h.staffName,
    start: h.start,
    dur: h.dur,
    status: h.status,
    proxy: h.proxy,
    note: h.note,
  }));

  const rangePickerLabels = {
    prevMonth: sharedLabels.datePrevMonth,
    nextMonth: sharedLabels.dateNextMonth,
    thisMonth: sharedLabels.dateThisMonth,
    reset: sharedLabels.dateReset,
    typeStart: sharedLabels.dateTypeStart,
    typeEnd: sharedLabels.dateTypeEnd,
    pickYear: sharedLabels.datePickYear,
    pickMonth: sharedLabels.datePickMonth,
    apply: sharedLabels.dateApply,
  };

  const staffOptions = [...staffDirectory.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const toolbar = (
    <div className="ctoolbar">
      <AdminDateRangePicker
        from={from}
        to={to}
        onChange={onRangeChange}
        localeTag={localeTag}
        ariaLabel={sharedLabels.pickRange}
        labels={rangePickerLabels}
      />
      <AdmDropdown
        size="sm"
        value={propFilter}
        onChange={(v) => onPropFilterChange(v as BuildingKey | "all")}
        ariaLabel={t.building}
        options={[
          { value: "all", label: t.allProp },
          ...BUILDING_ORDER.map((b) => ({ value: b, label: buildingLabels[b] ?? b })),
        ]}
      />
      <AdmDropdown
        size="sm"
        value={staffFilter}
        onChange={onStaffFilterChange}
        ariaLabel={t.staff}
        options={[{ value: "all", label: t.allStaff }, ...staffOptions.map((s) => ({ value: s.id, label: s.name }))]}
      />
      {/* 세션 상태 축 (모바일 "상태"와 동일: 완료 / 진행중 / 취소) */}
      <AdmDropdown
        size="sm"
        value={sessionStatusFilter}
        onChange={(v) => onSessionStatusFilterChange(v as HistorySessionStatusFilter)}
        ariaLabel={t.status}
        options={[
          { value: "all", label: t.allSessionStatus },
          { value: "done", label: t.sessionStatus.completed },
          { value: "progress", label: t.sessionStatus.in_progress },
          { value: "cancelled", label: t.sessionStatus.cancelled },
        ]}
      />
      {/* 완료 유형 축 (정상 완료 / 관리자 대리 완료). ariaLabel 은 이 필터의 기본 옵션 문구
          ("전체 유형" / "All types" / "全タイプ")를 쓴다 — 콘솔 사전에 "완료 유형" 명사 키가
          아직 없다. 키가 추가되면 여기만 바꾸면 된다. */}
      <AdmDropdown
        size="sm"
        value={completionFilter}
        onChange={(v) => onCompletionFilterChange(v as HistoryCompletionFilter)}
        ariaLabel={t.allStatus}
        options={[
          { value: "all", label: t.allStatus },
          { value: "normal", label: t.stNormal },
          { value: "proxy", label: t.stProxy },
        ]}
      />
      <div className="qsearch qsearch--inline">
        <span className="ic">
          <Search />
        </span>
        <input placeholder={t.searchStaff} value={query} onChange={(e) => onQueryChange(e.target.value)} />
        {query ? (
          <button type="button" className="qsearch__clear" onClick={() => onQueryChange("")}>
            <span className="ic">
              <X />
            </span>
          </button>
        ) : null}
      </div>
      <span className="ctoolbar__spacer" />
      <AdminExportButtons
        onExportXls={() => exportCleaningHistoryWorkbook(exportRows, from, to)}
        onExportPdf={() => exportCleaningHistoryReport(exportRows, from, to)}
        disabled={!rows.length}
        onToast={onToast}
        labels={sharedLabels}
      />
    </div>
  );

  if (rangeLoading) {
    return (
      <>
        {toolbar}
        <div className="cl-empty">
          <span className="cl-empty__ic">
            <Search aria-hidden="true" />
          </span>
          <div className="cl-empty__t">{t.histLoading}</div>
        </div>
      </>
    );
  }

  if (!rows.length) {
    return (
      <>
        {toolbar}
        <div className="cl-empty">
          <span className="cl-empty__ic">
            <Search aria-hidden="true" />
          </span>
          <div className="cl-empty__t">{t.histEmptyT}</div>
          <div className="cl-empty__s">{t.histEmptyS}</div>
          <button type="button" className="cl-empty__btn" onClick={onClearFilters}>
            {t.clearFilter}
          </button>
        </div>
      </>
    );
  }

  // 숫자 줄 — 지금 걸러진 줄 기준(시안: 기록 · 총 소요 · 평균 소요 · 오래 걸림 · 관리자 완료).
  const timed = rows.filter((h) => h.dur != null && h.status === "done");
  const totalMin = timed.reduce((sum, h) => sum + (h.dur ?? 0), 0);
  const avgMin = timed.length ? Math.round(totalMin / timed.length) : null;
  const longCount = timed.filter((h) => (h.dur ?? 0) > LONG_CLEANING_MIN).length;
  const proxyCount = rows.filter((h) => h.proxy).length;
  const staffCount = new Set(rows.map((h) => h.staffId).filter(Boolean)).size;
  const totalH = Math.floor(totalMin / 60);
  const totalM = totalMin % 60;
  // 최근 날짜가 위로(시안). 내보내기는 서버 순서(날짜 오름차순) 그대로다.
  const shown = [...rows].reverse();

  return (
    <>
      {toolbar}
      <div className="cl-kpis cl-kpis--5">
        <div className="cl-kpi">
          <span className="cl-kpi__k">{t.kpiRecords}</span>
          <span className="cl-kpi__v">
            {rows.length}
            <small>{t.unitRecords}</small>
          </span>
          <span className="cl-kpi__d">
            {fmtDate(from, localeTag)} – {fmtDate(to, localeTag)}
          </span>
        </div>
        <div className="cl-kpi">
          <span className="cl-kpi__k">{t.kpiTotalDur}</span>
          <span className="cl-kpi__v">
            {totalH > 0 ? (
              <>
                {totalH}
                <small>{t.unitHour}</small>{" "}
              </>
            ) : null}
            {totalM}
            <small>{t.unitMin}</small>
          </span>
          <span className="cl-kpi__d">{t.staffN.replace("{n}", String(staffCount))}</span>
        </div>
        <div className="cl-kpi">
          <span className="cl-kpi__k">{t.kpiAvgDur}</span>
          <span className="cl-kpi__v">
            {avgMin == null ? "—" : avgMin}
            {avgMin == null ? null : <small>{t.unitMin}</small>}
          </span>
          <span className="cl-kpi__d">{t.doneBasis.replace("{n}", String(timed.length))}</span>
        </div>
        <div className="cl-kpi">
          <span className="cl-kpi__k">{t.kpiLong}</span>
          <span className={`cl-kpi__v${longCount > 0 ? " is-danger" : ""}`}>
            {longCount}
            <small>{t.unitCount}</small>
          </span>
          <span className="cl-kpi__d">{t.longSub.replace("{n}", String(LONG_CLEANING_MIN))}</span>
        </div>
        <div className="cl-kpi">
          <span className="cl-kpi__k">{t.kpiProxy}</span>
          <span className="cl-kpi__v">
            {proxyCount}
            <small>{t.unitCount}</small>
          </span>
          <span className="cl-kpi__d">{t.stProxy}</span>
        </div>
      </div>
      <table className="cl-tbl">
        <thead>
          <tr>
            <th>{t.colDate}</th>
            <th>{t.colRoom}</th>
            <th>{t.building}</th>
            <th>{t.colStaff}</th>
            <th>{t.colWhen}</th>
            <th>{t.colDur}</th>
            <th className="r">{t.colMemo}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((h) => {
            // 취소된 세션은 끝난 게 아니라 완료 시각 · 소요를 비운다.
            const shownDur = h.status === "done" ? h.dur : null;
            const end = endOf(h.start, shownDur);
            const long = h.status === "done" && (h.dur ?? 0) > LONG_CLEANING_MIN;
            const memo: string[] = [];
            if (h.status === "cancelled") memo.push(t.stCancelled);
            if (h.proxy) memo.push(t.stProxy);
            if (h.reports?.issue) memo.push(`${t.pIssue} ${h.reports.issue}`);
            if (h.reports?.lost) memo.push(`${t.pLostItem} ${h.reports.lost}`);
            if (long) memo.push(t.longTag);
            if (h.note) memo.push(h.note);
            const staffName = staffLabelOf(h.staffId, staffDirectory) || h.staffName;
            return (
              <tr key={h.id} className={selectedId === h.id ? "sel" : ""} onClick={() => onSelect(h.id)}>
                <td className="mono b">{shortDate(h.date)}</td>
                <td>
                  <span className="mono b">{h.room}</span>
                  <div className="cl-tbl__sub">{typeLabel(h.type, t)}</div>
                </td>
                <td>{buildingLabelOf(h, buildingLabels)}</td>
                <td>
                  <span className="cl-who">
                    <span className="cl-av">{staffName ? Array.from(staffName)[0] : "–"}</span>
                    <b>{staffName || t.unassigned}</b>
                  </span>
                </td>
                <td className="mono">
                  {h.start || "—"} → {h.status === "progress" ? <span className="cl-live">{t.stProgress}</span> : (end ?? "—")}
                </td>
                <td className={`mono b${long ? " is-danger" : ""}${shownDur == null ? " is-muted" : ""}`}>{durLabel(shownDur, t)}</td>
                <td className="r cl-tbl__memo" title={memo.join(" · ")}>
                  {memo.length ? memo.join(" · ") : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
