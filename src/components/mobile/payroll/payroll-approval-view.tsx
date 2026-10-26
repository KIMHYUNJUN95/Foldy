"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { approvePayroll, cancelPayrollApprovalRequest, returnPayroll, undoPayrollApproval } from "@/actions/payroll-approval";
import { haptic } from "@/lib/haptics";
import type { ApprovalSlot } from "@/lib/payroll-approval";
import type { PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import { fmtTime, num, yenMark } from "./payroll-format";
import { ReasonSheet, RoundHistory, StampSlots, slotLabel, statusLabel, type RoundFail, type ShowToast } from "./payroll-round-ui";
import "./payroll-round.css";

/**
 * 모바일 급여 결재 — 사장 확인표(읽기 전용) · 도장 칸 · 기록 · 결재 / 돌려보내기(시안 Approve-Phone · Approve-Fold · Approve-Tablet, 2026-10-26).
 * 폰: 도장 → 목록 → 아래 고정 막대. 폴드: 도장이 머리 오른쪽, 표(이름 · 시간 · 총지급 · 실수령) + 아래 막대.
 * 태블릿 가로: 왼쪽 확인표 | 오른쪽 320px 결재 칸(도장 · 기록 · 버튼).
 * 결재는 한 번 누름 + 되돌리기 토스트(확인 창 없음), 돌려보내기만 사유 시트. docs/product/40 §4-3.
 */
export function PayrollApprovalView({
  data,
  copy,
  localeTag,
  monthLabel,
  paydayLabel,
  showToast,
  onFail,
  refresh,
}: {
  data: PayrollPrepData;
  copy: PayrollPrepCopy;
  localeTag: string;
  monthLabel: string;
  paydayLabel: string;
  showToast: ShowToast;
  onFail: (reason: RoundFail) => void;
  refresh: () => void;
}) {
  const { ym, rows, totals, round, canManage } = data;
  const [pending, start] = useTransition();
  const [fresh, setFresh] = useState<{ slot: ApprovalSlot; at: string } | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  // 서버가 새 회차를 주면(결재 반영 · 되돌리기) 방금 찍은 표시는 서버 값을 따른다 — 되돌렸으면 사라진다.
  const [seenRound, setSeenRound] = useState(round);
  if (seenRound !== round) {
    setSeenRound(round);
    if (fresh && !(fresh.slot === "senmu" ? round.senmu?.approvedAt : round.president.approvedAt)) setFresh(null);
  }

  const myTurn = round.myTurn;
  const anyApproved = Boolean(round.senmu?.approvedAt || round.president.approvedAt);
  const canCancel = canManage && !anyApproved;

  const approve = () => {
    if (!myTurn || pending) return;
    const slot = myTurn;
    setFresh({ slot, at: new Date().toISOString() });
    start(async () => {
      const res = await approvePayroll(ym).catch(() => ({ ok: false as const, reason: "error" as const }));
      if (!res.ok) {
        setFresh(null);
        onFail(res.reason);
        return;
      }
      haptic("success");
      const done = res.slot ?? slot;
      showToast({
        kind: "undo",
        text: fillCopy(copy.approvedToast, { slot: slotLabel(copy, done) }),
        onUndo: () => void undo(done),
      });
      refresh();
    });
  };

  const undo = async (slot: ApprovalSlot) => {
    const res = await undoPayrollApproval(ym, slot).catch(() => ({ ok: false as const, reason: "error" as const }));
    if (!res.ok) {
      onFail(res.reason);
      return;
    }
    haptic("light");
    setFresh(null);
    showToast({ kind: "done", text: copy.undone });
    refresh();
  };

  const cancelRequest = () => {
    if (pending) return;
    start(async () => {
      const res = await cancelPayrollApprovalRequest(ym).catch(() => ({ ok: false as const, reason: "error" as const }));
      if (!res.ok) {
        onFail(res.reason);
        return;
      }
      haptic("success");
      showToast({ kind: "done", text: copy.cancelledToast });
      refresh();
    });
  };

  const sendBack = async (reason: string): Promise<boolean> => {
    const res = await returnPayroll(ym, reason).catch(() => ({ ok: false as const, reason: "error" as const }));
    if (!res.ok) {
      onFail(res.reason);
      return res.reason === "conflict"; // 상태가 바뀌었으면 시트를 닫고, 아니면 이유를 그대로 두고 다시 시도
    }
    haptic("success");
    showToast({ kind: "done", text: copy.returnedToast });
    refresh();
    return true;
  };

  const groups: { key: string; label: string; rows: PrepRow[] }[] = [
    { key: "transfer", label: copy.transferGroup, rows: rows.filter((r) => r.paymentMethod === "transfer") },
    { key: "cash", label: copy.cashGroup, rows: rows.filter((r) => r.paymentMethod === "cash") },
    { key: "none", label: copy.noMethod, rows: rows.filter((r) => r.paymentMethod == null) },
  ].filter((g) => g.rows.length > 0);
  const sumNet = (list: PrepRow[]) => list.reduce((s, r) => s + (r.net ?? 0), 0);

  const sumLine = (
    <div className="mpr-sum">
      <span>{copy.netTotal}</span>
      <b className="num">{yenMark(totals.net)}</b>
    </div>
  );

  const actions = (
    <div className="mpr-acts">
      {/* 돌려보내기도 지금 차례 결재자만(PC 와 같음) — 다른 `payroll.approve` 사람은 서버가 forbidden. */}
      {myTurn ? (
        <button
          type="button"
          className="mpr-btn mpr-btn--sec"
          disabled={pending}
          onClick={() => {
            haptic("light");
            setReturnOpen(true);
          }}
        >
          {copy.returnAction}
        </button>
      ) : null}
      {myTurn ? (
        <button type="button" className="mpr-btn mpr-btn--pri" disabled={pending} aria-busy={pending} onClick={approve}>
          {copy.approve}
        </button>
      ) : null}
      {!myTurn && canCancel ? (
        <button type="button" className="mpr-btn mpr-btn--sec" disabled={pending} aria-busy={pending} onClick={cancelRequest}>
          {copy.cancelRequest}
        </button>
      ) : null}
    </div>
  );
  const waitLine = !myTurn ? <p className="mpr-wait">{canManage ? copy.approvalWait : statusLabel(copy, round.status)}</p> : null;
  const hasActions = Boolean(myTurn) || canCancel;

  return (
    <div className="mpr-ap">
      <section className="mpr-ap__sheet" aria-label={copy.ownerSheet}>
        <div className="mpr-ap__top">
          <div className="mpr-ap__h">
            <h2>{copy.ownerSheet}</h2>
            <span>
              {monthLabel} · {paydayLabel} · {fillCopy(copy.people, { n: rows.length })}
            </span>
            <p className="mpr-lock">
              <Lock aria-hidden="true" />
              {copy.lockedShort}
            </p>
          </div>
          <StampSlots className="mpr-stamps--head" copy={copy} fresh={fresh} localeTag={localeTag} round={round} />
        </div>

        <div className="mpr-tbl" role="table" aria-label={copy.ownerSheet}>
          <div className="mpr-tr mpr-tr--h" role="row">
            <span role="columnheader">{copy.colName}</span>
            <span role="columnheader" className="r">
              {copy.colHours}
            </span>
            <span role="columnheader" className="r">
              {copy.colGross}
            </span>
            <span role="columnheader" className="r">
              {copy.colNet}
            </span>
          </div>
          {groups.map((g) => (
            <div key={g.key} role="rowgroup" className="mpr-grp">
              <div className="mpr-grp__h" role="row">
                <b role="rowheader">
                  {g.label} {fillCopy(copy.people, { n: g.rows.length })}
                </b>
                <span className="num">{yenMark(sumNet(g.rows))}</span>
              </div>
              {g.rows.map((r) => (
                <div key={r.userId} className="mpr-tr" role="row">
                  <span role="cell" className="mpr-tr__nm">
                    <b>{r.name}</b>
                    <small className="num">
                      {fmtTime(copy, r.paidMinutes)} · {copy.colGross} {num(r.gross)} · {copy.colWithholding} {num(r.withholding ?? 0)}
                    </small>
                  </span>
                  <span role="cell" className="r num mpr-tr__wide">
                    {fmtTime(copy, r.paidMinutes)}
                  </span>
                  <span role="cell" className="r num mpr-tr__wide">
                    {num(r.gross)}
                  </span>
                  <span role="cell" className="r num mpr-tr__net">
                    {r.net == null ? "—" : num(r.net)}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <div className="mpr-tr mpr-tr--tot" role="row">
            <span role="cell">{copy.netTotal}</span>
            <span role="cell" className="r num mpr-tr__wide">
              {fmtTime(copy, totals.paidMinutes)}
            </span>
            <span role="cell" className="r num mpr-tr__wide">
              {num(totals.gross)}
            </span>
            <span role="cell" className="r num">
              {yenMark(totals.net)}
            </span>
          </div>
        </div>

        <RoundHistory copy={copy} localeTag={localeTag} round={round} />
      </section>

      {/* 태블릿 가로 — 오른쪽 결재 칸 */}
      <aside className="mpr-ap__pane" aria-label={copy.approvalTitle}>
        <h2 className="mpr-h2">{copy.approvalTitle}</h2>
        <StampSlots copy={copy} fresh={fresh} localeTag={localeTag} round={round} />
        <RoundHistory copy={copy} localeTag={localeTag} round={round} />
        <div className="mpr-ap__paneacts">
          {sumLine}
          {waitLine}
          {hasActions ? actions : null}
        </div>
      </aside>

      {/* 폰 · 폴드 — 아래 고정 막대 */}
      <div className="mpr-bar">
        {sumLine}
        {waitLine}
        {hasActions ? actions : null}
      </div>

      {returnOpen ? (
        <ReasonSheet
          body={copy.returnBody}
          copy={copy}
          title={copy.returnAction}
          onClose={() => setReturnOpen(false)}
          onSubmit={sendBack}
        />
      ) : null}
    </div>
  );
}
