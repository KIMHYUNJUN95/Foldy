import Image from "next/image";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { FALLBACK_COPY, resolveFallbackLocale } from "@/lib/fallback-copy";
import { inferLocaleFromAcceptLanguage } from "@/lib/i18n";
import { getCurrentAppSession } from "@/lib/session";

/**
 * 루트 404 — `/mobile` 밖의 없는 주소 · `/admin` 상세의 `notFound()` 가 닿는 곳(2026-10-23).
 *
 * 이 파일이 없을 때는 Next 기본 화면(영어 「404 | This page could not be found.」)이 떴다.
 * 문구는 `src/app/mobile/not-found.tsx` 와 같은 폴백 테이블(`src/lib/fallback-copy.ts`)을 쓰고, 언어는 루트
 * 레이아웃의 `<html lang>` 과 같은 순서로 고른다: 세션 → `stayops_locale` 쿠키 → Accept-Language.
 * 「홈으로」는 `/` — 기기에 맞는 화면(모바일 · 대시보드 · 로그인)으로 다시 나눠 보낸다.
 */
export default async function RootNotFound() {
  const session = await getCurrentAppSession().catch(() => null);
  const cookieLocale = (await cookies()).get("stayops_locale")?.value;
  const locale = session?.user.preferredLanguage
    ? resolveFallbackLocale(session.user.preferredLanguage)
    : cookieLocale
      ? resolveFallbackLocale(cookieLocale)
      : inferLocaleFromAcceptLanguage((await headers()).get("accept-language") ?? "");
  const copy = FALLBACK_COPY[locale];

  return (
    <main
      className="flex min-h-svh flex-col items-center justify-center bg-background px-8 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-center text-foreground"
      lang={locale}
    >
      <Image
        alt="Foldy"
        className="rounded-[22px] shadow-[0_22px_50px_-26px_rgb(122_82_230/0.55)]"
        height={84}
        priority
        src="/icons/icon-192.png"
        width={84}
      />

      <h1 className="mt-7 text-[22px] font-black tracking-[-0.02em]">{copy.notFoundTitle}</h1>

      <p className="mt-3 text-[13px] font-medium leading-relaxed text-muted-foreground">{copy.notFoundBody}</p>

      <Link
        className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-8 text-[14px] font-extrabold text-primary-foreground shadow-[0_14px_28px_-12px_rgb(122_82_230/0.55)] transition-transform active:scale-[0.97]"
        href="/"
      >
        {copy.goHome}
      </Link>
    </main>
  );
}
