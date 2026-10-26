import "server-only";

import type { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  currentSlot,
  EMPTY_PAYMENT_CHECK,
  paidCount,
  parseRoundStatus,
  parseSnapshot,
  type ApprovalSlot,
  type PaymentCheckState,
  type PayrollRound,
  type PayrollRoundEvent,
  type PayrollRoundStatus,
  type PayrollSnapshot,
} from "@/lib/payroll-approval";
import type { PrepRow } from "@/lib/payroll-prep";
import type { OrgPayrollSettings } from "@/lib/payroll-settings-server";

/**
 * 알바 급여 P5 — 급여 회차 읽기(서버 전용, service role). 권한 확인은 부르는 쪽이 한다. docs/product/40 §6.
 */

type Service = ReturnType<typeof getSupabaseServiceClient>;

export const PAYROLL_APPROVAL_SELECT =
  "status, snapshot, requested_by, requested_at, senmu_approver_id, president_approver_id, senmu_approved_by, senmu_approved_at, president_approved_by, president_approved_at, paid_at, sent_by, sent_at";

export type ApprovalRow = {
  status: string;
  snapshot: unknown;
  requested_by: string | null;
  requested_at: string | null;
  senmu_approver_id: string | null;
  president_approver_id: string | null;
  senmu_approved_by: string | null;
  senmu_approved_at: string | null;
  president_approved_by: string | null;
  president_approved_at: string | null;
  paid_at: string | null;
  sent_by: string | null;
  sent_at: string | null;
};

type CheckRow = {
  user_id: string;
  envelope_by: string | null;
  envelope_at: string | null;
  received_by: string | null;
  received_at: string | null;
  transferred_by: string | null;
  transferred_at: string | null;
};

export const PAYMENT_CHECK_SELECT =
  "user_id, envelope_by, envelope_at, received_by, received_at, transferred_by, transferred_at";

export async function readApprovalRow(service: Service, organizationId: string, ym: string): Promise<ApprovalRow | null> {
  const { data, error } = await service
    .from("payroll_month_approvals")
    .select(PAYROLL_APPROVAL_SELECT)
    .eq("organization_id", organizationId)
    .eq("target_month", `${ym}-01`)
    .maybeSingle();
  if (error) {
    console.warn("[payroll-approval] round read failed:", error.message);
    return null;
  }
  return (data as ApprovalRow | null) ?? null;
}

export async function readPaymentCheckRows(service: Service, organizationId: string, ym: string): Promise<CheckRow[]> {
  const { data, error } = await service
    .from("payroll_payment_checks")
    .select(PAYMENT_CHECK_SELECT)
    .eq("organization_id", organizationId)
    .eq("target_month", `${ym}-01`);
  if (error) console.warn("[payroll-approval] checks read failed:", error.message);
  return (data ?? []) as CheckRow[];
}

/** 체크 줄 → 사람별 상태(누가 = id). 이름으로 바꾸는 건 `loadPayrollRound`. */
export function checksById(rows: readonly CheckRow[]): Record<string, PaymentCheckState> {
  const out: Record<string, PaymentCheckState> = {};
  for (const r of rows) {
    out[r.user_id] = {
      envelopeAt: r.envelope_at,
      envelopeBy: r.envelope_by,
      receivedAt: r.received_at,
      receivedBy: r.received_by,
      transferredAt: r.transferred_at,
      transferredBy: r.transferred_by,
    };
  }
  return out;
}

export type LoadedRound = {
  round: PayrollRound;
  /** 잠긴 달(결재 요청 이후)의 굳힌 값 — 급여 준비 단계면 null. */
  snapshot: PayrollSnapshot | null;
};

/**
 * 한 달 회차 + 지급 체크 + 기록. 줄이 없으면 「급여 준비」. 결재 칸의 결재자는 요청 때 적어 둔 값,
 * 아직 요청 전이면 지금 설정 › 급여 값을 보여 준다.
 */
