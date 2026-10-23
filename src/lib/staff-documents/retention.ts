import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { STAFF_DOCUMENT_BUCKET } from "@/lib/staff-documents/server";
import { pickExpiredOwners, retentionCutoff, type RetentionDocument, type RetentionMembership } from "@/lib/staff-documents/policy";
import { tokyoToday } from "@/lib/tokyo-date";

/** 크론 한 번에 정리하는 최대 사람 수(오래 걸리지 않게 — 남은 사람은 다음 날). */
const MAX_OWNERS_PER_RUN = 50;
/** Supabase 는 한 번에 최대 1000행만 돌려준다 — 그 단위로 끝까지 나눠 읽는다(.limit 을 크게 줘도 1000에서 잘린다). */
const PAGE = 1000;

/**
 * 신분 서류 보관 기한 정리 — 퇴사 3년 뒤 하드 삭제(docs/product/41 §6). 매일 `/api/tasks/reminders` 크론에 붙어 돈다.
 *
 * 대상은 **멤버십에서** 고른다: 떠난 상태(suspended · removed)이고 `left_at` 이 기준보다 앞인 (조직, 사람). 그중 서류나
 * 읽기 기록이 남은 사람만. 서류 표를 앞에서부터 읽던 첫 판은 1000행에서 잘려 재직자가 앞자리를 차지하면 퇴사자를 영영 못 보고,
 * 멤버십 없는 사람을 서류 갱신 시각으로 재 일찍 지울 수 있었다(2026-10-23 점검). 멤버십이 없는 사람은 지우지 않는다.
 *
 * 한 사람(조직 · 사람 짝)마다 **사진 먼저 → 표 행 나중**. 사진 지우기가 실패하면 표 행을 남겨 다음 날 다시 찾게 한다
 * (표를 먼저 지우면 남은 사진을 다시 찾을 길이 없다). 이미 없는 사진을 지우는 것은 오류가 아니라 몇 번 돌아도 같다.
 * 사진은 표에 적힌 앞 · 뒤 경로 + 그 사람 폴더(`{조직}/{사람}/…`)에 남은 파일(제출 안 한 촬영분)까지 지운다.
 */
export async function cleanupExpiredIdDocuments(service: SupabaseClient<Database>, today = tokyoToday()) {
  const cutoff = retentionCutoff(today);

  // 1) 기한이 지난 퇴사 멤버십 — 끝까지.
  const left: RetentionMembership[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from("memberships")
      .select("organization_id, user_id, status, left_at")
      .in("status", ["suspended", "removed"])
      .lt("left_at", cutoff)
      .order("left_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const m of data ?? []) {
      left.push({ organizationId: m.organization_id, userId: m.user_id, status: m.status, leftAt: m.left_at });
    }
    if ((data ?? []).length < PAGE) break;
  }
  if (left.length === 0) return { checked: true, deleted: 0, failed: 0 };

  // 2) 그중 서류 · 읽기 기록이 남은 사람만(조직별로 200명씩).
  const owners: RetentionDocument[] = [];
  const byOrg = new Map<string, string[]>();
  for (const m of left) byOrg.set(m.organizationId, [...(byOrg.get(m.organizationId) ?? []), m.userId]);
  for (const [organizationId, userIds] of byOrg) {
    for (let i = 0; i < userIds.length; i += 200) {
      const chunk = userIds.slice(i, i + 200);
      const [docs, reads] = await Promise.all([
        service.from("staff_id_documents").select("user_id, updated_at").eq("organization_id", organizationId).in("user_id", chunk),
        service.from("staff_id_ocr_reads").select("user_id, created_at").eq("organization_id", organizationId).in("user_id", chunk),
      ]);
      if (docs.error) throw docs.error;
      if (reads.error) throw reads.error;
      for (const d of docs.data ?? []) owners.push({ organizationId, userId: d.user_id, updatedAt: d.updated_at });
      for (const r of reads.data ?? []) owners.push({ organizationId, userId: r.user_id, updatedAt: r.created_at });
    }
  }

  // 3) 같은 규칙으로 한 번 더 거른다(재직 · 떠난 시각 모름 제외).
  const expired = pickExpiredOwners(owners, left, cutoff).slice(0, MAX_OWNERS_PER_RUN);

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
