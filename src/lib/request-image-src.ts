// `request-images` 버킷 사진을 화면에 그릴 주소(2026-11-27). 버킷이 비공개라 저장된 공개 주소는 바로 열리지 않는다 —
// 우리 Storage 의 이 버킷 주소(공개 · 서명) 또는 버킷 안 경로를 `/api/request-images/...` 로 바꾸고, 그 라우트가
// 권한을 보고 서명 주소로 보낸다. 다른 버킷 · 다른 프로젝트 · 외부 주소 · blob: 은 그대로 둔다.
// 클라이언트 · 서버 어디서나 쓴다(비밀값 없음). 문서: docs/engineering/05-rls-permissions.md 「request-images 비공개 버킷」

const BUCKET = "request-images";
const ROUTE_PREFIX = "/api/request-images/";
const MARKERS = [
  `/storage/v1/object/public/${BUCKET}/`,
  `/storage/v1/object/sign/${BUCKET}/`,
  `/storage/v1/object/authenticated/${BUCKET}/`,
  `/storage/v1/object/${BUCKET}/`,
];
const BARE_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

function ourStorageHost(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}

function routeFor(path: string): string | null {
  const segments = path.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return ROUTE_PREFIX + segments.map(encodeURIComponent).join("/");
}

// URL 파서는 `..` · `%2E%2E` 를 풀어 버린다 — 파싱 전에 날 문자열에서 거른다.
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}(\/|$|\?|#)/i;

function pathFromStorageUrl(url: string): string | null {
  if (DOT_SEGMENT.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = ourStorageHost();
  if (!host || parsed.host !== host) return null;
  const marker = MARKERS.find((m) => parsed.pathname.startsWith(m));
  if (!marker) return null;
  try {
    return decodeURIComponent(parsed.pathname.slice(marker.length));
  } catch {
    return null;
  }
}

/** 화면 `<img src>` 에 넣을 주소. 우리 request-images 사진이면 `/api/request-images/...`, 아니면 받은 그대로. */
export function requestImageSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith(ROUTE_PREFIX)) return url;
  if (BARE_PATH.test(url)) return routeFor(url) ?? url;
  const path = pathFromStorageUrl(url);
  if (!path) return url;
  return routeFor(path) ?? url;
}

/** 여러 장을 한 번에. */
export function requestImageSrcs(urls: readonly (string | null | undefined)[] | null | undefined): string[] {
  return (urls ?? []).map(requestImageSrc);
}
