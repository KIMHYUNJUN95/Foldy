"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import { saveMemberPayrollSetting } from "@/actions/payroll-settings";
import { savePayrollMonthInput } from "@/actions/payroll-month-inputs";
import { cancelPayrollApprovalRequest, requestPayrollApproval } from "@/actions/payroll-approval";
import { haptic } from "@/lib/haptics";
import { canRequestApproval, currentSlot } from "@/lib/payroll-approval";
import type { PrepManual, PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import type { WithholdingClass } from "@/lib/payroll-settings-rules";
import { fmtTime, initialOf, num, signedNum, yenMark } from "./payroll-format";
import { PayrollPerson } from "./payroll-person";
import { PayrollFiles } from "./payroll-files";
import { PayrollToast, type PayrollToastState } from "./payroll-toast";
import { PayrollApprovalView } from "./payroll-approval-view";
import { PayrollPayView } from "./payroll-pay-view";
import { failText, slotLabel, statusLabel, type RoundFail } from "./payroll-round-ui";
import "./mobile-payroll.css";

/**
 * 모바일 급여 준비 — 시안 Prep-Phone · PrepSheet-Phone · Prep-Fold · Prep-Tablet(2026-10-25). 도메인 계약: docs/product/39 §5-A.
 * 폰: 한 줄 목록 → 줄을 누르면 하단 시트. 폴드: 표(이름 · 시간 · 총지급 · 실수령) → 같은 시트. 태블릿 가로: 목록 + 사람 칸(시트 없음).
 * 숫자는 서버가 낸 줄을 그대로 그린다. 폭에 따른 모양은 mobile-payroll.css 가 고른다(목록 · 표를 둘 다 그려 두고 하나만 보인다).
 *
 * P5(2026-10-26, 시안 Inbox-Phone · Approve-* · Pay-*): 회차 상태로 화면이 바뀐다.
 * - 급여 준비: 결재 요청(조건이 맞을 때만) · 돌려보낸 이유 한 줄.
 * - 결재 단계: 폰은 잠긴 목록 + 맨 위 「결재할 급여」 카드(내 차례) / 상태 줄 → `?view=approve` 결재 화면.
 *   폴드 · 태블릿은 결재 화면을 바로 그린다(둘 다 그려 두고 CSS 가 폭으로 고른다 — 깜빡임 없음).
 * - 지급 중 이후: 지급 확인 화면 + 파일.
 */
type Filter = "all" | "transfer" | "cash";

export function MobilePayroll({
  data,
  copy,
  localeTag,
  minYm,
  maxYm,
  withholdingLabels,
  view = null,
}: {
  data: PayrollPrepData;
  copy: PayrollPrepCopy;
  localeTag: string;
  minYm: string;
  maxYm: string;
  withholdingLabels: Record<WithholdingClass, string>;
  /** `approve` — 폰에서 결재 화면(사장 확인표)을 연다. 결재 단계가 아니면 무시. */
  view?: "approve" | null;
}) {
  const { ym, rows, totals, payday, round } = data;
  const status = round.status;
  const phase: "prep" | "approval" | "pay" = status === "preparing" ? "prep" : currentSlot(status) ? "approval" : "pay";
  const locked = phase !== "prep";
  // 결재가 시작되면 입력은 잠긴다 — 서버도 `locked` 로 막는다.
  const canManage = data.canManage && !locked;
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
  const [requestPending, startRequest] = useTransition();

  const onFail = (reason: RoundFail) => {
    haptic("error");
    showToast({ kind: "bad", text: failText(copy, reason) });
    if (reason === "conflict" || reason === "locked") refresh();
  };

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
      onFail(res.reason === "forbidden" || res.reason === "locked" ? res.reason : "error");
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
      onFail(res.reason === "locked" ? "locked" : "error");
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
    return <span className="mpp-sub">{parts.join(" · ") || " "}</span>;
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
      readOnlyNote={locked ? copy.lockedShort : undefined}
    />
  );

  const checkLine =
    totals.needsCheck > 0 ? (
      <span className="mpp-dot">{fillCopy(copy.checkPeople, { n: totals.needsCheck })}</span>
    ) : (
      <span className="mpp-bar__ok">{copy.noChecks}</span>
    );

  // ── 결재 요청(P5) — 관리자 · 확인 0 · 모두 계산 · 근태 마감 · 사장 결재자 있음 ──
  const ready = canRequestApproval(rows, totals);
  const canRequest = phase === "prep" && data.canManage && ready && round.approversReady;
  const requestHint = !round.approversReady ? copy.errorNoApprover : !ready ? copy.errorNotReady : null;
  const request = () => {
    if (!canRequest || requestPending) return;
    startRequest(async () => {
      const res = await requestPayrollApproval(ym).catch(() => ({ ok: false as const, reason: "error" as const }));
      if (!res.ok) {
        onFail(res.reason);
        return;
      }
      haptic("success");
      showToast({ kind: "undo", text: copy.requestedToast, onUndo: () => void cancelRequest() });
      refresh();
    });
  };
  const cancelRequest = async () => {
    const res = await cancelPayrollApprovalRequest(ym).catch(() => ({ ok: false as const, reason: "error" as const }));
    if (!res.ok) {
      onFail(res.reason);
      return;
    }
    haptic("light");
    showToast({ kind: "done", text: copy.cancelledToast });
    refresh();
  };
  const anyApproved = Boolean(round.senmu?.approvedAt || round.president.approvedAt);

  const header = (
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
  );

  const toastEl = toast ? <PayrollToast key={toast.id} toast={toast} undoLabel={copy.undo} onDismiss={() => setToast(null)} /> : null;
  const approveHref = `/mobile/payroll?ym=${ym}&view=approve`;

  /** 결재 단계 · 폰 맨 위 — 내 차례면 「결재할 급여」 카드, 아니면 상태 줄. 둘 다 결재 화면으로. */
  const approvalEntry =
    phase === "approval" ? (
      round.myTurn ? (
        <Link href={approveHref} className="mpr-card" scroll={false} onClick={() => haptic("light")}>
          <span className="mpr-card__mini" aria-hidden="true">
            {round.senmu ? <i className={round.senmu.approvedAt ? "" : "is-wait"}>{round.senmu.approvedAt ? initialOf(round.senmu.approvedByName ?? "") : ""}</i> : null}
            <i className="is-wait" />
          </span>
          <span className="mpr-card__t">
            <small>{fillCopy(copy.turnOf, { slot: slotLabel(copy, round.myTurn) })}</small>
            <b>{fillCopy(copy.approveCardTitle, { month: month(ym) })}</b>
            <span className="num">{fillCopy(copy.approveCardSub, { n: rows.length, amount: yenMark(totals.net) })}</span>
          </span>
          <ChevronRight aria-hidden="true" />
        </Link>
      ) : (
        <Link href={approveHref} className="mpr-card mpr-card--plain" scroll={false} onClick={() => haptic("light")}>
          <span className="mpr-card__t">
            <small>{statusLabel(copy, status)}</small>
            <b>{copy.ownerSheet}</b>
          </span>
          <ChevronRight aria-hidden="true" />
        </Link>
      )
    ) : null;

  const prepMain = (
    <div className="mpp-main" key={ym}>
      {approvalEntry ? (
        <section className="mpr-entry" aria-label={round.myTurn ? copy.myTurnCard : copy.ownerSheet}>
          {approvalEntry}
        </section>
      ) : null}
      {header}

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

      {locked ? <span className="mpr-st">{`${statusLabel(copy, status)} · ${copy.lockedShort}`}</span> : null}
      {phase === "prep" && round.lastReturn ? (
        <p className="mpr-returned" role="note">
          {fillCopy(copy.returnedNote, { name: round.lastReturn.actorName ?? "—", reason: round.lastReturn.reason ?? "" })}
        </p>
      ) : null}

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
                    <button
                      type="button"
                      className="mpp-who"
                      onClick={(event) => {
                        event.stopPropagation();
                        open(row);
                      }}
                    >
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

          <PayrollFiles ym={ym} copy={copy} showToast={showToast} />

          {phase === "prep" && data.canManage ? (
            <>
              <div className="mpp-phone-go">
                <button
                  type="button"
                  className="mpp-go"
                  disabled={!canRequest || requestPending}
                  aria-busy={requestPending}
                  aria-describedby={requestHint ? "mpp-go-note" : undefined}
                  onClick={request}
                >
                  {copy.requestApproval}
                </button>
                {requestHint ? <p id="mpp-go-note">{requestHint}</p> : null}
              </div>
              <div className="mpp-bar">
                {round.approversReady ? checkLine : <span className="mpp-dot">{copy.errorNoApprover}</span>}
                <button
                  type="button"
                  className="mpp-go"
                  disabled={!canRequest || requestPending}
                  aria-busy={requestPending}
                  onClick={request}
                >
                  {copy.requestApproval}
                </button>
              </div>
            </>
          ) : null}
          {phase === "approval" && data.canManage && !round.myTurn ? (
            <div className="mpp-phone-go">
              <p>{copy.approvalWait}</p>
              {!anyApproved ? (
                <button
                  type="button"
                  className="mpr-btn mpr-btn--sec"
                  disabled={requestPending}
                  aria-busy={requestPending}
                  onClick={() => {
                    if (requestPending) return;
                    startRequest(cancelRequest);
                  }}
                >
                  {copy.cancelRequest}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const roundProps = {
    data,
    copy,
    localeTag,
    monthLabel: fillCopy(copy.title, { month: month(ym) }),
    paydayLabel,
    showToast,
    onFail,
    refresh,
  };

  // ── 지급 중 이후 ──
  if (phase === "pay") {
    return (
      <div className={`mpp mpp--flow${navPending ? " is-pending" : ""}`}>
        <div className="mpp-main" key={ym}>
          {header}
          <PayrollPayView {...roundProps} />
          <PayrollFiles ym={ym} copy={copy} showToast={showToast} />
        </div>
        {toastEl}
      </div>
    );
  }

  // ── 결재 단계 ──
  if (phase === "approval") {
    const approvalMain = (
      <div className="mpp-main" key={`${ym}-ap`}>
        {header}
        <PayrollApprovalView {...roundProps} />
      </div>
    );
    return (
      <div className={`mpp mpp--flow${navPending ? " is-pending" : ""}`}>
        {view === "approve" ? (
          approvalMain
        ) : (
          <>
            <div className="mpr-phone-only">{prepMain}</div>
            <div className="mpr-wide-only">{approvalMain}</div>
          </>
        )}
        {view !== "approve" && !isTablet && sheetOpen && selected ? (
          <BottomSheet ariaLabel={`${selected.name} · ${copy.net}`} onClose={() => setSheetOpen(false)}>
            <div className="mpp-sheet">{person(selected)}</div>
          </BottomSheet>
        ) : null}
        {toastEl}
      </div>
    );
  }

  // ── 급여 준비 ──
  return (
    <div className={`mpp${navPending ? " is-pending" : ""}`}>
      {prepMain}

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

      {toastEl}
    </div>
  );
}
