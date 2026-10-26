"use client";

import { useState, useTransition } from "react";
import { Copy } from "lucide-react";
import { returnPayroll, setAccountantSent, setPaymentChecks } from "@/actions/payroll-approval";
import { haptic } from "@/lib/haptics";
import { usableAccount, type MemberBank } from "@/lib/payroll-bank";
import { bankTypeLabel, type PayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { checkAt, type PaymentCheckKind, type PaymentCheckState } from "@/lib/payroll-approval";
import type { PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import { num, yenMark } from "./payroll-format";
import { CheckButton, fmtStamp, ReasonSheet, RoundHistory, statusLabel, type RoundFail, type ShowToast } from "./payroll-round-ui";
import "./payroll-round.css";

/**
 * 모바일 급여 지급 확인 — 진행 n/m · 현금(봉투 넣음 → 본인 확인) · 이체(이체 완료 · 모두 이체 완료) · 세무사 「보냄」
 * (시안 Pay-Phone · Pay-Fold · Pay-Tablet, 2026-10-26). docs/product/40 §4-4 · §4-5.
 * 체크는 누르는 즉시 그려지고(낙관적), 서버가 거절하면 되돌아간다. 세무사에 보낸 뒤엔 읽기 전용.
 * 폰: 줄 아래 체크 두 개. 폴드: 한 줄에 이름 · 금액 · 체크. 태블릿 가로: 현금 | 이체 두 단.
 */
type Key = `${string}:${PaymentCheckKind}`;

export function PayrollPayView({
  data,
  copy,
  localeTag,
  monthLabel,
  paydayLabel,
  showToast,
  onFail,
  refresh,
  bankCopy,
  banks,
}: {
  data: PayrollPrepData;
  copy: PayrollPrepCopy;
  localeTag: string;
  monthLabel: string;
  paydayLabel: string;
  showToast: ShowToast;
  onFail: (reason: RoundFail) => void;
  refresh: () => void;
  bankCopy: PayrollBankCopy;
  /** 계좌 — `payroll.view` 가 없으면 빈 객체(계좌 줄을 그리지 않는다). */
  banks: Record<string, MemberBank>;
}) {
  const { ym, rows, round, canManage } = data;
  const status = round.status;
  const [over, setOver] = useState<Partial<Record<Key, boolean>>>({});
  const [seenChecks, setSeenChecks] = useState(round.checks);
  if (seenChecks !== round.checks) {
    // 서버 값이 새로 오면 서버가 이미 맞춘 낙관적 표시만 버린다 — 아직 응답을 기다리는 체크(봉투 → 본인 확인을 빠르게 누름)는
    // 남겨 둬야 앞 요청의 새로 읽기에 뒤 체크가 잠깐 꺼졌다 켜지지 않는다. 실패는 `write` 가 직접 지운다.
    const nextChecks = round.checks;
    setSeenChecks(nextChecks);
    setOver((prev) => {
      const kept: Partial<Record<Key, boolean>> = {};
      for (const [key, value] of Object.entries(prev) as [Key, boolean | undefined][]) {
        if (value === undefined) continue;
        const cut = key.lastIndexOf(":");
        const server = Boolean(checkAt(nextChecks[key.slice(0, cut)], key.slice(cut + 1) as PaymentCheckKind));
        if (server !== value) kept[key] = value;
      }
      return kept;
    });
  }
  const [taxPending, startTax] = useTransition();
  const [bulkPending, startBulk] = useTransition();
  const [revertOpen, setRevertOpen] = useState(false);

  const editable = canManage && (status === "paying" || status === "paid");
  const isOn = (row: PrepRow, kind: PaymentCheckKind) =>
    over[`${row.userId}:${kind}`] ?? Boolean(checkAt(round.checks[row.userId], kind));
  const isDone = (row: PrepRow) =>
    row.paymentMethod === "cash" ? isOn(row, "received") : row.paymentMethod === "transfer" ? isOn(row, "transfer") : false;

  const cash = rows.filter((r) => r.paymentMethod === "cash");
  const transfer = rows.filter((r) => r.paymentMethod === "transfer");
  const other = rows.filter((r) => r.paymentMethod == null);
  const done = rows.filter(isDone).length;
  const anyCheck = rows.some((r) => isOn(r, "envelope") || isOn(r, "received") || isOn(r, "transfer"));
  const sumNet = (list: PrepRow[]) => list.reduce((s, r) => s + (r.net ?? 0), 0);
  const kindLabel = (kind: PaymentCheckKind) => (kind === "envelope" ? copy.envelope : kind === "received" ? copy.received : copy.transferDone);

  const setOverMany = (ids: string[], kind: PaymentCheckKind, value: boolean | undefined) =>
    setOver((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (value === undefined) delete next[`${id}:${kind}`];
        else next[`${id}:${kind}`] = value;
      }
      return next;
    });

  /** 체크 켜고 끄기 — 성공하면 「되돌리기」 토스트, 전원 끝나면 「지급이 모두 끝났어요」. */
  const write = async (row: PrepRow, kind: PaymentCheckKind, on: boolean, fromUndo = false) => {
    setOverMany([row.userId], kind, on);
    const res = await setPaymentChecks({ ym, userIds: [row.userId], kind, on }).catch(() => ({ ok: false as const, reason: "error" as const }));
    if (!res.ok) {
      setOverMany([row.userId], kind, undefined);
      onFail(res.reason);
      return;
    }
    if (res.status === "paid" && status !== "paid") {
      haptic("success");
      showToast({ kind: "done", text: copy.paidAllToast });
    } else if (fromUndo) {
      showToast({ kind: "done", text: copy.undone });
    } else if (on) {
      showToast({
        kind: "undo",
        text: fillCopy(copy.checkToast, { name: row.name, what: kindLabel(kind) }),
        onUndo: () => void write(row, kind, false, true),
      });
    } else {
      showToast({ kind: "done", text: fillCopy(copy.uncheckToast, { name: row.name, what: kindLabel(kind) }) });
    }
    refresh();
  };

  const toggle = (row: PrepRow, kind: PaymentCheckKind) => {
    if (!editable) return;
    const on = !isOn(row, kind);
    if (kind === "received" && on && !isOn(row, "envelope")) return;
    if (kind === "envelope" && !on && isOn(row, "received")) return;
    haptic("light");
    void write(row, kind, on);
  };

  const pendingTransfer = transfer.filter((r) => !isOn(r, "transfer"));
  const allTransferred = () => {
    if (!editable || pendingTransfer.length === 0 || bulkPending) return;
    const ids = pendingTransfer.map((r) => r.userId);
    haptic("light");
    setOverMany(ids, "transfer", true);
    startBulk(async () => {
      const res = await setPaymentChecks({ ym, userIds: ids, kind: "transfer", on: true }).catch(() => ({
        ok: false as const,
        reason: "error" as const,
      }));
      if (!res.ok) {
        setOverMany(ids, "transfer", undefined);
        onFail(res.reason);
        return;
      }
      haptic("success");
      const changed = res.changed;
      if (res.status === "paid" && status !== "paid") {
        showToast({ kind: "done", text: copy.paidAllToast });
      } else {
        showToast({
          kind: "undo",
          text: fillCopy(copy.allTransferredToast, { n: changed.length }),
          onUndo: () => void undoBulk(changed),
        });
      }
      refresh();
    });
  };
  const undoBulk = async (ids: string[]) => {
    if (ids.length === 0) return;
    setOverMany(ids, "transfer", false);
    const res = await setPaymentChecks({ ym, userIds: ids, kind: "transfer", on: false }).catch(() => ({
      ok: false as const,
      reason: "error" as const,
    }));
    if (!res.ok) {
      setOverMany(ids, "transfer", undefined);
      onFail(res.reason);
      return;
    }
    haptic("light");
    showToast({ kind: "done", text: copy.undone });
    refresh();
  };

  const sent = status === "sent_to_accountant";
  const taxEnabled = canManage && (status === "paid" || sent);
  const toggleTax = () => {
    if (!taxEnabled || taxPending) return;
    const on = !sent;
    haptic("light");
    startTax(async () => {
      const res = await setAccountantSent(ym, on).catch(() => ({ ok: false as const, reason: "error" as const }));
      if (!res.ok) {
        onFail(res.reason);
        return;
      }
      if (on) haptic("success");
      showToast({ kind: "done", text: on ? copy.taxSentToast : copy.evUnsent });
      refresh();
    });
  };

  const revert = async (reason: string): Promise<boolean> => {
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

  /** 이체 줄의 계좌 — 이체에는 확인한 계좌(확인 전이면 이전 계좌)를 쓴다. 계좌를 볼 권한이 없으면 그리지 않는다. */
  const canSeeBanks = Object.keys(banks).length > 0 || rows.some((r) => r.issues.includes("bank_missing"));
  const copyNumber = async (value: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // 권한 없음 — 아래 실패 알림
    }
    haptic(ok ? "light" : "error");
    showToast({ kind: ok ? "done" : "bad", text: ok ? copy.bankCopied : copy.errorSave });
  };
  const bankLine = (row: PrepRow) => {
    if (!canSeeBanks) return null;
    const bank = banks[row.userId];
    if (!bank) return <small className="mpr-bank__miss">{copy.issues.bank_missing}</small>;
    const acct = usableAccount(bank);
    return (
      <span className="mpr-bank">
        <small className="mpr-bank__b">
          {acct.bankName} {acct.branchName}
        </small>
        <span className="mpr-bank__n">
          <span className="num">
            {bankTypeLabel(bankCopy, acct.accountType)} {acct.accountNumber}
          </span>
          <button type="button" aria-label={copy.bankCopy} onClick={() => void copyNumber(acct.accountNumber)}>
            <Copy aria-hidden="true" />
          </button>
        </span>
        {bank.pending ? <small>{copy.bankBeforeConfirm}</small> : null}
      </span>
    );
  };

  /** 줄 아래 작은 글 — 마지막 체크의 사람 · 시각. */
  const meta = (row: PrepRow) => {
    const c: PaymentCheckState | undefined = round.checks[row.userId];
    if (!c) return null;
    if (row.paymentMethod === "cash") {
      if (c.receivedAt && isOn(row, "received")) return [copy.received, c.receivedBy, fmtStamp(localeTag, c.receivedAt)];
      if (c.envelopeAt && isOn(row, "envelope")) return [copy.envelopeShort, c.envelopeBy, fmtStamp(localeTag, c.envelopeAt)];
      return null;
    }
    if (c.transferredAt && isOn(row, "transfer")) return [c.transferredBy, fmtStamp(localeTag, c.transferredAt)];
    return null;
  };
  const metaLine = (row: PrepRow) => {
    const parts = meta(row)?.filter(Boolean);
    return parts && parts.length > 0 ? <small className="num">{parts.join(" · ")}</small> : null;
  };

  const ratio = rows.length > 0 ? done / rows.length : 0;
  const showRevert = status === "paying" && (canManage || round.viewerIsApprover) && !anyCheck;

  return (
    <div className="mpr-pay">
      <div className="mpr-pay__top">
        <div className="mpr-ap__h">
          <h2>{statusLabel(copy, status)}</h2>
          <span>
            {monthLabel} · {paydayLabel}
          </span>
        </div>
        {showRevert ? (
          <button
            type="button"
            className="mpr-lnk"
            onClick={() => {
              haptic("light");
              setRevertOpen(true);
            }}
          >
            {copy.revertAction}
          </button>
        ) : null}
      </div>

      <div className="mpr-prog">
        <div className="mpr-prog__n">
          <b className="num">{fillCopy(copy.payProgress, { done, n: rows.length })}</b>
          <span>{copy.payProgressLabel}</span>
        </div>
        <div
          className="mpr-track"
          role="progressbar"
          aria-label={copy.payProgressLabel}
          aria-valuemin={0}
          aria-valuemax={rows.length}
          aria-valuenow={done}
        >
          <i style={{ transform: `scaleX(${ratio})` }} />
        </div>
      </div>

      <div className="mpr-pay__cols">
        {cash.length > 0 ? (
          <section className="mpr-pgrp" aria-label={copy.cashGroup}>
            <div className="mpr-pgrp__h">
              <span>
                <b>
                  {copy.cashGroup} {fillCopy(copy.people, { n: cash.length })}
                </b>
                <span className="num">{yenMark(sumNet(cash))}</span>
              </span>
            </div>
            <p className="mpr-pgrp__hint">{copy.cashHint}</p>
            <ul>
              {cash.map((row) => {
                const env = isOn(row, "envelope");
                const rec = isOn(row, "received");
                return (
                  <li key={row.userId} className="mpr-prow mpr-prow--cash">
                    <span className="mpr-prow__nm">
                      <b>{row.name}</b>
                      {metaLine(row)}
                    </span>
                    <span className="mpr-prow__amt num">{row.net == null ? "—" : num(row.net)}</span>
                    <span className="mpr-prow__cks">
                      <CheckButton
                        ariaLabel={`${row.name} · ${copy.envelope}`}
                        disabled={!editable || rec}
                        label={copy.envelope}
                        on={env}
                        onClick={() => toggle(row, "envelope")}
                      />
                      <CheckButton
                        ariaLabel={`${row.name} · ${copy.received}`}
                        disabled={!editable || !env}
                        label={copy.received}
                        on={rec}
                        onClick={() => toggle(row, "received")}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {transfer.length > 0 || other.length > 0 ? (
          <section className="mpr-pgrp" aria-label={copy.transferGroup}>
            {transfer.length > 0 ? (
              <>
                <div className="mpr-pgrp__h">
                  <span>
                    <b>
                      {copy.transferGroup} {fillCopy(copy.people, { n: transfer.length })}
                    </b>
                    <span className="num">{yenMark(sumNet(transfer))}</span>
                  </span>
                  {editable && pendingTransfer.length > 0 ? (
                    <button type="button" className="mpr-lnk" disabled={bulkPending} aria-busy={bulkPending} onClick={allTransferred}>
                      {copy.allTransferred}
                    </button>
                  ) : null}
                </div>
                <ul>
                  {transfer.map((row) => (
                    <li key={row.userId} className="mpr-prow mpr-prow--tr">
                      <span className="mpr-prow__nm">
                        <b>{row.name}</b>
                        {bankLine(row)}
                        {metaLine(row)}
                      </span>
                      <span className="mpr-prow__amt num">{row.net == null ? "—" : num(row.net)}</span>
                      <span className="mpr-prow__cks">
                        <CheckButton
                          ariaLabel={`${row.name} · ${copy.transferDone}`}
                          disabled={!editable}
                          label={copy.transferDone}
                          on={isOn(row, "transfer")}
                          onClick={() => toggle(row, "transfer")}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {other.length > 0 ? (
              <>
                <div className="mpr-pgrp__h">
                  <span>
                    <b>
                      {copy.noMethod} {fillCopy(copy.people, { n: other.length })}
                    </b>
                    <span className="num">{yenMark(sumNet(other))}</span>
                  </span>
                </div>
                <ul>
                  {other.map((row) => (
                    <li key={row.userId} className="mpr-prow mpr-prow--tr">
                      <span className="mpr-prow__nm">
                        <b>{row.name}</b>
                      </span>
                      <span className="mpr-prow__amt num">{row.net == null ? "—" : num(row.net)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="mpr-tax">
        <CheckButton
          disabled={!taxEnabled || taxPending}
          label={copy.taxSend}
          on={sent}
          onClick={toggleTax}
        />
        {sent && round.sentAt ? (
          <small className="num">{[round.sentByName, fmtStamp(localeTag, round.sentAt)].filter(Boolean).join(" · ")}</small>
        ) : !taxEnabled ? (
          <small>{copy.taxSendHint}</small>
        ) : null}
      </div>

      <RoundHistory copy={copy} localeTag={localeTag} round={round} />

      {revertOpen ? (
        <ReasonSheet
          body={copy.revertBody}
          copy={copy}
          title={copy.revertAction}
          onClose={() => setRevertOpen(false)}
          onSubmit={revert}
        />
      ) : null}
    </div>
  );
}
