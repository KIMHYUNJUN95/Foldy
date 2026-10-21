"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowUpRight,
  CircleAlert,
  Info,
  Lock,
  LogOut,
  Pencil,
  Shield,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import type { AdminWageRow } from "@/lib/admin-attendance";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import {
  exportAttendanceWagesReport,
  exportAttendanceWagesWorkbook,
  setEmploymentType,
  setHourlyRate,
} from "@/app/admin/attendance/actions";
import { AdminDatePicker } from "../shared/admin-date-picker";
import { AdminExportButtons } from "../shared/admin-export-buttons";
import { AdminReasonModal } from "../shared/admin-reason-modal";
import { formatOptionalAdminYen } from "../shared/admin-format";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";

type Att = Dictionary["admin"]["attendanceConsole"];
type Filter = "all" | "hourly" | "salaried";

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}
function initial(name: string): string {
  return name.trim().slice(0, 1) || "·";
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return d.replace(/-/g, ".").slice(2);
}

export function AttendanceWagesClient({
  initialRows,
  ym,
  defaultEffectiveFrom,
  minEffectiveFrom,
  gapFillMinFrom,
  locale,
  localeTag,
}: {
  initialRows: AdminWageRow[];
  ym: string;
  defaultEffectiveFrom: string;
  minEffectiveFrom: string;
  gapFillMinFrom: string;
  locale: Locale;
  localeTag: string;
}) {
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const shared = dictionary.admin.shared;
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>("all");
  const [panelId, setPanelId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  const showToast = (msg: string) => setToast({ id: Date.now(), msg });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      hourly: rows.filter((r) => r.employment === "hourly").length,
      salaried: rows.filter((r) => r.employment === "salaried").length,
    }),
    [rows],
  );
  const list = useMemo(
    () =>
      filter === "all"
        ? rows
        : rows.filter((r) =>
            filter === "hourly" ? r.employment === "hourly" : r.employment === "salaried",
          ),
    [rows, filter],
  );

  const panelRow = panelId ? rows.find((r) => r.userId === panelId) ?? null : null;

  function applyRow(updated: AdminWageRow) {
    setRows((prev) => prev.map((r) => (r.userId === updated.userId ? updated : r)));
  }

  return (
    <div style={{ position: "relative" }}>
      <div className="toolbar">
        <div className="fseg" role="tablist">
          <button
            type="button"
            className={filter === "all" ? "on" : ""}
            onClick={() => setFilter("all")}
          >
            {c.wageFilterAll}
            <span className="cnt">{counts.all}</span>
          </button>
          <button
            type="button"
            className={filter === "hourly" ? "on" : ""}
            onClick={() => setFilter("hourly")}
          >
            {c.wageFilterHourly}
            <span className="cnt">{counts.hourly}</span>
          </button>
          <button
            type="button"
            className={filter === "salaried" ? "on" : ""}
            onClick={() => setFilter("salaried")}
          >
            {c.wageFilterSalaried}
            <span className="cnt">{counts.salaried}</span>
          </button>
        </div>
        <span className="toolbar__spacer" />
        <AdminExportButtons
          onExportXls={exportAttendanceWagesWorkbook}
          onExportPdf={exportAttendanceWagesReport}
          disabled={rows.length === 0}
          onToast={showToast}
          labels={shared}
        />
      </div>

      {list.length === 0 ? (
        <div className="card">
          <div className="state">
            <span className="state__ic empty">
              <Ic>
                <User />
              </Ic>
            </span>
            <div className="state__t">{c.wageEmptyTitle}</div>
            <div className="state__s">{c.wageEmptyBody}</div>
          </div>
        </div>
      ) : (
        // 화이트 리디자인(2026-10-13, 시안 AttRate-PC): 카드 · 고용형태 배지 · 구간 수 대신 현재 시급 · 적용일 · 최근 변경 · 변경 이력(오른쪽 정렬).
        <div>
          <table className="qtbl wage-tbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 16 }}>{c.wageColStaff}</th>
                <th className="r">{c.wageColCurrent}</th>
                <th className="r">{c.wageColFrom}</th>
                <th className="r">{c.wageColRecent}</th>
                <th className="r">{c.wageColChanges}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const salaried = r.employment === "salaried";
                const sel = panelId === r.userId;
                const hist = [...r.history].filter((h) => h.rate != null).sort((x, y) => (x.from < y.from ? 1 : -1));
                const yen = (n: number | null) => (n == null ? "—" : `${c.yenSym}${formatOptionalAdminYen(n, localeTag)}`);
                return (
                  <tr key={r.userId} className={sel ? "sel" : ""} onClick={() => setPanelId(r.userId)}>
                    <td style={{ paddingLeft: 16 }}>
                      <div className="who">
                        <span className="uhead__av" style={{ width: 32, height: 32 }}>
                          {initial(r.userName)}
                        </span>
                        <div>
                          <div className="who__nm">{r.userName}</div>
                          <div className="who__sub">
                            {r.role ?? "—"} · {salaried ? c.wageTagSalaried : c.wageTagHourly}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="r num">
                      {salaried || r.currentRate == null ? <span className="dim-cell">{c.wageNotApplied}</span> : <b>{yen(r.currentRate)}</b>}
                    </td>
                    <td className="r num">{salaried || !r.currentFrom ? <span className="dim-cell">—</span> : fmtDate(r.currentFrom)}</td>
                    <td className="r num">
                      {salaried || hist.length === 0 ? (
                        <span className="dim-cell">—</span>
                      ) : hist.length === 1 ? (
                        <span className="dim-cell">{c.wageInitialSet}</span>
                      ) : (
                        `${yen(hist[1].rate)} → ${yen(hist[0].rate)}`
                      )}
                    </td>
                    <td className="r">
                      {salaried || hist.length === 0 ? <span className="dim-cell">—</span> : <span className="dim-cell">{c.wageTimes.replace("{n}", String(hist.length))}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--faint)",
          margin: "13px 4px 0",
          lineHeight: 1.6,
        }}
      >
        {c.wageHelpFootnote}
      </p>

      {panelRow ? (
        <WagePanel
          row={panelRow}
          ym={ym}
          c={c}
          localeTag={localeTag}
          defaultEffectiveFrom={defaultEffectiveFrom}
          minEffectiveFrom={minEffectiveFrom}
          gapFillMinFrom={gapFillMinFrom}
          onClose={() => setPanelId(null)}
          onApplied={(updated, toastMsg) => {
            applyRow(updated);
            showToast(toastMsg ?? c.wageActionDone);
            setPanelId(null);
          }}
        />
      ) : null}

      {toast ? (
        <div key={toast.id} role="status" className="adm-toast" onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

function WagePanel({
  row,
  ym,
  c,
  localeTag,
  defaultEffectiveFrom,
  minEffectiveFrom,
  gapFillMinFrom,
  onClose,
  onApplied,
}: {
  row: AdminWageRow;
  ym: string;
  c: Att;
  localeTag: string;
  defaultEffectiveFrom: string;
  minEffectiveFrom: string;
  gapFillMinFrom: string;
  onClose: () => void;
  onApplied: (updated: AdminWageRow, toastMsg?: string) => void;
}) {
  const router = useRouter();
  // 앞쪽 빈 날 채우기(2026-10-21) — 이력이 없거나 지난달 1일보다 늦게 시작하면 그 앞 빈 날도 고를 수 있다.
  // 이미 값이 있는 날 · 마감된 달은 서버(`planPastGapFill`)가 다시 거른다.
  const earliestRateFrom = row.history.reduce<string | null>((m, h) => (!m || h.from < m ? h.from : m), null);
  const earliestEmpFrom = row.employmentHistory.reduce<string | null>((m, h) => (!m || h.from < m ? h.from : m), null);
  const rateMinFrom = !earliestRateFrom || earliestRateFrom > gapFillMinFrom ? gapFillMinFrom : minEffectiveFrom;
  const empMinFrom = !earliestEmpFrom || earliestEmpFrom > gapFillMinFrom ? gapFillMinFrom : minEffectiveFrom;
  const salaried = row.employment === "salaried";
  const currentEmp: "hourly" | "salaried" | "unknown" = row.employment;
  const [empType, setEmpType] = useState<"hourly" | "salaried">(
    currentEmp === "salaried" ? "salaried" : "hourly",
  );
  const [empDate, setEmpDate] = useState<string>(defaultEffectiveFrom);
  const [empConfirm, setEmpConfirm] = useState(false);
  const [empPending, startEmpTransition] = useTransition();
  const [empErr, setEmpErr] = useState<string | null>(null);
  // A change is applicable when the picked type differs from the current active one (unknown = never
  // set, so any pick counts) and the date is valid.
  const empChanged = currentEmp === "unknown" ? true : empType !== currentEmp;
  const canApplyEmp = empChanged && /^\d{4}-\d{2}-\d{2}$/.test(empDate) && !empPending;
  const empTypeLabel = empType === "hourly" ? c.wageTagHourly : c.wageTagSalaried;

  // Employment change is sensitive (alters pay model + leave eligibility), so it goes through a
  // confirmation modal rather than applying on the first click. The reason is captured there.
  function doApplyEmp(reason: string) {
    setEmpErr(null);
    startEmpTransition(async () => {
      const res = await setEmploymentType({
        userId: row.userId,
        employmentType: empType,
        effectiveFrom: empDate,
        note: reason.trim() ? reason.trim() : null,
      });
      if (res.ok) {
        setEmpConfirm(false);
        router.refresh();
        // 빈 날 채우기는 지난 구간만 채운다 — 이미 유형이 있으면 지금 유형은 그대로다.
        const filledPastOnly = empDate < minEffectiveFrom && currentEmp !== "unknown";
        onApplied(filledPastOnly ? row : { ...row, employment: empType }, c.wageActionEmploymentDone);
      } else if (res.reason === "forbidden") {
        setEmpErr(c.wageActionForbidden);
      } else if (res.reason === "future_required") {
        setEmpErr(c.wageActionFutureRequired);
      } else if (res.reason === "month_finalized") {
        setEmpErr(c.wageActionMonthFinalized);
      } else if (res.reason === "no_change") {
        setEmpErr(c.wagePanelEmpSame);
      } else {
        setEmpErr(c.wageActionFailed);
      }
    });
  }
  const [rate, setRate] = useState<string>(
    row.currentRate != null ? String(row.currentRate) : "",
  );
  const [date, setDate] = useState<string>(defaultEffectiveFrom);
  const [reason, setReason] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose);

  const parsedRate = Number(rate);
  const validRate = Number.isFinite(parsedRate) && parsedRate > 0;
  // A change is applicable when either the rate or the effective date differs from the current
  // tier — e.g. rescheduling an already-chosen rate to a different start date is a valid edit.
  const hasChange =
    row.currentRate == null || parsedRate !== row.currentRate || date !== row.currentFrom;
  const canApply =
    !salaried && validRate && hasChange && /^\d{4}-\d{2}-\d{2}$/.test(date) && !pending;

  function doApply() {
    setErr(null);
    startTransition(async () => {
      const res = await setHourlyRate({
        userId: row.userId,
        hourlyRate: Math.round(parsedRate),
        effectiveFrom: date,
        note: reason.trim() ? reason.trim() : null,
      });
      if (res.ok && date < minEffectiveFrom && earliestRateFrom) {
        // 앞쪽 빈 날 채우기 — 기존 이력은 그대로, 가장 이른 이력 전날까지 닫힌 행 하나가 맨 뒤(가장 오래된 쪽)에 붙는다.
        onApplied({
          ...row,
          history: [
            ...row.history,
            {
              id: res.id,
              rate: Math.round(parsedRate),
              from: date,
              to: shiftDay(earliestRateFrom, -1),
              locked: true,
              note: reason.trim() ? reason.trim() : null,
            },
          ],
        });
      } else if (res.ok) {
        const newEntry = {
          id: res.id,
          rate: Math.round(parsedRate),
          from: date,
          to: null,
          locked: false,
          note: reason.trim() ? reason.trim() : null,
        };
        const reconciledHistory = row.history.flatMap((h) => {
          if (h.to != null) return [h];
          if (h.from >= date) return [];
          return [
            {
              ...h,
              to: shiftDay(date, -1),
              locked: true,
            },
          ];
        });
        const updated: AdminWageRow = {
          ...row,
          currentRate: Math.round(parsedRate),
          currentFrom: date,
          history: [newEntry, ...reconciledHistory],
        };
        onApplied(updated);
      } else if (res.reason === "forbidden") {
        setErr(c.wageActionForbidden);
      } else if (res.reason === "rate_required") {
        setErr(c.wageActionRateRequired);
      } else if (res.reason === "future_required") {
        setErr(c.wageActionFutureRequired);
      } else if (res.reason === "month_finalized") {
        setErr(c.wageActionMonthFinalized);
      } else if (res.reason === "salaried_member") {
        setErr(c.wageActionSalaried);
      } else if (res.reason === "invalid") {
        setErr(c.wageActionInvalid);
      } else {
        setErr(c.wageActionFailed);
      }
    });
  }

  const preview = renderPreview(row.currentRate, parsedRate, rate, date, row.currentFrom, c, localeTag);

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside
        ref={panelRef}
        className="panel on"
        role="dialog"
        aria-label={c.wagePanelKicker}
        tabIndex={-1}
      >
        <div className="panel__h">
          <div className="panel__top">
            <span className="panel__kicker">{c.wagePanelKicker}</span>
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
            {salaried ? (
              <span className="pill pill--muted">{c.wagePanelTagSalaried}</span>
            ) : (
              <span className="pill pill--info">
                <span className="d" />
                {c.wagePanelTagHourly}
              </span>
            )}
          </div>
        </div>

        <div className="panel__body">
          {/* Employment-type change — available for both hourly and salaried members. */}
          <div className="pblock">
            <div className="wedit">
              <div className="wedit__h">
                <span className="wedit__t">
                  <Ic>
                    <User />
                  </Ic>
                  &nbsp;{c.wagePanelEmpEditTitle}
                </span>
                <span className="wedit__role">
                  <Ic>
                    <Shield />
                  </Ic>
                  {c.wagePanelEditRoleChip}
                </span>
              </div>
              <div className="seg" style={{ margin: "10px 0" }}>
                <button
                  type="button"
                  className={`segb${empType === "hourly" ? " on" : ""}`}
                  onClick={() => setEmpType("hourly")}
                >
                  {c.wageTagHourly}
                </button>
                <button
                  type="button"
                  className={`segb${empType === "salaried" ? " on" : ""}`}
                  onClick={() => setEmpType("salaried")}
                >
                  {c.wageTagSalaried}
                </button>
              </div>
              <div>
                <div className="wfield__l">{c.wagePanelFieldDate}</div>
                <AdminDatePicker
                  value={empDate}
                  onChange={setEmpDate}
                  min={empMinFrom}
                  localeTag={localeTag}
                  ariaLabel={c.wagePanelFieldDate}
                  labels={{
                    prevMonth: c.datePickerPrevMonth,
                    nextMonth: c.datePickerNextMonth,
                    today: c.datePickerToday,
                  }}
                />
              </div>
              <div className={`wprev${!empChanged ? " same" : ""}`}>
                <Ic>
                  <Info />
                </Ic>
                <span>
                  {empChanged
                    ? c.wagePanelEmpPreview(empTypeLabel, fmtDate(empDate))
                    : c.wagePanelEmpSame}
                </span>
              </div>
              <div className="locknote" style={{ marginTop: 4 }}>
                <Ic>
                  <CircleAlert />
                </Ic>
                {c.wagePanelEmpNote}
              </div>
              <div className="wedit__btns">
                <button
                  type="button"
                  className={`btn btn--pri btn--sm${canApplyEmp ? "" : " is-locked"}`}
                  style={{ flex: 1 }}
                  disabled={!canApplyEmp}
                  onClick={() => {
                    setEmpErr(null);
                    setEmpConfirm(true);
                  }}
                >
                  <Ic>
                    <TrendingUp />
                  </Ic>
                  {c.wagePanelEmpApply}
                </button>
              </div>
            </div>
          </div>

          {empConfirm ? (
            <AdminReasonModal
              title={c.wagePanelEmpConfirmTitle}
              description={c.wagePanelEmpConfirmDesc(row.userName, empTypeLabel, fmtDate(empDate))}
              placeholder={c.dialogReasonPlaceholder}
              confirmLabel={c.wagePanelEmpApply}
              cancelLabel={c.wagePanelBtnCancel}
              pending={empPending}
              errorText={empErr}
              danger
              onConfirm={(reason) => doApplyEmp(reason)}
              onCancel={() => setEmpConfirm(false)}
            />
          ) : null}

          {/* Employment-type history — always shown, with the change reason on each interval. */}
          <div className="pblock">
            <div className="pblock__t">{c.wagePanelEmpHistoryTitle(row.employmentHistory.length)}</div>
            {row.employmentHistory.length === 0 ? (
              <div className="locknote">
                <Ic>
                  <Info />
                </Ic>
                {c.wagePanelEmpHistoryEmpty}
              </div>
            ) : (
              <div className="ratelist">
                {row.employmentHistory.map((e, i) => {
                  const isCurrent = i === 0 && e.to == null;
                  return (
                    <div className="ratelist__r" key={e.id}>
                      <span className={`ratelist__dot${isCurrent ? " cur" : ""}`} />
                      <div className="ratelist__b">
                        <div className="ratelist__rate">
                          {e.type === "hourly" ? c.wageTagHourly : c.wageTagSalaried}
                        </div>
                        <div className="ratelist__period">
                          {e.to
                            ? c.wagePanelTierRange(fmtDate(e.from), fmtDate(e.to))
                            : c.wagePanelTierRangeOpen(fmtDate(e.from))}
                        </div>
                        {e.note ? (
                          <div className="ratelist__note">
                            {c.wagePanelReasonLabel}: {e.note}
                          </div>
                        ) : null}
                      </div>
                      <span className="note">
                        {isCurrent ? (
                          <span className="pill pill--info" style={{ height: 18 }}>
                            {c.wagePanelTierCurrent}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {salaried ? (
            <>
              <div className="pblock">
                <div className="locknote">
                  <Ic>
                    <Info />
                  </Ic>
                  {c.wagePanelSalariedNote}
                </div>
              </div>
              <div className="pblock">
                <div className="pblock__t">{c.wagePanelEmploymentTitle}</div>
                <div className="kv">
                  <span className="kv__k">{c.wagePanelEmploymentKind}</span>
                  <span className="kv__v">{c.wageTagSalaried}</span>
                </div>
                {row.currentFrom ? (
                  <div className="kv">
                    <span className="kv__k">{c.wagePanelEmploymentFrom}</span>
                    <span className="kv__v mono">{fmtDate(row.currentFrom)}</span>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              {/* current rate */}
              <div className="pblock">
                <div className="pblock__t">{c.wagePanelCurrent}</div>
                <div className="psum">
                  <span className="psum__amt">
                    <span className="yen">{c.yenSym}</span>
                    {formatOptionalAdminYen(row.currentRate, localeTag)}
                  </span>
                  <span className="psum__lbl">
                    {c.wagePanelCurrentSub(fmtDate(row.currentFrom))}
                  </span>
                </div>
              </div>

              {/* inline editor */}
              <div className="pblock">
                <div className="wedit">
                  <div className="wedit__h">
                    <span className="wedit__t">
                      <Ic>
                        <Pencil />
                      </Ic>
                      &nbsp;{c.wagePanelEditTitle}
                    </span>
                    <span className="wedit__role">
                      <Ic>
                        <Shield />
                      </Ic>
                      {c.wagePanelEditRoleChip}
                    </span>
                  </div>
                  <div className="wgrid">
                    <div>
                      <div className="wfield__l">{c.wagePanelFieldRate}</div>
                      <div className="winp">
                        <span className="yen">{c.yenSym}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          step={10}
                          min={0}
                          value={rate}
                          onChange={(e) => setRate(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="wfield__l">{c.wagePanelFieldDate}</div>
                      <AdminDatePicker
                        value={date}
                        onChange={setDate}
                        min={rateMinFrom}
                        localeTag={localeTag}
                        ariaLabel={c.wagePanelFieldDate}
                        labels={{
                          prevMonth: c.datePickerPrevMonth,
                          nextMonth: c.datePickerNextMonth,
                          today: c.datePickerToday,
                        }}
                      />
                    </div>
                  </div>
                  <div className="wreason">
                    <div className="wfield__l">{c.wagePanelFieldReason}</div>
                    <input
                      type="text"
                      placeholder={c.wagePanelReasonPlaceholder}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <div className={`wprev${preview.same ? " same" : ""}`}>
                    <Ic>
                      <Info />
                    </Ic>
                    <span>{preview.text}</span>
                  </div>
                  <div className="wedit__btns">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ flex: 1 }}
                      onClick={onClose}
                    >
                      {c.wagePanelBtnCancel}
                    </button>
                    <button
                      type="button"
                      className={`btn btn--pri btn--sm${canApply ? "" : " is-locked"}`}
                      style={{ flex: 1.5 }}
                      disabled={!canApply}
                      onClick={doApply}
                    >
                      <Ic>
                        <TrendingUp />
                      </Ic>
                      {pending ? c.wagePanelBtnApplying : c.wagePanelBtnApply}
                    </button>
                  </div>
                </div>
              </div>

              {/* history */}
              <div className="pblock">
                <div className="pblock__t">{c.wagePanelHistoryTitle(row.history.length)}</div>
                <div className="ratelist">
                  {row.history.map((h, i) => {
                    const prev = row.history[i + 1];
                    const up =
                      prev && prev.rate != null && h.rate != null && h.rate > prev.rate
                        ? `+${formatOptionalAdminYen(h.rate - prev.rate, localeTag)}`
                        : null;
                    const isCurrent = i === 0 && h.to == null;
                    return (
                      <div className="ratelist__r" key={h.id}>
                        <span className={`ratelist__dot${isCurrent ? " cur" : ""}`} />
                        <div className="ratelist__b">
                          <div className="ratelist__rate">
                            <span className="yen">{c.yenSym}</span>
                            {formatOptionalAdminYen(h.rate, localeTag)}
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--adm-muted)",
                                fontWeight: 700,
                                marginLeft: 3,
                              }}
                            >
                              {c.payRateUnit}
                            </span>
                          </div>
                          <div className="ratelist__period">
                            {h.to
                              ? c.wagePanelTierRange(fmtDate(h.from), fmtDate(h.to))
                              : c.wagePanelTierRangeOpen(fmtDate(h.from))}
                          </div>
                          {h.note ? (
                            <div className="ratelist__note">
                              {c.wagePanelReasonLabel}: {h.note}
                            </div>
                          ) : null}
                        </div>
                        <span className="note">
                          {up ? (
                            <span className="ratelist__up">
                              <Ic>
                                <TrendingUp />
                              </Ic>
                              {up}
                            </span>
                          ) : null}
                          {isCurrent ? (
                            <span className="pill pill--info" style={{ height: 18 }}>
                              {c.wagePanelTierCurrent}
                            </span>
                          ) : h.locked ? (
                            <>
                              <Ic>
                                <Lock />
                              </Ic>
                              {c.wagePanelTierLocked}
                            </>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pblock">
                <div className="locknote">
                  <Ic>
                    <Info />
                  </Ic>
                  {c.wagePanelNote}
                </div>
              </div>
            </>
          )}

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
          {salaried ? (
            <>
              <span className="locknote" style={{ flex: 1, background: "transparent", padding: 0 }}>
                <Ic>
                  <Shield />
                </Ic>
                {c.wagePanelSwitchPendingNote}
              </span>
              <button type="button" className="btn btn--ghost" disabled>
                <Ic>
                  <CircleAlert />
                </Ic>
                {c.wagePanelSalariedConvert}
              </button>
            </>
          ) : (
            <>
              <Link
                className="btn btn--ghost"
                style={{ flex: 1 }}
                href={`/admin/attendance/staff/${row.userId}?ym=${ym}`}
              >
                <Ic>
                  <ArrowUpRight />
                </Ic>
                {c.wagePanelBtnUserDetail}
              </Link>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function shiftDay(d: string, delta: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function renderPreview(
  current: number | null,
  next: number,
  rawRate: string,
  date: string,
  currentFrom: string | null,
  c: Att,
  localeTag: string,
): { text: string; same: boolean } {
  if (rawRate.trim() === "" || !Number.isFinite(next) || next <= 0) {
    return { text: c.wagePanelPreviewIdle, same: true };
  }
  if (current != null && next === current) {
    if (date !== currentFrom) {
      return { text: c.wagePanelPreviewSameRateNewDate(date), same: false };
    }
    return { text: c.wagePanelPreviewSame, same: true };
  }
  const sign = current != null && next < current ? "−" : "+";
  const diff = current != null ? Math.abs(next - current) : next;
  return {
    text: c.wagePanelPreviewDiff(
      current != null
        ? `${c.yenSym}${new Intl.NumberFormat(localeTag).format(current)}`
        : "—",
      `${c.yenSym}${new Intl.NumberFormat(localeTag).format(next)}`,
      sign,
      `${c.yenSym}${new Intl.NumberFormat(localeTag).format(diff)}`,
      date,
    ),
    same: false,
  };
}
