"use client";

// PC(/admin/*) 공용 로딩 — 틀(사이드바 · 위 줄)은 그대로 두고 내용 자리 가운데에 막대 로더(2026-10-14, 시안 Motion-B-Loading-PC).
// 어느 메뉴가 열리는 중인지는 주소로 고른다(가장 긴 href 가 맞는 메뉴).
import { usePathname } from "next/navigation";
import { useSession } from "@/components/providers/session-provider";
import { AdminShell } from "@/components/shell/admin-shell";
import { adminNavigation, getNavigationLabel } from "@/config/navigation";
import { FoldyLoader } from "@/components/shared/foldy-loader";

export function AdminRouteLoading() {
  const pathname = usePathname() ?? "/admin";
  const { session } = useSession();
  const locale = session?.user.preferredLanguage ?? "ko";
  const item = [...adminNavigation]
    .filter((n) => (n.href === "/admin" ? pathname === "/admin" : pathname === n.href || pathname.startsWith(`${n.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? adminNavigation[0];
  return (
    <AdminShell activeItem={item.id} title={getNavigationLabel(item, locale)}>
      <FoldyLoader />
    </AdminShell>
  );
}
