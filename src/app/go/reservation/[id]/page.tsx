import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasAdminWebAccess } from "@/config/capabilities";
import { getDictionary } from "@/lib/i18n";
import { getDeviceSurfaceFromHeaders } from "@/lib/mobile-device";
import { getOnboardingState } from "@/lib/onboarding";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { resolveReservationShortcut } from "@/lib/reservation-shortcut";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

/**
 * 예약 바로가기 — Slack 알림의 「Foldy 에서 열기」 링크가 닿는 곳.
 *
 * 도메인 계약: docs/product/36-automation-control.md → 「예약 바로가기 링크」 · 판단은 `src/lib/reservation-shortcut.ts`
 *
 * 권한이 있으면 기기에 맞는 판매 캘린더에서 그 예약을 열고, 없으면 이 화면에서 「권한이 없어요」를 보여 준다.
 * 예약이 어느 조직 것인지는 여기서 보지 않는다 — 판매 캘린더가 자기 조직 예약만 연다.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Foldy",
};

export default async function ReservationShortcutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [state, session, requestHeaders] = await Promise.all([getOnboardingState(), getCurrentAppSession(), headers()]);
  const surface = getDeviceSurfaceFromHeaders(requestHeaders);
  const ready = state.status === "ready" && session && hasOrganizationContext(session);

  const result = resolveReservationShortcut({
    canOpenCalendar: Boolean(ready && session && canAccessOpsAdmin(session) && hasAdminWebAccess(session)),
    reservationId: id,
    state: state.status === "unauthenticated" ? "unauthenticated" : ready ? "ready" : "onboarding",
    surface,
  });
  if (result.kind === "redirect") redirect(result.path);

  // 여기까지 오면 로그인 · 가입이 끝난 사람이다(아니면 위에서 로그인 · 가입으로 보냈다).
  const copy = getDictionary(session?.user.preferredLanguage ?? "ko").reservationShortcut;
  const homeHref = surface !== "mobile" && session && hasAdminWebAccess(session) ? "/admin" : "/mobile";
  const denied = result.kind === "denied";

  return (
    <main className="min-h-[100svh] bg-background px-6 py-[max(28px,env(safe-area-inset-top))] text-foreground">
      <section className="mx-auto flex min-h-[calc(100svh-56px)] w-full max-w-[420px] flex-col justify-center">
        <div className="rounded-[28px] border border-border bg-surface px-6 py-7 shadow-[0_24px_70px_-42px_rgba(16,24,40,0.5)]">
          <p className="text-[12px] font-black uppercase tracking-[0.16em] text-primary">{copy.deniedEyebrow}</p>
          <h1 className="mt-3 text-[22px] font-black leading-tight tracking-[-0.03em] text-foreground">
            {denied ? copy.deniedTitle : copy.invalidTitle}
          </h1>
          <p className="mt-4 text-[14px] font-semibold leading-6 text-muted-foreground">
            {denied ? copy.deniedBody : copy.invalidBody}
          </p>
          {denied ? (
            <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-[13px] font-bold leading-5 text-muted-foreground">
              {copy.deniedHelp}
            </p>
          ) : null}
          <Link
            className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-black text-primary-foreground active:scale-[0.99]"
            href={homeHref}
          >
            {copy.home}
          </Link>
        </div>
      </section>
    </main>
  );
}
