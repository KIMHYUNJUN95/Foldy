"use server";

import type { OrganizationRole } from "@/config/roles";
import type { Database } from "@/types/database";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// database.ts 에 Relationships 가 없어서 service.rpc() 에 타입이 붙지 않는다.
// 초대 코드 가입 RPC 에 필요한 만큼만 타입을 준다.
type JoinRpcRow = {
  organization_id: string;
  role: Database["public"]["Enums"]["organization_role"];
  status: string;
};
type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: JoinRpcRow[] | null; error: { message: string } | null }>;
};

export type InviteValidationResult =
  | { ok: true; organizationId: string; defaultRole: OrganizationRole }
  | { ok: false; error: "invalid" | "expired" | "inactive" | "maxed_out" };

/**
 * 초대 코드를 소비하지 않고 검증한다.
 * 코드가 쓸 수 있으면 대상 조직과 기본 역할을 돌려준다.
 */
export async function validateInviteCode(
  code: string,
): Promise<InviteValidationResult> {
  if (!code?.trim()) return { ok: false, error: "invalid" };

  type InviteRow = {
    organization_id: string;
    default_role: string;
    expires_at: string;
    max_uses: number;
    used_count: number;
    is_active: boolean;
  };

  const service = getSupabaseServiceClient();
  const { data: rawData, error } = await service
    .from("invite_codes")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();

  if (error || !rawData) return { ok: false, error: "invalid" };
  const data = rawData as unknown as InviteRow;
  if (!data.is_active) return { ok: false, error: "inactive" };
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { ok: false, error: "expired" };
  }
  if (data.max_uses !== null && data.used_count >= data.max_uses) {
    return { ok: false, error: "maxed_out" };
  }

  return {
    ok: true,
    organizationId: data.organization_id as string,
    defaultRole: data.default_role as OrganizationRole,
  };
}

export type JoinResult =
  | { ok: true; organizationId: string; role: OrganizationRole }
  | {
      ok: false;
      error:
        | "invalid"
        | "expired"
        | "inactive"
        | "maxed_out"
        | "already_member"
        | "rpc_error";
    };

/**
 * 초대 코드로 조직에 가입한다.
 * 먼저 코드를 검증한 뒤 join_organization_with_invite_code RPC 를 호출한다.
 * RPC 가 원자적으로 used_count 를 올리고 멤버십 행을 만든다.
 */
export async function joinOrganizationWithInviteCode(
  userId: string,
  code: string,
): Promise<JoinResult> {
  const validation = await validateInviteCode(code);
  if (!validation.ok) return validation;

  const service = getSupabaseServiceClient();
  const { data, error } = await (service as unknown as RpcClient).rpc(
    "join_organization_with_invite_code",
    { p_user_id: userId, p_code: code.trim().toUpperCase() },
  );

  if (error) {
    if (error.message.toLowerCase().includes("already")) {
      return { ok: false, error: "already_member" };
    }
    return { ok: false, error: "rpc_error" };
  }

  const row = data?.[0];
  if (!row) return { ok: false, error: "rpc_error" as const };

  return {
    ok: true,
    organizationId: row.organization_id,
    role: row.role as OrganizationRole,
  };
}