export async function loadPayrollRound(
  service: Service,
  organizationId: string,
  ym: string,
  viewerId: string,
  org: Pick<OrgPayrollSettings, "senmuApproverId" | "presidentApproverId">,
  canApprove: boolean,
): Promise<LoadedRound> {
  const [row, checkRows, eventsRes] = await Promise.all([
    readApprovalRow(service, organizationId, ym),
    readPaymentCheckRows(service, organizationId, ym),
    service
      .from("payroll_month_approval_events")
      .select("action, slot, actor_user_id, reason, created_at")
      .eq("organization_id", organizationId)
      .eq("target_month", `${ym}-01`)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (eventsRes.error) console.warn("[payroll-approval] events read failed:", eventsRes.error.message);
  const status: PayrollRoundStatus = parseRoundStatus(row?.status);
  const locked = status !== "preparing";
  const snapshot = locked ? parseSnapshot(row?.snapshot) : null;
  const orgSenmu = org.senmuApproverId && org.senmuApproverId !== org.presidentApproverId ? org.senmuApproverId : null;
  const senmuId = locked ? (row?.senmu_approver_id ?? null) : orgSenmu;
  const presidentId = locked ? (row?.president_approver_id ?? null) : org.presidentApproverId;
  const events = (eventsRes.data ?? []) as {
    action: string;
    slot: string | null;
    actor_user_id: string | null;
    reason: string | null;
    created_at: string;
  }[];
  const ids = new Set<string>();
  for (const id of [
    senmuId,
    presidentId,
    row?.requested_by,
    row?.senmu_approved_by,
    row?.president_approved_by,
    row?.sent_by,
    ...events.map((e) => e.actor_user_id),
    ...checkRows.flatMap((c) => [c.envelope_by, c.received_by, c.transferred_by]),
  ]) {
    if (id) ids.add(id);
  }
  const names = new Map<string, string>();
  if (ids.size > 0) {
    const { data } = await service.from("profiles").select("id, name").in("id", Array.from(ids));
    for (const p of (data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name);
  }
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null);

  const checks: Record<string, PaymentCheckState> = {};
  for (const [userId, c] of Object.entries(checksById(checkRows))) {
    checks[userId] = {
      ...EMPTY_PAYMENT_CHECK,
      envelopeAt: c.envelopeAt,
      envelopeBy: nameOf(c.envelopeBy),
      receivedAt: c.receivedAt,
      receivedBy: nameOf(c.receivedBy),
      transferredAt: c.transferredAt,
      transferredBy: nameOf(c.transferredBy),
    };
  }
  const rows: PrepRow[] = snapshot?.rows ?? [];
  const roundEvents: PayrollRoundEvent[] = events.map((e) => ({
    action: e.action,
    slot: e.slot === "senmu" || e.slot === "president" ? e.slot : null,
    actorName: nameOf(e.actor_user_id),
    reason: e.reason,
    at: e.created_at,
  }));
  const slot = currentSlot(status);
  const turnId = slot === "senmu" ? senmuId : slot === "president" ? presidentId : null;
  const myTurn: ApprovalSlot | null = slot && canApprove && turnId === viewerId ? slot : null;
  const lastReturn = roundEvents.find((e) => e.action === "return" || e.action === "revert") ?? null;
  // 마지막 돌려보내기 뒤에 다시 요청했으면 그 이유는 지난 일이다.
  const lastRequest = roundEvents.find((e) => e.action === "request");
  const showReturn = status === "preparing" && lastReturn && (!lastRequest || lastRequest.at < lastReturn.at) ? lastReturn : null;

  return {
    snapshot,
    round: {
      status,
      requestedByName: locked ? nameOf(row?.requested_by) : null,
      requestedAt: locked ? (row?.requested_at ?? null) : null,
      senmu: senmuId
        ? {
            approverId: senmuId,
            approverName: nameOf(senmuId),
            approvedByName: locked ? nameOf(row?.senmu_approved_by) : null,
            approvedAt: locked ? (row?.senmu_approved_at ?? null) : null,
          }
        : null,
      president: {
        approverId: presidentId,
        approverName: nameOf(presidentId),
        approvedByName: locked ? nameOf(row?.president_approved_by) : null,
        approvedAt: locked ? (row?.president_approved_at ?? null) : null,
      },
      paidAt: row?.paid_at ?? null,
      sentAt: row?.sent_at ?? null,
      sentByName: nameOf(row?.sent_by),
      checks,
      paidPeople: paidCount(rows, checks),
      events: roundEvents,
      myTurn,
      viewerIsApprover: canApprove && (viewerId === senmuId || viewerId === presidentId),
      approversReady: Boolean(org.presidentApproverId),
      lastReturn: showReturn,
    },
  };
}

/** 그 달 급여가 결재 요청 이후인지 — 급여 준비 입력 · 근태 마감 풀기를 막는다(P5 잠금). */
export async function isPayrollMonthLocked(service: Service, organizationId: string, ym: string): Promise<boolean> {
  const row = await readApprovalRow(service, organizationId, ym);
  return parseRoundStatus(row?.status) !== "preparing";
}
