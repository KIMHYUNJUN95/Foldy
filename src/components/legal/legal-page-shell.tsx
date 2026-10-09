import Link from "next/link";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import {
  getDictionary,
  inferLocaleFromAcceptLanguage,
  isLocale,
  locales,
  type Locale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type LegalPageKey = "terms" | "privacy" | "support" | "deletion";

const LOCALE_COOKIE = "stayops_locale";

const PAGE_PATHS: Record<LegalPageKey, string> = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  support: "/support",
  deletion: "/legal/account-deletion",
};

/** 로그인 없이 여는 공개 페이지라 세션 대신 로그인 화면과 같은 순서로 언어를 고른다:
 *  `?lang=` → `stayops_locale` 쿠키 → Accept-Language → ko. */
export async function resolvePublicLocale(lang: string | undefined): Promise<Locale> {
  if (isLocale(lang)) return lang;
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  return inferLocaleFromAcceptLanguage((await headers()).get("accept-language") ?? "");
}

export function legalHref(page: LegalPageKey, locale: Locale, hash?: string) {
  return `${PAGE_PATHS[page]}?lang=${locale}${hash ? `#${hash}` : ""}`;
}

/**
 * 공개 법적 고지 · 고객지원 페이지의 공용 틀 (2026-10-06).
 *
 * App Store 심사 · 앱 안 링크가 가리키는 페이지라 로그인 없이 열리고(미들웨어 보호 경로 밖),
 * 모바일 셸 · 관리 콘솔 어느 쪽에도 속하지 않는다. 읽기용 문서이므로 폰 · 폴드 · 태블릿 모두
 * 760px 읽기 폭 한 칸이 정답이다(본문 줄 길이를 넓히지 않는다). 상단은 standalone PWA 의
 * 상태 표시줄을 피하도록 safe-area 를 더한다.
 */
export function LegalPageShell({
  locale,
  active,
  children,
}: {
  locale: Locale;
  active: LegalPageKey;
  children: ReactNode;
}) {
  const dictionary = getDictionary(locale);
  const t = dictionary.legal;
  const tabs: { key: LegalPageKey; label: string }[] = [
    { key: "terms", label: t.navTerms },
    { key: "privacy", label: t.navPrivacy },
    { key: "support", label: t.navSupport },
    { key: "deletion", label: t.navDeletion },
  ];

  return (
    <div className="min-h-dvh bg-background text-foreground" lang={locale}>
      <div className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link
            className="text-[13px] font-bold text-muted-foreground transition-colors hover:text-foreground"
            href="/"
          >
            ← {t.backToApp}
          </Link>
          <nav aria-label={t.languageAria} className="flex gap-1">
            {locales.map((code) => (
              <Link
                aria-current={code === locale ? "true" : undefined}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[12px] font-bold transition-colors",
                  code === locale
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
                href={legalHref(active, code)}
                hrefLang={code}
                key={code}
              >
                {dictionary.languages[code]}
              </Link>
            ))}
          </nav>
        </header>

        <nav aria-label={t.navAria} className="mt-6 flex gap-1.5 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <Link
              aria-current={tab.key === active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-bold transition-colors",
                tab.key === active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-slate-600 hover:bg-muted/60",
              )}
              href={legalHref(tab.key, locale)}
              key={tab.key}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <main className="mt-4 rounded-2xl border border-border bg-surface px-5 py-6 shadow-[0_1px_2px_rgba(20,32,43,0.04)] sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export { LegalDocumentView } from "@/components/legal/legal-document-view";
