import { redirect } from "next/navigation";

import { TermsForm } from "@/components/terms-form";
import { getStayOr404 } from "@/lib/guest/page";
import { fmt, getDictionary } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// 약관 동의(시안 W3b). 아직 다 넣지 않은 사람이 있으면 목록으로 돌려보낸다(서버도 다시 막는다).
export const dynamic = "force-dynamic";

export default async function TermsPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, locale] = await Promise.all([params, getLocale()]);
  const stay = await getStayOr404(token);
  if (!stay.editable || stay.guests.some((guest) => guest.missing.length > 0) || stay.guests.length < stay.partySize) {
    redirect(`/r/${token}?view=list`);
  }
  const dict = getDictionary(locale);

  // 약관 전문은 건물 설정(property_settings.terms_text)에 있을 때만 보여 준다.
  const { data: settings } = await createCheckinServiceClient()
    .from("property_settings")
    .select("terms_text")
    .eq("organization_id", stay.organizationId)
    .eq("property_key", stay.propertyKey)
    .maybeSingle();
  const texts = (settings?.terms_text ?? {}) as Record<string, unknown>;
  const termsText = [locale, "en", "ja"].map((key) => texts[key]).find((value): value is string => typeof value === "string" && !!value) ?? null;

  return (
    <TermsForm
      token={token}
      locale={locale}
      dict={{ terms: dict.terms, common: dict.common }}
      counter={fmt(dict.terms.counter, { n: stay.guests.length })}
      countNote={
        stay.guests.length !== stay.guestCountExpected
          ? fmt(dict.terms.countDiffers, { booked: stay.guestCountExpected, n: stay.guests.length })
          : null
      }
      termsText={termsText}
    />
  );
}
