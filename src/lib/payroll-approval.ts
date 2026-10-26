import type { PrepRow, PrepTotals } from "@/lib/payroll-prep";
import type { Payday } from "@/lib/payroll-settings-rules";

/**
 * 알바 급여 P5 — 결재 · 지급 확인 규칙(DB 없음, 순수). docs/product/40 §4-3 ~ §6, 39 「P5 구현」.
 *
 * 급여 회차 상태: 급여 준비 → 전무 결재 → 사장 결재 → 지급 중 → 지급 완료 → 세무사 송부.
 * 「결재 요청」 순간 급여 준비 값을 스냅샷으로 굳힌다 — 그 뒤로는 입력이 잠기고, 결재 · 지급 확인 · 출력이 모두 스냅샷을 쓴다.
 * 고치려면 돌려보내기 · 결재 되돌리기(사유) → 급여 준비(스냅샷을 버림).
 */

export const PAYROLL_ROUND_STATUSES = [
  "preparing",
  "approval_senmu",
  "approval_president",
  "paying",
  "paid",
  "sent_to_accountant",
] as const;

export type PayrollRoundStatus = (typeof PAYROLL_ROUND_STATUSES)[number];
export type ApprovalSlot = "senmu" | "president";
export type PaymentCheckKind = "envelope" | "received" | "transfer";

export function parseRoundStatus(v: unknown): PayrollRoundStatus {
  return (PAYROLL_ROUND_STATUSES as readonly unknown[]).includes(v) ? (v as PayrollRoundStatus) : "preparing";
}

/** 결재가 시작되면(요청 이후 전부) 급여 준비 입력 · 근태 마감 풀기가 잠긴다. */
export function isRoundLocked(status: PayrollRoundStatus): boolean {
  return status !== "preparing";
}

/** 지금 차례인 결재 칸 — 결재 단계가 아니면 null. */
export function currentSlot(status: PayrollRoundStatus): ApprovalSlot | null {
  if (status === "approval_senmu") return "senmu";
  if (status === "approval_president") return "president";
  return null;
}

/** 결재 요청 뒤 첫 단계 — 전무 결재자가 없으면(사장이 겸함) 바로 사장 칸. */
export function firstApprovalStatus(senmuApproverId: string | null): PayrollRoundStatus {
  return senmuApproverId ? "approval_senmu" : "approval_president";
}

/** 결재 칸을 하나 넘긴 다음 상태. */
export function statusAfterApprove(slot: ApprovalSlot): PayrollRoundStatus {
  return slot === "senmu" ? "approval_president" : "paying";
}

/** 결재 요청을 열 수 있는지 — 사람이 있고, 확인 필요 0, 모두 계산됨, 근태 마감 끝. */
export function canRequestApproval(rows: readonly PrepRow[], totals: PrepTotals): boolean {
  return rows.length > 0 && totals.needsCheck === 0 && totals.uncalculated === 0 && rows.every((r) => r.finalized);
}

export type PaymentCheckState = {
  envelopeAt: string | null;
  envelopeBy: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  transferredAt: string | null;
  transferredBy: string | null;
};

export const EMPTY_PAYMENT_CHECK: PaymentCheckState = {
  envelopeAt: null,
  envelopeBy: null,
  receivedAt: null,
  receivedBy: null,
  transferredAt: null,
  transferredBy: null,
};

/** 한 사람 지급이 끝났는지 — 현금은 본인 확인까지, 이체는 이체 완료. 지급 방식이 없으면(스냅샷엔 없음) 끝나지 않음. */
export function paymentDone(method: PrepRow["paymentMethod"], check: PaymentCheckState | undefined): boolean {
  if (!check) return false;
  if (method === "cash") return Boolean(check.receivedAt);
  if (method === "transfer") return Boolean(check.transferredAt);
  return false;
}

/** 이 체크가 이 사람의 지급 방식에 맞는지 — 현금은 봉투 · 본인 확인, 이체는 이체 완료만. */
export function checkFitsMethod(method: PrepRow["paymentMethod"], kind: PaymentCheckKind): boolean {
  return method === "cash" ? kind === "envelope" || kind === "received" : method === "transfer" ? kind === "transfer" : false;
}

export function paidCount(rows: readonly PrepRow[], checks: Readonly<Record<string, PaymentCheckState>>): number {
  return rows.filter((r) => paymentDone(r.paymentMethod, checks[r.userId])).length;
}

/** 아무 체크라도 있는지 — 있으면 결재를 되돌릴 수 없다(돈이 이미 움직였을 수 있음). */
export function anyPaymentCheck(checks: Readonly<Record<string, PaymentCheckState>>): boolean {
  return Object.values(checks).some((c) => c.envelopeAt || c.receivedAt || c.transferredAt);
}

/** 결재 요청 때 굳히는 값 — 화면 · 지급 확인 · 출력이 결재 이후 이것만 쓴다. */
export type PayrollSnapshot = {
  v: 1;
  rows: PrepRow[];
  totals: PrepTotals;
  payday: Payday;
  companyName: string;
  takenAt: string;
};

export function parseSnapshot(v: unknown): PayrollSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<PayrollSnapshot>;
  if (s.v !== 1 || !Array.isArray(s.rows) || !s.totals || !s.payday || typeof s.payday.date !== "string") return null;
  return {
    v: 1,
    rows: s.rows,
    totals: s.totals,
    payday: s.payday,
    companyName: typeof s.companyName === "string" ? s.companyName : "",
    takenAt: typeof s.takenAt === "string" ? s.takenAt : "",
  };
}

/** 결재 칸 하나 — 칸을 안 쓰면(전무 결재자 없음) 회차에서 null. */
export type ApprovalSlotView = {
  approverId: string | null;
  approverName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
};

export type PayrollRoundEvent = {
  action: string;
  slot: ApprovalSlot | null;
  actorName: string | null;
  reason: string | null;
  at: string;
};

/** 화면 · 출력이 보는 회차. 숫자(rows · totals)는 `PayrollPrepData` 쪽 — 잠긴 달이면 이미 스냅샷 값이다. */
export type PayrollRound = {
  status: PayrollRoundStatus;
  requestedByName: string | null;
  requestedAt: string | null;
  senmu: ApprovalSlotView | null;
  president: ApprovalSlotView;
  paidAt: string | null;
  sentAt: string | null;
  sentByName: string | null;
  /** 사람 → 지급 체크. 체크한 사람 이름은 `*By` 에 이름으로 들어간다. */
  checks: Record<string, PaymentCheckState>;
  paidPeople: number;
  /** 최근 것부터. */
  events: PayrollRoundEvent[];
  /** 지금 보는 사람이 이 회차의 전무 · 사장 결재자인지(`payroll.approve` 도 있음) — 「결재 되돌리기」 보이기. */
  viewerIsApprover: boolean;
  /** 지금 보는 사람이 결재할 차례인 칸. */
  myTurn: ApprovalSlot | null;
  /** 설정 › 급여에 사장 결재자가 있는지 — 없으면 결재 요청을 못 한다. */
  approversReady: boolean;
  /** 마지막 돌려보내기 · 되돌리기 — 급여 준비에서 이유를 보여 준다. */
  lastReturn: PayrollRoundEvent | null;
};

/** 「봉투 넣음」 · 「본인 확인」 · 「이체 완료」 중 체크된 시각. */
export function checkAt(check: PaymentCheckState | undefined, kind: PaymentCheckKind): string | null {
  if (!check) return null;
  return kind === "envelope" ? check.envelopeAt : kind === "received" ? check.receivedAt : check.transferredAt;
}
