"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { payrollPrepAvailable, type PrepManual } from "@/lib/payroll-prep";
import { paydayFor, shiftYm } from "@/lib/payroll-settings-rules";
import { loadOrgPayrollSettings } from "@/lib/payroll-settings-server";
import { loadPrepRows, PAYROLL_MONTH_INPUT_SELECT, rowToPrepManual } from "@/lib/payroll-prep-server";
import { isPayrollMonthLocked, readApprovalRow } from "@/lib/payroll-approval-server";
import { parseRoundStatus, parseSnapshot } from "@/lib/payroll-approval";
import {
  CARRY_FIELDS,
  planCarryOver,
  undoPatch,
  type CarryEntry,
  type CarryField,
  type CarryPatch,
} from "@/lib/payroll-carry-over";

/**
 * 「지난달 값 가져오기」 — 미리 세기 · 가져오기 · 되돌리기(PC 근태 › 급여 · 모바일 급여 준비가 같이 부른다 → src/actions).
 * 권한 `payroll.manage`, 결재 요청 이후(잠긴 달)는 막힘. 지난달이 결재됐으면 결재 때 굳힌 값, 아니면 지난달 입력 그대로.
 * docs/product/39 §5-A
 */

export type CarryFail = { ok: false; reason: "forbidden" | "invalid" | "closed" | "locked" | "error" };
export type CarryPreviewResult = { ok: true; fromYm: string; counts: Record<CarryField, number> } | CarryFail;
export type CarryRunResult = { ok: true; people: number; cells: number; entries: CarryEntry[] } | CarryFail;
export type CarryUndoResult = { ok: true; cells: number } | CarryFail;

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_ENTRIES = 500;

type Ctx = { service: ReturnType<typeof getSupabaseServiceClient>; organizationId: string; viewerId: string };

async function guard(ym: unknown): Promise<Ctx | CarryFail> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "forbidden" };
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  if (!(await attendanceCan(service, organizationId, session.user.id, "payroll.manage"))) return { ok: false, reason: "forbidden" };
  if (typeof ym !== "string" || !YM_RE.test(ym)) return { ok: false, reason: "invalid" };
  if (!payrollPrepAvailable(ym)) return { ok: false, reason: "closed" };
  if (await isPayrollMonthLocked(service, organizationId, ym)) return { ok: false, reason: "locked" };
  return { service, organizationId, viewerId: session.user.id };
}

async function readInputs(ctx: Ctx, ym: string): Promise<Map<string, PrepManual> | null> {
  const res = await ctx.service
    .from("payroll_month_inputs")
    .select(PAYROLL_MONTH_INPUT_SELECT)
    .eq("organization_id", ctx.organizationId)
    .eq("target_month", `${ym}-01`);
  if (res.error) return null;
  const out = new Map<string, PrepManual>();
  for (const row of (res.data ?? []) as ({ user_id: string } & Parameters<typeof rowToPrepManual>[0] & object)[]) {
    out.set(row.user_id, rowToPrepManual(row));
  }
  return out;
}

/** 지난달 값 — 결재 요청 이후면 굳힌 스냅샷, 아니면 입력 표. */
async function readSource(ctx: Ctx, fromYm: string): Promise<Map<string, PrepManual> | null> {
  const approval = await readApprovalRow(ctx.service, ctx.organizationId, fromYm);
  if (parseRoundStatus(approval?.status) !== "preparing") {
    const snap = parseSnapshot(approval?.snapshot);
    if (snap) return new Map(snap.rows.map((r) => [r.userId, r.manual]));
  }
  return readInputs(ctx, fromYm);
}

/** 이번 달 급여 준비에 나오는 사람 — 일하지 않은 사람에게 값을 넣어 줄을 만들지 않게. */
async function targetUsers(ctx: Ctx, ym: string): Promise<string[]> {
  const org = await loadOrgPayrollSettings(ctx.service, ctx.organizationId);
  const prep = await loadPrepRows(ctx.service, ctx.organizationId, ym, paydayFor(ym, org.payDay), org.employmentInsuranceRates);
  return prep.rows.map((r) => r.userId);
}

async function plan(ctx: Ctx, ym: string, fields: readonly CarryField[]) {
  const fromYm = shiftYm(ym, -1);
  const [source, target, users] = await Promise.all([readSource(ctx, fromYm), readInputs(ctx, ym), targetUsers(ctx, ym)]);
  if (!source || !target) return null;
  return { fromYm, target, result: planCarryOver(source, target, users, fields) };
}

function toRow(patch: CarryPatch) {
  const row: Record<string, number | string | null> = {};
  if (patch.special !== undefined) row.special = patch.special;
  if (patch.overtime !== undefined) row.overtime = patch.overtime;
  if (patch.weekend !== undefined) row.weekend = patch.weekend;
  if (patch.withholdingOverride !== undefined) row.withholding_override = patch.withholdingOverride;
  if (patch.withholdingOverrideReason !== undefined) row.withholding_override_reason = patch.withholdingOverrideReason;
  if (patch.memo !== undefined) row.memo = patch.memo;
  return row;
}

