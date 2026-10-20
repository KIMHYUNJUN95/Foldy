"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Search, Settings, X } from "lucide-react";
import {
  getNavigationLabel,
  getNavigationTabLabel,
  mobileNavBugs,
  type NavigationItem,
} from "@/config/navigation";
import { getLocalizedText, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import "@/components/shell/mobile-menu.css";

/**
 * 전체 메뉴 서랍의 내용 — 화이트 리디자인(2026-10-15, 시안 Menu-Phone).
 *
 * 서랍 자체(`<aside>` · 열고 닫는 움직임 · Esc · 뒤로가기 표식)는 `MobileShell` 그대로이고, 여기는 안에 그리는 것만 맡는다:
 * 내 정보 줄 → 기능 검색 → 자주 쓰는 기능(= 내 하단 탭) → 업무 · 소통 · 운영 관리자 묶음 → 계정 설정 · 버그 신고.
 * 검색은 화면 안에서만 거른다(서버 왕복 없음). docs/product/16-mobile-navigation.md 「전체 메뉴 · 하단 탭 편집 — 화이트 리디자인」
 */

// 묶음 — 시안 순서. 여기 없는 새 메뉴는 「업무」 끝에 붙는다(빠뜨리지 않게).
const COMMS_IDS: readonly string[] = ["announcements", "board", "complaints", "suggestions", "directory"];
const WORK_ORDER: readonly string[] = ["home", "calendar", "cleaning", "requests", "tasks", "attendance", "linen-return", "users"];
const LOCALES: readonly Locale[] = ["ko", "ja", "en"];

function orderBy(items: NavigationItem[], order: readonly string[]) {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}

function matches(item: NavigationItem, q: string) {
  return LOCALES.some((l) => {
    const label = getLocalizedText(item.label, l).toLowerCase();
    const short = item.shortLabel ? getLocalizedText(item.shortLabel, l).toLowerCase() : "";
    return label.includes(q) || short.includes(q);
  });
}

export function MobileMenuPanel({
  activeItem,
  badges,
  frequentItems,
  labels,
  locale,
  menuItems,
  onClose,
  open,
  opsItems,
  opsTitle,
  userName,
  userSub,
}: {
  activeItem?: string;
  badges: Partial<Record<string, number>>;
  /** 자주 쓰는 기능 — 사용자가 고른 하단 탭(권한으로 거른 것). */
  frequentItems: NavigationItem[];
  labels: {
    accountSettings: string;
    clear: string;
    close: string;
    comms: string;
    frequent: string;
    search: string;
    searchEmpty: string;
    work: string;
  };
  locale: Locale;
  menuItems: NavigationItem[];
  onClose: () => void;
  open: boolean;
  opsItems: NavigationItem[];
  opsTitle: string;
  userName: string;
  userSub: string;
}) {
  const [query, setQuery] = useState("");
  // 닫히면 검색어를 비운다(다음에 열 때 처음 모습) — 렌더 중 이전 값과 비교하는 방식(효과 안 setState 금지).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open && query) setQuery("");
  }

  const q = query.trim().toLowerCase();
  const work = orderBy(menuItems.filter((i) => !COMMS_IDS.includes(i.id)), WORK_ORDER);
  const comms = orderBy(menuItems.filter((i) => COMMS_IDS.includes(i.id)), COMMS_IDS);
  const results = q ? [...work, ...comms, ...opsItems].filter((i) => matches(i, q)) : [];

  const row = (item: NavigationItem) => {
    const Icon = item.icon;
    const active = item.id === activeItem;
    const count = badges[item.id] ?? 0;
    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={cn("mm__row", active && "is-active")}
        href={item.href}
        key={item.id}
        onClick={onClose}
      >
        <Icon aria-hidden="true" className="mm__row-ico" />
        <span className="mm__row-lbl">{getNavigationLabel(item, locale)}</span>
        {count > 0 ? <span className="mm__row-count">{count > 99 ? "99+" : count}</span> : null}
      </Link>
    );
  };

  const group = (title: string, items: NavigationItem[]) =>
    items.length > 0 ? (
      <nav aria-label={title} className="flex flex-col">
        <span className="mm__label">{title}</span>
        {items.map(row)}
      </nav>
    ) : null;

  const BugIcon = mobileNavBugs.icon;
  const bugActive = activeItem === mobileNavBugs.id;

  return (
    <div className="mm">
      <div className="mm__top">
        <button aria-label={labels.close} className="mm__close" onClick={onClose} type="button">
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <Link className="mm__me" href="/account?mode=mobile" onClick={onClose}>
        <span aria-hidden="true" className="mm__avatar">
          {Array.from(userName.trim() || "·")[0]}
        </span>
        <span className="min-w-0 flex-1">
          <b className="mm__me-name">{userName}</b>
          <span className="mm__me-sub">{userSub}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#b4b1bf]" />
      </Link>

      <label className="mm__search">
        <Search aria-hidden="true" className="size-[17px] shrink-0" />
        <input
          aria-label={labels.search}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.search}
          type="search"
          value={query}
        />
        {query ? (
          <button aria-label={labels.clear} className="mm__clear" onClick={() => setQuery("")} type="button">
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </label>

      <div className="mm__scroll">
        {q ? (
          results.length > 0 ? (
            <nav aria-label={labels.search} className="flex flex-col pt-2">
              {results.map(row)}
            </nav>
          ) : (
            <p className="mm__empty">{labels.searchEmpty}</p>
          )
        ) : (
          <>
            {frequentItems.length > 0 ? (
              <div className="mm__freq">
                <span className="mm__label">{labels.frequent}</span>
                <div className="mm__freq-grid">
                  {frequentItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link className="mm__tile" href={item.href} key={item.id} onClick={onClose}>
                        <span className="mm__tile-ico">
                          <Icon aria-hidden="true" className="size-[23px]" strokeWidth={1.7} />
                        </span>
                        <span className="mm__tile-lbl">{getNavigationTabLabel(item, locale)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {group(labels.work, work)}
            {group(labels.comms, comms)}
            {/* 운영 관리자 — 권한(`ops_admin.access` 등)이 없으면 구역째 안 보인다(셸이 거른 목록). */}
            {group(opsTitle, opsItems)}
          </>
        )}
      </div>

      <div className="mm__foot">
        <Link className="mm__foot-link" href="/account?mode=mobile" onClick={onClose}>
          <Settings aria-hidden="true" />
          <span className="truncate">{labels.accountSettings}</span>
        </Link>
        <Link
          aria-current={bugActive ? "page" : undefined}
          className={cn("mm__foot-link", bugActive && "is-active")}
          href={mobileNavBugs.href}
          onClick={onClose}
        >
          <BugIcon aria-hidden="true" />
          {getNavigationLabel(mobileNavBugs, locale)}
        </Link>
      </div>
    </div>
  );
}
