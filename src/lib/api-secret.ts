import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared secret comparison for API routes (2026-10-26).
 *
 * - `safeEqualSecret` compares in constant time and is length-safe (both sides are hashed first,
 *   so differing lengths neither throw nor leak length through timing).
 * - `requestMatchesSecret` collects EVERY candidate the caller sent (bearer, named headers, and —
 *   when `query` is set — `?secret=`) and accepts if any one matches any configured secret. The old
 *   `a ?? b ?? c` chaining only ever looked at the first non-null candidate, so a stray empty or wrong
 *   header could shadow a correct one.
 *
 * Never log the candidates or the configured secrets.
 */
export function safeEqualSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

type RequestLike = {
  headers: Headers;
  nextUrl?: { searchParams: URLSearchParams };
};

export function providedSecretCandidates(
  request: RequestLike,
  options: { headers?: readonly string[]; query?: boolean } = {},
): string[] {
  const out: string[] = [];
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer) out.push(bearer);
  for (const name of options.headers ?? []) {
    const v = request.headers.get(name)?.trim();
    if (v) out.push(v);
  }
  if (options.query) {
    const v = request.nextUrl?.searchParams.get("secret")?.trim();
    if (v) out.push(v);
  }
  return out;
}

/** True when any provided candidate equals any configured (non-empty) secret. */
export function requestMatchesSecret(
  request: RequestLike,
  secrets: ReadonlyArray<string | undefined | null>,
  options: { headers?: readonly string[]; query?: boolean } = {},
): boolean {
  const expected = secrets.map((s) => s?.trim()).filter((s): s is string => !!s);
  if (expected.length === 0) return false;
  const candidates = providedSecretCandidates(request, options);
  let ok = false;
  // No early exit: keep the work independent of which candidate/secret matched.
  for (const c of candidates) {
    for (const e of expected) {
      if (safeEqualSecret(c, e)) ok = true;
    }
  }
  return ok;
}
