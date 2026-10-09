import Image from "next/image";
import Link from "next/link";
import { FALLBACK_COPY, resolveFallbackLocale } from "@/lib/fallback-copy";
import { getCurrentAppSession } from "@/lib/session";

/**
 * Mobile 404 — branded, in the viewer's own language. Hit when a `/mobile/.../[id]` deep-links to a
 * deleted/unknown record (the detail loaders return null → notFound()), instead of a bare framework
 * 404. Uses the canonical PWA app icon (same as the splash screen) so the brand is consistent
 * across cold-launch and error surfaces.
 *
 * **Localized since 2026-08-04.** This is a server component, so the session's `preferredLanguage`
 * is available — the old "renders without session locale context" justification for stacking all
 * three languages did not hold. A signed-out viewer falls back to `ko`.
 */
export default async function MobileNotFound() {
  const session = await getCurrentAppSession().catch(() => null);
  const copy = FALLBACK_COPY[resolveFallbackLocale(session?.user.preferredLanguage)];

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-8 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-center text-foreground">
      <Image
        alt="Foldy"
        className="rounded-[22px] shadow-[0_22px_50px_-26px_rgb(122_82_230/0.55)]"
        height={84}
        priority
        src="/icons/icon-192.png"
        width={84}
      />

      <h1 className="mt-7 text-[22px] font-black tracking-[-0.02em]">{copy.notFoundTitle}</h1>

      <p className="mt-3 text-[13px] font-medium leading-relaxed text-muted-foreground">
        {copy.notFoundBody}
      </p>

      <Link
        className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-8 text-[14px] font-extrabold text-primary-foreground shadow-[0_14px_28px_-12px_rgb(122_82_230/0.55)] transition-transform active:scale-[0.97]"
        href="/mobile"
      >
        {copy.goHome}
      </Link>
    </main>
  );
}
