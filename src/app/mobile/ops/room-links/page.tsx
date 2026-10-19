import { redirect } from "next/navigation";
import { MobileRoomLinks } from "@/components/mobile/ops/mobile-room-links";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { canAccessRoomLinks } from "@/lib/ops-admin";
import { getRoomLinksPageData } from "@/lib/room-links";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

/**
 * 모바일 룸 링크 — 데스크톱 `/admin/ops/room-links` 의 폰 화면(2026-10-05 시안 1a → 2026-10-15 화이트 리디자인).
 *
 * 도메인 계약: `docs/product/35-room-links.md` → 「모바일」
 *
 * **데이터는 데스크톱과 같다**(`getRoomLinksPageData`). 모바일은 보기 · 열기 · 복사만 — 고치기는 대시보드에서 한다.
 * 그래서 판매 캘린더와 달리 **관리자 웹 역할을 요구하지 않는다** — 권한 키(`room_links.access`)만 있으면 현장 역할도
 * 연다. 없으면 모바일 홈으로.
 */
export const dynamic = "force-dynamic";

const BASE_PATH = "/mobile/ops/room-links";

export default async function MobileRoomLinksPage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);
  if (state.status === "unauthenticated") redirect(`/auth/login?next=${encodeURIComponent(BASE_PATH)}`);
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!canAccessRoomLinks(session)) redirect("/mobile");

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const [data, badges] = await Promise.all([getRoomLinksPageData(session, locale), navBadgesPromise]);

  return (
    // `split` — 폴드는 화면이 가운데 540px 로, 태블릿 가로는 폭 전부(왼쪽 건물 · 가운데 객실 · 오른쪽 상세 칸을 화면이 직접 그린다).
    <MobileShell activeItem="ops-room-links" badges={badges} split title={dictionary.roomLinks.title}>
      <MobileRoomLinks copy={dictionary.roomLinks} data={data} />
    </MobileShell>
  );
}
