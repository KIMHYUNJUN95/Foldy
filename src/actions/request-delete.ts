"use server";

import { revalidatePath } from "next/cache";
import { canDeleteRequestRecord } from "@/lib/request-delete-rule";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { isOwnStoragePublicUrl, storagePathFromPublicUrl } from "@/lib/storage-url-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { REQUEST_IMAGE_BUCKET } from "@/lib/task-images";

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

/** 열 → 사진이 올라가는 폴더(업로더가 `{조직}/{폴더}/{기록 id}/` 로 고정 — lost-item-create · maintenance-create · 처리 사진 액션). */
const PHOTO_COLUMNS: Partial<Record<RequestTable, ReadonlyArray<{ column: string; folder: string }>>> = {
  lost_items: [
    { column: "image_urls", folder: "lost-items" },
    { column: "handling_image_urls", folder: "lost-found-handling" },
  ],
  maintenance_reports: [
    { column: "image_urls", folder: "maintenance-reports" },
    { column: "resolution_image_urls", folder: "maintenance-resolutions" },
  ],
};

/** 행을 지운 뒤 사진 파일을 지운다. 실패해도 삭제 결과는 바꾸지 않는다(파일이 남는 쪽이 안전). 이 기록의 폴더 아래 한 장짜리 경로만. */
async function removeRequestPhotos(
  row: Record<string, unknown>,
  columns: ReadonlyArray<{ column: string; folder: string }>,
  organizationId: string,
  recordId: string,
) {
  const paths = new Set<string>();
  for (const { column, folder } of columns) {
    const urls = row[column];
    if (!Array.isArray(urls)) continue;
    const prefix = `${organizationId}/${folder}/${recordId}/`;
    for (const url of urls) {
      if (typeof url !== "string" || !isOwnStoragePublicUrl(url, REQUEST_IMAGE_BUCKET, prefix)) continue;
      const path = storagePathFromPublicUrl(url, REQUEST_IMAGE_BUCKET);
      if (path) paths.add(path);
    }
  }
  if (paths.size === 0) return;
  try {
    const { error } = await getSupabaseServiceClient().storage.from(REQUEST_IMAGE_BUCKET).remove([...paths]);
    if (error) console.error("[deleteRequestRow] storage remove failed:", error.message);
  } catch (error) {
    console.error("[deleteRequestRow] storage remove threw:", error instanceof Error ? error.message : "unknown");
  }
}

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
  const photoColumns = PHOTO_COLUMNS[table] ?? [];
  const { data: existing, error: readError } = await supabase
    .from(table)
    .select(["id", "reported_by_user_id", "status", ...photoColumns.map((c) => c.column)].join(", "))
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (readError) {
    console.error("[deleteRequestRow] read failed:", readError.message);
    return { ok: false, error: "delete_failed" };
  }
  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  const row = existing as unknown as { reported_by_user_id: string; status: string } & Record<string, unknown>;
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
  if (photoColumns.length > 0) await removeRequestPhotos(row, photoColumns, session.organization.id, id);
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
