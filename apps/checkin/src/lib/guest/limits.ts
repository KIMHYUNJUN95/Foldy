import { createHmac } from "node:crypto";

// 예약 찾기 막기 규칙(시안 W1x · W1L, 44 FR-W01). 판정만 여기, 기록은 claim 라우트.
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 10;
export const IP_PER_MINUTE = 30;

export function attemptKeys(ip: string, building: string, secret: string) {
  const hmac = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  return { keyHash: hmac(`claim|${building}|${ip}`), ipHash: hmac(`ip|${ip}`) };
}

export type AttemptRow = { succeeded: boolean; attempted_at: string };

/**
 * 최근 10분 시도(새것 먼저)로 잠김을 본다. 성공하면 그 앞의 실패는 지운 셈 친다.
 * 잠기면 마지막 실패 + 10분까지.
 */
export function lockState(recent: AttemptRow[], now: Date) {
  const windowStart = now.getTime() - LOCK_MINUTES * 60_000;
  let failures = 0;
  let lastFailure: number | null = null;
  for (const row of recent) {
    const at = Date.parse(row.attempted_at);
    if (at < windowStart) break;
    if (row.succeeded) break;
    failures += 1;
    lastFailure ??= at;
  }
  const locked = failures >= MAX_FAILURES && lastFailure !== null;
  return {
    failures,
    remaining: Math.max(0, MAX_FAILURES - failures),
    lockedUntil: locked ? new Date(lastFailure! + LOCK_MINUTES * 60_000).toISOString() : null,
  };
}
