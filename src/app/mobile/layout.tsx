import { AppSplash } from "@/components/mobile/app-splash";
import { IdentityFillPrompt } from "@/components/identity/identity-fill-prompt";
import { ImageFadeIn } from "@/components/shell/image-fade-in";
import { ResumeRefresh } from "@/components/shell/resume-refresh";
import { BuildingNamesProvider } from "@/components/shared/building-names";
import { getDictionary } from "@/lib/i18n";
import { getCurrentAppSession } from "@/lib/session";

// 모바일 공용 레이아웃 — 앱 스플래시만 붙인다(2026-10-14). 페이지 안(MobileShell)에 두면 페이지가 도착해야 나와서,
// 새로고침하면 로딩 화면이 먼저 보이고 그 뒤에 스플래시가 떴다. 레이아웃은 로딩 화면보다 먼저 흘려 보내지고
// 앱 안 이동 땐 그대로 남아(다시 안 그림) 스플래시가 새로 불러올 때만 나온다.
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentAppSession();
  const dictionary = getDictionary(session?.user.preferredLanguage ?? "ko");
  const tagline = dictionary.mobile.splashTagline;
  const identity = dictionary.onboarding.identity;
  return (
    <>
      <AppSplash tagline={tagline} />
      {/* 국적 · 이름 세 가지가 빈 사람에게 하루 한 번(2026-10-22, docs/product/41 §3-2). */}
      <IdentityFillPrompt
        copy={{
          fillTitle: identity.fillTitle,
          fillBody: identity.fillBody,
          fillLater: identity.fillLater,
          fillCta: identity.fillCta,
        }}
        incomplete={Boolean(session?.user.identityIncomplete)}
      />
      {/* 사진 부드럽게 나타나기(2026-10-22) — 레이아웃에 한 번만 붙인다. */}
      <ImageFadeIn />
      {/* 오래 나가 있다 돌아오면 새로 고치기(2026-10-22). */}
      <ResumeRefresh />
      {/* 건물 이름을 보는 사람 언어로(2026-10-22) — 데이터는 한국어 정규 명칭이라 그릴 때 `useBuildingName()` 으로 바꾼다. */}
      <BuildingNamesProvider labels={dictionary.cleaning.buildingLabels}>{children}</BuildingNamesProvider>
    </>
  );
}
