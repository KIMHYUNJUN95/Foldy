"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { last4, parseBankInput, sameAccount, type BankChange, type BankField, type MemberBank } from "@/lib/payroll-bank";
import { loadBankHistory, MEMBER_BANK_SELECT, rowToMemberBank, type MemberBankRow } from "@/lib/payroll-bank-server";

/**
 * 급여 계좌 — 읽기 · 쓰기 · 확인(본인 내 계정 · PC 근태 › 시급 패널 · 모바일 사용자 상세 · 급여 준비가 같이 부른다 → src/actions).
 * 보기 = 본인 또는 `payroll.view`. 고치기 = 본인 또는 `payroll.manage`. 확인 = `payroll.manage`.
 * 본인이 바꾸면 확인 전(`pending`), 관리자가 바꾸면 바로 확인됨. 막히면 redirect 대신 `forbidden`. docs/product/39 §3-A
 */

export type MemberBankDetail = {
  bank: MemberBank | null;
  history: BankChange[];
  /** 이 사람 계좌를 고칠 수 있는지(본인 또는 payroll.manage). */
  canEdit: boolean;
  /** 확인함을 누를 수 있는지(payroll.manage). */
  canConfirm: boolean;
};

export type MemberBankResult =
  | ({ ok: true } & MemberBankDetail)
  | { ok: false; reason: "forbidden" | "invalid" | "not_member" | "error"; field?: BankField };

type Ctx = {
  service: ReturnType<typeof getSupabaseServiceClient>;
  organizationId: string;
  viewerId: string;
  isSelf: boolean;
  canView: boolean;
  canManage: boolean;
};

async function context(userId: unknown): Promise<Ctx | null> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session) || typeof userId !== "string" || !userId) return null;
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const isSelf = userId === session.user.id;
  const [canView, canManage] = await Promise.all([
    attendanceCan(service, organizationId, session.user.id, "payroll.view"),
    attendanceCan(service, organizationId, session.user.id, "payroll.manage"),
  ]);
  return { service, organizationId, viewerId: session.user.id, isSelf, canView, canManage };
}

async function isMember(ctx: Ctx, userId: string): Promise<boolean | null> {
  const res = await ctx.service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", userId)
    .limit(1);
  if (res.error) return null;
  return (res.data ?? []).length > 0;
}

async function readBank(ctx: Ctx, userId: string): Promise<{ ok: true; row: MemberBankRow | null } | { ok: false }> {
  const res = await ctx.service
    .from("member_bank_accounts")
    .select(MEMBER_BANK_SELECT)
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) return { ok: false };
  return { ok: true, row: (res.data as MemberBankRow | null) ?? null };
}

async function detail(ctx: Ctx, userId: string, row: MemberBankRow | null): Promise<MemberBankResult> {
  return {
    ok: true,
    bank: row ? rowToMemberBank(row) : null,
    history: await loadBankHistory(ctx.service, ctx.organizationId, userId),
    canEdit: ctx.isSelf || ctx.canManage,
    canConfirm: ctx.canManage,
  };
}

function revalidate() {
  revalidatePath("/account");
  revalidatePath("/admin/attendance/payroll");
  revalidatePath("/admin/attendance/wages");
  revalidatePath("/mobile/payroll");
  revalidatePath("/mobile/users", "layout");
}

/** 한 사람 계좌 + 바뀐 기록 — 패널 · 시트를 열 때. */
export async function getMemberBank(input: { userId: string }): Promise<MemberBankResult> {
  const ctx = await context(input?.userId);
  if (!ctx) return { ok: false, reason: "forbidden" };
  if (!ctx.isSelf && !ctx.canView) return { ok: false, reason: "forbidden" };
  const member = await isMember(ctx, input.userId);
  if (member === null) return { ok: false, reason: "error" };
  if (!member) return { ok: false, reason: "not_member" };
  const read = await readBank(ctx, input.userId);
  if (!read.ok) return { ok: false, reason: "error" };
  return detail(ctx, input.userId, read.row);
}

