import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { FoldyMark } from "@/components/brand/foldy-mark";
import { hasAdminWebAccess } from "@/config/capabilities";
import { getDictionary } from "@/lib/i18n";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession } from "@/lib/session";

/**
 * 관리자 화면 권한 없음(2026-10-21) — PC 에서 `admin_web.access` 가 없으면 여기로 온다. 예전엔 `/mobile` 로 보냈는데 PC 에선 가운데
 * 폰 너비로만 떠서 어색했다(사용자). 폰 · 태블릿은 미들웨어가 `/admin` 을 먼저 `/mobile` 로 보내므로 여기 오지 않는다.
 * 관리자 셸(메뉴)은 그리지 않는다 — 들어갈 수 없는 곳의 메뉴를 보여 주지 않는다. docs/product/05-admin-web-ia.md
 */
export default async function AdminNoAccessPage() {
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);
  if (state.status === "unauthenticated") redirect("/auth/login?next=/admin");
  if (state.status !== "ready" || !session) redirect("/onboarding");
  // 권한이 생겼으면(대표가 켜 줌) 바로 대시보드로.
  if (hasAdminWebAccess(session)) redirect("/admin");

  const dictionary = getDictionary(session.user.preferredLanguage);
  const copy = dictionary.admin.shared;

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-[440px]">
        {/* 로고 = 앱 아이콘과 같은 세 줄 마크 + 굵은 sans 「Foldy」(사이드 메뉴와 같음). */}
        <div className="flex items-center gap-2.5">
          <FoldyMark size={30} />
          <span className="wordmark text-[19px] text-foreground">Foldy</span>
        </div>
        <div className="mt-8 rounded-[24px] bg-surface px-8 py-9 shadow-[0_24px_70px_-42px_rgba(16,24,40,0.45)]">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LockKeyhole aria-hidden="true" size={20} strokeWidth={2} />
          </span>
          <p className="mt-5 text-[12px] font-bold uppercase tracking-[0.14em] text-primary">{copy.noAccessConsoleEyebrow}</p>
          <h1 className="mt-2 text-[22px] font-black leading-tight tracking-[-0.03em]">{copy.noAccessConsoleTitle}</h1>
          <p className="mt-3 text-[14px] font-medium leading-6 text-muted-foreground">{copy.noAccessConsoleBody}</p>
          <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-[13px] font-semibold leading-5 text-muted-foreground">
            {copy.noAccessConsoleHelp}
          </p>
          <form action={signOut} className="mt-7">
            <input name="next" type="hidden" value="/auth/login?next=/admin" />
            <button
              className="h-12 w-full rounded-2xl bg-primary text-[15px] font-bold text-primary-foreground transition-transform active:scale-[0.99]"
              type="submit"
            >
              {dictionary.common.logout}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
