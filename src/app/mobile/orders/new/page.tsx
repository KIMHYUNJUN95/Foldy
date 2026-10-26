import { redirect } from "next/navigation";
import { OrderCreateForm } from "@/components/requests/order-create-form";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getDictionary } from "@/lib/i18n";
import { getOnboardingState } from "@/lib/onboarding";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { sanitizeSharedUrl } from "@/lib/share-target";
import "@/components/requests/order-form.css";

type PageProps = {
  searchParams: Promise<{ sharedUrl?: string; shareError?: string; error?: string }>;
};

export default async function MobileOrderNewPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/orders/new")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = {
    ...dict.mobile.orderForm,
    // RSC props 로는 Client Component 에 함수를 넘길 수 없다.
    confirmSummary: undefined,
    itemCardTitle: undefined,
  } as unknown as typeof dict.mobile.orderForm;

  // 서버 액션이 `?error=` 로 넘긴 실패 사유. 예전에는 이 화면이 그 파라미터를 **아예 읽지 않아**,
  // 저장에 실패해도 폼만 다시 그려지고 아무 안내가 없었다(2026-08-04). 사전에 없는 키여도
  // `save_failed` 문구로 폴백해 무반응만은 피한다.
  const errorMessage = params.error
    ? (copy.errors?.[params.error] ?? copy.errors?.save_failed ?? params.error)
    : null;

  // Web Share Target 리다이렉트로 온 URL 을 한 번 더 검증한다(라우트에서 이미 한 번 확인함).
  const sharedUrl = sanitizeSharedUrl(params.sharedUrl ?? null);
  // shareError=1 은 URL 이 공유됐지만 라우트 핸들러의 검증에 실패했다는 뜻이다.
  const shareError = !sharedUrl && params.shareError === "1";

  const catalog = (await getActiveRoomCatalogServer(session.organization.id)) ?? [];
  const buildings = Array.from(new Set(catalog.map((item) => item.propertyName))).sort();

  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="requests" badges={navBadges} hideBottomNav title={copy.title}>
      {/* 화이트 리디자인(2026-10-14, 시안 OrderNew-Phone · Order-Fold): 상자 없는 제목 줄 → 폼. 폴드 · 태블릿은 520px 가운데 열. */}
      <div className="ofw-page">
        <div className="ofw-head">
          <h1>{copy.wHeading}</h1>
          <p>{copy.wSub}</p>
        </div>

        {errorMessage ? <p className="ofw-error" role="alert">{errorMessage}</p> : null}

        <OrderCreateForm
          buildingLabels={dict.cleaning.buildingLabels}
          buildings={buildings}
          copy={copy}
          imgCopy={dict.requestImages}
          organizationId={session.organization.id}
          reporterName={session.user.name}
          shareError={shareError}
          sharedUrl={sharedUrl}
        />
      </div>
    </MobileShell>
  );
}
