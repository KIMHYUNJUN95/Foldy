import { AppSplash } from "@/components/mobile/app-splash";
import { IdentityFillPrompt } from "@/components/identity/identity-fill-prompt";
import { ImageFadeIn } from "@/components/shell/image-fade-in";
import { ResumeRefresh } from "@/components/shell/resume-refresh";
import { BuildingNamesProvider } from "@/components/shared/building-names";
import { getDictionary } from "@/lib/i18n";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { hasCurrentIdDocument } from "@/lib/staff-documents/server";

// 모바일 공용 레이아웃 — 앱 스플래시만 붙인다(2026-10-14). 페이지 안(MobileShell)에 두면 페이지가 도착해야 나와서,
// 새로고침하면 로딩 화면이 먼저 보이고 그 뒤에 스플래시가 떴다. 레이아웃은 로딩 화면보다 먼저 흘려 보내지고
// 앱 안 이동 땐 그대로 남아(다시 안 그림) 스플래시가 새로 불러올 때만 나온다.
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentAppSession();
  const dictionary = getDictionary(session?.user.preferredLanguage ?? "ko");
  const tagline = dictionary.mobile.splashTagline;
  const identity = dictionary.onboarding.identity;
  // 이름이 다 찬 조직 멤버인데 신분 서류가 없으면 「카드를 등록해 주세요」(R2, docs/product/41 §3-1). 레이아웃은 새로 불러올 때만 그린다.
  const needsDocument =
    session && hasOrganizationContext(session) && !session.user.identityIncomplete
      ? !(await hasCurrentIdDocument(session.organization.id, session.user.id).catch(() => true))
      : false;
  const idCard = dictionary.idCard;
  return (
    <>
      <AppSplash tagline={tagline} />
      {/* 국적 · 이름 세 가지 · 신분 서류가 빈 사람에게 앱을 켤 때마다(2026-10-23, docs/product/41 §3-2). */}
      <IdentityFillPrompt
        copy={{
          fillTitle: identity.fillTitle,
          fillBody: identity.fillBody,
          fillLater: identity.fillLater,
          fillCta: identity.fillCta,
        }}
        documentPrompt={
          needsDocument
            ? {
                title: session?.user.identity.nationality === "JP" ? idCard.promptTitleMyNumber : idCard.promptTitleResidence,
                body: idCard.promptBody,
                cta: idCard.promptCta,
              }
            : null
        }
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
