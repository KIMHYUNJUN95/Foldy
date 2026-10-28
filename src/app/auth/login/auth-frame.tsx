import "./auth-white.css";
import Link from "next/link";
import { LanguageSheet } from "@/app/auth/login/language-sheet";
import { FoldyMark } from "@/components/brand/foldy-mark";
import { NavCachePurge } from "@/components/shell/nav-cache-purge";
import { LegalLink } from "@/components/legal/legal-overlay";
import { legalOverlayProps } from "@/components/legal/legal-overlay-props";
import { legalHref } from "@/components/legal/legal-page-shell";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { ReactNode } from "react";

const Back = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/**
 * AuthFrame — 로그인 / 가입 / 재설정 화면 (화이트 리디자인 2026-10-09).
 *
 * 흰 바탕 한 페이지, 브랜드 패널 없음. 넓은 화면 (≥ 1200px): 헤더 (마크 · Foldy · 「운영 콘솔」,
 * 오른쪽에 언어 선택 — 도움말은 푸터에만 있음, 2026-10-09), 가운데 400px 스테이지, 푸터 (직원 전용 안내 · 약관 링크).
 * 더 좁은 화면 (폰 · 폴드 · 태블릿 가로): 가운데 한 단 — 위에 뒤로 + 언어,
 * 맨 아래에 약관 링크. 참고: docs/product/05-admin-web-ia.md → 「Admin Login Screen」 및
 * docs/design/05-white-redesign.md.
 */
export function AuthFrame({
  locale,
  next,
  view,
  backHref,
  mobileCopy = false,
  children,
}: {
  locale: Locale;
  next: string;
  view?: string;
  /** 뒤로 가기 컨트롤을 표시한다 (좁은 화면은 왼쪽 위 화살표, 넓은 화면은 텍스트 링크). */
  backHref?: string;
  /** Phone · tablet · app — hides the 「운영 콘솔」 label (app-review copy rule, 2026-10-08). */
  mobileCopy?: boolean;
  children: ReactNode;
}) {
  const dict = getDictionary(locale);
  const c = dict.auth.console;
  const e = dict.auth.entry;
  const legal = legalOverlayProps(locale);

  return (
    // 표시 언어를 여기서 명시한다. `<html lang>` 은 세션·쿠키 기준이라, 로그아웃 상태에서 `?lang=`
    // 로만 언어를 바꾼 첫 방문에는 실제 화면 언어와 어긋난다.
    <div className="authw" lang={locale}>
      <NavCachePurge />
      <header className="authw__top">
        <div className="authw__brand">
          <FoldyMark />
          <span className="authw__wm">Foldy</span>
          {!mobileCopy && <span className="authw__role">{c.role}</span>}
        </div>
        {backHref ? (
          <Link href={backHref} className="authw__backicon" aria-label={dict.auth.email.back}>
            <span className="ic">{Back}</span>
          </Link>
        ) : (
          <span className="authw__backicon is-empty" aria-hidden="true" />
        )}
        <div className="authw__tools">
          <LanguageSheet locale={locale} next={next} view={view} />
        </div>
      </header>

      <main className="authw__stage">
        <div className="authw__col">
          {backHref && (
            <Link href={backHref} className="authw__backlink">
              <span className="ic">{Back}</span>
              {dict.auth.email.back}
            </Link>
          )}
          {children}
        </div>
      </main>

      <footer className="authw__foot">
        <span className="authw__staff">{c.footStaff}</span>
        <span className="authw__legal">
          <LegalLink doc="terms" href={legal.hrefs.terms} {...legal}>{e.termsLink}</LegalLink>
          <LegalLink doc="privacy" href={legal.hrefs.privacy} {...legal}>{e.privacyLink}</LegalLink>
          <Link href={legalHref("support", locale)}>{e.helpLink}</Link>
        </span>
      </footer>
    </div>
  );
}
