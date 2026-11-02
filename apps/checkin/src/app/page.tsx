import { headers } from "next/headers";

import { getDictionary, pickLocale } from "@/lib/i18n";

// 손님은 건물 고정 링크(/p/<건물>)로만 들어온다. 루트는 안내만.
export default async function Home() {
  const dict = getDictionary(pickLocale((await headers()).get("accept-language")));
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <h1 className="text-2xl font-semibold tracking-tight">{dict.notFound.title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{dict.notFound.body}</p>
    </main>
  );
}
