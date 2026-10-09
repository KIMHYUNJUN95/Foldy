/** 가입만 하고 메일 확인을 하지 않은 계정을 이만큼 지나면 지운다. */
export const UNCONFIRMED_SIGNUP_TTL_DAYS = 7;
export type UnconfirmedCandidate = {
  id: string;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  created_at: string;
  identities?: { provider: string }[] | null;
};

/** 순수 판정 — 테스트용으로 따로 둔다. 이메일 가입이고, 확인도 로그인도 한 번 없고, TTL 이 지났을 때만. */
export function isStaleUnconfirmedSignup(user: UnconfirmedCandidate, now: Date, ttlDays = UNCONFIRMED_SIGNUP_TTL_DAYS) {
  if (user.email_confirmed_at || user.phone_confirmed_at || user.last_sign_in_at) return false;
  const providers = (user.identities ?? []).map((i) => i.provider);
  if (providers.some((p) => p !== "email")) return false;
  const created = Date.parse(user.created_at);
  if (!Number.isFinite(created)) return false;
  return now.getTime() - created > ttlDays * 24 * 60 * 60 * 1000;
}

