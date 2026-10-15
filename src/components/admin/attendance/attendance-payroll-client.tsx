"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CircleAlert,
  CircleCheck,
  LogOut,
  Shield,
  Wallet,
  X,
} from "lucide-react";
import type { AdminPayrollRow } from "@/lib/admin-attendance";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import {
  exportMonthlyPayrollReport,
  exportMonthlyPayrollWorkbook,
  exportUserPayrollReport,
  exportUserPayrollWorkbook,
  finalizeAttendanceMonth,
  reopenAttendanceMonth,
} from "@/app/admin/attendance/actions";
import { AdminExportButtons, type AdminExportLabels } from "../shared/admin-export-buttons";
import { AdminReasonModal } from "../shared/admin-reason-modal";
import { AdminUndoToast } from "../shared/admin-undo-toast";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";
import { formatAdminYen } from "../shared/admin-format";

type Att = Dictionary["admin"]["attendanceConsole"];

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}
function initial(name: string): string {
  return name.trim().slice(0, 1) || "·";
}
function employmentLabel(emp: AdminPayrollRow["employment"], c: Att): string {
  switch (emp) {
    case "hourly":
      return c.payEmploymentHourly;
    case "salaried":
      return c.payEmploymentSalaried;
    case "mixed":
      return c.payEmploymentMixed;
    default:
      return c.payEmploymentNone;
  }
}

function payStatusPill(row: AdminPayrollRow, c: Att): { label: string; cls: string } {
  if (row.finalized) return { label: c.payStatusFinalized, cls: "pill--done" };
  return { label: c.payStatusEstimated, cls: "pill--info" };
}

