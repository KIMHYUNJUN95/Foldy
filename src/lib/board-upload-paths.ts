const REQUEST_IMAGES_MARKER = "/storage/v1/object/public/request-images/";

/**
 * 게시판 사진 공개 URL → `request-images` 버킷 안 경로. 저장이 실패했을 때 방금 올린 사진을 지우는 데 쓴다
 * (게시판 unslop 2026-11-20). 다른 버킷 · 모르는 주소는 null.
 */
export function boardImageStoragePath(url: string): string | null {
  const i = url.indexOf(REQUEST_IMAGES_MARKER);
  if (i < 0) return null;
  const path = url.slice(i + REQUEST_IMAGES_MARKER.length).split("?")[0];
  if (!path) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
