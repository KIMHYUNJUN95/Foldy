import { redirect } from "next/navigation";
import { LockKeyhole, Smartphone } from "lucide-react";
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
 *
 * 모양(2026-10-22 Apple 스타일 시안 승인): 카드 없이 연회색 바탕 가운데 — 아이콘 · 제목 · 설명 · 회색 캡슐 로그아웃(보조 동작) ·
 * 맨 아래 휴대폰 앱 한 줄. 로고는 왼쪽 위에 작게.
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
    <main className="relative flex min-h-[100svh] items-center justify-center bg-[#f5f5f7] px-6 py-16 text-[#1d1d1f]">
      <div className="absolute left-8 top-7 flex items-center gap-2">
        <FoldyMark size={24} />
        <span className="wordmark text-[16px]">Foldy</span>
      </div>
      <section className="flex w-full max-w-[400px] flex-col items-center text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-[#e8e8ed] text-[#6e6e73]">
          <LockKeyhole aria-hidden="true" size={28} strokeWidth={1.8} />
        </span>
        <h1 className="mt-6 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">{copy.noAccessConsoleTitle}</h1>
        <p className="mt-2.5 whitespace-pre-line text-[15px] leading-[22px] text-[#6e6e73]">{copy.noAccessConsoleBody}</p>
        <form action={signOut} className="mt-8">
          <input name="next" type="hidden" value="/auth/login?next=/admin" />
          <button
            className="h-11 rounded-full bg-[#e8e8ed] px-7 text-[15px] font-medium text-[#1d1d1f] transition-[background-color,transform] duration-150 hover:bg-[#dedee3] active:scale-[0.97]"
            type="submit"
          >
            {dictionary.common.logout}
          </button>
        </form>
        <p className="mt-10 flex items-center gap-1.5 text-[13px] leading-[18px] text-[#86868b]">
          <Smartphone aria-hidden="true" size={14} strokeWidth={2} />
          {copy.noAccessConsoleHelp}
        </p>
      </section>
    </main>
  );
}
