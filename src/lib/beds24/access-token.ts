import { beds24Fetch } from "@/lib/beds24/credit-ledger";
import { getOptionalBeds24ApiEnv } from "@/lib/env";

/**
 * Beds24 액세스 토큰 해석 + 프로세스 내 캐시.
 *
 * 리뷰 수집(`reviews-sync`)과 사후 재연결(`review-room-relink`)이 **같은 캐시**를 써야 한다 —
 * 각자 들고 있으면 한 요청 안에서 토큰 갱신이 두 번 일어나고, 갱신 자체가 실패 지점이 두 배가
 * 된다. 두 모듈이 서로를 import 하면 순환 참조가 되므로 여기로 뺐다.
 *
 * 토큰과 refreshToken 은 **절대 로그에 남기지 않는다.**
 */
export type Beds24TokenState = { ok: true; token: string } | { ok: false; skipped: string };

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function resolveBeds24AccessToken(prefix = "beds24"): Promise<Beds24TokenState> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) return { ok: false, skipped: `${prefix}:missing-env` };
  if (env.accessToken) return { ok: true, token: env.accessToken };
  if (!env.refreshToken) return { ok: false, skipped: `${prefix}:missing-token` };
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cachedToken.token };
  }
  try {
    const response = await beds24Fetch(
      `${env.baseUrl.replace(/\/$/, "")}/authentication/token`,
      {
        method: "GET",
        headers: { accept: "application/json", refreshToken: env.refreshToken },
        cache: "no-store",
      },
      { feature: "auth", action: "token.refresh", job: prefix },
    );
    if (!response.ok) {
      return {
        ok: false,
        skipped:
          response.status === 401 || response.status === 403
            ? `${prefix}:refresh-token-invalid`
            : `${prefix}:refresh-http-${response.status}`,
      };
    }
    const json = (await response.json()) as { token?: unknown; expiresIn?: unknown };
    const token = typeof json.token === "string" && json.token.trim() ? json.token.trim() : null;
    if (!token) return { ok: false, skipped: `${prefix}:refresh-missing-token` };
    const expiresIn =
      typeof json.expiresIn === "number" && Number.isFinite(json.expiresIn) ? json.expiresIn : 3600;
    cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return { ok: true, token };
  } catch {
    return { ok: false, skipped: `${prefix}:refresh-request-error` };
  }
}
