import { AppSplash } from "@/components/mobile/app-splash";
import { ImageFadeIn } from "@/components/shell/image-fade-in";
import { ResumeRefresh } from "@/components/shell/resume-refresh";
import { getDictionary } from "@/lib/i18n";
import { getCurrentAppSession } from "@/lib/session";

// 모바일 공용 레이아웃 — 앱 스플래시만 붙인다(2026-10-14). 페이지 안(MobileShell)에 두면 페이지가 도착해야 나와서,
// 새로고침하면 로딩 화면이 먼저 보이고 그 뒤에 스플래시가 떴다. 레이아웃은 로딩 화면보다 먼저 흘려 보내지고
// 앱 안 이동 땐 그대로 남아(다시 안 그림) 스플래시가 새로 불러올 때만 나온다.
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentAppSession();
  const tagline = getDictionary(session?.user.preferredLanguage ?? "ko").mobile.splashTagline;
  return (
    <>
      <AppSplash tagline={tagline} />
      {/* 사진 부드럽게 나타나기(2026-10-22) — 레이아웃에 한 번만 붙인다. */}
      <ImageFadeIn />
      {/* 오래 나가 있다 돌아오면 새로 고치기(2026-10-22). */}
      <ResumeRefresh />
      {children}
    </>
  );
}
