import type { Metadata } from "next";
import { LegalPageShell, resolvePublicLocale } from "@/components/legal/legal-page-shell";
import { getDictionary } from "@/lib/i18n";
import { supportContent } from "@/lib/legal-content";

type PageProps = { searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const locale = await resolvePublicLocale((await searchParams).lang);
  return { title: `${supportContent[locale].title} · Foldy` };
}

/** 고객지원 — App Store 「지원 URL」. 문의 메일은 로그인 차단 화면과 같은 `NEXT_PUBLIC_SUPPORT_EMAIL`. */
export default async function SupportPage({ searchParams }: PageProps) {
  const locale = await resolvePublicLocale((await searchParams).lang);
  const t = getDictionary(locale).legal;
  const content = supportContent[locale];
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";

  return (
    <LegalPageShell active="support" locale={locale}>
      <article>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">{content.title}</h1>
        <p className="mt-3 text-[14.5px] leading-7">{content.summary}</p>

        <section className="mt-6 rounded-xl border border-border bg-muted/20 px-4 py-4">
          <h2 className="text-[16px] font-extrabold">{content.contactHeading}</h2>
          <p className="mt-2 text-[14px] leading-7 text-slate-700">{content.contactBody}</p>
          {supportEmail ? (
            <a
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13.5px] font-bold text-primary-foreground"
              href={`mailto:${supportEmail}?subject=${encodeURIComponent("[Foldy] " + content.title)}`}
            >
              {t.contactEmailCta}
              <span className="font-semibold opacity-80">{supportEmail}</span>
            </a>
          ) : (
            <p className="mt-3 text-[13px] font-semibold text-muted-foreground">{t.contactFallback}</p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-[16px] font-extrabold">{content.faqHeading}</h2>
          <dl className="mt-3 divide-y-[0.5px] divide-[var(--separator)]">
            {content.faqs.map((faq) => (
              <div className="py-3.5" key={faq.q}>
                <dt className="text-[14px] font-bold">{faq.q}</dt>
                <dd className="mt-1 text-[14px] leading-7 text-slate-700">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
    </LegalPageShell>
  );
}