export function AttendancePayrollClient({
  ym,
  monthLabel,
  initialRows,
  initialKpi,
  locale,
  localeTag,
}: {
  ym: string;
  monthLabel: string;
  initialRows: AdminPayrollRow[];
  initialKpi: {
    hourlyTarget: number;
    expectedTotal: number;
    excludedTotal: number;
    finalizedCount: number;
  };
  locale: Locale;
  localeTag: string;
}) {
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const shared = dictionary.admin.shared;
  const [rows, setRows] = useState(initialRows);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  const showToast = (msg: string) => setToast((prev) => ({ id: (prev?.id ?? 0) + 1, msg }));
  const [exportHourlyOnly, setExportHourlyOnly] = useState(false);
  // 한 번 클릭 마감(2026-10-15, 시안 Motion-C-Confirm-PC) — 확인 창 없이 마감 → 다음 직원으로 → 실행 취소 토스트.
  const [undo, setUndo] = useState<{ stamp: number; items: { userId: string; name: string }[] } | null>(null);
  const [undoPending, startUndo] = useTransition();
  const [fresh, setFresh] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const panelRow = panelId ? rows.find((r) => r.userId === panelId) ?? null : null;

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 1700);
    return () => clearTimeout(t);
  }, [fresh]);

  function openPanel(userId: string | null) {
    setAdvanced(false);
    setPanelId(userId);
  }

  // 마감 → 줄 「확정」 → 표에서 다음에 마감할 수 있는 직원으로(없으면 패널 닫힘) · 토스트에 한 명 더.
  function handleFinalized(updated: AdminPayrollRow) {
    const idx = rows.findIndex((r) => r.userId === updated.userId);
    const order = [...rows.slice(idx + 1), ...rows.slice(0, Math.max(0, idx))];
    const next = order.find((r) => !r.finalized && r.finalizationEligible && r.employment !== "salaried");
    applyRow(updated);
    setFresh(updated.userId);
    setUndo((prev) => ({
      stamp: (prev?.stamp ?? 0) + 1,
      items: [...(prev?.items ?? []), { userId: updated.userId, name: updated.userName }],
    }));
    setAdvanced(Boolean(next));
    setPanelId(next ? next.userId : null);
  }

  function undoFinalize() {
    const items = undo?.items ?? [];
    startUndo(async () => {
      let failed = false;
      for (const it of items) {
        const res = await reopenAttendanceMonth({ userId: it.userId, ym, reason: c.payUndoReason });
        if (res.ok) setRows((prev) => prev.map((r) => (r.userId === it.userId ? reopenedRow(r) : r)));
        else failed = true;
      }
      setUndo(null);
      showToast(failed ? c.actionFailed : c.payActionDoneReopen);
    });
  }

  function applyRow(updated: AdminPayrollRow) {
    setRows((prev) => prev.map((r) => (r.userId === updated.userId ? updated : r)));
  }

  // 평균 시급 = 직원별 시급을 인정 시간으로 가중 평균. 기본급 ÷ 시간으로 내면 월 10엔 올림이 섞여
  // 실제 없는 시급(¥1,613 등)이 나온다. 시급 대상이 없으면 0.
  const hourlyRows = rows.filter((r) => r.employment !== "salaried" && r.totalPaidMinutes > 0 && r.primaryRate > 0);
  const paidMinutesSum = hourlyRows.reduce((sum, r) => sum + r.totalPaidMinutes, 0);
  const avgRate = paidMinutesSum > 0 ? Math.round(hourlyRows.reduce((sum, r) => sum + r.primaryRate * r.totalPaidMinutes, 0) / paidMinutesSum) : 0;
  function hoursLabel(mins: number) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}${c.unitMinShort}`;
    return m === 0 ? `${h}${c.unitHourShort}` : c.payHoursFmt.replace("{h}", String(h)).replace("{m}", String(m));
  }

  return (
    <div style={{ position: "relative" }}>
      {/* 화이트 리디자인(2026-10-13, 시안 AttPay-PC): 숫자 줄 → 상태 · 내보내기 줄 → 표(근무일 · 인정 시간 · 시급 · 수당 · 예상 급여 · 제외 · 상태).
          쓰이지 않던 「고용형태」 필터 칩(비활성)은 뺐다. */}
      <div className="wkpis" style={{ marginBottom: 6 }}>
        <div className="wkpi">
          <span className="wkpi__k">{c.payKpiHourly}</span>
          <span className="wkpi__v">
            {initialKpi.hourlyTarget}
            <small>{c.unitPeople}</small>
          </span>
          <span className="wkpi__d">{monthLabel}</span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{c.payKpiExpected}</span>
          <span className="wkpi__v">
            {c.yenSym}
            {formatAdminYen(initialKpi.expectedTotal, localeTag)}
          </span>
          <span className="wkpi__d">{c.payKpiExpectedSub}</span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{c.payKpiExcluded}</span>
          <span className={`wkpi__v${initialKpi.excludedTotal > 0 ? " is-danger" : ""}`}>
            {initialKpi.excludedTotal}
            <small>{c.unitCount}</small>
          </span>
          <span className="wkpi__d">{c.kpiPayExcludedSub}</span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{c.payKpiAvgRate}</span>
          <span className="wkpi__v">{avgRate > 0 ? `${c.yenSym}${formatAdminYen(avgRate, localeTag)}` : "—"}</span>
          <span className="wkpi__d">{c.payKpiAvgRateSub}</span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{c.payKpiFinalized}</span>
          <span className="wkpi__v">
            {initialKpi.finalizedCount}
            <small>{c.unitPeople}</small>
          </span>
          <span className="wkpi__d">{c.payStatusFinalized}</span>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 10 }}>
        <span className="pay-state">{initialKpi.finalizedCount > 0 && initialKpi.finalizedCount >= rows.length ? c.payStatusFinalized : c.payStateLine}</span>
        <span className="toolbar__spacer" />
        <button
          type="button"
          className={`export-toggle${exportHourlyOnly ? " on" : ""}`}
          role="switch"
          aria-checked={exportHourlyOnly}
          onClick={() => setExportHourlyOnly((v) => !v)}
        >
          <span className="export-toggle__track" aria-hidden="true">
            <span className="export-toggle__knob" />
          </span>
          <span className="export-toggle__label">{c.payExportHourlyOnly}</span>
        </button>
        <AdminExportButtons
          onExportXls={() => exportMonthlyPayrollWorkbook(ym, { hourlyOnly: exportHourlyOnly })}
          onExportPdf={() => exportMonthlyPayrollReport(ym, { hourlyOnly: exportHourlyOnly })}
          disabled={rows.length === 0}
          onToast={showToast}
          labels={shared}
        />
      </div>

      {rows.length === 0 ? (
        <div className="state">
          <span className="state__ic empty">
            <Ic>
              <Wallet />
            </Ic>
          </span>
          <div className="state__t">{c.payEmptyTitle}</div>
          <div className="state__s">{c.payEmptyBody}</div>
        </div>
      ) : (
        <table className="qtbl pay-tbl">
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>{c.payColStaff}</th>
              <th className="r">{c.payColWorkDays}</th>
              <th className="r">{c.payColRecognized}</th>
              <th className="r">{c.payColRate}</th>
              <th className="r">{c.payColAllowance}</th>
              <th className="r">{c.payColExpected}</th>
              <th className="r">{c.payColExcluded}</th>
              <th className="r">{c.payColStatus}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pill = payStatusPill(r, c);
              const sel = panelId === r.userId;
              const isSalaried = r.employment === "salaried";
              return (
                <tr
                  key={r.userId}
                  className={[sel ? "sel" : "", fresh === r.userId ? "cfm-fresh" : ""].join(" ").trim()}
                  onClick={() => openPanel(r.userId)}
                >
                  <td style={{ paddingLeft: 16 }}>
                    <div className="who">
                      <span className="uhead__av" style={{ width: 32, height: 32 }}>
                        {initial(r.userName)}
                      </span>
                      <div>
                        <div className="who__nm">{r.userName}</div>
                        <div className="who__sub">
                          {r.employmentMissing ? (
                            <span style={{ color: "#a8641c", fontWeight: 600 }}>{c.payEmploymentMissing}</span>
                          ) : (
                            employmentLabel(r.employment, c)
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="r num">{r.workDays > 0 ? `${r.workDays}${c.unitDay}` : <span className="dim-cell">—</span>}</td>
                  <td className="r num">{r.totalPaidMinutes > 0 ? hoursLabel(r.totalPaidMinutes) : <span className="dim-cell">—</span>}</td>
                  <td className="r num">
                    {r.primaryRate > 0 ? `${c.yenSym}${formatAdminYen(r.primaryRate, localeTag)}` : <span className="dim-cell">—</span>}
                  </td>
                  <td className="r num">
                    {r.allowanceTotal > 0 ? `${c.yenSym}${formatAdminYen(r.allowanceTotal, localeTag)}` : <span className="dim-cell">—</span>}
                  </td>
                  <td className="r num">
                    {isSalaried || (r.expectedGross === 0 && r.totalPaidMinutes === 0) ? (
                      <span className="dim-cell">—</span>
                    ) : (
                      <b>{`${c.yenSym}${formatAdminYen(r.expectedGross, localeTag)}`}</b>
                    )}
                  </td>
                  <td className="r">
                    {r.excludedCount > 0 ? (
                      <Link
                        className="pay-excl"
                        href={`/admin/attendance/queue?ym=${ym}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.payExcludedLink.replace("{n}", String(r.excludedCount))} ›
                      </Link>
                    ) : (
                      <span className="dim-cell">—</span>
                    )}
                  </td>
                  <td className="r">
                    <span className={`pill ${pill.cls}`}>{pill.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Right detail panel */}
      {panelRow ? (
        <PayrollPanel
          ym={ym}
          row={panelRow}
          c={c}
          shared={shared}
          localeTag={localeTag}
          advanced={advanced}
          onClose={() => openPanel(null)}
          onFinalized={handleFinalized}
          onUpdated={(updated, msg) => {
            applyRow(updated);
            showToast(msg);
          }}
        />
      ) : null}

      {undo ? (
        <AdminUndoToast
          stamp={undo.stamp}
          message={
            undo.items.length === 1
              ? c.payUndoOne.replace("{name}", undo.items[0].name)
              : c.payUndoMany.replace("{n}", String(undo.items.length))
          }
          undoLabel={shared.undo}
          pending={undoPending}
          onUndo={undoFinalize}
          onExpire={() => setUndo(null)}
        />
      ) : toast ? (
        <div key={toast.id} role="status" className="adm-toast" onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

/** 마감이 풀린 줄 — 막는 것이 없으면 다시 마감 가능. */
function reopenedRow(row: AdminPayrollRow): AdminPayrollRow {
  const b = row.blockers;
  return {
    ...row,
    finalized: false,
    finalizationEligible:
      row.employment !== "salaried" && b.reviewRequired === 0 && b.pendingCorrections === 0 && b.openSessions === 0,
    blockers: { ...b, alreadyFinalized: false },
  };
}

/** 마감 버튼의 자물쇠 — 마감되면 고리가 「딸깍」 내려와 잠김(`.cfm-shackle`). */
function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path className="cfm-shackle" d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" />
    </svg>
  );
}

