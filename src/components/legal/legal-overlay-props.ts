import { legalHref } from "@/components/legal/legal-page-shell";
import type { LegalOverlayCopy, LegalOverlayDoc } from "@/components/legal/legal-overlay";
import { getDictionary, type Locale } from "@/lib/i18n";
import { privacyPolicy, termsOfService, type LegalDocument } from "@/lib/legal-content";

/** 서버에서 `LegalLink` 에 넘길 문구 · 문서 · 주소를 한 번에 만든다(클라이언트에 i18n 전체를 싣지 않게). */
export function legalOverlayProps(locale: Locale): {
  copy: LegalOverlayCopy;
  documents: Record<LegalOverlayDoc, LegalDocument>;
  hrefs: Record<LegalOverlayDoc, string>;
} {
  const t = getDictionary(locale).legal;
  return {
    copy: {
      title: t.overlayTitle,
      termsTab: t.navTerms,
      privacyTab: t.navPrivacy,
      confirm: t.overlayConfirm,
      openNew: t.overlayOpenNew,
      close: t.overlayClose,
    },
    documents: { terms: termsOfService[locale], privacy: privacyPolicy[locale] },
    hrefs: { terms: legalHref("terms", locale), privacy: legalHref("privacy", locale) },
  };
}
