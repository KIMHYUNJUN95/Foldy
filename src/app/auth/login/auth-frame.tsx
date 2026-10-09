import "./auth-white.css";
import Link from "next/link";
import { LanguageSheet } from "@/app/auth/login/language-sheet";
import { FoldyMark } from "@/components/brand/foldy-mark";
import { legalHref } from "@/components/legal/legal-page-shell";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { ReactNode } from "react";

const Back = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/**
 * AuthFrame — login / signup / reset surface (white redesign 2026-10-09).
 *
 * One white page, no brand panel. Wide screens (≥ 1200px): a header (mark · Foldy · 「운영 콘솔」,
 * Language on the right — help lives only in the footer, 2026-10-09), a centred 400px stage and a footer (staff-only note · legal links).
 * Narrower (phone · fold · tablet landscape): a single centred column — back + Language on top,
 * legal links at the bottom. See docs/product/05-admin-web-ia.md → 「Admin Login Screen」 and
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
  /** Shows a back control (top-left chevron on narrow screens, text link on wide screens). */
  backHref?: string;
  /** Phone · tablet · app — hides the 「운영 콘솔」 label (app-review copy rule, 2026-10-08). */
  mobileCopy?: boolean;
  children: ReactNode;
}) {
  const dict = getDictionary(locale);
  const c = dict.auth.console;
  const e = dict.auth.entry;

  return (
    // 표시 언어를 여기서 명시한다. `<html lang>` 은 세션·쿠키 기준이라, 로그아웃 상태에서 `?lang=`
    // 로만 언어를 바꾼 첫 방문에는 실제 화면 언어와 어긋난다.
    <div className="authw" lang={locale}>
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
          <Link href={legalHref("terms", locale)}>{e.termsLink}</Link>
          <Link href={legalHref("privacy", locale)}>{e.privacyLink}</Link>
          <Link href={legalHref("support", locale)}>{e.helpLink}</Link>
        </span>
      </footer>
    </div>
  );
}