/** 계좌 저장 — 본인이면 확인 전, 관리자(payroll.manage)가 다른 사람 것을 바꾸면 바로 확인됨. */
export async function saveMemberBank(input: { userId: string; account: unknown }): Promise<MemberBankResult> {
  const ctx = await context(input?.userId);
  if (!ctx) return { ok: false, reason: "forbidden" };
  if (!ctx.isSelf && !ctx.canManage) return { ok: false, reason: "forbidden" };
  const parsed = parseBankInput(input.account);
  if (!parsed.ok) return { ok: false, reason: "invalid", field: parsed.field };
  const member = await isMember(ctx, input.userId);
  if (member === null) return { ok: false, reason: "error" };
  if (!member) return { ok: false, reason: "not_member" };
  const read = await readBank(ctx, input.userId);
  if (!read.ok) return { ok: false, reason: "error" };

  const next = parsed.account;
  const before = read.row ? rowToMemberBank(read.row) : null;
  if (before && sameAccount(before.current, next)) return detail(ctx, input.userId, read.row);

  // 본인 변경은 확인 전 — 단, 이전에 확인한 계좌로 되돌린 거면 확인할 게 없다.
  const bySelf = ctx.isSelf;
  const pending = bySelf && !sameAccount(before?.confirmed ?? null, next);
  const now = new Date().toISOString();
  const confirmedFields = bySelf
    ? {}
    : {
        confirmed_bank_name: next.bankName,
        confirmed_branch_name: next.branchName,
        confirmed_account_type: next.accountType,
        confirmed_account_number: next.accountNumber,
        confirmed_holder_kana: next.holderKana,
        confirmed_by: ctx.viewerId,
        confirmed_at: now,
      };
  const saved = await ctx.service
    .from("member_bank_accounts")
    .upsert(
      {
        organization_id: ctx.organizationId,
        user_id: input.userId,
        bank_name: next.bankName,
        branch_name: next.branchName,
        account_type: next.accountType,
        account_number: next.accountNumber,
        holder_kana: next.holderKana,
        pending,
        ...confirmedFields,
        updated_by: ctx.viewerId,
        updated_at: now,
      },
      { onConflict: "organization_id,user_id" },
    )
    .select(MEMBER_BANK_SELECT)
    .single();
  if (saved.error || !saved.data) {
    console.error("[payroll-bank] upsert failed:", saved.error?.message);
    return { ok: false, reason: "error" };
  }

  await bestEffortWrite(
    "member_bank_account_changes: save",
    ctx.service.from("member_bank_account_changes").insert({
      organization_id: ctx.organizationId,
      user_id: input.userId,
      kind: before ? "updated" : "created",
      by_self: bySelf,
      changed_by: ctx.viewerId,
      prev_bank_name: before?.current.bankName ?? null,
      prev_last4: before ? last4(before.current.accountNumber) : null,
      new_bank_name: next.bankName,
      new_last4: last4(next.accountNumber),
    }),
  );
  revalidate();
  return detail(ctx, input.userId, saved.data as MemberBankRow);
}

/** 본인이 바꾼 계좌를 급여 담당이 확인 — 이 뒤로 이체에 새 계좌를 쓴다. */
export async function confirmMemberBank(input: { userId: string }): Promise<MemberBankResult> {
  const ctx = await context(input?.userId);
  if (!ctx) return { ok: false, reason: "forbidden" };
  if (!ctx.canManage) return { ok: false, reason: "forbidden" };
  const read = await readBank(ctx, input.userId);
  if (!read.ok) return { ok: false, reason: "error" };
  if (!read.row) return { ok: false, reason: "invalid" };
  if (!read.row.pending) return detail(ctx, input.userId, read.row);
  const now = new Date().toISOString();
  const saved = await ctx.service
    .from("member_bank_accounts")
    .update({
      pending: false,
      confirmed_bank_name: read.row.bank_name,
      confirmed_branch_name: read.row.branch_name,
      confirmed_account_type: read.row.account_type,
      confirmed_account_number: read.row.account_number,
      confirmed_holder_kana: read.row.holder_kana,
      confirmed_by: ctx.viewerId,
      confirmed_at: now,
    })
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", input.userId)
    // 확인 창을 연 뒤 본인이 또 바꿨으면 그 값은 확인하지 않는다.
    .eq("account_number", read.row.account_number)
    .eq("bank_name", read.row.bank_name)
    .select(MEMBER_BANK_SELECT)
    .maybeSingle();
  if (saved.error) {
    console.error("[payroll-bank] confirm failed:", saved.error.message);
    return { ok: false, reason: "error" };
  }
  if (!saved.data) {
    const again = await readBank(ctx, input.userId);
    return again.ok ? detail(ctx, input.userId, again.row) : { ok: false, reason: "error" };
  }
  await bestEffortWrite(
    "member_bank_account_changes: confirm",
    ctx.service.from("member_bank_account_changes").insert({
      organization_id: ctx.organizationId,
      user_id: input.userId,
      kind: "confirmed",
      by_self: false,
      changed_by: ctx.viewerId,
      new_bank_name: read.row.bank_name,
      new_last4: last4(read.row.account_number),
    }),
  );
  revalidate();
  return detail(ctx, input.userId, saved.data as MemberBankRow);
}
