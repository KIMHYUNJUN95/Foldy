"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";
import { bestEffortWrite } from "@/lib/db-write-guard";
import {
  anyPaymentCheck,
  canRequestApproval,
  checkFitsMethod,
  currentSlot,
  EMPTY_PAYMENT_CHECK,
  firstApprovalStatus,
  paidCount,
  parseRoundStatus,
  parseSnapshot,
  statusAfterApprove,
  type ApprovalSlot,
  type PaymentCheckKind,
  type PayrollRoundStatus,
  type PayrollSnapshot,
} from "@/lib/payroll-approval";
import { checksById, readApprovalRow, readPaymentCheckRows } from "@/lib/payroll-approval-server";
import { payrollPrepAvailable } from "@/lib/payroll-prep";
import { loadPrepRows } from "@/lib/payroll-prep-server";
import { loadOrgPayrollSettings } from "@/lib/payroll-settings-server";
import { paydayFor } from "@/lib/payroll-settings-rules";

/**
 * 알바 급여 P5 — 결재 · 지급 확인 · 세무사 송부(PC 근태 › 급여 · 모바일 급여가 같이 부른다 → src/actions).
 * docs/product/40 §4-3 ~ §6, 39 「P5 구현」.
 *
 * - 결재 요청 · 요청 취소 · 지급 체크 · 송부 = `payroll.manage`
 * - 결재 · 결재 되돌리기(내 결재 취소) · 돌려보내기 = `payroll.approve` + 그 칸의 결재자(설정 › 급여, 요청 때 적어 둔 값)
 * 상태 전환은 모두 「지금 상태가 이것일 때만」 조건으로 쓴다(`eq status`) — 두 사람이 동시에 눌러도 한 번만 넘어간다.
 * 막히면 redirect 대신 `forbidden`.
 */

type Fail =
  | "forbidden"
  | "invalid"
  | "conflict"
  | "not_ready"
  | "no_approver"
  | "reason_required"
  | "has_checks"
  | "order"
  | "error";

export type PayrollRoundActionResult = { ok: true; status: PayrollRoundStatus } | { ok: false; reason: Fail };

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_REASON = 300;

type Ctx = {
  organizationId: string;
  actorId: string;
  service: ReturnType<typeof getSupabaseServiceClient>;
};

async function context(ym: unknown, capability: "payroll.manage" | "payroll.approve"): Promise<Ctx | Fail> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return "forbidden";
  if (typeof ym !== "string" || !YM_RE.test(ym) || !payrollPrepAvailable(ym)) return "invalid";
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  if (!(await attendanceCan(service, organizationId, session.user.id, capability))) return "forbidden";
  return { organizationId, actorId: session.user.id, service };
}

function revalidate() {
  revalidatePath("/admin/attendance/payroll");
  revalidatePath("/mobile/payroll");
}

async function logEvent(
  ctx: Ctx,
  ym: string,
  action: string,
  extra: { slot?: ApprovalSlot | null; reason?: string | null } = {},
) {
  await bestEffortWrite(
    "payroll_month_approval_events: insert",
    ctx.service.from("payroll_month_approval_events").insert({
      organization_id: ctx.organizationId,
      target_month: `${ym}-01`,
      action,
      slot: extra.slot ?? null,
      actor_user_id: ctx.actorId,
      reason: extra.reason ?? null,
    }),
  );
}

/** 지금 상태가 `from` 일 때만 바꾼다. 바뀐 줄이 없으면 누가 먼저 바꾼 것 → conflict. */
async function transition(
  ctx: Ctx,
  ym: string,
  from: PayrollRoundStatus,
  patch: Record<string, unknown>,
): Promise<"ok" | "conflict" | "error"> {
  const res = await ctx.service
    .from("payroll_month_approvals")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organizationId)
    .eq("target_month", `${ym}-01`)
    .eq("status", from)
    .select("status");
  if (res.error) {
    console.error("[payroll-approval] transition failed:", res.error.message);
    return "error";
  }
  return (res.data ?? []).length > 0 ? "ok" : "conflict";
}

const CLEARED = {
  status: "preparing",
  snapshot: null,
  requested_by: null,
  requested_at: null,
  senmu_approver_id: null,
  president_approver_id: null,
  senmu_approved_by: null,
  senmu_approved_at: null,
  president_approved_by: null,
  president_approved_at: null,
  paid_at: null,
  sent_by: null,
  sent_at: null,
};

function cleanReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= MAX_REASON ? t : null;
}

