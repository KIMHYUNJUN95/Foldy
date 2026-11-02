import { getDictionary } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

// 없는 주소 · 닫힌 링크. 어느 쪽인지 말하지 않는다.
export default async function NotFound() {
  const dict = getDictionary(await getLocale());
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <h1 className="w-h text-[26px]">{dict.notFound.pageTitle}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{dict.notFound.pageBody}</p>
    </main>
  );
}
