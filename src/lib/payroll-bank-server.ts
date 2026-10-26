import "server-only";

import type { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { BankAccount, BankAccountType, BankChange, MemberBank } from "@/lib/payroll-bank";

/**
 * 급여 계좌 읽기(서버 전용, service role). 권한 확인(본인 · payroll.view)은 부르는 쪽이 한다.
 * docs/product/39 §3-A 「급여 계좌」 · docs/engineering/04-data-model.md → member_bank_accounts
 */

type Service = ReturnType<typeof getSupabaseServiceClient>;

export const MEMBER_BANK_SELECT =
  "user_id, bank_name, branch_name, account_type, account_number, holder_kana, pending, confirmed_bank_name, confirmed_branch_name, confirmed_account_type, confirmed_account_number, confirmed_holder_kana, updated_at";

export type MemberBankRow = {
  user_id: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  holder_kana: string;
  pending: boolean;
  confirmed_bank_name: string | null;
  confirmed_branch_name: string | null;
  confirmed_account_type: string | null;
  confirmed_account_number: string | null;
  confirmed_holder_kana: string | null;
  updated_at: string;
};

const asType = (v: string | null): BankAccountType => (v === "current" ? "current" : "ordinary");

export function rowToMemberBank(row: MemberBankRow): MemberBank {
  const confirmed: BankAccount | null =
    row.confirmed_bank_name && row.confirmed_branch_name && row.confirmed_account_number && row.confirmed_holder_kana
      ? {
          bankName: row.confirmed_bank_name,
          branchName: row.confirmed_branch_name,
          accountType: asType(row.confirmed_account_type),
          accountNumber: row.confirmed_account_number,
          holderKana: row.confirmed_holder_kana,
        }
      : null;
  return {
    current: {
      bankName: row.bank_name,
      branchName: row.branch_name,
      accountType: asType(row.account_type),
      accountNumber: row.account_number,
      holderKana: row.holder_kana,
    },
    pending: Boolean(row.pending),
    confirmed,
    updatedAt: row.updated_at,
  };
}

export async function loadMemberBanks(
  service: Service,
  organizationId: string,
  userIds: readonly string[],
): Promise<Map<string, MemberBank>> {
  const out = new Map<string, MemberBank>();
  if (userIds.length === 0) return out;
  const { data, error } = await service
    .from("member_bank_accounts")
    .select(MEMBER_BANK_SELECT)
    .eq("organization_id", organizationId)
    .in("user_id", userIds as string[]);
  if (error) console.warn("[payroll-bank] accounts read failed:", error.message);
  for (const row of (data ?? []) as MemberBankRow[]) out.set(row.user_id, rowToMemberBank(row));
  return out;
}

/** 바뀐 기록 — 최근 20줄, 바꾼 사람 이름까지. */
export async function loadBankHistory(service: Service, organizationId: string, userId: string): Promise<BankChange[]> {
  const { data, error } = await service
    .from("member_bank_account_changes")
    .select("kind, by_self, changed_by, prev_bank_name, prev_last4, new_bank_name, new_last4, created_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) console.warn("[payroll-bank] history read failed:", error.message);
  const rows = (data ?? []) as {
    kind: string;
    by_self: boolean;
    changed_by: string | null;
    prev_bank_name: string | null;
    prev_last4: string | null;
    new_bank_name: string | null;
    new_last4: string | null;
    created_at: string;
  }[];
  const ids = Array.from(new Set(rows.map((r) => r.changed_by).filter((v): v is string => Boolean(v))));
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const res = await service.from("profiles").select("id, name").in("id", ids);
    for (const p of (res.data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name);
  }
  return rows.map((r) => ({
    at: r.created_at,
    kind: r.kind === "created" || r.kind === "confirmed" ? r.kind : "updated",
    bySelf: Boolean(r.by_self),
    changedByName: r.changed_by ? (names.get(r.changed_by) ?? null) : null,
    prevBankName: r.prev_bank_name,
    prevLast4: r.prev_last4,
    newBankName: r.new_bank_name,
    newLast4: r.new_last4,
  }));
}
