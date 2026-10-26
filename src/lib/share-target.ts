const MAX_URL_LENGTH = 2048;

/**
 * Web Share Target 으로 받은 URL 을 검증/정제한다.
 * 형식이 잘못됐거나, http(s) 가 아닌 스킴이거나, 문자열이 너무 길면 null 을 반환한다.
 * 라우트 핸들러(서버)와 RSC 페이지 양쪽에서 실행된다 (이중 검증).
 */
export function sanitizeSharedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().slice(0, MAX_URL_LENGTH);
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