/** 결재 요청 — 지금 값으로 다시 셈해 확인 필요가 0 이면 스냅샷을 굳히고 첫 결재 칸으로. */
export async function requestPayrollApproval(ym: string): Promise<PayrollRoundActionResult> {
  const ctx = await context(ym, "payroll.manage");
  if (typeof ctx === "string") return { ok: false, reason: ctx };
  const [row, org] = await Promise.all([
    readApprovalRow(ctx.service, ctx.organizationId, ym),
    loadOrgPayrollSettings(ctx.service, ctx.organizationId),
  ]);
  if (row && parseRoundStatus(row.status) !== "preparing") return { ok: false, reason: "conflict" };
  if (!org.presidentApproverId) return { ok: false, reason: "no_approver" };

  const payday = paydayFor(ym, org.payDay);
  const live = await loadPrepRows(ctx.service, ctx.organizationId, ym, payday, org.employmentInsuranceRates);
  if (!canRequestApproval(live.rows, live.totals)) return { ok: false, reason: "not_ready" };

  const now = new Date().toISOString();
  const snapshot: PayrollSnapshot = {
    v: 1,
    rows: live.rows,
    totals: live.totals,
    payday,
    companyName: org.companyName,
    takenAt: now,
  };
  // 한 사람이 두 칸을 겸하지 않는다 — 전무 = 사장이면 사장 칸만(문서 40 §4-3).
  const senmuId = org.senmuApproverId && org.senmuApproverId !== org.presidentApproverId ? org.senmuApproverId : null;
  const status = firstApprovalStatus(senmuId);
  const values = {
    status,
    snapshot,
    requested_by: ctx.actorId,
    requested_at: now,
    senmu_approver_id: senmuId,
    president_approver_id: org.presidentApproverId,
    senmu_approved_by: null,
    senmu_approved_at: null,
    president_approved_by: null,
    president_approved_at: null,
    paid_at: null,
    sent_by: null,
    sent_at: null,
  };
  if (row) {
    const r = await transition(ctx, ym, "preparing", values);
    if (r !== "ok") return { ok: false, reason: r };
  } else {
    const ins = await ctx.service.from("payroll_month_approvals").insert({
      organization_id: ctx.organizationId,
      target_month: `${ym}-01`,
      ...values,
      updated_at: now,
    });
    // 같은 달 줄이 막 생겼으면(동시에 두 번) 기본 키가 막는다.
    if (ins.error) return { ok: false, reason: ins.error.code === "23505" ? "conflict" : "error" };
  }
  // 지난 회차의 지급 체크가 남아 있으면 지운다(돌려보내기 뒤 다시 요청 — 체크가 있으면 되돌릴 수 없으니 보통 없음).
  await ctx.service
    .from("payroll_payment_checks")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("target_month", `${ym}-01`);
  await logEvent(ctx, ym, "request");
  revalidate();
  return { ok: true, status };
}

/** 결재 요청 취소(되돌리기) — 아직 아무도 결재하지 않았을 때만. */
export async function cancelPayrollApprovalRequest(ym: string): Promise<PayrollRoundActionResult> {
  const ctx = await context(ym, "payroll.manage");
  if (typeof ctx === "string") return { ok: false, reason: ctx };
  const row = await readApprovalRow(ctx.service, ctx.organizationId, ym);
  const status = parseRoundStatus(row?.status);
  if (!row || !currentSlot(status) || row.senmu_approved_at || row.president_approved_at) {
    return { ok: false, reason: "conflict" };
  }
  const r = await transition(ctx, ym, status, CLEARED);
  if (r !== "ok") return { ok: false, reason: r };
  await logEvent(ctx, ym, "cancel_request");
  revalidate();
  return { ok: true, status: "preparing" };
}

/** 결재 — 지금 차례 칸의 결재자만. 전무 → 사장 결재 단계, 사장 → 지급 중. */
export async function approvePayroll(ym: string): Promise<PayrollRoundActionResult & { slot?: ApprovalSlot }> {
  const ctx = await context(ym, "payroll.approve");
  if (typeof ctx === "string") return { ok: false, reason: ctx };
  const row = await readApprovalRow(ctx.service, ctx.organizationId, ym);
  const status = parseRoundStatus(row?.status);
  const slot = currentSlot(status);
  if (!row || !slot) return { ok: false, reason: "conflict" };
  const approverId = slot === "senmu" ? row.senmu_approver_id : row.president_approver_id;
  if (approverId !== ctx.actorId) return { ok: false, reason: "forbidden" };
  const next = statusAfterApprove(slot);
  const now = new Date().toISOString();
  const r = await transition(
    ctx,
    ym,
    status,
    slot === "senmu"
      ? { status: next, senmu_approved_by: ctx.actorId, senmu_approved_at: now }
      : { status: next, president_approved_by: ctx.actorId, president_approved_at: now },
  );
  if (r !== "ok") return { ok: false, reason: r };
  await logEvent(ctx, ym, "approve", { slot });
  revalidate();
  return { ok: true, status: next, slot };
}

