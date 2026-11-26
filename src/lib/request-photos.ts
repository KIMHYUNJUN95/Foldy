import { isOwnStoragePublicUrl, storagePathFromPublicUrl } from "@/lib/storage-url-guard";
import { REQUEST_IMAGE_BUCKET } from "@/lib/task-images";

export type RequestPhotoColumn = { column: string; folder: string };

/** 열 → 사진이 올라가는 폴더(업로더가 `{조직}/{폴더}/{기록 id}/` 로 고정 — lost-item-create · maintenance-create · 처리 사진 액션). */
export const LOST_ITEM_PHOTO_COLUMNS: ReadonlyArray<RequestPhotoColumn> = [
  { column: "image_urls", folder: "lost-items" },
  { column: "handling_image_urls", folder: "lost-found-handling" },
];

export const MAINTENANCE_PHOTO_COLUMNS: ReadonlyArray<RequestPhotoColumn> = [
  { column: "image_urls", folder: "maintenance-reports" },
  { column: "resolution_image_urls", folder: "maintenance-resolutions" },
];

/** 기록 행의 사진 주소 중 **이 조직 · 이 기록 폴더 바로 아래** 파일만 버킷 경로로. 다른 조직 · 다른 기록 · 외부 주소는 버린다. */
export function requestPhotoPaths(
  row: Record<string, unknown>,
  columns: ReadonlyArray<RequestPhotoColumn>,
  organizationId: string,
  recordId: string,
): string[] {
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
  return [...paths];
}
