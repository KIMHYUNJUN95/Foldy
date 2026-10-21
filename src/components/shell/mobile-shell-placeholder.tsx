"use client";

import { usePathname } from "next/navigation";
import { FoldyLoader } from "@/components/shared/foldy-loader";
import { useSession } from "@/components/providers/session-provider";
import { getShellHint, MobileShell } from "@/components/shell/mobile-shell";
import { mobileNavBugs, mobileOpsAdminNavigation, mobileSidebarNavigation } from "@/config/navigation";
import { getLocalizedText } from "@/lib/i18n";

type ActiveItem = NonNullable<Parameters<typeof MobileShell>[0]["activeItem"]>;

const NAV_ITEMS = [...mobileSidebarNavigation, ...mobileOpsAdminNavigation, mobileNavBugs];

/** 경로가 속한 메뉴 — 주소가 가장 길게 겹치는 항목(홈 `/mobile` 은 정확히 같을 때만). */
function navItemFor(pathname: string) {
  let best: (typeof NAV_ITEMS)[number] | null = null;
  for (const item of NAV_ITEMS) {
    const href = item.href.split("?")[0];
    const match = href === "/mobile" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    if (match && (!best || href.length > best.href.split("?")[0].length)) best = item;
  }
  return best;
}

/**
 * 로딩 자리 셸 (2026-10-21 네이티브 점검 2 · 3 · 4) — `/mobile/**​/loading.tsx` 가 쓴다.
 *
 * 예전 로딩은 화면 전체를 로더로 덮어 **탭바 · 위 줄까지 사라졌고**, 들어오는 전환은 빈 로딩 위에서 끝나 진짜 화면은 툭 나타났다.
 * 이제 누르자마자 같은 셸(탭바 · 위 줄 그대로)이 그려지고 본문 칸이 밀려 들어오며, 0.3초 넘게 걸리면 그 자리에 로더가 보인다.
 * 진짜 화면이 오면 본문만 살짝 나타난다(`screen-reveal`). 탭바 모양은 그 경로를 지난번에 그린 셸 설정(`getShellHint`)을 따르고,
 * 처음 가는 경로면 주소로 메뉴를 찾고 새로 쓰기 · 고치기 화면(`/new` · `/compose` · `/edit`)은 탭바를 숨긴다.
 */
export function MobileShellPlaceholder() {
  const pathname = usePathname();
  const { session } = useSession();
  const { badges, hint } = getShellHint(pathname);
  const item = navItemFor(pathname);
  const locale = session?.user.preferredLanguage ?? "ko";
  return (
    <MobileShell
      activeItem={hint?.activeItem ?? (item?.id as ActiveItem | undefined)}
      badges={badges}
      hideBottomNav={hint?.hideBottomNav ?? /\/(new|compose|edit)$/.test(pathname)}
      placeholder
      split={hint?.split}
      title={hint?.title ?? (item ? getLocalizedText(item.label, locale) : "")}
      wide={hint?.wide}
    >
      <FoldyLoader />
    </MobileShell>
  );
}