function PayrollPanel({
  ym,
  row,
  c,
  shared,
  localeTag,
  advanced,
  onClose,
  onFinalized,
  onUpdated,
}: {
  ym: string;
  row: AdminPayrollRow;
  c: Att;
  shared: AdminExportLabels;
  localeTag: string;
  advanced: boolean;
  onClose: () => void;
  onFinalized: (updated: AdminPayrollRow) => void;
  onUpdated: (updated: AdminPayrollRow, toast: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"reopen" | null>(null);
  // 마감 직후 0.65초 — 버튼이 초록 「마감됨」 · 자물쇠 딸깍을 보여 준 뒤 다음 직원으로 넘어간다.
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const done = doneFor === row.userId;
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: modal !== null });
  const pill = payStatusPill(row, c);
  const b = row.blockers;
  const hasBlockers =
    b.reviewRequired > 0 ||
    b.pendingCorrections > 0 ||
    b.openSessions > 0 ||
    b.alreadyFinalized;
  const blockerHref = (f: "review" | "corr") =>
    `/admin/attendance/queue?ym=${ym}&filter=${f}&q=${encodeURIComponent(row.userName)}`;

  function doFinalize() {
    setErr(null);
    startTransition(async () => {
      const res = await finalizeAttendanceMonth({ userId: row.userId, ym });
      if (res.ok) {
        setDoneFor(row.userId);
        const finalizedRow = { ...row, finalized: true, finalizationEligible: false };
        setTimeout(() => onFinalized(finalizedRow), 650);
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "blocked") {
        setErr(c.payActionBlocked);
      } else if (res.reason === "not_hourly") {
        setErr(c.payActionNotHourly);
      } else {
        setErr(c.actionFailed);
      }
    });
  }
  function doReopen(reason: string) {
    if (!reason.trim()) {
      setErr(c.actionReasonRequired);
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await reopenAttendanceMonth({
        userId: row.userId,
        ym,
        reason: reason.trim(),
      });
      if (res.ok) {
        onUpdated(reopenedRow(row), c.payActionDoneReopen);
        onClose();
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "reason_required") {
        setErr(c.actionReasonRequired);
      } else {
        setErr(c.actionFailed);
      }
    });
  }
  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside
        ref={panelRef}
        className={`panel on${advanced ? " cfm-next" : ""}`}
        role="dialog"
        aria-label={c.payPanelKicker}
        tabIndex={-1}
      >
        <div className="panel__h" key={`h-${row.userId}`}>
          <div className="panel__top">
            <span className="panel__kicker">{c.payPanelKicker}</span>
            <button type="button" className="panel__x" onClick={onClose} aria-label={c.panelClose}>
              <Ic>
                <X />
              </Ic>
            </button>
          </div>
          <div className="panel__title">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="uhead__av" style={{ background: "var(--adm-primary)" }}>
                {initial(row.userName)}
              </span>
              <span>
                <span
                  className="panel__sub"
                  style={{
                    display: "block",
                    color: "var(--ink)",
                    fontSize: 17,
                    fontWeight: 900,
                  }}
                >
                  {row.userName}
                </span>
                <span className="panel__sub">{row.role ?? "—"}</span>
              </span>
            </span>
          </div>
          <div className="panel__chips">
            <span className={`pill ${pill.cls}`}>
              <span className="d" />
              {pill.label}
            </span>
            {row.employmentMissing ? (
              <span className="pill pill--warn">{c.payEmploymentMissing}</span>
            ) : (
              <span className="pill pill--muted">{employmentLabel(row.employment, c)}</span>
            )}
          </div>
        </div>

        <div className="panel__body" key={`b-${row.userId}`}>
          {/* summary */}
          <div className="pblock">
            <div className="pblock__t">{c.payPanelSecSummary}</div>
            <div className="kv">
              <span className="kv__k">{c.payPanelKvRecognized}</span>
              <span className="kv__v mono">{row.recognizedLabel}</span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.payPanelKvRate}</span>
              <span className="kv__v">
                {row.primaryRate > 0 ? (
                  <>
                    <span className="mono">
                      {c.yenSym}
                      {formatAdminYen(row.primaryRate, localeTag)}
                    </span>
                    <span className="dim-cell"> {c.payRateUnit}</span>
                  </>
                ) : (
                  <span className="dim-cell">—</span>
                )}
              </span>
            </div>
            {row.allowanceTotal > 0 && row.employment !== "salaried" ? (
              <>
                <div className="kv">
                  <span className="kv__k">{c.payPanelKvBase}</span>
                  <span className="kv__v">
                    <span className="mono">
                      {c.yenSym}
                      {formatAdminYen(row.baseGross, localeTag)}
                    </span>
                  </span>
                </div>
                {row.allowanceRegularTotal > 0 ? (
                  <div className="kv">
                    <span className="kv__k">{c.payPanelKvAllowance}</span>
                    <span className="kv__v">
                      <span className="mono">
                        {c.yenSym}
                        {formatAdminYen(row.allowanceRegularTotal, localeTag)}
                      </span>
                    </span>
                  </div>
                ) : null}
                {row.allowanceSpecialTotal > 0 ? (
                  <div className="kv">
                    <span className="kv__k">{c.payPanelKvSpecial}</span>
                    <span className="kv__v">
                      <span className="mono">
                        {c.yenSym}
                        {formatAdminYen(row.allowanceSpecialTotal, localeTag)}
                      </span>
                    </span>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="kv">
              <span className="kv__k">{c.payPanelKvExpected}</span>
              <span className="kv__v">
                {row.employment === "salaried" ? (
                  <span className="dim-cell">—</span>
                ) : (
                  <span className="mono">
                    {c.yenSym}
                    {formatAdminYen(row.expectedGross, localeTag)}
                  </span>
                )}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.payExportTransport}</span>
              <span className="kv__v">
                {row.transportApproved > 0 ? (
                  <span className="mono">
                    {c.yenSym}
                    {formatAdminYen(row.transportApproved, localeTag)}
                  </span>
                ) : (
                  <span className="dim-cell">
                    {c.yenSym}
                    {formatAdminYen(0, localeTag)}
                  </span>
                )}
              </span>
            </div>
            <div className="kv kv--total">
              <span className="kv__k">{c.payExportTotalWithTransport}</span>
              <span className="kv__v">
                {row.employment === "salaried" ? (
                  <span className="dim-cell">—</span>
                ) : (
                  <b className="mono">
                    {c.yenSym}
                    {formatAdminYen(row.expectedGross + row.transportApproved, localeTag)}
                  </b>
                )}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.payPanelKvExcluded}</span>
              <span className="kv__v">
                {row.excludedCount > 0 ? (
                  <b style={{ color: "var(--warn)" }}>
                    {row.excludedCount}
                    {c.unitCount}
                  </b>
                ) : (
                  "0"
                )}
              </span>
            </div>
            {row.finalizedAtLabel ? (
              <div className="kv">
                <span className="kv__k">{c.payPanelKvFinalized}</span>
                <span className="kv__v">{row.finalizedAtLabel}</span>
              </div>
            ) : null}
            {row.employment === "salaried" ? (
              <div className="locknote" style={{ marginTop: 10 }}>
                <Ic>
                  <Shield />
                </Ic>
                {c.payRoleGuestNote}
              </div>
            ) : null}
          </div>

          {/* blockers */}
          <div className="pblock">
            <div className="pblock__t">{c.payPanelSecBlockers}</div>
            {hasBlockers ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {b.reviewRequired > 0 ? (
                  <Link
                    className="errbar is-warn errbar--link"
                    style={{ margin: 0 }}
                    href={blockerHref("review")}
                    title={c.payPanelBlockerGo}
                  >
                    <span className="errbar__ic">
                      <Ic>
                        <AlertTriangle />
                      </Ic>
                    </span>
                    <div>
                      <div className="errbar__t">{c.payPanelBlockerReview(b.reviewRequired)}</div>
                    </div>
                    <span className="errbar__a">
                      <Ic>
                        <ArrowUpRight />
                      </Ic>
                    </span>
                  </Link>
                ) : null}
                {b.pendingCorrections > 0 ? (
                  <Link
                    className="errbar is-warn errbar--link"
                    style={{ margin: 0 }}
                    href={blockerHref("corr")}
                    title={c.payPanelBlockerGo}
                  >
                    <span className="errbar__ic">
                      <Ic>
                        <AlertTriangle />
                      </Ic>
                    </span>
                    <div>
                      <div className="errbar__t">{c.payPanelBlockerCorr(b.pendingCorrections)}</div>
                    </div>
                    <span className="errbar__a">
                      <Ic>
                        <ArrowUpRight />
                      </Ic>
                    </span>
                  </Link>
                ) : null}
                {b.openSessions > 0 ? (
                  <Link
                    className="errbar is-warn errbar--link"
                    style={{ margin: 0 }}
                    href={blockerHref("review")}
                    title={c.payPanelBlockerGo}
                  >
                    <span className="errbar__ic">
                      <Ic>
                        <AlertTriangle />
                      </Ic>
                    </span>
                    <div>
                      <div className="errbar__t">{c.payPanelBlockerOpen(b.openSessions)}</div>
                    </div>
                    <span className="errbar__a">
                      <Ic>
                        <ArrowUpRight />
                      </Ic>
                    </span>
                  </Link>
                ) : null}
                {b.alreadyFinalized ? (
                  <div className="locknote">
                    <Ic>
                      <CircleCheck />
                    </Ic>
                    {c.payPanelBlockerAlready}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="locknote">
                <Ic>
                  <CircleCheck />
                </Ic>
                {c.payPanelBlockerNone}
              </div>
            )}
          </div>

          {/* perm zone */}
          <div className="pblock">
            <div className="permzone">
              <div className="permzone__h">
                <span className="permzone__ic">
                  <Ic>
                    <Shield />
                  </Ic>
                </span>
                <div>
                  <div className="permzone__t">{c.payPanelPermTitle}</div>
                  <div className="permzone__s">{c.payPanelPermSub}</div>
                </div>
                <span className="permzone__role">
                  <Ic>
                    <Shield />
                  </Ic>
                  {c.panelPermRole}
                </span>
              </div>
              <div className="locknote" style={{ marginTop: 10 }}>
                <Ic>
                  <CircleAlert />
                </Ic>
                {c.payExportFinalizedNote}
              </div>
            </div>
          </div>

          {err ? (
            <div className="pblock">
              <div className="errbar">
                <span className="errbar__ic">
                  <Ic>
                    <LogOut />
                  </Ic>
                </span>
                <div>
                  <div className="errbar__t">{err}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel__foot">
          <Link
            className="btn btn--subtle btn--sm"
            href={`/admin/attendance/staff/${row.userId}?ym=${ym}`}
            style={{ flex: 1 }}
          >
            <Ic>
              <ArrowUpRight />
            </Ic>
            {c.staffViewMonthlyDetailShort}
          </Link>
          <AdminExportButtons
            onExportXls={() => exportUserPayrollWorkbook(row.userId, ym)}
            onExportPdf={() => exportUserPayrollReport(row.userId, ym)}
            disabled={pending || !row.finalized}
            disabledTitle={!row.finalized ? c.payExportFinalizedNote : undefined}
            onToast={setErr}
            labels={shared}
            variant="panel"
          />
          {done ? (
            <button type="button" className="btn btn--ok cfm-done" style={{ flex: 1.4 }} disabled aria-live="polite">
              <LockIcon />
              <span className="cfm-lab">{c.payPanelBtnFinalizedShort}</span>
            </button>
          ) : row.finalized ? (
            <button
              type="button"
              className="btn btn--danger-ghost"
              style={{ flex: 1.2 }}
              onClick={() => setModal("reopen")}
              disabled={pending}
            >
              <Ic>
                <Ban />
              </Ic>
              {c.payPanelBtnReopenShort}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ok"
              style={{ flex: 1.4 }}
              onClick={doFinalize}
              disabled={pending || !row.finalizationEligible || row.employment === "salaried"}
            >
              <LockIcon />
              {c.payPanelBtnFinalizeShort}
            </button>
          )}
        </div>
      </aside>
      {modal === "reopen" ? (
        <AdminReasonModal
          title={c.payPanelBtnReopen}
          description={c.payPromptReopen}
          placeholder={c.payPromptReopen}
          confirmLabel={c.payPanelBtnReopenShort}
          cancelLabel={c.dialogCancel}
          pending={pending}
          errorText={err}
          danger
          onConfirm={(reason) => {
            setModal(null);
            doReopen(reason);
          }}
          onCancel={() => setModal(null)}
        />
      ) : null}
    </>
  );
}
