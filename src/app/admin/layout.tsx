import type { Metadata } from "next";
import { AdminEntry } from "@/components/admin/admin-entry";
import { BuildingNamesProvider } from "@/components/shared/building-names";
import { getDictionary } from "@/lib/i18n";
import { getCurrentAppSession } from "@/lib/session";

// The admin console is an installable PWA in its own right, kept fully separate from the
// mobile app. Next.js metadata merges by segment, so overriding `manifest` here makes every
// /admin/* route advertise the desktop-oriented manifest (standalone window, unlocked
// orientation, /admin scope + start_url) instead of the root mobile manifest. Installing while
// on an /admin page therefore registers a distinct "Foldy Admin" app (id "/admin"), separate
// from the mobile "Foldy" app (id "/"). The shared service worker (scope "/") still serves
// both. See docs/product/05-admin-web-ia.md → "Installable Admin PWA".
export const metadata: Metadata = {
  manifest: "/manifest-admin.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Foldy Admin",
  },
};

// 진입 모션은 레이아웃에, 내용보다 앞(스크립트가 콘솔 HTML 보다 먼저 돈다) — 어느 관리자 화면에서 새로고침 · 다시 접속해도 나오고, 콘솔 안 이동 땐 레이아웃이 그대로라 다시 안 나온다.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentAppSession();
  const dictionary = getDictionary(session?.user.preferredLanguage ?? "ko");
  return (
    <>
      <AdminEntry />
      {/* 건물 이름을 보는 사람 언어로(2026-10-23) — 모바일과 같은 공급자. 데이터는 한국어 정규 명칭이라 그릴 때 `useBuildingName()` 으로 바꾼다. */}
      <BuildingNamesProvider labels={dictionary.cleaning.buildingLabels}>{children}</BuildingNamesProvider>
    </>
  );
}
