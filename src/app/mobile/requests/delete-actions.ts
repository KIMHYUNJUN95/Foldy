"use server";

import { roleCan } from "@/config/capabilities";
import { revalidatePath } from "next/cache";
import type { Role } from "@/config/roles";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * 삭제 후 갱신돼야 하는 화면들.
 *
 * 이 액션들은 **모바일 요청 목록과 어드민 콘솔 양쪽에서** 호출된다. 재검증이 없어서 두 화면 모두
 * 클라이언트가 `router.refresh()` 로 때우고 있었는데, 그러면 (a) 왕복이 한 번 더 들고 (b) 호출한
 * 화면만 갱신되고 다른 쪽은 낡은 채로 남는다. 서버가 재검증하는 편이 옳다 (2026-08-11).
 */
function revalidateAfterDelete(kind: "lost-found" | "maintenance" | "orders") {
  revalidatePath("/mobile/requests");
  revalidatePath(kind === "lost-found" ? "/admin/lost-found" : kind === "maintenance" ? "/admin/maintenance" : "/admin/orders");
}

type DeleteResult = { ok: true } | { ok: false; error: "unauthorized" | "not_found" | "delete_failed" };

function canDeleteAnyRequestRecord(role: Role): boolean {
  return roleCan(role, "request.delete_any");
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** 작성자 본인이거나 관리 역할이어야 삭제할 수 있다. */
function canDelete(role: Role, reportedByUserId: string, currentUserId: string): boolean {
  return reportedByUserId === currentUserId || canDeleteAnyRequestRecord(role);
}

export async function deleteLostItem(id: string): Promise<DeleteResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    return { ok: false, error: "unauthorized" };
  }
  if (!isValidUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("lost_items")
    .select("id, reported_by_user_id")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  const owner = (existing as { reported_by_user_id: string }).reported_by_user_id;
  if (!canDelete(session.user.role, owner, session.user.id)) {
    return { ok: false, error: "unauthorized" };
  }

  const { error } = await supabase
    .from("lost_items")
    .delete()
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("permission") || msg.includes("policy") || msg.includes("denied")) {
      return { ok: false, error: "unauthorized" };
    }
    return { ok: false, error: "delete_failed" };
  }
  revalidateAfterDelete("lost-found");
  return { ok: true };
}

export async function deleteMaintenanceReport(id: string): Promise<DeleteResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    return { ok: false, error: "unauthorized" };
  }
  if (!isValidUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("maintenance_reports")
    .select("id, reported_by_user_id")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  const owner = (existing as { reported_by_user_id: string }).reported_by_user_id;
  if (!canDelete(session.user.role, owner, session.user.id)) {
    return { ok: false, error: "unauthorized" };
  }

  const { error } = await supabase
    .from("maintenance_reports")
    .delete()
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("permission") || msg.includes("policy") || msg.includes("denied")) {
      return { ok: false, error: "unauthorized" };
    }
    return { ok: false, error: "delete_failed" };
  }
  revalidateAfterDelete("maintenance");
  return { ok: true };
}

export async function deleteOrderRequest(id: string): Promise<DeleteResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    return { ok: false, error: "unauthorized" };
  }
  if (!isValidUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("order_requests")
    .select("id, reported_by_user_id, status")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  const row = existing as { reported_by_user_id: string; status: string };
  if (!canDelete(session.user.role, row.reported_by_user_id, session.user.id)) {
    return { ok: false, error: "unauthorized" };
  }
  // 상태 제약(docs/product/10-order-request-workflow.md → Status constraint):
  // 이미 외부에 발주가 나간 `ordered`/`received` 건은 관리 역할만 삭제할 수 있다 — 작성자 본인이라도 불가.
  if (
    (row.status === "ordered" || row.status === "received") &&
    !canDeleteAnyRequestRecord(session.user.role)
  ) {
    return { ok: false, error: "unauthorized" };
  }

  const { error } = await supabase
    .from("order_requests")
    .delete()
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("permission") || msg.includes("policy") || msg.includes("denied")) {
      return { ok: false, error: "unauthorized" };
    }
    return { ok: false, error: "delete_failed" };
  }
  revalidateAfterDelete("orders");
  return { ok: true };
}
