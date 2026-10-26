"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FALLBACK_COPY, resolveFallbackLocale } from "@/lib/fallback-copy";

/**
 * 모바일 에러 바운더리 — 밋밋한 흰색 루트 에러 페이지를 브랜드 화면으로 바꿔서, 어떤 /mobile/* 화면에서 에러가
 * 던져져도 크래시가 아니라 복구 가능한 앱 내 상태로 보이게 한다.
 *
 * **사용자 언어로 표시 (2026-08-04).** 예전에는 바운더리가 세션 로케일 맥락 없이 렌더된다는 이유로
 * 세 언어를 한꺼번에 쌓아 보여 줬다. 하지만 루트 레이아웃이 세션 언어를 `<html lang>` 에 쓰고
 * 이것은 클라이언트 컴포넌트라 그냥 읽으면 된다.
 * 세 언어를 쌓으면 폰에서 버튼 글자가 중간에 줄바꿈되는 문제도 있었다. 속성이 없으면 `ko` 로
 * 돌아간다 (`resolveFallbackLocale` 참고).
 */
export default function MobileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 첫 페인트부터 맞는 언어로 그리기 위해 lazy initializer 에서 읽는다. 이 경계는 클라이언트에서만
  // 렌더되지만, 스트리밍 중 서버에서 평가될 여지를 남겨 `document` 유무를 확인한다.
  const [locale] = useState(() =>
    resolveFallbackLocale(typeof document === "undefined" ? null : document.documentElement.lang),
  );
  const copy = FALLBACK_COPY[locale];

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-8 text-center text-foreground">
      {/* 실제 PWA 앱 아이콘 — `not-found.tsx` 와 같은 소스를 써서 콜드런치·에러·404 가 하나의
          브랜드로 읽히게 한다. 예전엔 여기에 그라데이션 박스 + 이탤릭 "S" 를 직접 그렸는데, 그건
          제품 로고가 아니라 이 파일에서만 쓰던 임시 마크였다(2026-08-04). */}
      <Image
        alt="Foldy"
        className="rounded-[20px]"
        height={64}
        priority
        src="/icons/icon-192.png"
        width={64}
      />
      <h1 className="mt-2 text-[19px] font-black tracking-[-0.02em]">{copy.errorTitle}</h1>
      <p className="text-[13.5px] font-medium leading-relaxed text-muted-foreground">
        {copy.errorBody}
      </p>
      <div className="mt-4 flex items-center gap-2.5">
        <button
          className="flex h-12 items-center justify-center rounded-full bg-primary px-7 text-[14px] font-extrabold text-primary-foreground transition-transform active:scale-[0.97]"
          onClick={reset}
          type="button"
        >
          {copy.retry}
        </button>
        <Link
          className="flex h-12 items-center justify-center rounded-full border border-border bg-surface px-7 text-[14px] font-bold text-foreground transition-transform active:scale-[0.97]"
          href="/mobile"
        >
          {copy.home}
        </Link>
      </div>
    </main>
  );
}
