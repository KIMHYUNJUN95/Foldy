"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approvePayroll,
  cancelPayrollApprovalRequest,
  returnPayroll,
  undoPayrollApproval,
} from "@/actions/payroll-approval";
import { exportPayrollBookReport, exportPayrollBookWorkbook } from "@/actions/payroll-exports";
import { getDictionary, type Locale } from "@/lib/i18n";
import { currentSlot, type ApprovalSlot, type ApprovalSlotView } from "@/lib/payroll-approval";
import type { PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { getPayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import { AdminExportButtons } from "../../shared/admin-export-buttons";
import { AdminReasonModal } from "../../shared/admin-reason-modal";
import { LockIcon } from "./payroll-prep-client";
import type { RoundToast } from "./payroll-round-client";
import { formatPrepMonth, formatPrepPayday, formatPrepStamp, formatPrepTime, prepInitial } from "./prep-format";
import { eventLabel, roundFailMessage, slotLabel, stageHref } from "./round-ui";
import "./payroll-prep.css";

/**
 * 결재(PC) — 시안 「R · 제안 · PC 결재」. 왼쪽 사장 확인표(요청 때 굳힌 숫자, 보기만) · 오른쪽 도장 칸 · 기록 · 급여 파일.
 * 아래 줄: 내 차례면 「돌려보내기」 · 「결재」(한 번 클릭 + 실행 취소), 요청한 사람이면 「요청 취소」.
 * docs/product/40 §4-3.
 */
export function PayrollApprovalView({
  data,
  locale,
  localeTag,
  toast,
}: {
  data: PayrollPrepData;
  locale: Locale;
  localeTag: string;
  toast: RoundToast;
}) {
  const router = useRouter();
  const copy = getPayrollPrepCopy(locale);
  const shared = getDictionary(locale).admin.shared;
  const { ym, round, rows, totals, payday } = data;
  const { announce, notice } = toast;

  const [pending, startAction] = useTransition();
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  // 방금 찍은 도장 — 서버 값이 오기 전에도 바로 찍히고(이름은 그 칸의 결재자), 「찍힘」 모션을 한 번 탄다.
  const [stamped, setStamped] = useState<{ slot: ApprovalSlot; at: string } | null>(null);

  const money = new Intl.NumberFormat(localeTag);
  const num = (n: number | null) => (n == null ? "—" : money.format(n));
  const yen = (n: number) => fillCopy(copy.yen, { n: money.format(n) });
  const stay = () => router.replace(stageHref(ym, "approval"), { scroll: false });

  const fail = (reason: string) => {
    if (reason === "conflict") router.refresh();
    notice(roundFailMessage(copy, reason));
  };

  const turn = currentSlot(round.status);
  const myTurn = round.myTurn;
  const nobodyApproved = !round.senmu?.approvedAt && !round.president.approvedAt;
  const canCancel = data.canManage && !myTurn && turn !== null && nobodyApproved;

  function approve() {
    if (!myTurn) return;
    const slot = myTurn;
    startAction(async () => {
      const res = await approvePayroll(ym);
      if (!res.ok) return fail(res.reason);
      setStamped({ slot, at: new Date().toISOString() });
      stay();
      announce(fillCopy(copy.approvedToast, { slot: slotLabel(copy, slot) }), async () => {
        const back = await undoPayrollApproval(ym, slot);
        if (!back.ok) return fail(back.reason);
        setStamped(null);
        stay();
        notice(copy.undone);
      });
    });
  }

  function cancelRequest() {
    startAction(async () => {
      const res = await cancelPayrollApprovalRequest(ym);
      if (!res.ok) return fail(res.reason);
      router.replace(stageHref(ym, "prep"), { scroll: false });
      notice(copy.cancelledToast);
    });
  }

  function sendBack(reason: string) {
    if (!reason.trim()) return setReturnError(copy.reasonRequired);
    setReturnError(null);
    startAction(async () => {
      const res = await returnPayroll(ym, reason);
      if (!res.ok) {
        if (res.reason === "reason_required") return setReturnError(copy.reasonRequired);
        setReturning(false);
        return fail(res.reason);
      }
      setReturning(false);
      router.replace(stageHref(ym, "prep"), { scroll: false });
      notice(copy.returnedToast);
    });
  }

  const transfer = rows.filter((r) => r.paymentMethod === "transfer");
  const cash = rows.filter((r) => r.paymentMethod === "cash");
  const other = rows.filter((r) => r.paymentMethod !== "transfer" && r.paymentMethod !== "cash");
  const groups: { key: string; label: string; list: PrepRow[]; net: number }[] = [
    { key: "transfer", label: copy.transferGroup, list: transfer, net: totals.transfer.net },
    { key: "cash", label: copy.cashGroup, list: cash, net: totals.cash.net },
    { key: "other", label: copy.noMethod, list: other, net: other.reduce((s, r) => s + (r.net ?? 0), 0) },
  ].filter((g) => g.list.length > 0);

  const slots: { slot: ApprovalSlot; view: ApprovalSlotView }[] = [
    ...(round.senmu ? [{ slot: "senmu" as const, view: round.senmu }] : []),
    { slot: "president", view: round.president },
  ];

  return (
    <div className="ppr ppa">
      <div className="ppr-title">
        <b>{fillCopy(copy.title, { month: formatPrepMonth(ym, localeTag) })}</b>
        <span>{fillCopy(copy.payday, { date: formatPrepPayday(payday.date, localeTag) })}</span>
      </div>

      <p className="ppr-note ppr-note--lock">
        <LockIcon />
        {copy.lockedNote}
      </p>

      <div className="ppa-cols">
        <section className="ppa-sheet" aria-label={copy.ownerSheet}>
          <div className="ppa-sh">
            <b>{copy.ownerSheet}</b>
            <span>
              {fillCopy(copy.people, { n: totals.people })} · {formatPrepTime(totals.paidMinutes)}
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="ppr-empty">{copy.empty}</p>
          ) : (
            <>
              <div className="ppa-row ppa-th">
                <span>{copy.colName}</span>
                <span className="ppr-r">{copy.colHours}</span>
                <span className="ppr-r">{copy.colGross}</span>
                <span className="ppr-r">{copy.colWithholding}</span>
                <span className="ppr-r">{copy.colNet}</span>
              </div>
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="ppa-grp">
                    <b>
                      {g.label} {fillCopy(copy.people, { n: g.list.length })}
                    </b>
                    <span>{yen(g.net)}</span>
                  </div>
                  {g.list.map((r) => (
                    <div className="ppa-row ppa-tr" key={r.userId}>
                      <span className="ppr-who">
                        <span className="ppr-av" aria-hidden="true">
                          {prepInitial(r)}
                        </span>
                        <b>{r.name}</b>
                      </span>
                      <span className="ppr-r ppr-mute">{formatPrepTime(r.paidMinutes)}</span>
                      <span className="ppr-r">{num(r.gross)}</span>
                      <span className="ppr-r ppr-mute">{num(r.withholding)}</span>
                      <span className="ppr-r ppr-net">{num(r.net)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="ppa-row ppa-tot">
                <span>{copy.netTotal}</span>
                <span className="ppr-r">{formatPrepTime(totals.paidMinutes)}</span>
                <span className="ppr-r">{num(totals.gross)}</span>
                <span className="ppr-r">{num(totals.withholding)}</span>
                <span className="ppr-r">{yen(totals.net)}</span>
              </div>
            </>
          )}
        </section>

        <aside className="ppa-aside" aria-label={copy.approvalTitle}>
          <h2>{copy.approvalTitle}</h2>
          <div className="ppa-stamps">
            {slots.map(({ slot, view }) => {
              const fresh = stamped?.slot === slot;
              const at = view.approvedAt ?? (fresh ? stamped.at : null);
              const name = view.approvedByName ?? (fresh ? view.approverName : null);
              return (
                <div className="ppa-slot" key={slot}>
                  {at ? (
                    <span className={`ppa-stamp${fresh ? " fresh" : ""}`}>
                      <b>{name ?? "—"}</b>
                      <small>{formatPrepStamp(at)}</small>
                    </span>
                  ) : (
                    <span className={`ppa-stamp wait${turn === slot ? " turn" : ""}`}>{copy.stampWaiting}</span>
                  )}
                  <em>{slotLabel(copy, slot)}</em>
                  {!at && view.approverName ? <small>{view.approverName}</small> : null}
                </div>
              );
            })}
          </div>

          <h3 className="ppa-h3">{copy.historyTitle}</h3>
          <ol className="ppa-hist">
            {turn ? (
              <li className="now">
                <b>{fillCopy(copy.turnOf, { slot: slotLabel(copy, turn) })}</b>
                <span>{(turn === "senmu" ? round.senmu?.approverName : round.president.approverName) ?? ""}</span>
              </li>
            ) : null}
            {round.events.map((ev, i) => (
              <li key={`${ev.at}-${i}`}>
                <b>{eventLabel(copy, ev)}</b>
                <span>{[ev.actorName, formatPrepStamp(ev.at)].filter(Boolean).join(" · ")}</span>
                {ev.reason ? <p>{ev.reason}</p> : null}
              </li>
            ))}
          </ol>

          <div className="ppa-files">
            <span className="ppr-mute">{copy.stampNote}</span>
            <span className="ppr-file" title={copy.fileBookHint}>
              <span className="ppr-file__l">{copy.fileBook}</span>
              <AdminExportButtons
                labels={shared}
                disabled={rows.length === 0}
                onExportXls={() => exportPayrollBookWorkbook(ym)}
                onExportPdf={() => exportPayrollBookReport(ym)}
                onToast={notice}
              />
            </span>
          </div>
        </aside>
      </div>

      <div className="ppr-bar">
        <span>
          <span className="k">{copy.netTotal}</span>
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
          {myTurn ? (
            <>
              <button
                type="button"
                className="ppr-btn"
                disabled={pending}
                onClick={() => {
                  setReturnError(null);
                  setReturning(true);
                }}
              >
                {copy.returnAction}
              </button>
              <button type="button" className="ppr-btn pri" disabled={pending} aria-busy={pending || undefined} onClick={approve}>
                {copy.approve}
              </button>
            </>
          ) : turn ? (
            <>
              <span>{copy.approvalWait}</span>
              {canCancel ? (
                <button type="button" className="ppr-btn" disabled={pending} onClick={cancelRequest}>
                  {copy.cancelRequest}
                </button>
              ) : null}
            </>
          ) : null}
        </span>
      </div>

      {returning ? (
        <AdminReasonModal
          title={copy.returnAction}
          description={copy.returnBody}
          placeholder={copy.reasonLabel}
          confirmLabel={copy.returnAction}
          cancelLabel={copy.cancel}
          pending={pending}
          errorText={returnError}
          danger
          onConfirm={sendBack}
          onCancel={() => setReturning(false)}
        />
      ) : null}
    </div>
  );
}
