/**
 * 리다이렉트 대상이 이 앱 안의 안전한 상대 경로인지 검증한다.
 * 절대 URL, 프로토콜 상대 경로, 백슬래시 우회,
 * 슬래시 하나로 시작하지 않는 모든 값을 거부한다.
 */
export function sanitizeNextPath(value: unknown, fallback = ""): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("://")) return fallback;
  // 브라우저가 백슬래시를 "/" 로 정규화해 /\evil.com 을 //evil.com 으로 바꿀 수 있다.
  if (raw.includes("\\")) return fallback;
  return raw;
}
