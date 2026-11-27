const PREFIX = "/api/request-images/";

/** 같은 출처의 `/api/request-images/…` 링크인가 — 앱 WebView 가 이걸 그대로 열면 Supabase 로 리다이렉트되어 시스템 브라우저로 튕긴다. */
export function isRequestImageLink(url: URL, currentOrigin: string): boolean {
  return url.origin === currentOrigin && url.pathname.startsWith(PREFIX);
}

/** 서명 주소를 JSON 으로 받는 요청 주소(`?as=json`). */
export function requestImageJsonHref(url: URL): string {
  return `${url.pathname}?as=json`;
}

/** 서버가 준 서명 주소가 우리 Supabase 호스트의 https 주소인가 — 환경값이 없으면 거절. */
export function isTrustedSignedImageUrl(candidate: unknown, supabaseUrl: string | undefined): candidate is string {
  if (typeof candidate !== "string" || !supabaseUrl) return false;
  try {
    const u = new URL(candidate);
    return u.protocol === "https:" && u.host === new URL(supabaseUrl).host;
  } catch {
    return false;
  }
}
