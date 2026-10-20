import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

/**
 * 사용자 관리 변경 기록(2026-10-20, 권한 정리 ④ A) — 기존 `audit_logs` 표에 남긴다(DB 구조 변경 없음).
 *
 * 누가(actor) · 언제(created_at) · 누구를(target = 멤버십) · 무엇을(action + metadata 의 from / to · 권한 키 등). 역할 · 상태 · 소속 ·
 * 플래그 · 개발자 지정 · 개인 부여/차단/회수 · 삭제 · 초대코드. 기록 실패가 본 동작을 되돌리지는 않는다(로그만 남김) — 이미 저장된
 * 변경을 「기록이 안 돼서」 실패로 보여 주면 사용자가 다시 눌러 같은 변경이 두 번 된다.
 * 화면: 멤버 상세(PC 패널 · 모바일)의 「최근 변경」. docs/product/17-user-profile-directory.md
 */

export const USER_AUDIT_TARGET = "membership";
export const INVITE_AUDIT_TARGET = "invite_code";

export type UserAuditAction =
  | "member.role"
  | "member.status"
  | "member.team"
  | "member.report_access"
  | "member.payroll_admin"
  | "member.leave_approver"
  | "member.developer"
  | "member.permission_grant"
  | "member.permission_revoke"
  | "member.permissions_auto_revoke"
  | "member.delete"
  | "invite.create"
  | "invite.active"
  | "invite.delete";

export async function logUserAudit(entry: {
  organizationId: string;
  actorUserId: string;
  action: UserAuditAction;
  targetType?: typeof USER_AUDIT_TARGET | typeof INVITE_AUDIT_TARGET;
  targetId: string | null;
  metadata?: Record<string, Json>;
}): Promise<void> {
  const { error } = await getSupabaseServiceClient()
    .from("audit_logs")
    .insert({
      organization_id: entry.organizationId,
      actor_user_id: entry.actorUserId,
      action: entry.action,
      target_type: entry.targetType ?? USER_AUDIT_TARGET,
      target_id: entry.targetId,
      metadata: entry.metadata ?? {},
    });
  if (error) console.error("[user-audit] insert failed", { action: entry.action, code: error.code });
}

export type MemberHistoryItem = {
  id: string;
  at: string;
  actorName: string;
  action: UserAuditAction;
  meta: Record<string, unknown>;
};

/** 한 멤버의 최근 변경(최신 순). 조직 인덱스(organization_id, created_at)를 타게 조직으로 먼저 거른다. */
export async function loadMemberHistory(organizationId: string, membershipId: string, limit = 10): Promise<MemberHistoryItem[]> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("audit_logs")
    .select("id, created_at, actor_user_id, action, metadata")
    .eq("organization_id", organizationId)
    .eq("target_type", USER_AUDIT_TARGET)
    .eq("target_id", membershipId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  const rows = data as { id: string; created_at: string; actor_user_id: string | null; action: string; metadata: Json }[];
  const actorIds = [...new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = actorIds.length
    ? await service.from("profiles").select("id, name").in("id", actorIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map(((profiles ?? []) as { id: string; name: string }[]).map((profile) => [profile.id, profile.name]));
  return rows.map((row) => ({
    id: row.id,
    at: row.created_at,
    actorName: (row.actor_user_id && nameById.get(row.actor_user_id)) || "—",
    action: row.action as UserAuditAction,
    meta: (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, unknown>,
  }));
}
