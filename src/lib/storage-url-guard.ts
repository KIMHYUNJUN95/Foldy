// 우리 Supabase Storage 의 공개 주소인지 검사하는 공용 도우미(2026-10-26).
//
// 사진 주소는 클라이언트가 올린 뒤 서버 액션으로 넘겨 DB 에 저장된다. 서버가 주소 모양을 보지 않으면
// 아무 외부 주소(추적 픽셀 · 다른 조직의 사진)나 저장될 수 있다. 여기서는
//   1) 우리 Supabase 호스트(NEXT_PUBLIC_SUPABASE_URL)인지 — 환경변수가 없으면 이 검사는 건너뛴다,
//   2) `/storage/v1/object/public/{bucket}/` (또는 `/storage/v1/object/{bucket}/`) 아래인지,
//   3) 그 뒤 경로가 `prefix` 로 시작하고 남는 부분이 파일 이름 한 칸(슬래시 · `..` 없음)인지
// 를 본다. `prefix` 는 업로더가 실제로 쓰는 `{조직}/{폴더}/{요청 id}/` 처럼 슬래시로 끝나게 준다.
// 클라이언트 · 서버 어디서나 쓸 수 있다(서버 전용 모듈 없음).

const SAFE_FILE = /^[A-Za-z0-9._-]+$/;

function ourStorageHost(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}

/** 공개 주소에서 버킷 안 경로(`{조직}/{폴더}/.../{파일}`)를 꺼낸다. 우리 주소가 아니면 null. */
export function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = ourStorageHost();
  if (host && parsed.host !== host) return null;
  if (parsed.search || parsed.hash) return null;
  const markers = [`/storage/v1/object/public/${bucket}/`, `/storage/v1/object/${bucket}/`];
  for (const marker of markers) {
    if (!parsed.pathname.startsWith(marker)) continue;
    let path: string;
    try {
      path = decodeURIComponent(parsed.pathname.slice(marker.length));
    } catch {
      return null;
    }
    if (path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
    return path;
  }
  return null;
}

/**
 * `url` 이 우리 Storage `bucket` 의 `prefix` 바로 아래 파일 한 장인지.
 * 예: `isOwnStoragePublicUrl(url, "request-images", \`${orgId}/maintenance-resolutions/${reportId}/\`)`.
 * 업로더가 `prefix` 아래에 무작위 폴더를 한 칸 더 두면(제안함: `{조직}/suggestion-images/{무작위 id}/{파일}`)
 * `{ subfolders: 1 }` 을 준다.
 */
export function isOwnStoragePublicUrl(
  url: string,
  bucket: string,
  prefix: string,
  options: { subfolders?: number } = {},
): boolean {
  if (typeof url !== "string" || !prefix.endsWith("/")) return false;
  const path = storagePathFromPublicUrl(url, bucket);
  if (!path || !path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length).split("/");
  if (rest.length !== (options.subfolders ?? 0) + 1) return false;
  return rest.every((seg) => seg.length > 0 && SAFE_FILE.test(seg));
}

/** 여러 장을 한 번에 — 하나라도 어긋나면 false. */
export function areOwnStoragePublicUrls(
  urls: readonly string[],
  bucket: string,
  prefix: string,
  options: { subfolders?: number } = {},
): boolean {
  return Array.isArray(urls) && urls.every((url) => isOwnStoragePublicUrl(url, bucket, prefix, options));
}
