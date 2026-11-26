import Link from "next/link";
import { FALLBACK_PRIMARY, FallbackScreen } from "@/components/fallback-screen";
import { FALLBACK_COPY } from "@/lib/fallback-copy";
import { resolveRequestLocale } from "@/lib/request-locale";
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
  const locale = await resolveRequestLocale(session);
  const copy = FALLBACK_COPY[locale];

  return (
    <FallbackScreen body={copy.notFoundBody} locale={locale} title={copy.notFoundTitle}>
      <Link className={FALLBACK_PRIMARY} href="/mobile">
        {copy.goHome}
      </Link>
    </FallbackScreen>
  );
}