/** 내 결재 되돌리기(토스트) — 다음 칸이 아직 움직이지 않았을 때만. 사장 결재는 지급 체크가 없을 때만. */
export async function undoPayrollApproval(ym: string, slot: ApprovalSlot): Promise<PayrollRoundActionResult> {
  if (slot !== "senmu" && slot !== "president") return { ok: false, reason: "invalid" };
  const ctx = await context(ym, "payroll.approve");
  if (typeof ctx === "string") return { ok: false, reason: ctx };
  const row = await readApprovalRow(ctx.service, ctx.organizationId, ym);
  if (!row) return { ok: false, reason: "conflict" };
  const status = parseRoundStatus(row.status);
  if (slot === "senmu") {
    if (status !== "approval_president" || row.senmu_approved_by !== ctx.actorId) return { ok: false, reason: "conflict" };
    const r = await transition(ctx, ym, status, { status: "approval_senmu", senmu_approved_by: null, senmu_approved_at: null });
    if (r !== "ok") return { ok: false, reason: r };
  } else {
    if (status !== "paying" || row.president_approved_by !== ctx.actorId) return { ok: false, reason: "conflict" };
    const checks = checksById(await readPaymentCheckRows(ctx.service, ctx.organizationId, ym));
    if (anyPaymentCheck(checks)) return { ok: false, reason: "has_checks" };
    const r = await transition(ctx, ym, status, {
      status: "approval_president",
      president_approved_by: null,
      president_approved_at: null,
    });
    if (r !== "ok") return { ok: false, reason: r };
  }
  await logEvent(ctx, ym, "undo_approve", { slot });
  revalidate();
  return { ok: true, status: slot === "senmu" ? "approval_senmu" : "approval_president" };
}

/**
 * 돌려보내기(결재 단계) · 결재 되돌리기(지급 중, 체크 전) — 사유 필수, 급여 준비로(스냅샷 · 결재를 버림).
 * 결재 단계 = 이 회차의 전무 · 사장 결재자(`payroll.approve`). 지급 중 = 그 결재자 또는 급여 담당(`payroll.manage`).
 */
export async function returnPayroll(ym: string, reason: string): Promise<PayrollRoundActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "forbidden" };
  if (typeof ym !== "string" || !YM_RE.test(ym) || !payrollPrepAvailable(ym)) return { ok: false, reason: "invalid" };
  const why = cleanReason(reason);
  if (!why) return { ok: false, reason: "reason_required" };
  const service = getSupabaseServiceClient();
  const ctx: Ctx = { organizationId: session.organization.id, actorId: session.user.id, service };
  const [canApprove, canManage, row] = await Promise.all([
    attendanceCan(service, ctx.organizationId, ctx.actorId, "payroll.approve"),
    attendanceCan(service, ctx.organizationId, ctx.actorId, "payroll.manage"),
    readApprovalRow(service, ctx.organizationId, ym),
  ]);
  if (!canApprove && !canManage) return { ok: false, reason: "forbidden" };
  if (!row) return { ok: false, reason: "conflict" };
  const status = parseRoundStatus(row.status);
  const slot = currentSlot(status);
  if (!slot && status !== "paying") return { ok: false, reason: "conflict" };
  const isApprover = canApprove && (ctx.actorId === row.senmu_approver_id || ctx.actorId === row.president_approver_id);
  if (slot ? !isApprover : !(isApprover || canManage)) return { ok: false, reason: "forbidden" };
  if (status === "paying") {
    const checks = checksById(await readPaymentCheckRows(service, ctx.organizationId, ym));
    if (anyPaymentCheck(checks)) return { ok: false, reason: "has_checks" };
  }
  const r = await transition(ctx, ym, status, CLEARED);
  if (r !== "ok") return { ok: false, reason: r };
  await logEvent(ctx, ym, slot ? "return" : "revert", { slot, reason: why });
  revalidate();
  return { ok: true, status: "preparing" };
}

export type PaymentCheckResult =
  | { ok: true; status: PayrollRoundStatus; changed: string[] }
  | { ok: false; reason: Fail };

/**
 * 지급 체크 켜고 끄기 — 한 사람(봉투 · 본인 확인 · 이체) 또는 여러 사람의 이체(「모두 이체 완료」 · 그 되돌리기).
 * 전원 끝나면 「지급 완료」, 끝난 뒤 하나를 풀면 「지급 중」으로. 세무사에 보낸 뒤엔 못 바꿈.
 */
