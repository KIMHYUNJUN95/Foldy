import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getDictionary, pickLocale } from "@/lib/i18n";

// 건물 고정 링크 첫 화면(시안 W-Start) — 뼈대. 예약 찾기 · 명부는 다음 단계에서 붙인다.
const BUILDING_KEY = /^[a-z0-9-]{1,40}$/;

export default async function BuildingStart({ params }: { params: Promise<{ building: string }> }) {
  const [{ building }, headerList] = await Promise.all([params, headers()]);
  if (!BUILDING_KEY.test(building)) notFound();
  const dict = getDictionary(pickLocale(headerList.get("accept-language")));
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-16">
      <p className="text-[17px] leading-relaxed text-[var(--muted)]">{dict.start.greeting}</p>
      <div className="flex-1" />
      <button
        type="button"
        className="h-14 w-full rounded-md bg-[var(--text)] text-[17px] font-semibold text-[#14161a]"
      >
        {dict.start.button}
      </button>
    </main>
  );
}
