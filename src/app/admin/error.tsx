"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FALLBACK_PRIMARY, FALLBACK_SECONDARY, FallbackScreen } from "@/components/fallback-screen";
import { FALLBACK_COPY, resolveFallbackLocale } from "@/lib/fallback-copy";

/**
 * 관리자 콘솔 에러 바운더리.
 *
 * 예전에는 `/admin/*` 이 죽으면 루트 `src/app/error.tsx` 의 흰 화면 + 영어 "Something went wrong."
 * 으로 떨어졌다. 모바일은 브랜드·다국어를 갖춘 화면이 있는데 콘솔만 맨몸이었다(2026-08-05).
 *
 * 모바일 경계와 **같은 문구 소스**(`src/lib/fallback-copy.ts`)를 쓴다 — 앱이 고장난 상태에서 떠야
 * 하는 화면이라 11,000줄짜리 사전 청크에 의존하지 않는다. 언어는 루트 레이아웃이 심어 둔
 * `<html lang>` 에서 읽고, 알 수 없으면 `ko`.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale] = useState(() =>
    resolveFallbackLocale(typeof document === "undefined" ? null : document.documentElement.lang),
  );
  const copy = FALLBACK_COPY[locale];

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <FallbackScreen body={copy.errorBody} locale={locale} title={copy.errorTitle}>
      <button className={FALLBACK_PRIMARY} onClick={reset} type="button">
        {copy.retry}
      </button>
      <Link className={FALLBACK_SECONDARY} href="/admin">
        {copy.home}
      </Link>
    </FallbackScreen>
  );
}
