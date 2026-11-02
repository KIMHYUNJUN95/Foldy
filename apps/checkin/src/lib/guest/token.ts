import { createHash, randomBytes } from "node:crypto";

// 링크 토큰: 32바이트 랜덤, DB 에는 sha256 만(16 §4). 원문은 발급할 때 한 번만 돌려준다.
export function newGuestToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashGuestToken(raw) };
}

export function hashGuestToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isTokenShaped(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(raw);
}
