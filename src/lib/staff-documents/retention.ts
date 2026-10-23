import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { STAFF_DOCUMENT_BUCKET } from "@/lib/staff-documents/server";
import { pickExpiredOwners, retentionCutoff, type RetentionDocument } from "@/lib/staff-documents/policy";
import { tokyoToday } from "@/lib/tokyo-date";

/** 크론 한 번에 정리하는 최대 사람 수(오래 걸리지 않게 — 남은 사람은 다음 날). */
const MAX_OWNERS_PER_RUN = 50;
const SCAN_LIMIT = 5000;

/**
 * 신분 서류 보관 기한 정리 — 퇴사 3년 뒤 하드 삭제(docs/product/41 §6). 매일 `/api/tasks/reminders` 크론에 붙어 돈다.
 *
 * 한 사람(조직 · 사람 짝)마다 **사진 먼저 → 표 행 나중**. 사진 지우기가 실패하면 표 행을 남겨 다음 날 다시 찾게 한다
 * (표를 먼저 지우면 남은 사진을 다시 찾을 길이 없다). 이미 없는 사진을 지우는 것은 오류가 아니라 몇 번 돌아도 같다.
 * 사진은 표에 적힌 앞 · 뒤 경로 + 그 사람 폴더(`{조직}/{사람}/…`)에 남은 파일(제출 안 한 촬영분)까지 지운다.
 */
export async function cleanupExpiredIdDocuments(service: SupabaseClient<Database>, today = tokyoToday()) {
  const cutoff = retentionCutoff(today);
  // 오래된 것부터 읽는다 — 상한에 걸려도 기한이 지난 쪽이 먼저 들어온다.

  const [{ data: docs, error: docsError }, { data: reads, error: readsError }] = await Promise.all([
    service.from("staff_id_documents").select("organization_id, user_id, updated_at").order("updated_at").limit(SCAN_LIMIT),
    service.from("staff_id_ocr_reads").select("organization_id, user_id, created_at").order("created_at").limit(SCAN_LIMIT),
  ]);
  if (docsError) throw docsError;
  if (readsError) throw readsError;

  // 읽기 기록만 있는 사람(촬영 · 읽기만 하고 제출 안 함)도 같은 기한으로 정리한다.
  const candidates: RetentionDocument[] = [
    ...(docs ?? []).map((d) => ({ organizationId: d.organization_id, userId: d.user_id, updatedAt: d.updated_at })),
    ...(reads ?? []).map((r) => ({ organizationId: r.organization_id, userId: r.user_id, updatedAt: r.created_at })),
  ];
  if (candidates.length === 0) return { checked: true, deleted: 0, failed: 0 };

  const userIds = [...new Set(candidates.map((c) => c.userId))];
  const memberships: { organization_id: string; user_id: string; status: string; left_at: string | null }[] = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const { data, error } = await service
      .from("memberships")
      .select("organization_id, user_id, status, left_at")
      .in("user_id", userIds.slice(i, i + 200));
    if (error) throw error;
    memberships.push(...(data ?? []));
  }

  const expired = pickExpiredOwners(
    candidates,
    memberships.map((m) => ({ organizationId: m.organization_id, userId: m.user_id, status: m.status, leftAt: m.left_at })),
    cutoff,
    { includeOrphans: (docs ?? []).length < SCAN_LIMIT && (reads ?? []).length < SCAN_LIMIT },
  ).slice(0, MAX_OWNERS_PER_RUN);

  let deleted = 0;
  let failed = 0;
  for (const owner of expired) {
    if (await purgeOwner(service, owner.organizationId, owner.userId)) deleted += 1;
    else failed += 1;
  }
  return { checked: true, deleted, failed };
}

async function purgeOwner(service: SupabaseClient<Database>, organizationId: string, userId: string): Promise<boolean> {
  const bucket = service.storage.from(STAFF_DOCUMENT_BUCKET);
  const { data: rows, error: rowsError } = await service
    .from("staff_id_documents")
    .select("front_path, back_path")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (rowsError) return false;

  const paths = new Set<string>();
  for (const row of rows ?? []) {
    paths.add(row.front_path);
    if (row.back_path) paths.add(row.back_path);
  }
  const root = `${organizationId}/${userId}`;
  const { data: folders, error: folderError } = await bucket.list(root, { limit: 1000 });
  if (folderError) return false;
  for (const folder of folders ?? []) {
    if (folder.id) {
      paths.add(`${root}/${folder.name}`);
      continue;
    }
    const { data: files, error: fileError } = await bucket.list(`${root}/${folder.name}`, { limit: 1000 });
    if (fileError) return false;
    for (const file of files ?? []) if (file.id) paths.add(`${root}/${folder.name}/${file.name}`);
  }

  if (paths.size > 0) {
    const { error: removeError } = await bucket.remove([...paths]);
    if (removeError) {
      console.error("[staff-documents/retention] storage remove failed", removeError.message);
      return false;
    }
  }

  const { error: docError } = await service
    .from("staff_id_documents")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (docError) return false;
  const { error: readError } = await service
    .from("staff_id_ocr_reads")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  return !readError;
}
