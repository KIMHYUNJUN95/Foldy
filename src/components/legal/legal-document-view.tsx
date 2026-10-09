import { getDictionary, type Locale } from "@/lib/i18n";
import { LEGAL_EFFECTIVE_DATE, type LegalDocument } from "@/lib/legal-content";

/** 이용약관 · 개인정보처리방침 본문. 조항 구조가 같아 한 컴포넌트로 그린다. */
export function LegalDocumentView({ document, locale }: { document: LegalDocument; locale: Locale }) {
  const t = getDictionary(locale).legal;
  return (
    <article>
      <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">{document.title}</h1>
      <p className="mt-1.5 text-[12.5px] font-semibold text-muted-foreground">
        {t.effectiveDate.replace("{date}", LEGAL_EFFECTIVE_DATE)}
      </p>
      <p className="mt-4 text-[14.5px] leading-7 text-foreground">{document.summary}</p>
      <div className="mt-6 space-y-6">
        {document.sections.map((section) => (
          <section className="scroll-mt-6" id={section.id} key={section.heading}>
            <h2 className="text-[16px] font-extrabold tracking-[-0.01em]">{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p className="mt-2 text-[14px] leading-7 text-slate-700" key={paragraph}>
                {paragraph}
              </p>
            ))}
            {section.items && (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-7 text-slate-700">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
