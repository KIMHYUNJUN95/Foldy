"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { MemberBankBlock } from "@/components/shared/payroll-bank/payroll-bank";
import { getPayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { saveMemberPayrollSetting } from "@/actions/payroll-settings";
import {
  fillCopy,
  getPayrollSettingsCopy,
  withholdingLabel,
  type PayrollSettingsCopy,
} from "@/lib/payroll-settings-i18n";
import {
  MAX_DEPENDENTS,
  PAYMENT_METHODS,
  WITHHOLDING_CLASSES,
  payrollIssues,
  type MemberPayrollSetting,
  type PayrollIssue,
  type WithholdingClass,
} from "@/lib/payroll-settings-rules";
import { AdminDatePicker } from "../shared/admin-date-picker";
import { AdminExportButtons } from "../shared/admin-export-buttons";
import { AdminReasonModal } from "../shared/admin-reason-modal";
import { formatOptionalAdminYen } from "../shared/admin-format";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";

type Att = Dictionary["admin"]["attendanceConsole"];
type Filter = "all" | "hourly" | "salaried" | "check";
type Toast = { id: number; msg: string; undo?: () => void };

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
  canViewBank,
}: {
  initialRows: AdminWageRow[];
  ym: string;
  defaultEffectiveFrom: string;
  minEffectiveFrom: string;
  gapFillMinFrom: string;
  locale: Locale;
  localeTag: string;
  /** 보는 사람에게 payroll.view 가 있을 때만 급여 계좌 묶음을 그린다. */
  canViewBank: boolean;
}) {
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const shared = dictionary.admin.shared;
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>("all");
  const [panelId, setPanelId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = (msg: string, undo?: () => void) => setToast({ id: Date.now(), msg, undo });
  const pc = getPayrollSettingsCopy(locale);
  // 확인 필요 보기에서 고쳐진 줄은 접히는 동안만 더 보여 준다.
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const rowsRef = useRef(rows);
  const filterRef = useRef(filter);
  useEffect(() => {
    rowsRef.current = rows;
    filterRef.current = filter;
  }, [rows, filter]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 1800);
    return () => clearTimeout(t);
  }, [toast]);

  function applySetting(userId: string, setting: MemberPayrollSetting, bumpChange: boolean) {
    const before = rowsRef.current.find((r) => r.userId === userId);
    if (!before) return;
    const issues = payrollIssues({
      hourly: before.employment === "hourly",
      setting,
      nameKatakana: before.payroll.nameKatakana,
      hireDate: before.payroll.hireDate,
      today: todayTokyoKey(),
    });
    setRows((prev) =>
      prev.map((r) =>
        r.userId === userId
          ? { ...r, payroll: { ...r.payroll, setting, issues, changeCount: r.payroll.changeCount + (bumpChange ? 1 : 0) } }
          : r,
      ),
    );
    if (filterRef.current === "check") {
      if (before.payroll.issues.length > 0 && issues.length === 0) {
        setLeaving((p) => new Set(p).add(userId));
        window.setTimeout(
          () =>
            setLeaving((p) => {
              const n = new Set(p);
              n.delete(userId);
              return n;
            }),
          300,
        );
      } else if (issues.length > 0) {
        setLeaving((p) => {
          const n = new Set(p);
          n.delete(userId);
          return n;
        });
      }
    }
  }

  /** 고르면 바로 저장 — 화면 먼저 바꾸고, 못 저장하면 되돌린다. 성공하면 「되돌리기」 토스트. */
  async function savePayroll(userId: string, patch: Partial<MemberPayrollSetting>, field: string, value: string) {
    const row = rowsRef.current.find((r) => r.userId === userId);
    if (!row) return;
    const prev = row.payroll.setting;
    const prevPatch: Partial<MemberPayrollSetting> = {};
    for (const k of Object.keys(patch) as (keyof MemberPayrollSetting)[]) {
      (prevPatch as Record<string, unknown>)[k] = prev[k];
    }
    applySetting(userId, { ...prev, ...patch }, false);
    const res = await saveMemberPayrollSetting({ userId, patch });
    if (!res.ok) {
      applySetting(userId, prev, false);
      showToast(res.reason === "forbidden" ? pc.errorForbidden : pc.errorSave);
      return;
    }
    applySetting(userId, res.setting, true);
    showToast(fillCopy(pc.toastSaved, { name: row.userName, field, value }), async () => {
      const back = await saveMemberPayrollSetting({ userId, patch: prevPatch });
      if (back.ok) {
        applySetting(userId, back.setting, true);
        showToast(pc.toastUndone);
      } else {
        showToast(pc.errorSave);
      }
    });
  }

  const counts = useMemo(
    () => ({
      all: rows.length,
      hourly: rows.filter((r) => r.employment === "hourly").length,
      salaried: rows.filter((r) => r.employment === "salaried").length,
      check: rows.filter((r) => r.payroll.issues.length > 0).length,
    }),
    [rows],
  );
  const list = useMemo(
    () =>
      filter === "all"
        ? rows
        : filter === "check"
          ? rows.filter((r) => r.payroll.issues.length > 0 || leaving.has(r.userId))
          : rows.filter((r) =>
              filter === "hourly" ? r.employment === "hourly" : r.employment === "salaried",
            ),
    [rows, filter, leaving],
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
          <button
            type="button"
            className={filter === "check" ? "on" : ""}
            onClick={() => setFilter("check")}
          >
            {pc.needsCheckFilter}
            <span className={`cnt${counts.check > 0 ? " wg-miss" : ""}`}>{counts.check}</span>
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
                <th className="r">{pc.columnHeader}</th>
                <th className="r">{c.wageColChanges}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const salaried = r.employment === "salaried";
                const sel = panelId === r.userId;
                const changeTotal = r.history.filter((h) => h.rate != null).length + r.payroll.changeCount;
                const hist = [...r.history].filter((h) => h.rate != null).sort((x, y) => (x.from < y.from ? 1 : -1));
                const yen = (n: number | null) => (n == null ? "—" : `${c.yenSym}${formatOptionalAdminYen(n, localeTag)}`);
                return (
                  <tr
                    key={r.userId}
                    className={`${sel ? "sel" : ""}${leaving.has(r.userId) && r.payroll.issues.length === 0 ? " wg-leave" : ""}`}
                    onClick={() => setPanelId(r.userId)}>
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
                      <PayrollCell row={r} copy={pc} />
                    </td>
                    <td className="r">
                      {salaried || changeTotal === 0 ? <span className="dim-cell">—</span> : <span className="dim-cell">{c.wageTimes.replace("{n}", String(changeTotal))}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filter === "check" ? <p className="wg-hint">{pc.needsCheckHint}</p> : null}
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
        <br />
        {pc.savesInstantly}
      </p>

      {panelRow ? (
        <WagePanel
          row={panelRow}
          ym={ym}
          c={c}
          pc={pc}
          onSavePayroll={savePayroll}
          localeTag={localeTag}
          locale={locale}
          canViewBank={canViewBank}
          onToast={showToast}
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
        <div
          key={toast.id}
          role="status"
          className={`adm-toast${toast.undo ? " adm-toast--undo" : ""}`}
          onClick={toast.undo ? undefined : () => setToast(null)}
        >
          <span>{toast.msg}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => {
                const undo = toast.undo;
                setToast(null);
                undo?.();
              }}
            >
              {pc.undo}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WagePanel({
  row,
  ym,
  c,
  pc,
  onSavePayroll,
  localeTag,
  locale,
  canViewBank,
  onToast,
  defaultEffectiveFrom,
  minEffectiveFrom,
  gapFillMinFrom,
  onClose,
  onApplied,
}: {
  row: AdminWageRow;
  ym: string;
  c: Att;
  pc: PayrollSettingsCopy;
  onSavePayroll: (userId: string, patch: Partial<MemberPayrollSetting>, field: string, value: string) => void;
  localeTag: string;
  locale: Locale;
  canViewBank: boolean;
  onToast: (msg: string) => void;
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
  // 선택한 형태가 현재 활성 형태와 다르고 (알 수 없음 = 설정된 적
  // 없음이라 어떤 선택이든 해당) 날짜가 유효하면 변경을 적용할 수 있다.
  const empChanged = currentEmp === "unknown" ? true : empType !== currentEmp;
  const canApplyEmp = empChanged && /^\d{4}-\d{2}-\d{2}$/.test(empDate) && !empPending;
  const empTypeLabel = empType === "hourly" ? c.wageTagHourly : c.wageTagSalaried;

  // 고용 형태 변경은 민감하므로 (급여 모델 + 연차 자격이 바뀜) 첫 클릭에 바로 적용하지 않고
  // 확인 모달을 거친다. 사유는 거기서 받는다.
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
  // 시급 또는 적용일 중 하나라도 현재 구간과 다르면 변경을 적용할 수 있다
  // — 예: 이미 고른 시급의 시작일을 다른 날로 미루는 것도 유효한 수정이다.
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
          {salaried ? (
            <div className="pblock">
              <div className="wgp__h">
                <span className="wgp__t">{pc.sectionTitle}</span>
              </div>
              <p className="wgp__help" style={{ margin: 0 }}>
                {pc.salariedNote}
              </p>
            </div>
          ) : (
            <>
              <PayrollBlock row={row} pc={pc} c={c} localeTag={localeTag} onSave={onSavePayroll} />
              {canViewBank ? (
                <div className="pblock">
                  <MemberBankBlock
                    key={row.userId}
                    userId={row.userId}
                    copy={getPayrollBankCopy(locale)}
                    localeTag={localeTag}
                    variant="panel"
                    onToast={onToast}
                  />
                </div>
              ) : null}
            </>
          )}

          {/* 고용 형태 변경 — 시급제와 월급제 멤버 모두에게 제공. */}
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

          {/* 고용 형태 이력 — 항상 표시하며, 각 구간에 변경 사유를 보여준다. */}
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
              {/* 현재 시급 */}
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

              {/* 인라인 편집기 */}
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

              {/* 이력 */}
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

function todayTokyoKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function issueLabel(issue: PayrollIssue, pc: PayrollSettingsCopy): string {
  switch (issue) {
    case "payment_method":
      return pc.issuePaymentMethod;
    case "withholding":
      return pc.issueWithholding;
    case "katakana":
      return pc.issueKatakana;
    case "hei_over":
      return pc.issueHeiOver;
    case "hei_no_hire_date":
      return pc.issueHeiNoHireDate;
  }
}

function PayrollCell({ row, copy: pc }: { row: AdminWageRow; copy: PayrollSettingsCopy }) {
  if (row.employment === "salaried") return <span className="dim-cell">{pc.salariedShort}</span>;
  const { setting, issues } = row.payroll;
  if (issues.length > 0) return <span className="wg-miss">{issueLabel(issues[0], pc)}</span>;
  const pay = setting.paymentMethod === "cash" ? pc.cash : pc.transfer;
  return (
    <span>
      {pay} · {setting.withholdingClass ? withholdingLabel(pc, setting.withholdingClass) : ""}
    </span>
  );
}

function PayrollSeg<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const idx = value ? options.findIndex((o) => o.value === value) : -1;
  return (
    <div
      className="wgseg"
      role="radiogroup"
      aria-label={label}
      style={{ "--n": options.length, "--i": Math.max(idx, 0) } as React.CSSProperties}
    >
      {idx >= 0 ? <span className="wgseg__thumb" aria-hidden="true" /> : null}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PayrollBlock({
  row,
  pc,
  c,
  localeTag,
  onSave,
}: {
  row: AdminWageRow;
  pc: PayrollSettingsCopy;
  c: Att;
  localeTag: string;
  onSave: (userId: string, patch: Partial<MemberPayrollSetting>, field: string, value: string) => void;
}) {
  const { setting, nameKatakana, hireDate, issues } = row.payroll;
  const cls = setting.withholdingClass;
  const helpOf: Record<WithholdingClass, string> = { kou: pc.kouHelp, otsu: pc.otsuHelp, hei: pc.heiHelp };
  const heiError = issues.includes("hei_over")
    ? fillCopy(pc.heiOverError, { date: (hireDate ?? "").replace(/-/g, ".") })
    : issues.includes("hei_no_hire_date")
      ? pc.heiNoHireDateError
      : null;
  const save = (patch: Partial<MemberPayrollSetting>, field: string, value: string) =>
    onSave(row.userId, patch, field, value);

  return (
    <div className="pblock">
      <div className="wgp__h">
        <span className="wgp__t">{pc.sectionTitle}</span>
        {issues.length > 0 ? (
          <span className="wg-miss" style={{ fontSize: 12 }}>
            {fillCopy(pc.needsCheck, { n: issues.length })}
          </span>
        ) : null}
      </div>

      <div className="wgp__row">
        <span className="k">{pc.paymentMethod}</span>
        <PayrollSeg
          label={pc.paymentMethod}
          value={setting.paymentMethod}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: m === "cash" ? pc.cash : pc.transfer }))}
          onChange={(m) => save({ paymentMethod: m }, pc.paymentMethod, m === "cash" ? pc.cash : pc.transfer)}
        />
      </div>

      <div className="wgp__row">
        <span className="k">{pc.withholding}</span>
        <PayrollSeg
          label={pc.withholding}
          value={cls}
          options={WITHHOLDING_CLASSES.map((k) => ({ value: k, label: withholdingLabel(pc, k), title: helpOf[k] }))}
          onChange={(k) => save({ withholdingClass: k }, pc.withholding, withholdingLabel(pc, k))}
        />
      </div>
      {heiError ? (
        <div className="wgp__err" role="alert">
          <Info aria-hidden="true" />
          <span>{heiError}</span>
        </div>
      ) : null}
      <p className="wgp__help">
        {cls ? helpOf[cls] : <span className="wg-miss">{pc.pickOne}</span>}
      </p>

      {cls === "kou" ? (
        <div className="wgp__row">
          <span className="k">{pc.dependents}</span>
          <div className="wgstep">
            <button
              type="button"
              aria-label={pc.dependentsMinus}
              disabled={setting.dependents <= 0}
              onClick={() =>
                save({ dependents: setting.dependents - 1 }, pc.dependents, String(setting.dependents - 1))
              }
            >
              −
            </button>
            <b aria-live="polite">{setting.dependents}</b>
            <button
              type="button"
              aria-label={pc.dependentsPlus}
              disabled={setting.dependents >= MAX_DEPENDENTS}
              onClick={() =>
                save({ dependents: setting.dependents + 1 }, pc.dependents, String(setting.dependents + 1))
              }
            >
              +
            </button>
          </div>
        </div>
      ) : null}

      <div className="wgp__row">
        <span className="k">{pc.katakana}</span>
        <span className="v" style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
          {nameKatakana?.trim() ? nameKatakana : <span className="wg-miss">{pc.katakanaMissing}</span>}
        </span>
      </div>

      <div className="wgp__row">
        <span className="k">{pc.hireDate}</span>
        <span className="v" style={{ fontVariantNumeric: "tabular-nums" }}>
          {hireDate ? hireDate.replace(/-/g, ".") : <span className="dim">{pc.hireDateMissing}</span>}
        </span>
        {/* 입사일은 근태 › 연차 › 잔여에서만 고친다 — 그 사람 잔여 패널로 바로 연다. */}
        <Link className="wgp__lnk" href={`/admin/attendance/leave?view=balance&user=${encodeURIComponent(row.userId)}`}>
          {pc.edit}
        </Link>
      </div>

      <div className="wgp__row">
        <span className="k">{pc.employmentInsurance}</span>
        <span className="v dim">{setting.employmentInsurance ? pc.insuranceOn : pc.insuranceOff}</span>
        <button
          type="button"
          role="switch"
          aria-checked={setting.employmentInsurance}
          aria-label={pc.employmentInsurance}
          className="wgsw"
          onClick={() =>
            save(
              { employmentInsurance: !setting.employmentInsurance },
              pc.employmentInsurance,
              setting.employmentInsurance ? pc.insuranceOff : pc.insuranceOn,
            )
          }
        >
          <i />
        </button>
      </div>
      {setting.employmentInsurance ? (
        <div className="wgp__since">
          <span>{pc.insuranceSince}</span>
          <AdminDatePicker
            value={setting.employmentInsuranceSince ?? ""}
            onChange={(d) => save({ employmentInsuranceSince: d }, pc.insuranceSince, d.replace(/-/g, "."))}
            placeholder={pc.insuranceSincePick}
            localeTag={localeTag}
            ariaLabel={pc.insuranceSince}
            labels={{
              prevMonth: c.datePickerPrevMonth,
              nextMonth: c.datePickerNextMonth,
              today: c.datePickerToday,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
