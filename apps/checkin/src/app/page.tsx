import { getDictionary } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

// 루트는 쓰지 않는다 — 손님은 메시지의 건물 링크(/p/<건물>)로 들어온다.
export default async function Home() {
  const dict = getDictionary(await getLocale());
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <h1 className="w-h text-[26px]">{dict.notFound.pageTitle}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{dict.notFound.pageBody}</p>
    </main>
  );
}
