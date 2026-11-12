import "server-only";

import { requestMatchesSecret } from "@/lib/api-secret";

/**
 * 손님 메시지 정기 실행 라우트(보정 조회 · 발송 큐 · 자동 안내)의 인가 — docs/engineering/07 「손님 메시지 정기 실행」.
 *
 * 받는 값 둘(헤더 `Authorization: Bearer …` 만, 쿼리는 안 받음):
 *  - `CRON_SECRET` — 사람이 손으로 부를 때.
 *  - pg_cron 토큰 — `202611130006_guest_messages_cron.sql` 이 Vault 에 난수로 만든 값. 값은 앱이 모르고
 *    `guest_messages_cron_token_ok()` 로 맞는지만 묻는다(Beds24 틱과 같은 방식). 마이그레이션 전이면 함수가 없어 거절.
 * 둘 다 없으면(CRON_SECRET 미설정 + 토큰 아님) 404 — 예전처럼 닫힌 채. 틀린 값은 403.
 * `CRON_SECRET` 을 먼저 보고, 맞지 않을 때만 서비스 클라이언트를 만들어(`getDb`) DB 에 묻는다.
 */
type TokenChecker = {
  rpc: (fn: "guest_messages_cron_token_ok", args: { p_token: string }) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

export async function authorizeGuestMessagesCron(
  request: { headers: Headers },
  getDb: () => TokenChecker,
): Promise<{ ok: true } | { ok: false; status: 403 | 404 }> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && requestMatchesSecret(request, [cronSecret])) return { ok: true };
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer && bearer.length >= 32) {
    const checked = await getDb().rpc("guest_messages_cron_token_ok", { p_token: bearer });
    if (checked.error) console.error("[guest-messages/cron] token check failed", { code: checked.error.code ?? "unknown" });
    else if (checked.data === true) return { ok: true };
  }
  return { ok: false, status: cronSecret ? 403 : 404 };
}
