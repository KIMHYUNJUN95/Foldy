"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMemberPayrollSetting } from "@/actions/payroll-settings";
import { savePayrollMonthInput } from "@/actions/payroll-month-inputs";
import { cancelPayrollApprovalRequest, requestPayrollApproval } from "@/actions/payroll-approval";
import {
  exportPayrollBookReport,
  exportPayrollBookWorkbook,
  exportTaxAccountantReport,
  exportTaxAccountantWorkbook,
} from "@/actions/payroll-exports";
import {
  previewPayrollCarryOver,
  runPayrollCarryOver,
  undoPayrollCarryOver,
} from "@/actions/payroll-carry-over";
import { confirmMemberBank } from "@/actions/payroll-bank";
import { bankSummary, formatBankDay } from "@/components/shared/payroll-bank/payroll-bank";
import { getPayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { CARRY_DEFAULT_FIELDS, CARRY_FIELDS, type CarryField } from "@/lib/payroll-carry-over";
import { getDictionary, type Locale } from "@/lib/i18n";
import { prepTotals, type PrepManual, type PrepRow } from "@/lib/payroll-prep";
import { canRequestApproval, isRoundLocked } from "@/lib/payroll-approval";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { getPayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import {
  fillCopy,
  getPayrollSettingsCopy,
  withholdingLabel,
} from "@/lib/payroll-settings-i18n";
import { WITHHOLDING_CLASSES } from "@/lib/payroll-settings-rules";
import { AdminExportButtons } from "../../shared/admin-export-buttons";
import {
  formatPrepMonth,
  formatPrepPayday,
  formatPrepTime,
  prepInitial,
} from "./prep-format";
import { PayrollPrepPanel } from "./payroll-prep-panel";
import type { RoundToast } from "./payroll-round-client";
import { roundFailMessage, stageHref } from "./round-ui";
import "./payroll-prep.css";

type Filter = "all" | "transfer" | "cash";

export function PayrollPrepClient({
  data,
  locale,
  localeTag,
  toast,
  canViewBank,
}: {
  data: PayrollPrepData;
  locale: Locale;
  localeTag: string;
  toast: RoundToast;
  canViewBank: boolean;
}) {
  const router = useRouter();
  const dictionary = getDictionary(locale);
  const copy = getPayrollPrepCopy(locale);
  const settings = getPayrollSettingsCopy(locale);
  const shared = dictionary.admin.shared;
  const c = dictionary.admin.attendanceConsole;
  const { ym, payday, round } = data;
  // 결재 요청 뒤(잠긴 달)엔 숫자를 못 고친다 — 보기만(docs/product/40 §4-3).
  const locked = isRoundLocked(round.status);
  const canManage = data.canManage && !locked;

  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const [requesting, startRequest] = useTransition();
  const [carry, setCarry] = useState<{
    fromYm: string;
    counts: Record<CarryField, number>;
    picked: CarryField[];
  } | null>(null);
  const [carryBusy, setCarryBusy] = useState(false);
  const [confirmingBank, setConfirmingBank] = useState<string | null>(null);
  const bankCopy = getPayrollBankCopy(locale);

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

  const { announce, notice } = toast;
  const refresh = () => startRefresh(() => router.refresh());

  const failMessage = (reason: string) => {
    if (reason === "conflict" || reason === "locked") refresh();
    return roundFailMessage(copy, reason);
  };

  // 결재 요청 — 확인 필요 0 · 모두 계산 · 근태 마감 끝 · 사장 결재자 있음(설정 › 급여).
  const ready = canRequestApproval(all, data.totals);
  const canRequest = canManage && ready && round.approversReady && round.status === "preparing";
  function requestApproval() {
    startRequest(async () => {
      const res = await requestPayrollApproval(ym);
      if (!res.ok) return notice(failMessage(res.reason));
      router.replace(stageHref(ym, "approval"), { scroll: false });
      announce(copy.requestedToast, async () => {
        const back = await cancelPayrollApprovalRequest(ym);
        if (!back.ok) return notice(failMessage(back.reason));
        router.replace(stageHref(ym, "prep"), { scroll: false });
        notice(copy.cancelledToast);
      });
    });
  }

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

  async function openCarry() {
    if (carryBusy) return;
    setCarryBusy(true);
    const res = await previewPayrollCarryOver({ ym });
    setCarryBusy(false);
    if (!res.ok) return notice(failMessage(res.reason));
    setCarry({ fromYm: res.fromYm, counts: res.counts, picked: [...CARRY_DEFAULT_FIELDS] });
  }

  async function runCarry(fields: CarryField[]) {
    if (carryBusy) return;
    setCarryBusy(true);
    const res = await runPayrollCarryOver({ ym, fields });
    setCarryBusy(false);
    if (!res.ok) {
      setCarry(null);
      return notice(failMessage(res.reason));
    }
    setCarry(null);
    refresh();
    const entries = res.entries;
    announce(fillCopy(copy.carryDone, { people: res.people, cells: res.cells }), async () => {
      const back = await undoPayrollCarryOver({ ym, entries });
      if (!back.ok) return notice(failMessage(back.reason));
      refresh();
      notice(copy.undone);
    });
  }

  async function confirmBank(row: PrepRow) {
    if (confirmingBank) return;
    setConfirmingBank(row.userId);
    const res = await confirmMemberBank({ userId: row.userId });
    setConfirmingBank(null);
    if (!res.ok) return notice(copy.errorSave);
    refresh();
    notice(fillCopy(copy.bankConfirmedToast, { name: row.name }));
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

  const bankNotices = data.canView
    ? all.filter((r) => data.banks[r.userId]?.pending)
    : [];

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

      {round.lastReturn ? (
        <p className="ppr-note">
          {fillCopy(copy.returnedNote, {
            name: round.lastReturn.actorName ?? "",
            reason: round.lastReturn.reason ?? "",
          })}
        </p>
      ) : locked ? (
        <p className="ppr-note ppr-note--lock">
          <LockIcon />
          {copy.lockedShort}
        </p>
      ) : null}

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
        {canManage ? (
          <button
            type="button"
            className="ppr-btn sm"
            disabled={carryBusy}
            aria-busy={carryBusy || undefined}
            onClick={() => void openCarry()}
          >
            {carryBusy && !carry ? copy.carryLoading : copy.carryOpen}
          </button>
        ) : null}
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

      {bankNotices.length > 0 ? (
        <section className="ppr-bn" aria-label={copy.bankNoticeTitle}>
          {bankNotices.map((r) => {
            const bank = data.banks[r.userId];
            const to = bankSummary(bank) ?? "";
            const from = bank.confirmed ? bankSummary({ ...bank, current: bank.confirmed }) : null;
            const date = formatBankDay(bank.updatedAt, localeTag);
            return (
              <div className="ppr-bn__i" key={r.userId}>
                <span className="ppr-bn__t">
                  <b className="ppr-dot">
                    {r.name} · {copy.bankChanged}
                  </b>
                  <small className="ppr-jp">
                    {fillCopy(from ? copy.bankChangedLine : copy.bankFirstLine, { date, from: from ?? "", to })}
                  </small>
                </span>
                <button type="button" className="ppr-lnk" onClick={() => setSelectedId(r.userId)}>
                  {copy.bankView}
                </button>
                {data.canManage ? (
                  <button
                    type="button"
                    className="ppr-btn sm"
                    disabled={confirmingBank !== null}
                    aria-busy={confirmingBank === r.userId || undefined}
                    onClick={() => void confirmBank(r)}
                  >
                    {copy.bankConfirm}
                  </button>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

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
                    <span className="ppr-nm">
                      <span className="ppr-nm__l">
                        <b>{r.name}</b>
                        {r.paymentMethod ? (
                          <small>
                            {r.paymentMethod === "cash" ? copy.cash : copy.transfer}
                          </small>
                        ) : null}
                      </span>
                      {r.manual.paymentMethodOverride ?? null ? (
                        <em>
                          {fillCopy(copy.monthOnlyTag, {
                            method: r.manual.paymentMethodOverride === "cash" ? copy.cash : copy.transfer,
                          })}
                        </em>
                      ) : null}
                    </span>
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
                    {r.issues.includes("bank_missing") && canViewBank ? (
                      <button type="button" className="ppr-lnk" onClick={() => setSelectedId(r.userId)}>
                        {copy.bankAdd}
                      </button>
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
          {locked ? (
            <span>{copy.lockedShort}</span>
          ) : totals.needsCheck > 0 ? (
            <span className="ppr-dot">
              {fillCopy(copy.checkPeople, { n: totals.needsCheck })}
            </span>
          ) : data.canManage && !round.approversReady ? (
            <span className="ppr-dot">{copy.errorNoApprover}</span>
          ) : (
            <span>{copy.noChecks}</span>
          )}
          {data.canManage && !locked ? (
            <button
              type="button"
              className="ppr-go"
              disabled={!canRequest || requesting}
              aria-busy={requesting || undefined}
              onClick={requestApproval}
            >
              {copy.requestApproval}
            </button>
          ) : null}
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
          bankCopy={bankCopy}
          canViewBank={canViewBank}
          onBankToast={notice}
          onBankChange={refresh}
          onSave={saveInput}
          onClose={closePanel}
        />
      ) : null}

      {carry ? (
        <CarryModal
          copy={copy}
          monthLabel={formatPrepMonth(carry.fromYm, localeTag)}
          counts={carry.counts}
          picked={carry.picked}
          busy={carryBusy}
          onPick={(picked) => setCarry({ ...carry, picked })}
          onCancel={() => setCarry(null)}
          onRun={(fields) => void runCarry(fields)}
        />
      ) : null}
    </div>
  );
}

function CarryModal({
  copy,
  monthLabel,
  counts,
  picked,
  busy,
  onPick,
  onCancel,
  onRun,
}: {
  copy: ReturnType<typeof getPayrollPrepCopy>;
  monthLabel: string;
  counts: Record<CarryField, number>;
  picked: CarryField[];
  busy: boolean;
  onPick: (picked: CarryField[]) => void;
  onCancel: () => void;
  onRun: (fields: CarryField[]) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const label: Record<CarryField, { name: string; hint?: string }> = {
    special: { name: copy.carrySpecial, hint: copy.carrySpecialHint },
    withholding: { name: copy.carryWithholding },
    memo: { name: copy.carryMemo },
    overtimeWeekend: { name: copy.carryOvertimeWeekend, hint: copy.carryOvertimeWeekendHint },
  };
  const nothing = CARRY_FIELDS.every((f) => counts[f] === 0);
  const fields = picked.filter((f) => counts[f] > 0);

  return (
    <div className="ppr-cm" onClick={onCancel}>
      <div
        className="ppr-cm__box"
        role="dialog"
        aria-modal="true"
        aria-label={fillCopy(copy.carryTitle, { month: monthLabel })}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{fillCopy(copy.carryTitle, { month: monthLabel })}</h2>
        <p>{copy.carryBody}</p>
        {nothing ? (
          <p className="ppr-cm__none">{copy.carryNothing}</p>
        ) : (
          <div className="ppr-cm__list">
            {CARRY_FIELDS.map((f) => {
              const n = counts[f];
              const on = picked.includes(f) && n > 0;
              return (
                <button
                  key={f}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={n === 0}
                  className="ppr-cm__row"
                  onClick={() => onPick(on ? picked.filter((x) => x !== f) : [...picked, f])}
                >
                  <span className={`ppr-cm__ck${on ? " on" : ""}`} aria-hidden="true">
                    {on ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="ppr-cm__t">
                    <b>{label[f].name}</b>
                    {label[f].hint ? <small>{label[f].hint}</small> : null}
                  </span>
                  <span className="ppr-cm__n">{fillCopy(copy.carryCount, { n })}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="ppr-cm__never">{copy.carryNever}</p>
        <div className="ppr-cm__act">
          <button type="button" className="ppr-btn" onClick={onCancel}>
            {copy.cancel}
          </button>
          <button
            type="button"
            className="ppr-btn pri"
            disabled={busy || fields.length === 0}
            aria-busy={busy || undefined}
            onClick={() => onRun(fields)}
          >
            {copy.carryRun}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
