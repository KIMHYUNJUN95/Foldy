"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminExportButtons } from "@/components/admin/shared/admin-export-buttons";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import type { LeaveStatus, LeaveType } from "@/lib/annual-leave-approvals-server";
import type { LeaveLedgerEntry } from "@/lib/annual-leave-admin-server";
import {
  exportLeaveLedgerReport,
  exportLeaveLedgerWorkbook,
} from "@/app/admin/attendance/leave/actions";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import { filterLeaveLedger, leaveLedgerProcessedKey, type LeaveLedgerFilter } from "@/lib/annual-leave";

type Lc = Dictionary["admin"]["leaveConsole"];

function roleLabel(role: string | null, dictionary: Dictionary): string {
  if (!role) return "—";
  const map = dictionary.roles as Record<string, string>;
  return map[role] ?? role;
}

function typeBadgeClass(type: LeaveType): string {
  switch (type) {
    case "paid":
      return "typebadge--paid";
    case "annual":
      return "typebadge--annual";
    case "special":
      return "typebadge--special";
    default:
      return "typebadge--other";
  }
}

function typeLabel(type: LeaveType, lc: Lc): string {
  switch (type) {
    case "paid":
      return lc.typePaid;
    case "annual":
      return lc.typeAnnual;
    case "special":
      return lc.typeSpecial;
    default:
      return lc.typeOther;
  }
}

function statusPill(status: LeaveStatus, lc: Lc): { label: string; cls: string } {
  switch (status) {
    case "requested":
      return { label: lc.statusRequested, cls: "pill--warn" };
    case "approved":
      return { label: lc.statusApproved, cls: "pill--done" };
    case "rejected":
      return { label: lc.statusRejected, cls: "pill--danger" };
    case "cancelled":
      return { label: lc.statusCancelled, cls: "pill--muted" };
  }
}

function fmtMd(iso: string): string {
  return iso.slice(5).replace("-", "/");
}

function fmtPeriod(e: LeaveLedgerEntry, lc: Lc): string {
  const s = fmtMd(e.startDate);
  const end = fmtMd(e.endDate);
  const base = s === end ? s : `${s} – ${end}`;
  if (e.durationUnit === "am") return `${base} · ${lc.durationAm}`;
  if (e.durationUnit === "pm") return `${base} · ${lc.durationPm}`;
  return base;
}

const STATUS_ORDER: LeaveStatus[] = ["approved", "requested", "rejected", "cancelled"];

