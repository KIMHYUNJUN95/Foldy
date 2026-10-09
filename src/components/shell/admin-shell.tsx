"use client";

import { useState } from "react";

import Link from "next/link";
import { ChevronDown, Search, Smartphone } from "lucide-react";
import { AdminGuestSearch } from "@/components/shell/admin-guest-search";
import { MobilePreview } from "@/components/shell/mobile-preview";
import "@/components/admin/admin-console.css";
import { NotificationBell } from "@/components/admin/notification-bell";
import { useSession } from "@/components/providers/session-provider";
import {
  adminNavigation,
  adminNavGroupOf,
  adminNavGroupOrder,
  getNavigationLabel,
  navigationCapability,
  type AdminNavGroupKey,
} from "@/config/navigation";
import { getDictionary } from "@/lib/i18n";
import { canAccessOpsAdmin } from "@/lib/ops-admin";

type AdminShellProps = {
  activeItem?: (typeof adminNavigation)[number]["id"];
  children: React.ReactNode;
  mobileHref?: string;
  title: string;
};

export function AdminShell({ activeItem, children, mobileHref = "/mobile", title }: AdminShellProps) {
  const { session } = useSession();
  // 훅은 조기 반환보다 앞에 와야 한다(세션이 없으면 아래에서 null 을 돌려준다).
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!session) {
    return null;
  }

  const role = session.user.role;
  const capabilities = session.capabilities ?? [];
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.console;
  const orgName = session.organization.name;
  const userName = session.user.name ?? "";

  const groupLabel: Record<AdminNavGroupKey, string> = {
    operations: c.navGroupOps,
    people: c.navGroupPeople,
    info: c.navGroupInfo,
    ops: c.navGroupOpsAdmin,
  };

  return (
    <main className="adm">
      <div className="app">
        {/*
         * ── Sidebar (warm espresso rail) ──
         *
         * 평소에는 **아이콘만** 보이고 커서를 올리면 펼쳐진다. 조작 수단은 커서뿐이라
         * 접기/펴기 버튼도, 저장할 상태도 없다 — 규칙이 전부 CSS 안에서 끝난다
         * (admin-console.css 「사이드바 — 기본은 아이콘 레일」).
         */}
        <aside className="side">
          <Link className="side__brand" href="/admin">
            <span className="side__mark" aria-hidden="true" />
            <span style={{ minWidth: 0 }}>
              <span className="side__wm">Foldy</span>
              <span className="side__role" style={{ display: "block" }}>{c.brandRole}</span>
            </span>
          </Link>

          <div className="orgsw">
            <Link className="orgsw__btn" href="/admin/settings/organization" aria-label={c.orgSwitch}>
              <span className="orgsw__logo">{orgName.slice(0, 1)}</span>
              <span style={{ minWidth: 0 }}>
                <span className="orgsw__nm">{orgName}</span>
                <span className="orgsw__mt">{dictionary.roles[role]}</span>
              </span>
              <span className="ic orgsw__chev"><ChevronDown /></span>
            </Link>
          </div>

          <div className="side__scroll">
            {adminNavGroupOrder.map((groupKey) => {
              const items = adminNavigation.filter((item) => {
                if ((adminNavGroupOf[item.id] ?? "operations") !== groupKey) return false;
                // 권한 키가 붙은 메뉴는 그 권한을 가진 사람에게만 보인다. 판정은 서버가 이미
                // 끝냈고(`session.capabilities`) 여기서는 목록을 볼 뿐이다 — 클라이언트가 다시
                // 계산하면 그 순간 규칙이 두 벌이 된다.
                //
                // 이건 UX 다. 실제 차단은 페이지·서버 액션·RLS 가 한다.
                const capability = navigationCapability(item);
                return !capability || capabilities.includes(capability);
              });
              if (items.length === 0) return null;
              return (
                <div className="navgrp" key={groupKey}>
                  <div className="navgrp__t">{groupLabel[groupKey]}</div>
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        className={`navi${item.id === activeItem ? " on" : ""}`}
                        href={item.href}
                        key={item.id}
                      >
                        <span className="ic"><Icon /></span>
                        <span className="navi__t">{getNavigationLabel(item, locale)}</span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Main ── */}
        <section className="main">
          <header className="top">
            <div className="top__title">
              <div className="top__crumb">{orgName} · {c.crumbOps}</div>
              <div className="top__h">{title}</div>
            </div>
            {/* 판매 캘린더 권한이 있으면 예약 검색(고객명 · 예약번호 · 전화번호 → 예약 상세 패널).
                없으면 예전 자리 표시 입력 그대로 — 그 사람에게 열어 줄 패널이 없다. */}
            {canAccessOpsAdmin(session) ? (
              <AdminGuestSearch
                copy={{
                  placeholder: c.searchGuestPlaceholder,
                  submit: c.searchSubmit,
                  clear: c.searchClear,
                  searching: c.searchSearching,
                  empty: c.searchEmpty,
                  error: c.searchError,
                  cancelled: c.searchCancelled,
                  nights: c.searchNights,
                  resultCount: c.searchResultCount,
                }}
              />
            ) : (
              <div className="search">
                <span className="ic"><Search /></span>
                <input placeholder={c.searchPlaceholder} type="search" />
              </div>
            )}
            <div className="top__actions">
              {/* 전체 화면으로 넘어가는 대신 아이폰 모양 프레임으로 띄운다 — 어드민에서 일하는
                  중에 보는 것이라 화면을 떠나지 않는 편이 낫다. 전체 화면으로 가는 길은
                  미리보기 안의 「새 탭에서 열기」로 남겨 뒀다. */}
              <button
                type="button"
                className="top__mobbtn"
                onClick={() => setPreviewOpen(true)}
              >
                <span className="ic"><Smartphone /></span>
                {c.mobileView}
              </button>
              <NotificationBell
                labels={{
                  title: c.notifications,
                  markAll: c.notifMarkAll,
                  viewAll: c.notifViewAll,
                  empty: c.notifEmpty,
                }}
              />
              <Link className="top__av" href="/account?mode=admin" aria-label={c.account}>
                {userName.slice(0, 1) || "·"}
              </Link>
            </div>
          </header>

          <div className="content">
            <div className="cwrap">{children}</div>
          </div>
        </section>
      </div>

      {previewOpen && (
        <MobilePreview
          href={mobileHref}
          labels={{
            title: c.mobilePreviewTitle,
            close: c.mobilePreviewClose,
          }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </main>
  );
}