export async function setPaymentChecks(input: {
  ym: string;
  userIds: string[];
  kind: PaymentCheckKind;
  on: boolean;
}): Promise<PaymentCheckResult> {
  const ctx = await context(input?.ym, "payroll.manage");
  if (typeof ctx === "string") return { ok: false, reason: ctx };
  const { ym, kind, on } = input;
  if (
    !Array.isArray(input.userIds) ||
    input.userIds.length === 0 ||
    input.userIds.length > 500 ||
    !input.userIds.every((id) => typeof id === "string" && id) ||
    (kind !== "envelope" && kind !== "received" && kind !== "transfer") ||
    typeof on !== "boolean"
  ) {
    return { ok: false, reason: "invalid" };
  }
  const row = await readApprovalRow(ctx.service, ctx.organizationId, ym);
  const status = parseRoundStatus(row?.status);
  if (status !== "paying" && status !== "paid") return { ok: false, reason: "conflict" };
  const snapshot = parseSnapshot(row?.snapshot);
  if (!snapshot) return { ok: false, reason: "error" };
  const methodOf = new Map(snapshot.rows.map((r) => [r.userId, r.paymentMethod]));
  for (const id of input.userIds) {
    if (!methodOf.has(id) || !checkFitsMethod(methodOf.get(id) ?? null, kind)) return { ok: false, reason: "invalid" };
  }

  const checks = checksById(await readPaymentCheckRows(ctx.service, ctx.organizationId, ym));
  const now = new Date().toISOString();
  const changed: string[] = [];
  for (const userId of input.userIds) {
    const cur = checks[userId];
    const isOn =
      kind === "envelope" ? Boolean(cur?.envelopeAt) : kind === "received" ? Boolean(cur?.receivedAt) : Boolean(cur?.transferredAt);
    if (isOn === on) continue;
    // 순서: 봉투를 넣어야 본인 확인, 본인 확인을 풀어야 봉투를 풂.
    if (kind === "received" && on && !cur?.envelopeAt) return { ok: false, reason: "order" };
    if (kind === "envelope" && !on && cur?.receivedAt) return { ok: false, reason: "order" };
    const by = on ? ctx.actorId : null;
    const at = on ? now : null;
    const patch =
      kind === "envelope"
        ? { envelope_by: by, envelope_at: at }
        : kind === "received"
          ? { received_by: by, received_at: at }
          : { transferred_by: by, transferred_at: at };
    const res = await ctx.service.from("payroll_payment_checks").upsert(
      {
        organization_id: ctx.organizationId,
        user_id: userId,
        target_month: `${ym}-01`,
        ...patch,
        updated_at: now,
      },
      { onConflict: "organization_id,user_id,target_month" },
    );
    if (res.error) {
      console.error("[payroll-approval] check upsert failed:", res.error.message);
      return { ok: false, reason: "error" };
    }
    checks[userId] = {
      ...(cur ?? EMPTY_PAYMENT_CHECK),
      ...(kind === "envelope"
        ? { envelopeAt: at, envelopeBy: by }
        : kind === "received"
          ? { receivedAt: at, receivedBy: by }
          : { transferredAt: at, transferredBy: by }),
    };
    changed.push(userId);
  }
  if (changed.length > 0) {
    await bestEffortWrite(
      "audit_logs: payroll_payment_check",
      ctx.service.from("audit_logs").insert({
        organization_id: ctx.organizationId,
        actor_user_id: ctx.actorId,
        action: "payroll_payment_check",
        target_type: "payroll_payment_checks",
        target_id: changed[0],
        metadata: { ym, kind, on, user_ids: changed },
      }),
    );
  }

  // 전원 끝났는지 다시 본다.
  const allDone = paidCount(snapshot.rows, checks) === snapshot.rows.length;
  let next: PayrollRoundStatus = status;
  if (allDone && status === "paying") {
    const r = await transition(ctx, ym, "paying", { status: "paid", paid_at: now });
    if (r === "ok") {
      next = "paid";
      await logEvent(ctx, ym, "paid");
    }
  } else if (!allDone && status === "paid") {
    const r = await transition(ctx, ym, "paid", { status: "paying", paid_at: null });
    if (r === "ok") {
      next = "paying";
      await logEvent(ctx, ym, "unpaid");
    }
  }
  revalidate();
  return { ok: true, status: next, changed };
}

/** 세무사 「보냄」 체크 — 지급 완료 뒤에만. 끄면 지급 완료로. */
export async function setAccountantSent(ym: string, on: boolean): Promise<PayrollRoundActionResult> {
  const ctx = await context(ym, "payroll.manage");
  if (typeof ctx === "string") return { ok: false, reason: ctx };
  if (typeof on !== "boolean") return { ok: false, reason: "invalid" };
  const r = on
    ? await transition(ctx, ym, "paid", { status: "sent_to_accountant", sent_by: ctx.actorId, sent_at: new Date().toISOString() })
    : await transition(ctx, ym, "sent_to_accountant", { status: "paid", sent_by: null, sent_at: null });
  if (r !== "ok") return { ok: false, reason: r };
  await logEvent(ctx, ym, on ? "sent" : "unsent");
  revalidate();
  return { ok: true, status: on ? "sent_to_accountant" : "paid" };
}
