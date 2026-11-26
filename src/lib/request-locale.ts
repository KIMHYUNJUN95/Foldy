import { cookies, headers } from "next/headers";
import { resolvePreSessionLocale, type Locale } from "@/lib/i18n";

/** `<html lang>` · 404 · 오류 화면이 같은 언어를 고르게 하는 한 곳: 세션 → 쿠키 → Accept-Language. */
export function pickRequestLocale(input: {
  sessionLocale?: Locale | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (input.sessionLocale) return input.sessionLocale;
  return resolvePreSessionLocale({ cookie: input.cookie, acceptLanguage: input.acceptLanguage });
}

export async function resolveRequestLocale(session: { user: { preferredLanguage?: Locale | null } } | null) {
  const sessionLocale = session?.user.preferredLanguage;
  if (sessionLocale) return sessionLocale;
  return pickRequestLocale({
    cookie: (await cookies()).get("stayops_locale")?.value,
    acceptLanguage: (await headers()).get("accept-language"),
  });
}
