import Link from "next/link";
import { FALLBACK_PRIMARY, FallbackScreen } from "@/components/fallback-screen";
import { FALLBACK_COPY } from "@/lib/fallback-copy";
import { resolveRequestLocale } from "@/lib/request-locale";
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
  const locale = await resolveRequestLocale(session);
  const copy = FALLBACK_COPY[locale];

  return (
    <FallbackScreen body={copy.notFoundBody} locale={locale} title={copy.notFoundTitle}>
      <Link className={FALLBACK_PRIMARY} href="/">
        {copy.goHome}
      </Link>
    </FallbackScreen>
  );
}
