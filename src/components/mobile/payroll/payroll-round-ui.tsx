"use client";

import { useState, type FormEvent } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import type { ApprovalSlot, ApprovalSlotView, PayrollRound, PayrollRoundEvent, PayrollRoundStatus } from "@/lib/payroll-approval";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import type { PayrollToastState } from "./payroll-toast";

/**
 * 모바일 급여 P5 공용 조각 — 실패 문구 · 도장 칸 · 기록 · 사유 시트(시안 Approve-Phone · Return-Phone · Approve-Tablet, 2026-10-26).
 * 도메인 계약: docs/product/40 §4-3 ~ §6. 상태 전환은 모두 서버(`src/actions/payroll-approval`)가 정한다.
 */
export type ShowToast = (next: Omit<PayrollToastState, "id">) => void;

/** 서버 액션 실패 이유 → 화면 문구. `conflict` 는 부르는 쪽이 새로 고침까지 한다. */
export type RoundFail =
  | "forbidden"
  | "invalid"
  | "conflict"
  | "not_ready"
  | "no_approver"
  | "reason_required"
  | "has_checks"
  | "order"
  | "locked"
  | "error";

export function failText(copy: PayrollPrepCopy, reason: RoundFail): string {
  switch (reason) {
    case "forbidden":
      return copy.errorForbidden;
    case "conflict":
      return copy.errorConflict;
    case "not_ready":
      return copy.errorNotReady;
    case "no_approver":
      return copy.errorNoApprover;
    case "reason_required":
      return copy.reasonRequired;
    case "has_checks":
      return copy.errorHasChecks;
    case "order":
      return copy.errorOrder;
    case "locked":
      return copy.errorLocked;
    default:
      return copy.errorSave;
  }
}

export function slotLabel(copy: PayrollPrepCopy, slot: ApprovalSlot, short = false): string {
  if (slot === "senmu") return short ? copy.slotSenmuShort : copy.slotSenmu;
  return short ? copy.slotPresidentShort : copy.slotPresident;
}

export function statusLabel(copy: PayrollPrepCopy, status: PayrollRoundStatus): string {
  switch (status) {
    case "approval_senmu":
      return copy.stApprovalSenmu;
    case "approval_president":
      return copy.stApprovalPresident;
    case "paying":
      return copy.stPaying;
    case "paid":
      return copy.stPaid;
    case "sent_to_accountant":
      return copy.stSent;
    default:
      return copy.stPreparing;
  }
}

