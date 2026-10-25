"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import { saveMemberPayrollSetting } from "@/actions/payroll-settings";
import { savePayrollMonthInput } from "@/actions/payroll-month-inputs";
import { haptic } from "@/lib/haptics";
import type { PrepManual, PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import type { WithholdingClass } from "@/lib/payroll-settings-rules";
import { fmtTime, initialOf, num, signedNum, yenMark } from "./payroll-format";
import { PayrollPerson } from "./payroll-person";
import { PayrollToast, type PayrollToastState } from "./payroll-toast";
import "./mobile-payroll.css";

/**
 * 모바일 급여 준비 — 시안 Prep-Phone · PrepSheet-Phone · Prep-Fold · Prep-Tablet(2026-10-25). 도메인 계약: docs/product/39 §5-A.
 * 폰: 한 줄 목록 → 줄을 누르면 하단 시트. 폴드: 표(이름 · 시간 · 총지급 · 실수령) → 같은 시트. 태블릿 가로: 목록 + 사람 칸(시트 없음).
 * 숫자는 서버가 낸 줄을 그대로 그린다. 폭에 따른 모양은 mobile-payroll.css 가 고른다(목록 · 표를 둘 다 그려 두고 하나만 보인다).
 */
type Filter = "all" | "transfer" | "cash";

export function MobilePayroll({
  data,
  copy,
  localeTag,
  minYm,
  maxYm,
  withholdingLabels,
}: {
  data: PayrollPrepData;
  copy: PayrollPrepCopy;
  localeTag: string;
  minYm: string;
  maxYm: string;
  withholdingLabels: Record<WithholdingClass, string>;
}) {
  const { ym, rows, totals, payday, canManage } = data;
  const router = useRouter();
  const isTablet = useIsTablet();
  const [navPending, startNav] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<PayrollToastState | null>(null);

  const showToast = (next: Omit<PayrollToastState, "id">) => setToast((prev) => ({ ...next, id: (prev?.id ?? 0) + 1 }));
  const refresh = () => startRefresh(() => router.refresh());

  const visible = rows.filter((r) => filter === "all" || r.paymentMethod === filter);
  const selected = rows.find((r) => r.userId === selectedId) ?? null;
  // 태블릿은 칸이 늘 하나를 보여 준다 — 고른 게 없거나 거른 목록에 없으면 첫 줄.
  const paneRow = visible.find((r) => r.userId === selectedId) ?? visible[0] ?? null;

  const month = (key: string) =>
    new Intl.DateTimeFormat(localeTag, { month: "long", timeZone: "UTC" }).format(new Date(`${key}-15T00:00:00Z`));
  const paydayLabel = fillCopy(copy.payday, {
    date: new Intl.DateTimeFormat(localeTag, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
      new Date(`${payday.date}T12:00:00Z`),
    ),
  });

  const go = (target: string) => {
    haptic("light");
    startNav(() => router.push(`/mobile/payroll?ym=${target}`, { scroll: false }));
  };

  const saveInput = async (row: PrepRow, patch: Partial<PrepManual>, field: string): Promise<PrepManual | null> => {
    const res = await savePayrollMonthInput({ userId: row.userId, ym, patch }).catch(() => ({ ok: false as const, reason: "error" as const }));
    if (!res.ok) {
      haptic("error");
      showToast({ kind: "bad", text: res.reason === "forbidden" ? copy.errorForbidden : copy.errorSave });
      return null;
    }
    haptic("success");
    showToast({
      kind: "undo",
      text: fillCopy(copy.saved, { name: row.name, field }),
      onUndo: () => void undo(row, res.before),
    });
    refresh();
    return res.manual;
  };

  const undo = async (row: PrepRow, before: PrepManual) => {
    const res = await savePayrollMonthInput({ userId: row.userId, ym, patch: before }).catch(() => ({ ok: false as const, reason: "error" as const }));
    if (!res.ok) {
      haptic("error");
      showToast({ kind: "bad", text: copy.errorSave });
      return;
    }
    haptic("light");
    showToast({ kind: "done", text: copy.undone });
    refresh();
  };

  const saveClass = async (row: PrepRow, cls: WithholdingClass): Promise<boolean> => {
    const res = await saveMemberPayrollSetting({ userId: row.userId, patch: { withholdingClass: cls } }).catch(() => ({
      ok: false as const,
      reason: "error" as const,
    }));
    if (!res.ok) {
      haptic("error");
      showToast({ kind: "bad", text: res.reason === "forbidden" ? copy.errorForbidden : copy.errorSave });
      return false;
    }
    haptic("success");
    showToast({ kind: "done", text: fillCopy(copy.saved, { name: row.name, field: copy.withholding }) });
    refresh();
    return true;
  };

  const open = (row: PrepRow) => {
    haptic("light");
    setSelectedId(row.userId);
    if (!isTablet) setSheetOpen(true);
  };

  const methodLabel = (row: PrepRow) =>
    row.paymentMethod === "cash" ? copy.cash : row.paymentMethod === "transfer" ? copy.transfer : copy.noMethod;

  /** 목록 줄의 둘째 줄 — 확인할 게 있으면 첫 번째 이유(빨간 점), 없으면 시간과 눈에 띄는 것 하나. */
  const subLine = (row: PrepRow, withTime: boolean, extra: boolean) => {
    const first = row.issues[0];
    if (first) return <span className="mpp-sub mpp-dot">{copy.issues[first]}</span>;
    const parts: string[] = [];
    if (withTime) parts.push(fmtTime(copy, row.paidMinutes));
    if (extra) {
      if (row.withholding) parts.push(`${copy.withholding} ${num(row.withholding)}`);
      else if (row.prevAdjustmentTaxable !== 0) parts.push(`${copy.prevAdjust} ${signedNum(row.prevAdjustmentTaxable)}`);
      else if (row.paymentMethod === "cash") parts.push(copy.cash);
    }
    return <span className="mpp-sub">{parts.join(", ") || " "}</span>;
  };
  const tableSub = (row: PrepRow) => {
    const first = row.issues[0];
    if (first) return <small className="mpp-sub mpp-dot">{copy.issues[first]}</small>;
    if (row.withholding) return <small className="mpp-sub">{`${copy.withholding} ${num(row.withholding)}`}</small>;
    if (row.prevAdjustmentTaxable !== 0) return <small className="mpp-sub">{`${copy.prevAdjust} ${signedNum(row.prevAdjustmentTaxable)}`}</small>;
    return <small className="mpp-sub">{methodLabel(row)}</small>;
  };

  const counts = { all: rows.length, transfer: totals.transfer.people, cash: totals.cash.people };
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: copy.all },
    { key: "transfer", label: copy.transfer },
    { key: "cash", label: copy.cash },
  ];

  const taxYear = payday.date.slice(0, 4);
  const person = (row: PrepRow) => (
    <PayrollPerson
      key={row.userId}
      row={row}
      ym={ym}
      copy={copy}
      localeTag={localeTag}
      taxYear={taxYear}
      canManage={canManage}
      stale={refreshing}
      withholdingLabels={withholdingLabels}
      saveInput={saveInput}
      saveClass={saveClass}
    />
  );

  const checkLine =
    totals.needsCheck > 0 ? (
      <span className="mpp-dot">{fillCopy(copy.checkPeople, { n: totals.needsCheck })}</span>
    ) : (
      <span className="mpp-bar__ok">{copy.noChecks}</span>
    );

  return (
    <div className={`mpp${navPending ? " is-pending" : ""}`}>
      <div className="mpp-main" key={ym}>
        <header className="mpp-h">
          <div className="mpp-h__t">
            <h1>{fillCopy(copy.title, { month: month(ym) })}</h1>
            <span>{paydayLabel}</span>
          </div>
          <div className="mpp-mnav">
            <button type="button" className="mpp-arrow" aria-label={copy.prevMonth} disabled={ym <= minYm} onClick={() => go(shiftMonthKey(ym, -1))}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <button type="button" className="mpp-arrow" aria-label={copy.nextMonth} disabled={ym >= maxYm} onClick={() => go(shiftMonthKey(ym, 1))}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </header>

        <section className="mpp-hero" aria-label={copy.netTotal}>
          <div className="mpp-hero__net">
            <span>{copy.netTotal}</span>
            <b className="num">{yenMark(totals.net)}</b>
          </div>
          <span className="mpp-hero__split num">
            {copy.transfer} {num(totals.transfer.net)} · {copy.cash} {num(totals.cash.net)}
          </span>
          <div className="mpp-hero__cols num">
            <div>
              <span>{copy.transfer}</span>
              <b>{num(totals.transfer.net)}</b>
            </div>
            <div>
              <span>{copy.cash}</span>
              <b>{num(totals.cash.net)}</b>
            </div>
          </div>
          {totals.uncalculated > 0 ? <span className="mpp-hero__note">{fillCopy(copy.uncalculated, { n: totals.uncalculated })}</span> : null}
        </section>

        {rows.length === 0 ? (
          <p className="mpp-empty">{copy.empty}</p>
        ) : (
          <>
            <div className="mpp-seg" role="radiogroup" aria-label={copy.filterLabel}>
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.key}
                  onClick={() => {
                    if (filter === f.key) return;
                    haptic("light");
                    setFilter(f.key);
                  }}
                >
                  {f.label} {counts[f.key]}
                </button>
              ))}
            </div>

            <ul className="mpp-list">
              {visible.map((row) => (
                <li key={row.userId}>
                  <button
                    type="button"
                    className={`mpp-row${isTablet && paneRow?.userId === row.userId ? " is-sel" : ""}`}
                    aria-current={isTablet && paneRow?.userId === row.userId ? "true" : undefined}
                    onClick={() => open(row)}
                  >
                    <span className="mpp-av" aria-hidden="true">
                      {initialOf(row.name)}
                    </span>
                    <span className="mpp-row__b">
                      <span className="mpp-row__t">{row.name}</span>
                      {subLine(row, true, !isTablet)}
                    </span>
                    <span className={`mpp-amt num${row.net == null ? " is-none" : ""}`}>{row.net == null ? "—" : yenMark(row.net)}</span>
                  </button>
                </li>
              ))}
            </ul>

            <table className="mpp-tbl">
              <thead>
                <tr>
                  <th scope="col">{copy.colName}</th>
                  <th scope="col" className="r">
                    {copy.colHours}
                  </th>
                  <th scope="col" className="r">
                    {copy.colGross}
                  </th>
                  <th scope="col" className="r">
                    {copy.colNet}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.userId} onClick={() => open(row)}>
                    <td>
                      <button type="button" className="mpp-who" onClick={(event) => {
                          event.stopPropagation();
                          open(row);
                        }}>
                        <span className="mpp-av mpp-av--sm" aria-hidden="true">
                          {initialOf(row.name)}
                        </span>
                        <span className="mpp-who__t">
                          <b>{row.name}</b>
                          {tableSub(row)}
                        </span>
                      </button>
                    </td>
                    <td className="r num">{fmtTime(copy, row.paidMinutes)}</td>
                    <td className="r num">{num(row.gross)}</td>
                    <td className={`r num mpp-tbl__net${row.net == null ? " is-none" : ""}`}>{row.net == null ? "—" : num(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mpp-phone-go">
              <button type="button" className="mpp-go" disabled aria-describedby="mpp-go-note">
                {copy.requestApproval}
              </button>
              <p id="mpp-go-note">{copy.approvalLater}</p>
            </div>
            <div className="mpp-bar">
              {checkLine}
              <button type="button" className="mpp-go" disabled aria-describedby="mpp-go-note-bar">
                {copy.requestApproval}
              </button>
              <span id="mpp-go-note-bar" className="sr-only">
                {copy.approvalLater}
              </span>
            </div>
          </>
        )}
      </div>

      {isTablet && paneRow ? (
        <section className="mpp-pane" aria-label={paneRow.name}>
          {person(paneRow)}
        </section>
      ) : null}

      {!isTablet && sheetOpen && selected ? (
        <BottomSheet ariaLabel={`${selected.name} · ${copy.net}`} onClose={() => setSheetOpen(false)}>
          <div className="mpp-sheet">{person(selected)}</div>
        </BottomSheet>
      ) : null}

      {toast ? <PayrollToast key={toast.id} toast={toast} undoLabel={copy.undo} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
