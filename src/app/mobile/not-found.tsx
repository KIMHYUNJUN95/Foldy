import Image from "next/image";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { FALLBACK_COPY } from "@/lib/fallback-copy";
import { resolvePreSessionLocale } from "@/lib/i18n";
import { getCurrentAppSession } from "@/lib/session";

/**
 * 모바일 404 — 브랜드 화면, 보는 사람의 언어로. `/mobile/.../[id]` 딥링크가
 * 삭제되었거나 없는 기록을 가리킬 때 나타난다(상세 로더가 null 반환 → notFound()). 기본 프레임워크
 * 404 대신 쓴다. 정식 PWA 앱 아이콘(스플래시 화면과 동일)을 써서 브랜드가 일관되게
 * 콜드 런치와 오류 화면에 걸쳐 유지된다.
 *
 * **2026-08-04 부터 현지화.** 이 파일은 서버 컴포넌트라 세션의 `preferredLanguage` 를
 * 쓸 수 있다 — 세 언어를 모두 쌓아 보여주던 예전 근거인 "세션 로케일 컨텍스트 없이 렌더링"은
 * 성립하지 않았다. 로그아웃 상태의 방문자는 루트 404 의 순서를 따른다(2026-10-23):
 * `stayops_locale` 쿠키 → Accept-Language (지원하지 않으면 en) — 예전에는 무조건 `ko` 였다.
 */
export default async function MobileNotFound() {
  const session = await getCurrentAppSession().catch(() => null);
  const locale =
    session?.user.preferredLanguage ??
    resolvePreSessionLocale({
      cookie: (await cookies()).get("stayops_locale")?.value,
      acceptLanguage: (await headers()).get("accept-language"),
    });
  const copy = FALLBACK_COPY[locale];

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-8 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-center text-foreground">
      <Image
        alt="Foldy"
        className="rounded-[22px] shadow-[0_22px_50px_-26px_rgb(122_82_230/0.55)]"
        height={84}
        priority
        src="/icons/icon-192.png"
        width={84}
      />

      <h1 className="mt-7 text-[22px] font-black tracking-[-0.02em]">{copy.notFoundTitle}</h1>

      <p className="mt-3 text-[13px] font-medium leading-relaxed text-muted-foreground">
        {copy.notFoundBody}
      </p>

      <Link
        className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-8 text-[14px] font-extrabold text-primary-foreground shadow-[0_14px_28px_-12px_rgb(122_82_230/0.55)] transition-transform active:scale-[0.97]"
        href="/mobile"
      >
        {copy.goHome}
      </Link>
    </main>
  );
}
