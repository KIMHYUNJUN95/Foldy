import { createHash, timingSafeEqual } from "node:crypto";

// 크론 라우트 인증 — `Authorization: Bearer <CRON_SECRET>`(Vercel Cron 이 이 형식으로 보낸다).
// 비밀값이 없으면 누구도 통과하지 못한다.
export function isCronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(authorization.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
