import { createHmac } from "node:crypto";

import { nameTokens } from "./match";

// 예약 찾기 막기 규칙(시안 W1x · W1L, 44 FR-W01). 판정만 여기, 기록은 claim 라우트.
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 10;
export const IP_PER_MINUTE = 30;
// IP 를 바꿔 가며 넣어 보기 막기(2026-11-13): 같은 건물 · 날짜 · 이름은 하루 15번 실패까지.
export const NAME_DAY_MAX_FAILURES = 15;
export const NAME_DAY_MS = 24 * 60 * 60_000;
// 건물 전체는 막지 않는다 — 누구나 건물 하나를 통째로 잠글 수 있게 되므로. 시간당 30번 실패를 넘으면 경고 로그만 남긴다.
export const BUILDING_HOUR_ALERT_FAILURES = 30;
export const BUILDING_HOUR_MS = 60 * 60_000;
// 기기 등록 코드(8자리): IP 와 무관하게 10분 안 전체 실패 100번이면 잠시 모두 거절(2026-11-13).
// 모든 조직이 같이 쓰는 상한이라 넉넉히 둔다 — 한 조직의 실수가 다른 조직의 등록을 막지 않게. 8자리(1억 개) 중 살아 있는 코드는 몇 개뿐이라
// 10분 100번이면 맞힐 확률은 무시할 만하다.
export const ENROLL_GLOBAL_MAX_FAILURES = 100;
export const ENROLL_GLOBAL_WINDOW_MS = 10 * 60_000;
/** IP 와 무관한 줄의 `ip_hash` 자리 — 실제 HMAC 과 겹치지 않아 IP 분당 횟수에 섞이지 않는다. */
export const NO_IP_HASH = "-";

const hmacOf = (secret: string) => (value: string) => createHmac("sha256", secret).update(value).digest("hex");

export function attemptKeys(ip: string, building: string, secret: string) {
  const hmac = hmacOf(secret);
  return { keyHash: hmac(`claim|${building}|${ip}`), ipHash: hmac(`ip|${ip}`) };
}

/**
 * 이름 키 — `sameName` 이 같은 예약으로 맞춰 주는 입력(순서 · 띄어쓰기 · 대소문자 · 악센트만 다름)은 모두 같은 키가 되도록
 * 이름 글자를 정렬해 쓴다. 이름 원문은 HMAC 안에만 있다.
 */
export function claimNameKey(building: string, checkInDate: string, lastName: string, firstName: string, secret: string): string {
  const letters = [...[...nameTokens(lastName), ...nameTokens(firstName)].join("")].sort().join("");
  return hmacOf(secret)(`claim-name|${building}|${checkInDate}|${letters}`);
}

export function claimBuildingKey(building: string, secret: string): string {
  return hmacOf(secret)(`claim-building|${building}`);
}

/** 이름 · 건물이 없는 전체 키(기기 등록 코드 전체 실패 상한 등). */
export function scopeKey(scope: string, secret: string): string {
  return hmacOf(secret)(`scope|${scope}`);
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

/**
 * 창(windowMs) 안 실패가 max 번 이상이면 잠금 — 성공 앞의 실패는 지운 셈. 풀리는 때는 max 번째로 새 실패가 창을 벗어날 때.
 */
export function windowLock(recent: AttemptRow[], now: Date, rule: { max: number; windowMs: number }) {
  const windowStart = now.getTime() - rule.windowMs;
  const failures: number[] = [];
  for (const row of recent) {
    const at = Date.parse(row.attempted_at);
    if (at < windowStart || row.succeeded) break;
    failures.push(at);
  }
  const edge = failures.length >= rule.max ? failures[rule.max - 1] + rule.windowMs : null;
  return { failures: failures.length, lockedUntil: edge !== null && edge > now.getTime() ? new Date(edge).toISOString() : null };
}

/**
 * 「예약 찾기」 잠금 전부 — (IP + 건물) 10분 · (건물 + 날짜 + 이름) 10분 · 같은 이름 하루. 건물 전체는 막지 않는다(`BUILDING_HOUR_ALERT_FAILURES`).
 * 응답은 하나(`locked` + 가장 늦게 풀리는 때)라 무엇 때문에 막혔는지 드러나지 않는다.
 */
export function claimLock(rows: { ip: AttemptRow[]; name: AttemptRow[] }, now: Date) {
  const ip = lockState(rows.ip, now);
  const name = lockState(rows.name, now);
  const nameDay = windowLock(rows.name, now, { max: NAME_DAY_MAX_FAILURES, windowMs: NAME_DAY_MS });
  const locks = [ip.lockedUntil, name.lockedUntil, nameDay.lockedUntil].filter((value): value is string => !!value);
  return {
    failures: Math.max(ip.failures, name.failures),
    remaining: Math.min(ip.remaining, name.remaining),
    lockedUntil: locks.length ? locks.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null,
  };
}