/** 도쿄 기준 「10/28 14:02」. */
export function fmtStamp(localeTag: string, iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(localeTag, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

function eventLabel(copy: PayrollPrepCopy, e: PayrollRoundEvent): string {
  const slot = e.slot ? slotLabel(copy, e.slot) : "";
  switch (e.action) {
    case "request":
      return copy.evRequest;
    case "cancel_request":
      return copy.evCancel;
    case "approve":
      return fillCopy(copy.evApprove, { slot });
    case "undo_approve":
      return fillCopy(copy.evUndo, { slot });
    case "return":
      return copy.evReturn;
    case "revert":
      return copy.evRevert;
    case "paid":
      return copy.evPaid;
    case "unpaid":
      return copy.evUnpaid;
    case "sent":
      return copy.evSent;
    case "unsent":
      return copy.evUnsent;
    default:
      return e.action;
  }
}

/** 결재 칸 — 전무(있을 때) · 사장. 찍힌 칸은 보라 동그라미에 이름 · 시각, 아닌 칸은 점선 「대기」. */
export function StampSlots({
  round,
  copy,
  localeTag,
  fresh,
  className,
}: {
  round: PayrollRound;
  copy: PayrollPrepCopy;
  localeTag: string;
  /** 방금 찍은 칸(서버 응답 전 · 직후) — 「찍힘」 움직임 + 서버 값이 오기 전에도 도장을 그린다. */
  fresh: { slot: ApprovalSlot; at: string } | null;
  className?: string;
}) {
  const slots: { slot: ApprovalSlot; view: ApprovalSlotView }[] = [];
  if (round.senmu) slots.push({ slot: "senmu", view: round.senmu });
  slots.push({ slot: "president", view: round.president });
  return (
    <ul className={`mpr-stamps${className ? ` ${className}` : ""}`} aria-label={copy.approvalTitle}>
      {slots.map(({ slot, view }) => {
        const isFresh = fresh?.slot === slot;
        const at = view.approvedAt ?? (isFresh ? fresh.at : null);
        const name = view.approvedByName ?? view.approverName ?? "—";
        return (
          <li key={slot} className="mpr-slot">
            {at ? (
              <span className={`mpr-stamp${isFresh ? " is-new" : ""}`}>
                <b>{name}</b>
                <small className="num">{fmtStamp(localeTag, at)}</small>
              </span>
            ) : (
              <span className="mpr-stamp is-wait">{copy.stampWaiting}</span>
            )}
            <em>{slotLabel(copy, slot, true)}</em>
          </li>
        );
      })}
    </ul>
  );
}

/** 기록 — 오래된 것부터, 결재 단계면 끝에 「○○ 결재 차례 · 이름」. */
export function RoundHistory({ round, copy, localeTag }: { round: PayrollRound; copy: PayrollPrepCopy; localeTag: string }) {
  const events = round.events.slice(0, 12).reverse();
  const turn = round.status === "approval_senmu" ? round.senmu : round.status === "approval_president" ? round.president : null;
  const turnSlot: ApprovalSlot | null = round.status === "approval_senmu" ? "senmu" : round.status === "approval_president" ? "president" : null;
  if (events.length === 0 && !turnSlot) return null;
  return (
    <section className="mpr-hist" aria-label={copy.historyTitle}>
      <h2 className="mpr-h2">{copy.historyTitle}</h2>
      <ol>
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <b>{eventLabel(copy, e)}</b>
            <span className="num">{[e.actorName, fmtStamp(localeTag, e.at)].filter(Boolean).join(" · ")}</span>
            {e.reason ? <span className="mpr-hist__why">{e.reason}</span> : null}
          </li>
        ))}
        {turnSlot ? (
          <li className="is-now">
            <b>{fillCopy(copy.turnOf, { slot: slotLabel(copy, turnSlot) })}</b>
            {turn?.approverName ? <span>{turn.approverName}</span> : null}
          </li>
        ) : null}
      </ol>
    </section>
  );
}

/** 돌려보내기 · 결재 되돌리기 사유 — 공용 BottomSheet, 이유 필수. `onSubmit` 이 true 면 시트를 닫는다. */
export function ReasonSheet({
  title,
  body,
  copy,
  onSubmit,
  onClose,
}: {
  title: string;
  body: string;
  copy: PayrollPrepCopy;
  onSubmit: (reason: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <BottomSheet ariaLabelledBy="mpr-reason-title" onClose={onClose}>
      {({ close }) => {
        const submit = async (event: FormEvent) => {
          event.preventDefault();
          if (pending) return;
          if (!reason.trim()) {
            haptic("error");
            setError(true);
            return;
          }
          setPending(true);
          const ok = await onSubmit(reason.trim());
          setPending(false);
          if (ok) close();
        };
        return (
          <form className="mpr-reason" onSubmit={submit}>
            <h2 id="mpr-reason-title">{title}</h2>
            <p>{body}</p>
            <label htmlFor="mpr-reason-text">{copy.reasonLabel}</label>
            <textarea
              id="mpr-reason-text"
              value={reason}
              maxLength={300}
              rows={4}
              aria-invalid={error || undefined}
              aria-describedby={error ? "mpr-reason-err" : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                if (error) setError(false);
              }}
            />
            {error ? (
              <span id="mpr-reason-err" className="mpr-reason__err" role="alert">
                {copy.reasonRequired}
              </span>
            ) : null}
            <button type="submit" className="mpr-btn mpr-btn--warn" disabled={pending} aria-busy={pending}>
              {title}
            </button>
          </form>
        );
      }}
    </BottomSheet>
  );
}

/** 체크 버튼 — 동그라미 안 체크가 160ms 에 그려진다(줄임 움직임이면 바로). */
export function CheckButton({
  on,
  label,
  ariaLabel,
  disabled,
  onClick,
  className,
}: {
  on: boolean;
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`mpr-ck${on ? " is-on" : ""}${className ? ` ${className}` : ""}`}
      aria-pressed={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="mpr-ck__o" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
        </svg>
      </span>
      <span className="mpr-ck__t">{label}</span>
    </button>
  );
}
