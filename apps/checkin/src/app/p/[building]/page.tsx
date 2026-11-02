import { notFound } from "next/navigation";

import { StartFlow } from "@/components/start-flow";
import { isBuildingKey } from "@/lib/building-key";
import { getDictionary, LOCALES, type Locale } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { todayTokyo } from "@/lib/tokyo-date";

// 건물 고정 공개 링크(44 FR-W01). 메시지 · QR 이 모두 이 주소를 연다.
export default async function BuildingStart({ params }: { params: Promise<{ building: string }> }) {
  const [{ building }, locale] = await Promise.all([params, getLocale()]);
  if (!isBuildingKey(building)) notFound();
  const dict = getDictionary(locale);

  const langPrompts = Object.fromEntries(
    LOCALES.map((option) => {
      const each = getDictionary(option);
      return [option, { prompt: each.lang.prompt, hint: each.lang.hint }];
    }),
  ) as Record<Locale, { prompt: string; hint: string }>;
  const welcomes = Object.fromEntries(LOCALES.map((option) => [option, getDictionary(option).start.welcome])) as Record<
    Locale,
    string
  >;

  return (
    <StartFlow
      building={building}
      buildingName={(dict.buildings as Record<string, string>)[building]}
      locale={locale}
      dict={dict}
      langPrompts={langPrompts}
      welcomes={welcomes}
      today={todayTokyo()}
    />
  );
}