/** `processedAt` 은 도쿄 "YYYY/MM/DD HH:mm" 이다 — 선택기가 쓰는 "YYYY-MM-DD" 키로 줄인다. */
const processedDateKey = leaveLedgerProcessedKey;

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export function LeaveLedgerView({
  lc,
  shared,
  locale,
  entries,
  onToast,
}: {
  lc: Lc;
  shared: Dictionary["admin"]["shared"];
  locale: Locale;
  entries: LeaveLedgerEntry[];
  onToast: (message: string) => void;
}) {
  const dictionary = getDictionary(locale);
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | null>(null);
  const [query, setQuery] = useState("");

  // 장부는 통째로 온다(listLeaveLedger 에 날짜 인자가 없다). 그래서 기간은 모든 행을 덮을 만큼
  // 넓게 시작하고, 좁히기는 선택이며 처음 그릴 때는 아무것도 숨기지 않는다.
  const [range, setRange] = useState(() => {
    const keys = entries.map(processedDateKey).filter(Boolean).sort();
    const today = todayKey();
    return { from: keys[0] ?? today, to: today };
  });

  // 화면과 내보내기가 같은 조건 · 같은 규칙 — 내보내기는 이 조건만 보내고 서버가 이력을 다시 읽는다(2026-10-26).
  const filter = useMemo<LeaveLedgerFilter>(
    () => ({ status: statusFilter, query, from: range.from, to: range.to }),
    [statusFilter, query, range],
  );
  const filtered = useMemo(() => filterLeaveLedger(entries, filter), [entries, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [entries]);

  return (
    <div>
      <div className="toolbar">
        <AdminDateRangePicker
          from={range.from}
          to={range.to}
          onChange={(from, to) => setRange({ from, to })}
          localeTag={adminLocaleTag(locale)}
          ariaLabel={shared.pickRange}
          labels={{
            prevMonth: shared.datePrevMonth,
            nextMonth: shared.dateNextMonth,
            thisMonth: shared.dateThisMonth,
            reset: shared.dateReset,
            typeStart: shared.dateTypeStart,
            typeEnd: shared.dateTypeEnd,
            pickYear: shared.datePickYear,
            pickMonth: shared.datePickMonth,
            apply: shared.dateApply,
          }}
        />
        <div className="fseg" role="tablist">
          <button
            type="button"
            className={statusFilter === null ? "on" : ""}
            onClick={() => setStatusFilter(null)}
          >
            {lc.ledgerFilterAll}
            <span className="cnt">{entries.length}</span>
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={statusFilter === s ? "on" : ""}
              onClick={() => setStatusFilter(s)}
            >
              {statusPill(s, lc).label}
              <span className="cnt">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <span className="toolbar__spacer" />
        <div className="qsearch">
          <span className="ic">
            <Search />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={lc.ledgerSearchPlaceholder}
            aria-label={lc.ledgerSearchPlaceholder}
          />
        </div>
        <AdminExportButtons
          onExportXls={() => exportLeaveLedgerWorkbook(filter)}
          onExportPdf={() => exportLeaveLedgerReport(filter)}
          disabled={filtered.length === 0}
          onToast={onToast}
          labels={shared}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="state">
            <span className="state__ic empty">
              <span className="ic">
                <Search />
              </span>
            </span>
            <div className="state__t">{lc.ledgerEmptyTitle}</div>
            <div className="state__s">{lc.ledgerEmptyBody}</div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="qtbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 16 }}>{lc.ledgerColApplicant}</th>
                  <th>{lc.ledgerColType}</th>
                  <th>{lc.ledgerColPeriod}</th>
                  <th style={{ textAlign: "right" }}>{lc.ledgerColDays}</th>
                  <th>{lc.ledgerColStatus}</th>
                  <th>{lc.ledgerColProcessor}</th>
                  <th>{lc.ledgerColProcessedAt}</th>
                  <th>{lc.ledgerColDocNo}</th>
                  <th>{lc.ledgerColReason}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const pill = statusPill(e.status, lc);
                  return (
                    <tr key={e.id}>
                      <td style={{ paddingLeft: 16 }}>
                        <div className="who">
                          <span className="avatar" style={{ background: e.applicantBg, color: "#fff" }}>
                            {e.applicantInitial}
                          </span>
                          <div>
                            <div className="who__nm">{e.applicantName}</div>
                            <div className="who__sub">{roleLabel(e.applicantRole, dictionary)}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`typebadge ${typeBadgeClass(e.leaveType)}`}>{typeLabel(e.leaveType, lc)}</span>
                      </td>
                      <td className="mono">{fmtPeriod(e, lc)}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {lc.daysUnit(e.daysCount)}
                      </td>
                      <td>
                        <span className={`pill ${pill.cls}`}>{pill.label}</span>
                      </td>
                      <td>{e.processorName ?? <span className="dim-cell">—</span>}</td>
                      <td className="dim-cell mono">{e.processedAt}</td>
                      <td className="dim-cell mono">{e.documentNumber ?? "—"}</td>
                      <td className="dim-cell" style={{ maxWidth: 220 }}>
                        <span
                          title={
                            e.decisionReason
                              ? `${lc.formReason}: ${e.reason} / ${lc.ledgerColDecisionReason}: ${e.decisionReason}`
                              : e.reason
                          }
                          style={{
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {e.decisionReason
                            ? `${lc.ledgerColDecisionReason}: ${e.decisionReason}`
                            : e.reason}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
