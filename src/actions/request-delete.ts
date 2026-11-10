"use server";

import { revalidatePath } from "next/cache";
import { canDeleteRequestRecord } from "@/lib/request-delete-rule";
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

type RequestTable = "lost_items" | "maintenance_reports" | "order_requests";

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * 세 요청 삭제의 공통 흐름(2026-11-10). 판정은 화면과 같은 `canDeleteRequestRecord`(`@/lib/request-delete-rule`) 하나.
 * - 지울 때 **읽은 상태 그대로**인 행만 지운다 — 읽은 뒤 주문이 `ordered` 로 넘어갔으면 작성자 삭제가 막혀야 하는데, 예전엔 상태
 *   조건 없이 지워서 그 틈에 발주 나간 주문이 지워질 수 있었다.
 * - 지운 행 수를 본다 — RLS 가 거르면 에러 없이 0행이다. 0행이면 그 사이 바뀌었거나 이미 지워진 것이라 `not_found`.
 */
async function deleteRequestRow(table: RequestTable, id: string): Promise<DeleteResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    return { ok: false, error: "unauthorized" };
  }
  if (!isValidUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from(table)
    .select("id, reported_by_user_id, status")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  const row = existing as { reported_by_user_id: string; status: string };
  const allowed = canDeleteRequestRecord({
    canDeleteAny: session.capabilities.includes("request.delete_any"),
    isOwner: row.reported_by_user_id === session.user.id,
    // 상태 제약(docs/product/10 → Status constraint)은 주문만 — 이미 발주 나간 `ordered`/`received` 는 작성자 본인도 못 지운다.
    orderStatus: table === "order_requests" ? row.status : undefined,
  });
  if (!allowed) {
    return { ok: false, error: "unauthorized" };
  }

  const { data: deleted, error } = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    // 읽은 상태 그대로일 때만(위 설명). 세 표 모두 status 열이 있어 같은 조건을 건다.
    .eq("status", row.status as never)
    .select("id");
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("permission") || msg.includes("policy") || msg.includes("denied")) {
      return { ok: false, error: "unauthorized" };
    }
    return { ok: false, error: "delete_failed" };
  }
  if (!deleted || deleted.length === 0) {
    return { ok: false, error: "not_found" };
  }
  revalidateAfterDelete(table === "lost_items" ? "lost-found" : table === "maintenance_reports" ? "maintenance" : "orders");
  return { ok: true };
}

export async function deleteLostItem(id: string): Promise<DeleteResult> {
  return deleteRequestRow("lost_items", id);
}

export async function deleteMaintenanceReport(id: string): Promise<DeleteResult> {
  return deleteRequestRow("maintenance_reports", id);
}

export async function deleteOrderRequest(id: string): Promise<DeleteResult> {
  return deleteRequestRow("order_requests", id);
}
