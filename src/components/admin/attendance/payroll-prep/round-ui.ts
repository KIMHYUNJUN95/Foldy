import type { ApprovalSlot, PayrollRoundEvent, PayrollRoundStatus } from "@/lib/payroll-approval";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { fillCopy } from "@/lib/payroll-settings-i18n";

// P5 결재 · 지급 화면(PC)이 같이 쓰는 문구 고르기 — 순수 함수만.

export type PrepStage = "close" | "prep" | "approval" | "pay";

export const PAYROLL_PATH = "/admin/attendance/payroll";

export function stageHref(ym: string, stage: PrepStage): string {
  return `${PAYROLL_PATH}?ym=${ym}&stage=${stage}`;
}

/** 결재 단계가 열렸는지(요청 이후 전부). */
export function approvalOpen(status: PayrollRoundStatus): boolean {
  return status !== "preparing";
}

/** 지급 단계가 열렸는지(사장 결재 이후). */
export function payOpen(status: PayrollRoundStatus): boolean {
  return status === "paying" || status === "paid" || status === "sent_to_accountant";
}

/** 서버 액션 실패 이유 → 문구. 모르는 이유는 저장 실패로. */
export function roundFailMessage(copy: PayrollPrepCopy, reason: string): string {
  switch (reason) {
    case "forbidden":
      return copy.errorForbidden;
    case "conflict":
      return copy.errorConflict;
    case "has_checks":
      return copy.errorHasChecks;
    case "order":
      return copy.errorOrder;
    case "not_ready":
      return copy.errorNotReady;
    case "no_approver":
      return copy.errorNoApprover;
    case "reason_required":
      return copy.reasonRequired;
    case "locked":
      return copy.errorLocked;
    default:
      return copy.errorSave;
  }
}

export function slotLabel(copy: PayrollPrepCopy, slot: ApprovalSlot): string {
  return slot === "senmu" ? copy.slotSenmu : copy.slotPresident;
}

export function eventLabel(copy: PayrollPrepCopy, ev: PayrollRoundEvent): string {
  const slot = ev.slot ? slotLabel(copy, ev.slot) : "";
  switch (ev.action) {
    case "request":
      return copy.evRequest;
    case "cancel_request":
      return copy.evCancel;
    case "approve":
      return fillCopy(copy.evApprove, { slot }).trim();
    case "undo_approve":
      return fillCopy(copy.evUndo, { slot }).trim();
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
      return ev.action;
  }
}
