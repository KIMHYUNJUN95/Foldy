import "server-only";

import { cookies, headers } from "next/headers";

import { isLocale, pickLocale, type Locale } from "./index";

// 손님이 W0 에서 고른 언어(쿠키) → 없으면 브라우저 언어.
export const LOCALE_COOKIE = "ci_lang";

export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const chosen = cookieStore.get(LOCALE_COOKIE)?.value;
  return isLocale(chosen) ? chosen : pickLocale(headerList.get("accept-language"));
}
