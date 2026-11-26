import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { LOST_ITEM_PHOTO_COLUMNS, requestPhotoPaths } from "@/lib/request-photos";
import { REQUEST_IMAGE_BUCKET } from "@/lib/task-images";
import { tokyoDateOf, tokyoDayStart, tokyoToday, ymdShift } from "@/lib/tokyo-date";

/** 폐기 후 이만큼(도쿄 날짜) 지나면 하드 삭제. 예전 SQL `lostfound_auto_purge()` 와 같은 판정. */
export const LOST_ITEM_PURGE_DAYS = 90;
/** 크론 한 번에 지우는 최대 행 수 — 남은 행은 다음 날. */
const MAX_ROWS_PER_RUN = 200;

/** `(handled_at 도쿄 날짜) + 90 < 도쿄 오늘`. handled_at 이 없으면 대상 아님(SQL 의 null 비교와 같다). */
export function isLostItemPurgeDue(handledAt: string | null, today: string): boolean {
  const handledDate = tokyoDateOf(handledAt);
  if (!handledDate) return false;
  return ymdShift(handledDate, LOST_ITEM_PURGE_DAYS) < today;
}

export type LostItemPurgeResult = {
  checked: number;
  deleted: number;
  photosRemoved: number;
  photoFailures: number;
  deleteFailures: number;
};

/**
 * 분실물 자동 삭제(docs/product/09 「자동 삭제」). 모든 조직의 `disposed` 행 중 90일 지난 것을 행마다 **사진 먼저 → 행 나중**.
 * 사진 삭제가 실패하면 행을 남겨 다음 날 다시 찾게 한다(행을 먼저 지우면 남은 사진을 다시 찾을 길이 없다).
 * 이미 없는 사진을 지우는 것은 오류가 아니라 몇 번 돌아도 같다.
 */
export async function purgeDisposedLostItems(
  service: SupabaseClient<Database>,
  today = tokyoToday(),
): Promise<LostItemPurgeResult> {
  const { data, error } = await service
    .from("lost_items")
    .select("id, organization_id, handled_at, image_urls, handling_image_urls")
    .eq("status", "disposed")
    .lt("handled_at", tokyoDayStart(ymdShift(today, -LOST_ITEM_PURGE_DAYS)))
    .order("handled_at")
    .limit(MAX_ROWS_PER_RUN);
  if (error) throw error;

  const result: LostItemPurgeResult = { checked: 0, deleted: 0, photosRemoved: 0, photoFailures: 0, deleteFailures: 0 };
  for (const row of data ?? []) {
    if (!isLostItemPurgeDue(row.handled_at, today)) continue;
    result.checked += 1;

    const paths = requestPhotoPaths(row, LOST_ITEM_PHOTO_COLUMNS, row.organization_id, row.id);
    if (paths.length > 0) {
      let removeFailed: string | null = null;
      try {
        const { error: removeError } = await service.storage.from(REQUEST_IMAGE_BUCKET).remove(paths);
        if (removeError) removeFailed = removeError.message;
      } catch (thrown) {
        removeFailed = thrown instanceof Error ? thrown.message : "unknown";
      }
      if (removeFailed) {
        console.error("[lost-found/purge] storage remove failed:", removeFailed);
        result.photoFailures += 1;
        continue;
      }
      result.photosRemoved += paths.length;
    }

    const { data: deleted, error: deleteError } = await service
      .from("lost_items")
      .delete()
      .eq("id", row.id)
      .eq("organization_id", row.organization_id)
      .eq("status", "disposed")
      .select("id");
    if (deleteError) {
      console.error("[lost-found/purge] delete failed:", deleteError.message);
      result.deleteFailures += 1;
      continue;
    }
    if (deleted && deleted.length > 0) result.deleted += 1;
  }
  return result;
}
