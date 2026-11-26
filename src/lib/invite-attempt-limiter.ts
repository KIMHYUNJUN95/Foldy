/**
 * 초대 코드 시도 횟수 제한 — 사용자당 10분에 10번(미리보기 + 가입 합산).
 *
 * 서버리스 인스턴스 메모리라 인스턴스마다 따로 센다(최선 노력). 인스턴스를 가로지르는 확실한 제한은 저장 표가 필요해
 * 마이그레이션 결정을 기다린다(docs/engineering/05-rls-permissions.md 「초대 코드 시도 제한」).
 */
export const INVITE_ATTEMPT_LIMIT = 10;
export const INVITE_ATTEMPT_WINDOW_MS = 10 * 60_000;

const attempts = new Map<string, number[]>();

/** 시도 한 번을 센다. 한도를 넘었으면 세지 않고 false. */
export function takeInviteAttempt(userId: string, now: number = Date.now()): boolean {
  const recent = (attempts.get(userId) ?? []).filter((at) => now - at < INVITE_ATTEMPT_WINDOW_MS);
  if (recent.length >= INVITE_ATTEMPT_LIMIT) {
    attempts.set(userId, recent);
    return false;
  }
  recent.push(now);
  attempts.set(userId, recent);
  if (attempts.size > 5000) {
    for (const [key, times] of attempts) {
      if (times.every((at) => now - at >= INVITE_ATTEMPT_WINDOW_MS)) attempts.delete(key);
    }
  }
  return true;
}

export function resetInviteAttempts() {
  attempts.clear();
}