async function writeAll(ctx: Ctx, ym: string, entries: readonly CarryEntry[]): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = entries.map((e) => ({
    organization_id: ctx.organizationId,
    user_id: e.userId,
    target_month: `${ym}-01`,
    ...toRow(e.patch),
    updated_by: ctx.viewerId,
    updated_at: now,
  }));
  // 사람마다 바뀌는 칸이 달라 한 번에 upsert 하면 빠진 칸이 기본값으로 덮인다 — 한 줄씩.
  for (const row of rows) {
    const res = await ctx.service.from("payroll_month_inputs").upsert(row, { onConflict: "organization_id,user_id,target_month" });
    if (res.error) {
      console.error("[payroll-carry] upsert failed:", res.error.message);
      return false;
    }
  }
  return true;
}

function cleanFields(raw: unknown): CarryField[] | null {
  if (!Array.isArray(raw)) return null;
  const out = CARRY_FIELDS.filter((f) => raw.includes(f));
  return out.length > 0 && out.length === new Set(raw).size ? out : null;
}

/** 확인 창 — 칸마다 몇 명이 채워질지. */
export async function previewPayrollCarryOver(input: { ym: string }): Promise<CarryPreviewResult> {
  const ctx = await guard(input?.ym);
  if ("ok" in ctx) return ctx;
  const p = await plan(ctx, input.ym, CARRY_FIELDS);
  if (!p) return { ok: false, reason: "error" };
  return { ok: true, fromYm: p.fromYm, counts: p.result.counts };
}

export async function runPayrollCarryOver(input: { ym: string; fields: CarryField[] }): Promise<CarryRunResult> {
  const ctx = await guard(input?.ym);
  if ("ok" in ctx) return ctx;
  const fields = cleanFields(input.fields);
  if (!fields) return { ok: false, reason: "invalid" };
  const p = await plan(ctx, input.ym, fields);
  if (!p) return { ok: false, reason: "error" };
  const { entries, people, cells } = p.result;
  if (entries.length > 0) {
    if (!(await writeAll(ctx, input.ym, entries))) return { ok: false, reason: "error" };
    await bestEffortWrite(
      "audit_logs: payroll_month_input_carry_over",
      ctx.service.from("audit_logs").insert({
        organization_id: ctx.organizationId,
        actor_user_id: ctx.viewerId,
        action: "payroll_month_input_carry_over",
        target_type: "payroll_month_inputs",
        target_id: null,
        metadata: { ym: input.ym, fromYm: p.fromYm, fields, people, cells },
      }),
    );
    revalidatePath("/admin/attendance/payroll");
    revalidatePath("/mobile/payroll");
  }
  return { ok: true, people, cells, entries };
}

function validEntries(raw: unknown): CarryEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ENTRIES) return null;
  const out: CarryEntry[] = [];
  for (const e of raw as { userId?: unknown; patch?: unknown }[]) {
    if (!e || typeof e.userId !== "string" || !e.patch || typeof e.patch !== "object") return null;
    const p = e.patch as Record<string, unknown>;
    const patch: CarryPatch = {};
    for (const k of ["special", "overtime", "weekend", "withholdingOverride"] as const) {
      if (k in p) {
        if (typeof p[k] !== "number" || !Number.isInteger(p[k])) return null;
        patch[k] = p[k] as number;
      }
    }
    for (const k of ["withholdingOverrideReason", "memo"] as const) {
      if (k in p) {
        if (typeof p[k] !== "string") return null;
        patch[k] = p[k] as string;
      }
    }
    out.push({ userId: e.userId, patch });
  }
  return out;
}

/** 되돌리기 — 가져온 값이 아직 그대로인 칸만 비운다. */
export async function undoPayrollCarryOver(input: { ym: string; entries: CarryEntry[] }): Promise<CarryUndoResult> {
  const ctx = await guard(input?.ym);
  if ("ok" in ctx) return ctx;
  const entries = validEntries(input.entries);
  if (!entries) return { ok: false, reason: "invalid" };
  const current = await readInputs(ctx, input.ym);
  if (!current) return { ok: false, reason: "error" };
  const undo: CarryEntry[] = [];
  let cells = 0;
  for (const e of entries) {
    const now = current.get(e.userId);
    if (!now) continue;
    const patch = undoPatch(now, e.patch);
    if (patch) {
      undo.push({ userId: e.userId, patch });
      cells += Object.keys(patch).filter((k) => k !== "withholdingOverrideReason").length;
    }
  }
  if (undo.length > 0) {
    if (!(await writeAll(ctx, input.ym, undo))) return { ok: false, reason: "error" };
    revalidatePath("/admin/attendance/payroll");
    revalidatePath("/mobile/payroll");
  }
  return { ok: true, cells };
}
