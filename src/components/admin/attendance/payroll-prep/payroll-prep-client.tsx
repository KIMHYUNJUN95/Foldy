"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMemberPayrollSetting } from "@/actions/payroll-settings";
import { savePayrollMonthInput } from "@/actions/payroll-month-inputs";
import {
  exportPayrollBookReport,
  exportPayrollBookWorkbook,
  exportTaxAccountantReport,
  exportTaxAccountantWorkbook,
} from "@/actions/payroll-exports";
import { getDictionary, type Locale } from "@/lib/i18n";
import { prepTotals, type PrepManual, type PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { getPayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import {
  fillCopy,
  getPayrollSettingsCopy,
  withholdingLabel,
} from "@/lib/payroll-settings-i18n";
import { WITHHOLDING_CLASSES } from "@/lib/payroll-settings-rules";
import { AdminExportButtons } from "../../shared/admin-export-buttons";
import { AdminUndoToast } from "../../shared/admin-undo-toast";
import {
  formatPrepMonth,
  formatPrepPayday,
  formatPrepTime,
  prepInitial,
} from "./prep-format";
import { PayrollPrepPanel } from "./payroll-prep-panel";
import "./payroll-prep.css";

type Filter = "all" | "transfer" | "cash";
type Toast = { stamp: number; message: string; undo?: () => Promise<void> };

export function PayrollPrepClient({
  data,
  locale,
  localeTag,
}: {
  data: PayrollPrepData;
  locale: Locale;
  localeTag: string;
}) {
  const router = useRouter();
  const dictionary = getDictionary(locale);
  const copy = getPayrollPrepCopy(locale);
  const settings = getPayrollSettingsCopy(locale);
  const shared = dictionary.admin.shared;
  const c = dictionary.admin.attendanceConsole;
  const { ym, canManage, payday } = data;

  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const [undoPending, startUndo] = useTransition();

  const money = new Intl.NumberFormat(localeTag);
  const num = (n: number | null) => (n == null ? "—" : money.format(n));
  const yen = (n: number) => fillCopy(copy.yen, { n: money.format(n) });

  const all = data.rows;
  const rows = all.filter(
    (r) => filter === "all" || r.paymentMethod === filter,
  );
  const totals = data.totals;
  const shownTotals = filter === "all" ? totals : prepTotals(rows);
  const selected = selectedId
    ? (all.find((r) => r.userId === selectedId) ?? null)
    : null;

  function announce(message: string, undo?: () => Promise<void>) {
    setPlain(null);
    setToast((prev) => ({ stamp: (prev?.stamp ?? 0) + 1, message, undo }));
  }
  function notice(message: string) {
    setToast(null);
    setPlain(message);
    window.setTimeout(() => setPlain((p) => (p === message ? null : p)), 2200);
  }
  const refresh = () => startRefresh(() => router.refresh());

  const failMessage = (reason: string) =>
    reason === "forbidden" ? copy.errorForbidden : copy.errorSave;

  async function saveInput(
    row: PrepRow,
    patch: Partial<PrepManual>,
    field: string,
  ): Promise<boolean> {
    const res = await savePayrollMonthInput({ userId: row.userId, ym, patch });
    if (!res.ok) {
      notice(failMessage(res.reason));
      return false;
    }
    refresh();
    announce(fillCopy(copy.saved, { name: row.name, field }), async () => {
      const back = await savePayrollMonthInput({
        userId: row.userId,
        ym,
        patch: res.before,
      });
      if (!back.ok) return notice(failMessage(back.reason));
      refresh();
      notice(copy.undone);
    });
    return true;
  }

  async function saveClass(
    row: PrepRow,
    cls: (typeof WITHHOLDING_CLASSES)[number],
  ) {
    const prev = row.withholdingClass;
    const res = await saveMemberPayrollSetting({
      userId: row.userId,
      patch: { withholdingClass: cls },
    });
    if (!res.ok) return notice(failMessage(res.reason));
    refresh();
    announce(
      fillCopy(copy.saved, { name: row.name, field: copy.withholding }),
      async () => {
        const back = await saveMemberPayrollSetting({
          userId: row.userId,
          patch: { withholdingClass: prev },
        });
        if (!back.ok) return notice(failMessage(back.reason));
        refresh();
        notice(copy.undone);
      },
    );
  }

  function closePanel() {
    const id = selectedId;
    setSelectedId(null);
    if (id)
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-prep-row="${id}"]`)?.focus(),
      );
  }

  const monthLabels = {
    prevMonth: c.payPagerPrev,
    nextMonth: c.payPagerNext,
    prevYear: c.monthPickerPrevYear,
    nextYear: c.monthPickerNextYear,
    open: c.monthPickerOpen,
    thisMonth: c.monthPickerThisMonth,
  };

  const filters: { id: Filter; label: string; n: number }[] = [
    { id: "all", label: copy.all, n: all.length },
    {
      id: "transfer",
      label: copy.transfer,
      n: all.filter((r) => r.paymentMethod === "transfer").length,
    },
    {
      id: "cash",
      label: copy.cash,
      n: all.filter((r) => r.paymentMethod === "cash").length,
    },
  ];

  return (
    <div className={`ppr${selected ? " has-panel" : ""}`}>
      <div className="ppr-title">
        <b>{fillCopy(copy.title, { month: formatPrepMonth(ym, localeTag) })}</b>
        <span>
          {fillCopy(copy.payday, {
            date: formatPrepPayday(payday.date, localeTag),
          })}
        </span>
      </div>

      <div className="ppr-tools">
        <div className="ppr-seg" role="group" aria-label={copy.filterLabel}>
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <i>{f.n}</i>
            </button>
          ))}
        </div>
        <span className="ppr-tools__sp" />
        {/* P4 — 급여 파일(명세서 · 사장 확인표 · 지급 확인) · 세무사용. 둘 다 Excel + PDF(CLAUDE.md 4b). */}
        <span className="ppr-file" title={copy.fileBookHint}>
          <span className="ppr-file__l">{copy.fileBook}</span>
          <AdminExportButtons
            labels={shared}
            disabled={all.length === 0}
            onExportXls={() => exportPayrollBookWorkbook(ym)}
            onExportPdf={() => exportPayrollBookReport(ym)}
            onToast={notice}
          />
        </span>
        <span className="ppr-file" title={copy.fileTaxHint}>
          <span className="ppr-file__l">{copy.fileTax}</span>
          <AdminExportButtons
            labels={shared}
            disabled={all.length === 0}
            onExportXls={() => exportTaxAccountantWorkbook(ym)}
            onExportPdf={() => exportTaxAccountantReport(ym)}
            onToast={notice}
          />
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="ppr-empty">{copy.empty}</p>
      ) : (
        <div>
          <div className="ppr-th">
            <span>{copy.colName}</span>
            <span className="ppr-r">{copy.colHours}</span>
            <span className="ppr-r ppr-x">{copy.colBasePay}</span>
            <span className="ppr-r ppr-x">{copy.colAdjustments}</span>
            <span className="ppr-r ppr-x">{copy.colCommute}</span>
            <span className="ppr-r">{copy.colGross}</span>
            <span className="ppr-r ppr-x">{copy.colWithholding}</span>
            <span className="ppr-r">{copy.colNet}</span>
          </div>
          {rows.map((r) => {
            const rest = r.issues.slice(1).map((i) => copy.issues[i]);
            const first = r.issues[0];
            const hint =
              first === "withholding"
                ? copy.hintWithholding
                : first === "katakana"
                  ? copy.hintKatakana
                  : first === "not_finalized"
                    ? copy.hintNotFinalized
                    : null;
            const needsClass = r.issues.includes("withholding");
            return (
              <div
                className={`ppr-grp${r.userId === selectedId ? " sel" : ""}`}
                key={r.userId}
              >
                <button
                  type="button"
                  className="ppr-tr"
                  data-prep-row={r.userId}
                  aria-expanded={r.userId === selectedId}
                  onClick={() =>
                    r.userId === selectedId
                      ? closePanel()
                      : setSelectedId(r.userId)
                  }
                >
                  <span className="ppr-who">
                    <span className="ppr-av" aria-hidden="true">
                      {prepInitial(r)}
                    </span>
                    <b>{r.name}</b>
                    {r.paymentMethod ? (
                      <small>
                        {r.paymentMethod === "cash" ? copy.cash : copy.transfer}
                      </small>
                    ) : null}
                  </span>
                  <span className="ppr-r">{formatPrepTime(r.paidMinutes)}</span>
                  <span className="ppr-r ppr-x">{num(r.basePay)}</span>
                  <span
                    className={`ppr-r ppr-x${r.adjustments === 0 ? " ppr-mute" : ""}`}
                  >
                    {r.adjustments === 0 ? "—" : num(r.adjustments)}
                  </span>
                  <span className="ppr-r ppr-x">{num(r.commute)}</span>
                  <span className="ppr-r">{num(r.gross)}</span>
                  <span
                    className={`ppr-r ppr-x${r.withholding == null ? " ppr-mute" : ""}`}
                  >
                    {num(r.withholding)}
                  </span>
                  <span
                    className={`ppr-r ppr-net${r.net == null ? " ppr-mute" : ""}`}
                  >
                    {num(r.net)}
                  </span>
                </button>
                {first ? (
                  <div className="ppr-fix">
                    <span className="ppr-dot">
                      {[copy.issues[first], ...rest].join(" · ")}
                    </span>
                    {needsClass && canManage ? (
                      <span
                        className="ppr-pick"
                        role="radiogroup"
                        aria-label={copy.withholding}
                      >
                        {WITHHOLDING_CLASSES.map((cls) => (
                          <button
                            key={cls}
                            type="button"
                            role="radio"
                            aria-checked={r.withholdingClass === cls}
                            onClick={() => void saveClass(r, cls)}
                          >
                            {withholdingLabel(settings, cls)}
                          </button>
                        ))}
                      </span>
                    ) : null}
                    {hint ? <small>{hint}</small> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="ppr-sum">
            <span>{fillCopy(copy.people, { n: shownTotals.people })}</span>
            <span className="ppr-r">
              {formatPrepTime(shownTotals.paidMinutes)}
            </span>
            <span className="ppr-r ppr-x">{num(shownTotals.basePay)}</span>
            <span className="ppr-r ppr-x">{num(shownTotals.adjustments)}</span>
            <span className="ppr-r ppr-x">{num(shownTotals.commute)}</span>
            <span className="ppr-r">{num(shownTotals.gross)}</span>
            <span className="ppr-r ppr-x">{num(shownTotals.withholding)}</span>
            <span className="ppr-r">{num(shownTotals.net)}</span>
          </div>
        </div>
      )}

      <div className="ppr-bar">
        <span>
          <span className="k">
            {copy.netTotal}
            {totals.uncalculated > 0
              ? ` · ${fillCopy(copy.uncalculated, { n: totals.uncalculated })}`
              : ""}
          </span>
          <span className="v">{yen(totals.net)}</span>
        </span>
        <span>
          <span className="k">{copy.transfer}</span>
          <span className="v2">{yen(totals.transfer.net)}</span>
        </span>
        <span>
          <span className="k">{copy.cash}</span>
          <span className="v2">{yen(totals.cash.net)}</span>
        </span>
        <span className="ppr-bar__r">
          {totals.needsCheck > 0 ? (
            <span className="ppr-dot">
              {fillCopy(copy.checkPeople, { n: totals.needsCheck })}
            </span>
          ) : (
            <span>{copy.noChecks}</span>
          )}
          <button
            type="button"
            className="ppr-go"
            disabled
            title={copy.approvalLater}
          >
            {copy.requestApproval}
          </button>
        </span>
      </div>

      {selected ? (
        <PayrollPrepPanel
          key={selected.userId}
          row={selected}
          ym={ym}
          payYear={Number(payday.date.slice(0, 4))}
          canManage={canManage}
          copy={copy}
          settings={settings}
          localeTag={localeTag}
          monthLabels={monthLabels}
          onSave={saveInput}
          onClose={closePanel}
        />
      ) : null}

      {toast?.undo ? (
        <AdminUndoToast
          stamp={toast.stamp}
          message={toast.message}
          undoLabel={copy.undo}
          pending={undoPending}
          onUndo={() => startUndo(async () => void (await toast.undo?.()))}
          onExpire={() => setToast(null)}
        />
      ) : plain ? (
        <div className="ppr-toast" role="status">
          {plain}
        </div>
      ) : null}
    </div>
  );
}
