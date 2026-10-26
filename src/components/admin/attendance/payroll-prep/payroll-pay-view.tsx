"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { returnPayroll, setAccountantSent, setPaymentChecks } from "@/actions/payroll-approval";
import {
  exportPayrollBookReport,
  exportPayrollBookWorkbook,
  exportTaxAccountantReport,
  exportTaxAccountantWorkbook,
} from "@/actions/payroll-exports";
import { usableAccount } from "@/components/shared/payroll-bank/payroll-bank";
import { bankTypeLabel, getPayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { haptic } from "@/lib/haptics";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  anyPaymentCheck,
  checkAt,
  EMPTY_PAYMENT_CHECK,
  paidCount,
  type PaymentCheckKind,
  type PaymentCheckState,
} from "@/lib/payroll-approval";
import type { PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { getPayrollPrepCopy, type PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import { AdminExportButtons } from "../../shared/admin-export-buttons";
import { AdminReasonModal } from "../../shared/admin-reason-modal";
import type { RoundToast } from "./payroll-round-client";
import { formatPrepMonth, formatPrepPayday, formatPrepStamp, prepInitial } from "./prep-format";
import { roundFailMessage, stageHref } from "./round-ui";
import "./payroll-prep.css";

type Checks = Record<string, PaymentCheckState>;
/** 서버 답이 오기 전 화면에만 먼저 반영한 체크 — `${userId}:${kind}` → 켠 시각(끔 = null). */
type Pending = Record<string, string | null>;

const key = (userId: string, kind: PaymentCheckKind) => `${userId}:${kind}`;

function withPending(checks: Checks, pending: Pending): Checks {
  if (Object.keys(pending).length === 0) return checks;
  const out: Checks = { ...checks };
  for (const [k, stamp] of Object.entries(pending)) {
    const [userId, kind] = k.split(":") as [string, PaymentCheckKind];
    const cur = out[userId] ?? EMPTY_PAYMENT_CHECK;
    const on = stamp !== null;
    const at = on ? (checkAt(cur, kind) ?? stamp) : null;
    out[userId] =
      kind === "envelope"
        ? { ...cur, envelopeAt: at, envelopeBy: on ? cur.envelopeBy : null }
        : kind === "received"
          ? { ...cur, receivedAt: at, receivedBy: on ? cur.receivedBy : null }
          : { ...cur, transferredAt: at, transferredBy: on ? cur.transferredBy : null };
  }
  return out;
}

function kindLabel(copy: PayrollPrepCopy, kind: PaymentCheckKind) {
  return kind === "envelope" ? copy.envelope : kind === "received" ? copy.received : copy.transferDone;
}

/**
 * 지급 확인(PC) — 시안 「R · 제안 · PC 지급 확인」. 진행 막대 · 현금(봉투 넣음 → 본인 확인) · 이체(이체 완료 · 모두 이체 완료)
 * · 세무사 송부. 체크는 누르면 바로(화면 먼저) + 실행 취소 토스트. docs/product/40 §4-4 · §4-5.
 */
export function PayrollPayView({
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
  const copy = getPayrollPrepCopy(locale);
  const shared = getDictionary(locale).admin.shared;
  const { ym, round, rows, totals, payday } = data;
  const { announce, notice } = toast;

  const [pending, setPending] = useState<Pending>({});
  // 서버 체크가 새로 오면 서버에 이미 반영된 것만 버린다 — 아직 답을 기다리는 체크(연달아 누름)는 남겨 깜빡이지 않게.
  const [seen, setSeen] = useState(round.checks);
  if (seen !== round.checks) {
    setSeen(round.checks);
    setPending((p) => {
      const next: Pending = {};
      for (const [k, stamp] of Object.entries(p)) {
        const [userId, kind] = k.split(":") as [string, PaymentCheckKind];
        if (Boolean(checkAt(round.checks[userId], kind)) !== (stamp !== null)) next[k] = stamp;
      }
      return next;
    });
  }
  // 이번에 누른 체크만 그리기 모션을 탄다(처음 열 때 전부 그려지지 않게).
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [busy, startBusy] = useTransition();
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  const money = new Intl.NumberFormat(localeTag);
  const yen = (n: number | null) => fillCopy(copy.yen, { n: n == null ? "—" : money.format(n) });
  const stay = () => router.replace(stageHref(ym, "pay"), { scroll: false });

  const checks = withPending(round.checks, pending);
  const status = round.status;
  const sent = status === "sent_to_accountant";
  const canCheck = data.canManage && !sent && (status === "paying" || status === "paid");
  const done = paidCount(rows, checks);
  const pct = rows.length === 0 ? 0 : Math.round((done / rows.length) * 100);
  const canRevert = (data.canManage || round.viewerIsApprover) && status === "paying" && !anyPaymentCheck(round.checks) && Object.keys(pending).length === 0;

  const fail = (reason: string) => {
    if (reason === "conflict") router.refresh();
    notice(roundFailMessage(copy, reason));
  };

  function mark(ids: string[], kind: PaymentCheckKind, on: boolean) {
    const at = on ? new Date().toISOString() : null;
    setPending((p) => {
      const next = { ...p };
      for (const id of ids) next[key(id, kind)] = at;
      return next;
    });
    if (on) setFresh((f) => new Set([...f, ...ids.map((id) => key(id, kind))]));
  }
  function unmark(ids: string[], kind: PaymentCheckKind) {
    setPending((p) => {
      const next = { ...p };
      for (const id of ids) delete next[key(id, kind)];
      return next;
    });
  }

  /** 체크 켜고 끄기 — 화면 먼저 바꾸고, 실패하면 되돌린다. 실행 취소 = 같은 호출을 반대로. */
  function toggle(ids: string[], kind: PaymentCheckKind, on: boolean, message: string) {
    if (ids.length === 0) return;
    mark(ids, kind, on);
    startBusy(async () => {
      const wasPaid = status === "paid";
      const res = await setPaymentChecks({ ym, userIds: ids, kind, on });
      if (!res.ok) {
        unmark(ids, kind);
        return fail(res.reason);
      }
      stay();
      // 서버가 바꾼 사람만 되돌린다 — 이미 그 상태였으면(다른 사람이 먼저) 실행 취소를 주지 않는다.
      const changed = res.changed;
      if (changed.length === 0) {
        unmark(ids, kind);
        return notice(message);
      }
      announce(res.status === "paid" && !wasPaid ? copy.paidAllToast : message, async () => {
        mark(changed, kind, !on);
        const back = await setPaymentChecks({ ym, userIds: changed, kind, on: !on });
        if (!back.ok) {
          unmark(changed, kind);
          return fail(back.reason);
        }
        stay();
        notice(copy.undone);
      });
    });
  }

  function toggleOne(row: PrepRow, kind: PaymentCheckKind) {
    const on = !checkAt(checks[row.userId], kind);
    const what = kindLabel(copy, kind);
    toggle([row.userId], kind, on, fillCopy(on ? copy.checkToast : copy.uncheckToast, { name: row.name, what }));
  }

  function setSent(on: boolean) {
    startBusy(async () => {
      const res = await setAccountantSent(ym, on);
      if (!res.ok) return fail(res.reason);
      stay();
      if (!on) return notice(copy.undone);
      announce(copy.taxSentToast, async () => {
        const back = await setAccountantSent(ym, false);
        if (!back.ok) return fail(back.reason);
        stay();
        notice(copy.undone);
      });
    });
  }

  function revert(reason: string) {
    if (!reason.trim()) return setRevertError(copy.reasonRequired);
    setRevertError(null);
    startBusy(async () => {
      const res = await returnPayroll(ym, reason);
      if (!res.ok) {
        if (res.reason === "reason_required") return setRevertError(copy.reasonRequired);
        setReverting(false);
        return fail(res.reason);
      }
      setReverting(false);
      router.replace(stageHref(ym, "prep"), { scroll: false });
      notice(copy.returnedToast);
    });
  }

  const cash = rows.filter((r) => r.paymentMethod === "cash");
  const transfer = rows.filter((r) => r.paymentMethod === "transfer");
  const untransferred = transfer.filter((r) => !checks[r.userId]?.transferredAt).map((r) => r.userId);

  const stamps = [
    ...(round.senmu?.approvedAt ? [{ slot: copy.slotSenmu, name: round.senmu.approvedByName, at: round.senmu.approvedAt }] : []),
    ...(round.president.approvedAt
      ? [{ slot: copy.slotPresident, name: round.president.approvedByName, at: round.president.approvedAt }]
      : []),
  ];

  function meta(row: PrepRow): string {
    const c = checks[row.userId];
    if (!c) return "";
    const line = (label: string | null, by: string | null, at: string | null) =>
      at ? [label, [by, formatPrepStamp(at)].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "";
    if (row.paymentMethod === "cash") {
      if (c.receivedAt) return line(copy.received, c.receivedBy, c.receivedAt);
      return line(copy.envelopeShort, c.envelopeBy, c.envelopeAt);
    }
    return line(null, c.transferredBy, c.transferredAt);
  }

  function checkButton(row: PrepRow, kind: PaymentCheckKind) {
    const c = checks[row.userId];
    const on = Boolean(checkAt(c, kind));
    // 순서: 봉투를 넣어야 본인 확인, 본인 확인이 켜져 있으면 봉투를 못 풂.
    const blocked = (kind === "received" && !c?.envelopeAt) || (kind === "envelope" && Boolean(c?.receivedAt));
    const k = key(row.userId, kind);
    return (
      <button
        key={kind}
        type="button"
        className={`ppy-ck${on ? " on" : ""}${fresh.has(k) ? " fresh" : ""}`}
        aria-pressed={on}
        disabled={!canCheck || blocked}
        onClick={() => toggleOne(row, kind)}
      >
        <span className="ppy-ck__o" aria-hidden="true">
          {on ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
            </svg>
          ) : null}
        </span>
        {kindLabel(copy, kind)}
      </button>
    );
  }

  const bankCopy = getPayrollBankCopy(locale);
  async function copyNumber(value: string) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // 권한 없음 — 아래에서 실패로 알림
    }
    haptic(ok ? "light" : "error");
    notice(ok ? copy.bankCopied : copy.errorSave);
  }

  function accountCell(r: PrepRow) {
    const bank = data.banks[r.userId];
    if (!bank) return <span className="ppy-acct ppy-acct--none">{copy.issues.bank_missing}</span>;
    const a = usableAccount(bank);
    return (
      <span className="ppy-acct">
        <span className="ppy-acct__b ppr-jp">
          {a.bankName} {a.branchName}
        </span>
        <span className="ppy-acct__n">
          <span>
            {bankTypeLabel(bankCopy, a.accountType)} {a.accountNumber}
          </span>
          <button type="button" aria-label={copy.bankCopy} onClick={() => void copyNumber(a.accountNumber)}>
            <Copy aria-hidden="true" size={15} />
          </button>
        </span>
        {bank.pending ? <small>{copy.bankBeforeConfirm}</small> : null}
      </span>
    );
  }

  const row = (r: PrepRow, kinds: PaymentCheckKind[], withAccount = false) => (
    <div className={`ppy-row${withAccount ? " ppy-row--acct" : ""}`} key={r.userId}>
      <span className="ppr-who">
        <span className="ppr-av" aria-hidden="true">
          {prepInitial(r)}
        </span>
        <b>{r.name}</b>
      </span>
      <span className="ppr-r ppr-net">{yen(r.net)}</span>
      {withAccount ? accountCell(r) : null}
      <span className="ppy-cks">
        {kinds.map((k) => checkButton(r, k))}
      </span>
      <span className="ppy-meta">{meta(r)}</span>
    </div>
  );

  return (
    <div className="ppr ppy">
      <div className="ppr-title">
        <b>{fillCopy(copy.title, { month: formatPrepMonth(ym, localeTag) })}</b>
        <span>{fillCopy(copy.payday, { date: formatPrepPayday(payday.date, localeTag) })}</span>
      </div>

      <div className="ppy-head">
        {stamps.length > 0 ? (
          <p className="ppy-stamps">
            {copy.approvalTitle}{" "}
            {stamps.map((s, i) => (
              <span key={s.slot}>
                {i > 0 ? " · " : ""}
                <b>
                  {s.slot} {s.name ?? ""}
                </b>{" "}
                {formatPrepStamp(s.at)}
              </span>
            ))}
          </p>
        ) : null}
        {canRevert ? (
          <button
            type="button"
            className="ppr-lnk ppy-revert"
            onClick={() => {
              setRevertError(null);
              setReverting(true);
            }}
          >
            {copy.revertAction}
          </button>
        ) : null}
      </div>

      <div className="ppy-prog" role="status" aria-label={copy.payProgressLabel}>
        <b>{fillCopy(copy.payProgress, { done, n: rows.length })}</b>
        <span>{copy.payProgressLabel}</span>
        <span className="ppy-track" aria-hidden="true">
          <i style={{ transform: `scaleX(${pct / 100})` }} />
        </span>
      </div>

      {cash.length > 0 ? (
        <section aria-label={copy.cashGroup}>
          <div className="ppy-grp">
            <b>
              {copy.cashGroup} {fillCopy(copy.people, { n: cash.length })}
            </b>
            <span>{yen(totals.cash.net)}</span>
            <span className="ppy-grp__r">{copy.cashHint}</span>
          </div>
          {cash.map((r) => row(r, ["envelope", "received"]))}
        </section>
      ) : null}

      {transfer.length > 0 ? (
        <section aria-label={copy.transferGroup}>
          <div className="ppy-grp">
            <b>
              {copy.transferGroup} {fillCopy(copy.people, { n: transfer.length })}
            </b>
            <span>{yen(totals.transfer.net)}</span>
            {canCheck ? (
              <button
                type="button"
                className="ppr-btn sm ppy-grp__r"
                disabled={untransferred.length === 0}
                onClick={() =>
                  toggle(untransferred, "transfer", true, fillCopy(copy.allTransferredToast, { n: untransferred.length }))
                }
              >
                {copy.allTransferred}
              </button>
            ) : null}
          </div>
          {transfer.map((r) => row(r, ["transfer"], canViewBank))}
        </section>
      ) : null}

      <div className="ppy-tax">
        <button
          type="button"
          className={`ppy-ck${sent ? " on" : ""}`}
          aria-pressed={sent}
          disabled={!data.canManage || busy || !(status === "paid" || sent)}
          onClick={() => setSent(!sent)}
        >
          <span className="ppy-ck__o" aria-hidden="true">
            {sent ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : null}
          </span>
          {copy.taxSend}
        </button>
        <span className="ppy-tax__t">
          {sent ? (
            <small>{[round.sentByName, formatPrepStamp(round.sentAt)].filter(Boolean).join(" · ")}</small>
          ) : status === "paid" ? null : (
            <small>{copy.taxSendHint}</small>
          )}
        </span>
        <span className="ppy-tax__files">
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
          <span className="ppr-file" title={copy.fileTaxHint}>
            <span className="ppr-file__l">{copy.taxFiles}</span>
            <AdminExportButtons
              labels={shared}
              disabled={rows.length === 0}
              onExportXls={() => exportTaxAccountantWorkbook(ym)}
              onExportPdf={() => exportTaxAccountantReport(ym)}
              onToast={notice}
            />
          </span>
        </span>
      </div>

      {reverting ? (
        <AdminReasonModal
          title={copy.revertAction}
          description={copy.revertBody}
          placeholder={copy.reasonLabel}
          confirmLabel={copy.revertAction}
          cancelLabel={copy.cancel}
          pending={busy}
          errorText={revertError}
          danger
          onConfirm={revert}
          onCancel={() => setReverting(false)}
        />
      ) : null}
    </div>
  );
}
