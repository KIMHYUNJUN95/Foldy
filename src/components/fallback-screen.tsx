import Image from "next/image";
import type { ReactNode } from "react";

// 자기 active: 유틸리티가 있어 전역 누름 규칙(globals.css)에서 빠진다 — 0.97 / 160ms 를 여기서 한 번만 정한다.
export const FALLBACK_PRIMARY =
  "flex h-12 w-full items-center justify-center rounded-[14px] bg-primary text-[15px] font-semibold text-primary-foreground transition-transform duration-[160ms] ease-out active:scale-[0.97]";
export const FALLBACK_SECONDARY =
  "mt-2.5 flex h-11 w-full items-center justify-center text-[14px] font-semibold text-primary transition-transform duration-[160ms] ease-out active:scale-[0.97]";

/** 오류 · 404 · 사용할 수 없음 공용 모양 (`app-error-screen.tsx` 와 같은 치수). */
export function FallbackScreen({
  locale,
  title,
  body,
  children,
}: {
  locale: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <main
      className="flex min-h-svh items-center justify-center bg-background pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-center text-foreground"
      lang={locale}
    >
      <div className="w-full max-w-[340px]">
        <Image alt="" className="mx-auto mb-5 block rounded-[16px]" height={64} priority src="/icons/icon-192.png" width={64} />
        <h1 className="mb-2.5 text-[20px] font-semibold leading-[1.35] tracking-[-0.01em] text-balance [&:lang(ko)]:break-keep">{title}</h1>
        <p className="text-[14px] leading-[1.6] text-muted-foreground text-pretty [&:lang(ko)]:break-keep">{body}</p>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
