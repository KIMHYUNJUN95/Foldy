"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { ReactNode, UIEvent } from "react";
import { Bell, ChevronRight, LogOut, UserCircle, X } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { MobileSideNav } from "@/components/shell/mobile-side-nav";
import { SPLIT_PANE_MESSAGE } from "@/lib/split-pane";
import { attachSwipeBack } from "@/lib/swipe-back/controller";
import { isSwipeBackScreen } from "@/lib/swipe-back/history-model";
import { getHistoryIndex, getHistoryUrl } from "@/lib/swipe-back/history-tracker";
import { trackScreen } from "@/lib/swipe-back/snapshot-store";
import { signOut } from "@/app/auth/actions";
import { updateBottomNavTabs } from "@/app/account/actions";
import {
  MAX_BOTTOM_NAV_TABS,
  canSeeNavItem,
  customizableBottomNavItems,
  isMobileOpsAdminNavItem,
  getNavigationLabel,
  getNavigationTabLabel,
  mobileNavBugs,
  mobileOpsAdminNavigation,
  mobileSidebarNavigation,
  resolveBottomNavItems,
} from "@/config/navigation";
import { canAccessAdminWeb } from "@/config/roles";
import { haptic } from "@/lib/haptics";
import { getDictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Capitalized alias so the icon can be used as a JSX tag in the sidebar footer.
const BugIcon = mobileNavBugs.icon;

type MobileShellProps = {
  // Bug Report is not in the sidebar nav list (it lives in the footer next to Logout), but its
  // pages still mark themselves active — so allow its id alongside the sidebar ids.
  activeItem?:
    | (typeof mobileSidebarNavigation)[number]["id"]
    | (typeof mobileOpsAdminNavigation)[number]["id"]
    | typeof mobileNavBugs.id;
  appearance?: "default" | "announcement" | "cleaning";
  children: React.ReactNode;
  title: string;
  /** Operational unprocessed counts keyed by sidebar nav id (e.g. requests, notifications). */
  badges?: Partial<Record<string, number>>;
  /**
   * Hide the bottom tab bar for focused full-screen flows (e.g. a create form with its own sticky
   * submit bar, which would otherwise overlap the tab bar). Defaults to false — the side menu still
   * reaches every feature. When true the content's bottom padding shrinks (no tab bar to clear).
   */
  hideBottomNav?: boolean;
  /**
   * 넓은 화면(펼친 폴드 · 가로 모드 · 태블릿)에서 본문을 **화면 폭 전부** 쓴다(2026-10-02 — 판매 캘린더). 기본은 셸 폭
   * 430px 고정(모든 화면 공통). 켜도 사이드 메뉴는 지금처럼 화면 전체를 덮고(뒤가 비치지 않게), 하단 탭 바는 560px 로
   * 가운데 — 탭 간격이 지나치게 벌어지지 않는다.
   */
  wide?: boolean;
  /**
   * 목록 화면 — 태블릿 가로에서 목록 · 상세 2분할(`SplitList`)을 쓰므로 그 폭에서는 본문 폭 제한을 푼다(폴드는 760px 그대로).
   */
  split?: boolean;
};

const PULL_THRESHOLD = 72;
const MAX_PULL = 120;
const MAX_DISPLAY_H = 60;
const REFRESH_DISPLAY_H = 52;
const SIDEBAR_TRANSITION_MS = 360;
/**
 * 넓은 화면(펼친 폴드 · 태블릿 · 가로 폰 — globals.css `fold:` 와 같은 600px). 여기서는 하단 탭 바 · 위 머리 대신 왼쪽
 * 레일 · 사이드바(`MobileSideNav`)가 메뉴라 **스크롤해도 숨기지 않는다**(숨길 크롬이 없다).
 */
const FOLD_QUERY = "(min-width: 600px)";

// Center FAB icon — app-grid squircle ("Bottom Bar (Squircle Edit)" design); opens the editor sheet.
const EDIT_ICON = (
  <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
  </svg>
);

/**
 * "추가" launcher metadata, keyed by sidebar-navigation item id.
 * Each feature gets a distinct hue; the launcher grid is generated from
 * `mobileSidebarNavigation`, so adding a nav item automatically adds a tile.
 * Colours fix lightness/chroma and vary only hue → a unified palette.
 */
const LAUNCHER_META: Record<string, { hue: number; icon: ReactNode }> = {
  home: {
    hue: 185,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 11.5L12 5l8 6.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 10.5V19h12v-8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  calendar: {
    hue: 250,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.9" />
        <path d="M4 9.5h16M8 4v3M16 4v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    ),
  },
  cleaning: {
    hue: 155,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 4l1.4 3.6L17 9l-3.6 1.4L12 14l-1.4-3.6L7 9l3.6-1.4L12 4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M18 14l.7 1.8 1.8.7-1.8.7L18 19l-.7-1.8-1.8-.7 1.8-.7L18 14z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  requests: {
    hue: 70,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="5.5" y="4.5" width="13" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.9" />
        <path d="M9 3.5h6v3H9z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  announcements: {
    hue: 30,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 10v4h3l6 4V6l-6 4H4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M17.5 9.2a3.6 3.6 0 010 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  "ops-calendar": {
    hue: 225,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.9" />
        <path d="M4 9.5h16M8 4v3M16 4v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M13.6 12.4h-2.1a1.2 1.2 0 000 2.4h1a1.2 1.2 0 010 2.4H10.4M12 11.6v.8M12 17.2v.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  notifications: {
    hue: 305,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 10a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 19.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  directory: {
    hue: 225,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="9" cy="8.5" r="3.1" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.6 19c.9-2.6 3-4 5.4-4s4.5 1.4 5.4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16.3 6.3a2.8 2.8 0 010 5M18.2 18.8c-.3-1.3-.8-2.4-1.6-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  suggestions: {
    hue: 345,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 13l2.2-7.2A2 2 0 018.1 4.4h7.8a2 2 0 011.9 1.4L20 13v4.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5V13z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M4 13h4l1.2 2.2h5.6L16 13h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  attendance: {
    hue: 200,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.9" />
        <path d="M12 7.5v5l3.2 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
};

const FALLBACK_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);


/** Rubber-band resistance: fast start, asymptotic ceiling at MAX_DISPLAY_H. */
function computeContentOffset(raw: number): number {
  if (raw <= 0) return 0;
  return MAX_DISPLAY_H * raw / (raw + MAX_PULL * 0.4);
}

// Per-route scroll restoration. The app scrolls an INNER div (not the window), which Next's
// built-in scroll restoration can't track, so navigating back always lost your place in long
// lists. Keyed by pathname, module-scoped so it survives the shell's per-route remount within a
// session (the shell is rendered per page, so this Map is the only thing that persists).
const SCROLL_POSITIONS = new Map<string, number>();



export function MobileShell({
  activeItem,
  appearance = "default",
  children,
  title,
  badges = {},
  hideBottomNav = false,
  wide = false,
  split = false,
}: MobileShellProps) {
  const lastScrollYRef = useRef(0);
  const hideAccumRef = useRef(0);
  const showAccumRef = useRef(0);
  const tickingRef = useRef(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarChromeLocked, setSidebarChromeLocked] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const [pullDistanceState, setPullDistanceState] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshPending, startRefreshTransition] = useTransition();
  const router = useRouter();
  /**
   * 하단 탭 재탭 리셋용 리마운트 키.
   *
   * 화면 안쪽 상태(내부 탭·검색어·필터·선택 모드)는 전부 각 화면 컴포넌트의 로컬 state 라 같은
   * URL 로 다시 와도 라우팅으로는 풀리지 않는다. 화면마다 리스너를 다는 대신 **콘텐츠 서브트리를
   * 통째로 리마운트**해 모든 탭이 별도 배선 없이 초기화되게 한다(2026-08-03).
   *
   * 서버 컴포넌트 결과는 이미 element 로 넘어와 있어 리마운트해도 재요청이 일어나지 않는다.
   */
  const [contentKey, setContentKey] = useState(0);
  const pathname = usePathname();
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef(0);
  const touchStartXRef = useRef(0);
  const isPullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  // PTR may only arm on a gesture that STARTED at the top. Cleared the moment scrollTop goes >0 so a
  // momentum/rubber-band coast back to 0 under a held finger can't activate PTR against a stale anchor.
  const ptrEligibleRef = useRef(false);
  const sidebarChromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // rAF-coalesce touchmove → setState: refs update synchronously every sample, but the visible React
  // state setter fires at most once per animation frame (avoids a full subtree re-render at ~120Hz).
  const pullRafRef = useRef(0);
  const { session } = useSession();

  // Per-user bottom-bar tabs (customized via the center "추가" editor sheet).
  const initialNavIds = resolveBottomNavItems(session?.user.bottomNavTabs).map(
    (item) => item.id,
  );
  const [navTabIds, setNavTabIds] = useState<string[]>(initialNavIds);
  const savedNavRef = useRef<string[]>(initialNavIds);
  const sheetWasOpenRef = useRef(false);
  const [, startNavSave] = useTransition();

  const clearSidebarChromeTimer = useCallback(() => {
    if (sidebarChromeTimerRef.current) {
      clearTimeout(sidebarChromeTimerRef.current);
      sidebarChromeTimerRef.current = null;
    }
  }, []);

  const openSidebar = useCallback(() => {
    clearSidebarChromeTimer();
    setSidebarChromeLocked(true);
    setSidebarOpen(true);
  }, [clearSidebarChromeTimer]);

  const closeSidebar = useCallback(() => {
    clearSidebarChromeTimer();
    setSidebarOpen(false);
    sidebarChromeTimerRef.current = setTimeout(() => {
      setSidebarChromeLocked(false);
      sidebarChromeTimerRef.current = null;
    }, SIDEBAR_TRANSITION_MS);
  }, [clearSidebarChromeTimer]);

  function toggleNavTab(id: string) {
    setNavTabIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        return next.length > 0 ? next : prev; // keep at least one tab
      }
      if (prev.length >= MAX_BOTTOM_NAV_TABS) return prev; // bar is full
      return [...prev, id];
    });
  }

  const updateVisibility = useCallback((currentY: number) => {
    const delta = currentY - lastScrollYRef.current;

    if (currentY <= 8) {
      setHeaderVisible(true);
      hideAccumRef.current = 0;
      showAccumRef.current = 0;
    } else if (delta > 4) {
      hideAccumRef.current += delta;
      showAccumRef.current = 0;
      if (hideAccumRef.current > 64) {
        setHeaderVisible(false);
      }
    } else if (delta < -4) {
      showAccumRef.current += Math.abs(delta);
      hideAccumRef.current = 0;
      if (showAccumRef.current > 36) {
        setHeaderVisible(true);
      }
    } else {
      hideAccumRef.current = 0;
      showAccumRef.current = 0;
    }

    if (currentY <= 8) {
      setHeaderVisible(true);
    }

    lastScrollYRef.current = currentY;
    tickingRef.current = false;
  }, []);

  const requestVisibilityUpdate = useCallback(
    (currentY: number) => {
      if (window.matchMedia(FOLD_QUERY).matches) {
        lastScrollYRef.current = currentY;
        setHeaderVisible(true);
        return;
      }
      if (tickingRef.current) return;
      tickingRef.current = true;
      window.requestAnimationFrame(() => updateVisibility(currentY));
    },
    [updateVisibility],
  );

  // Key restore by the FULL url (path + query), not just pathname — list screens vary their content
  // by query (?view=, ?month=, ?date=) on a single pathname, so a path-only key restored a position
  // saved from a different (taller/shorter) variant.
  const routeKey = useCallback(
    () =>
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : pathname,
    [pathname],
  );

  const handleContentScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    const key = routeKey();
    // Remember where we are for back-nav restore. Re-set after delete to keep this key the most
    // recent (Map preserves insertion order) and cap the Map so it can't grow unbounded.
    SCROLL_POSITIONS.delete(key);
    SCROLL_POSITIONS.set(key, top);
    if (SCROLL_POSITIONS.size > 30) {
      SCROLL_POSITIONS.delete(SCROLL_POSITIONS.keys().next().value as string);
    }
    requestVisibilityUpdate(top);
  };

  // Restore the saved scroll position for this route on mount (native back-nav behavior). Runs once
  // per shell mount (the shell remounts per route navigation). A layout effect, so the first painted frame is already at
  // the saved position — after a swipe back the screen must match the snapshot that was just under the finger.
  useLayoutEffect(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const saved = SCROLL_POSITIONS.get(routeKey());
    if (saved && saved > 0) {
      el.scrollTop = saved;
      lastScrollYRef.current = saved; // avoid a spurious large delta on the first scroll event
    }
  }, [pathname, routeKey]);

  function syncPullDistance(v: number) {
    pullDistanceRef.current = v;
    if (pullRafRef.current) return;
    pullRafRef.current = window.requestAnimationFrame(() => {
      pullRafRef.current = 0;
      setPullDistanceState(pullDistanceRef.current);
    });
  }

  // Numeric offset — used for indicator opacity/scale animations (0..REFRESH_DISPLAY_H range).
  const contentOffset = isRefreshPending
    ? REFRESH_DISPLAY_H
    : computeContentOffset(pullDistanceState);
  // CSS value for the shell translateY. When refreshing we add env(safe-area-inset-top) so the
  // indicator content is positioned fully BELOW the notch/status-bar, not hidden behind it.
  const shellY = isRefreshPending
    ? `calc(env(safe-area-inset-top, 0px) + ${REFRESH_DISPLAY_H}px)`
    : `${computeContentOffset(pullDistanceState)}px`;
  const isReadyToRefresh = pullDistanceState >= PULL_THRESHOLD;

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (sidebarOpen || isRefreshPending) return;
    ptrEligibleRef.current = e.currentTarget.scrollTop <= 0;
    if (!ptrEligibleRef.current) return;
    touchStartYRef.current = e.touches[0].clientY;
    touchStartXRef.current = e.touches[0].clientX;
    isPullingRef.current = false;
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (isRefreshPending || e.touches.length !== 1) return;
    if (e.currentTarget.scrollTop > 0) {
      // Mark ineligible and re-anchor, so a later coast back to 0 doesn't compare against ancient Y.
      ptrEligibleRef.current = false;
      touchStartYRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
      if (isPullingRef.current) {
        isPullingRef.current = false;
        setIsPulling(false);
        syncPullDistance(0);
      }
      return;
    }
    if (!ptrEligibleRef.current) {
      // At the top, but this gesture started/passed through scrollTop>0 — don't arm PTR. Keep anchor fresh.
      touchStartYRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
      return;
    }
    const deltaY = e.touches[0].clientY - touchStartYRef.current;
    const deltaX = Math.abs(e.touches[0].clientX - touchStartXRef.current);
    if (deltaX > Math.abs(deltaY) || deltaY <= 0) {
      if (isPullingRef.current) {
        isPullingRef.current = false;
        setIsPulling(false);
        syncPullDistance(0);
      }
      return;
    }
    if (!isPullingRef.current) {
      isPullingRef.current = true;
      setIsPulling(true);
    }
    // Haptic pulse at the commit threshold — fires once per gesture as the user crosses 72px.
    const wasBelowThreshold = pullDistanceRef.current < PULL_THRESHOLD;
    syncPullDistance(deltaY);
    if (wasBelowThreshold && deltaY >= PULL_THRESHOLD) {
      if (typeof navigator !== "undefined") navigator.vibrate?.(10);
    }
  }

  function handleTouchEnd() {
    const wasPulling = isPullingRef.current;
    ptrEligibleRef.current = false;
    if (!wasPulling) return;
    const dist = pullDistanceRef.current;
    isPullingRef.current = false;
    setIsPulling(false);
    syncPullDistance(0);
    // Cancel any pending frame and commit the resting 0 now, so spring-back animates without delay.
    if (pullRafRef.current) {
      cancelAnimationFrame(pullRafRef.current);
      pullRafRef.current = 0;
    }
    setPullDistanceState(0);
    if (dist >= PULL_THRESHOLD) {
      haptic("medium");
      startRefreshTransition(() => { router.refresh(); });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // This app uses an overflow-hidden shell with an INNER scroll container,
    // not window scrolling. Listening to window "scroll" or "resize" would pass
    // scrollY=0 every time, resetting headerVisible→true and undoing any
    // scroll-back hiding. Only the custom mobile-shell-scroll event (dispatched
    // by calendar view) and the onScroll handler on the content div are used.
    const onShellScroll = (event: Event) => {
      const detail = event as CustomEvent<{ scrollTop?: number }>;
      if (typeof detail.detail?.scrollTop !== "number") return;
      requestVisibilityUpdate(detail.detail.scrollTop);
    };

    lastScrollYRef.current = 0;
    window.addEventListener("mobile-shell-scroll", onShellScroll as EventListener);

    return () => {
      window.removeEventListener("mobile-shell-scroll", onShellScroll as EventListener);
    };
  }, [requestVisibilityUpdate]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSidebar();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSidebar, sidebarOpen]);

  useEffect(() => () => clearSidebarChromeTimer(), [clearSidebarChromeTimer]);

  // 화면 스와이프 뒤로가기(2026-10-08) — 제스처 엔진을 붙이고, 이 화면의 복제본을 한가할 때 만들어 두었다가 떠날 때 맡긴다
  // (다음 화면에서 밀 때 아래에 깔린다). 뒤로 떠날 때(기록 번호가 줄었을 때)는 맡기지 않는다 — 그 화면으로 다시 「뒤로」 올
  // 일이 없다. 2분할 칸 안에서는 둘 다 하지 않는다. docs/product/16-mobile-navigation.md 「뒤로가기 — 화면 스와이프」
  useLayoutEffect(() => {
    const main = mainRef.current;
    const surface = surfaceRef.current;
    if (!main || !surface || document.documentElement.hasAttribute("data-pane")) return;
    const ownIndex = getHistoryIndex();
    const ownUrl = getHistoryUrl(ownIndex);
    const capture = trackScreen(main);
    const detach = attachSwipeBack({
      isSwipeScreen: () => isSwipeBackScreen(window.location.pathname),
      main,
      surface,
    });
    return () => {
      detach();
      if (ownUrl && getHistoryIndex() >= ownIndex) capture.commit(ownIndex, ownUrl);
      capture.dispose();
    };
  }, []);

  // 2분할 오른쪽 칸(`html[data-pane]`) 안이면 주소가 바뀔 때마다 부모 목록에 알린다 — 상세 밖으로 가면 부모가 칸을 닫는다.
  useEffect(() => {
    if (!document.documentElement.hasAttribute("data-pane")) return;
    window.parent.postMessage(
      { kind: "nav", path: window.location.pathname + window.location.search, type: SPLIT_PANE_MESSAGE },
      window.location.origin,
    );
  }, [pathname]);

  // Persist bottom-bar edits when the sheet closes (any close path), if changed.
  useEffect(() => {
    if (createOpen) {
      sheetWasOpenRef.current = true;
      return;
    }
    if (!sheetWasOpenRef.current) return;
    sheetWasOpenRef.current = false;

    if (JSON.stringify(navTabIds) === JSON.stringify(savedNavRef.current)) {
      return;
    }
    const next = navTabIds;
    savedNavRef.current = next;
    startNavSave(async () => {
      const result = await updateBottomNavTabs(next);
      if (result.ok) {
        router.refresh();
      }
    });
  }, [createOpen, navTabIds, router, startNavSave]);

  if (!session) return null;

  void appearance;

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);

  // User-customized bottom tabs, split into left / right around the center FAB.
  // 권한이 붙은 항목은 권한이 없으면 하단 바에 고정돼 있어도 그리지 않는다(운영 관리자 메뉴는 애초에 후보가 아니다).
  // 사이드 메뉴 한 줄 — 일반 메뉴와 운영 관리자 구역이 같은 모양을 쓴다.
  const renderNavItem = (item: (typeof mobileSidebarNavigation)[number] | (typeof mobileOpsAdminNavigation)[number]) => {
    const Icon = item.icon;
    const isActive = item.id === activeItem;
    const count = badges[item.id] ?? 0;

    return (
      <Link
        key={item.id}
        href={item.href}
        onClick={closeSidebar}
        aria-current={isActive ? "page" : undefined}
        className="group relative flex h-[50px] items-center gap-[14px] px-2"
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute -left-[22px] bottom-[13px] top-[13px] w-[3px] rounded-r-[3px] bg-primary"
          />
        )}
        <Icon
          aria-hidden="true"
          className={cn(
            "size-[22px] shrink-0 transition-colors",
            isActive
              ? "text-primary"
              : "text-muted-foreground group-hover:text-foreground",
          )}
        />
        <span
          className={cn(
            "flex-1 text-[15px] transition-colors",
            isActive ? "font-bold text-primary" : "font-medium text-foreground",
          )}
        >
          {getNavigationLabel(item, locale)}
        </span>
        {count > 0 && (
          <span
            className={cn(
              "font-mono text-[12.5px] font-semibold tabular-nums",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    );
  };
  // 판매 캘린더 페이지는 권한 키에 더해 **관리자 웹 역할**도 요구한다(쓰기 액션이 `requireAdminSession` 을 거친다).
  // 메뉴도 같은 두 조건으로 거른다 — 키만 받은 현장 역할에게 메뉴를 보여 주면 눌러도 홈으로 튕긴다(2026-10-01).
  const canSeeMobileNavItem = (item: { id: string }) =>
    canSeeNavItem(item, session.capabilities) &&
    (!isMobileOpsAdminNavItem(item.id) || canAccessAdminWeb(session.user.role));
  const opsNavItems = mobileOpsAdminNavigation.filter(canSeeMobileNavItem);
  const bottomItems = resolveBottomNavItems(navTabIds).filter(canSeeMobileNavItem);
  const splitAt = Math.ceil(bottomItems.length / 2);
  const leftTabs = bottomItems.slice(0, splitAt);
  const rightTabs = bottomItems.slice(splitAt);
  const isBarFull = navTabIds.length >= MAX_BOTTOM_NAV_TABS;
  const topChromeVisible = headerVisible && !sidebarChromeLocked;

  const renderTab = (item: (typeof bottomItems)[number]) => {
    const isActive = item.id === activeItem;
    return (
      <Link
        key={item.id}
        aria-current={isActive ? "page" : undefined}
        className={cn("tabbar__item", isActive && "is-active")}
        href={item.href}
        // 이미 있는 탭을 다시 누르면 **그 탭의 기본 화면으로 되돌린다**(네이티브 앱 관례).
        //
        // 예전에는 스크롤만 맨 위로 올렸는데, 목록 화면은 `?view=` `?date=` `?month=` 같은 쿼리로
        // 상태를 들고 있어서 "완료·기록 탭을 보다가 투두이스트를 다시 눌렀는데 그대로"인 상황이
        // 됐다. 지금 URL 이 탭 기본 주소와 다르면 기본 주소로 이동해 필터·뷰를 초기화하고,
        // 이미 기본 주소면 맨 위로 스크롤한다(더 되돌릴 상태가 없으므로).
        onClick={(event) => {
          if (!isActive) return;
          event.preventDefault();
          haptic("light");
          setSidebarOpen(false);

          const el = scrollElRef.current;
          const reduce =
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          const current = window.location.pathname + window.location.search;

          if (current !== item.href) {
            // 되돌아갈 때 예전 스크롤 위치가 복원되면 "리셋"이 아니게 되므로 저장분을 버린다.
            SCROLL_POSITIONS.delete(item.href);
            el?.scrollTo({ top: 0, behavior: "auto" });
            router.push(item.href);
            return;
          }

          el?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
          setContentKey((k) => k + 1);
        }}
      >
        <span className="ico">{LAUNCHER_META[item.id]?.icon ?? FALLBACK_ICON}</span>
        {/* 탭바만 축약형을 쓴다 — 사이드 메뉴·편집 시트는 정식 이름 그대로. */}
        <span className="lbl">{getNavigationTabLabel(item, locale)}</span>
      </Link>
    );
  };

  return (
    <main
      aria-label={title}
      className="h-dvh overflow-hidden bg-background text-foreground"
      ref={mainRef}
    >

      {/* ── Option-B PTR indicator — fixed at the top, revealed as the whole shell slides down ── */}
      {/* The shell (header + content + bottom nav) all translate together; this fixed layer fills
          the gap that opens above them. Background matches the canvas so the reveal looks seamless. */}
      <div
        aria-atomic="true"
        aria-live="polite"
        data-ptr-indicator=""
        className="pointer-events-none fixed inset-x-0 top-0 z-[1] flex flex-col items-center justify-center bg-background"
        style={{
          height: `calc(env(safe-area-inset-top, 0px) + ${REFRESH_DISPLAY_H}px)`,
          // Push content below the notch/status-bar so it's visible when the shell slides down.
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <p
          className="text-[11px] font-semibold tracking-wide text-muted-foreground"
          style={{
            opacity: (isReadyToRefresh || isRefreshPending) ? 1 : 0,
            transition: isPulling ? "none" : "opacity 180ms ease",
          }}
        >
          {isRefreshPending
            ? dictionary.mobile.homeRefreshing
            : dictionary.mobile.homeReleaseToRefresh}
        </p>
      </div>

      {/* 폰 = 430px 한 줄. 넓은 화면(`fold:`)은 폭 전부 — 왼쪽 레일/사이드바 + 본문(2026-10-05 태블릿 · 폴드 적응형). */}
      <div
        data-shell-frame=""
        className={cn(
          "relative mx-auto flex h-full w-full flex-col overflow-hidden fold:max-w-none fold:flex-row",
          wide ? "max-w-none" : "max-w-[430px]",
        )}
      >
        {/* 넓은 화면에서 서랍(전체 메뉴)이 열리면 뒤를 어둡게 — 서랍이 화면 일부만 덮으므로. */}
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 z-[59] hidden bg-slate-950/30 transition-opacity duration-300 fold:block",
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={closeSidebar}
        />
        <aside
          aria-label={dictionary.common.menu}
          // 열려 있을 때만 — 앱(Android) 뒤로가기 버튼이 먼저 메뉴를 닫게 한다(NativeShellBridge, 2026-10-06).
          data-native-back-overlay={sidebarOpen ? "" : undefined}
          className={cn(
            "absolute inset-y-0 left-0 z-[60] flex w-full flex-col overflow-hidden px-[22px] pb-[18px] pt-[max(24px,env(safe-area-inset-top))] text-foreground",
            // 넓은 화면에서는 왼쪽 360px 서랍(화면 전체를 덮지 않는다).
            "fold:w-[360px] fold:border-r fold:border-border",
            sidebarOpen && "fold:shadow-[24px_0_60px_-30px_rgba(2,6,23,0.45)]",
          )}
          style={{
            background: "var(--background)",
            transform: sidebarOpen ? "translate3d(0, 0, 0)" : "translate3d(-100%, 0, 0)",
            transition: `transform ${SIDEBAR_TRANSITION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
            willChange: "transform",
          }}
        >
          {/* Header */}
          <div className="flex h-10 items-center justify-between px-0.5">
            <Link
              href="/mobile"
              onClick={closeSidebar}
              className="wordmark text-[24px] text-foreground"
            >
              Foldy
            </Link>
            <button
              aria-label={dictionary.common.menu}
              className="flex size-[38px] items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
              onClick={closeSidebar}
              type="button"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* User row — flat, hairline bottom */}
          <Link
            href="/account?mode=mobile"
            onClick={closeSidebar}
            className="mt-5 flex items-center gap-[13px] border-b border-border px-1 pb-4"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
              <UserCircle className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold tracking-[-0.01em]">
                {session.user.name}
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-muted-foreground">
                {dictionary.roles[session.user.role]}
              </p>
            </div>
            <ChevronRight className="size-[17px] shrink-0 text-muted-foreground opacity-55" aria-hidden="true" />
          </Link>

          {/* Nav */}
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <p className="mb-1.5 ml-1 mt-[22px] text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              {dictionary.common.menu}
            </p>
            <nav className="flex flex-col">
              {mobileSidebarNavigation.filter((item) => canSeeNavItem(item, session.capabilities)).map(renderNavItem)}
            </nav>
            {/* 운영 관리자 — 일반 메뉴와 섞지 않고 아래에 따로 둔다(데스크톱 사이드바의 「운영 관리자」 묶음과 같다).
                권한(`ops_admin.access`)이 없으면 구역째 안 보인다. */}
            {opsNavItems.length > 0 && (
              <>
                <p className="mb-1.5 ml-1 mt-[18px] border-t border-border pt-[18px] text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {dictionary.admin.console.navGroupOpsAdmin}
                </p>
                <nav aria-label={dictionary.admin.console.navGroupOpsAdmin} className="flex flex-col">
                  {opsNavItems.map(renderNavItem)}
                </nav>
              </>
            )}
          </div>

          {/* Footer — hairline top, transparent buttons. Account (flex) + Bug Report + Logout. */}
          <div className="mt-[14px] flex items-center gap-1 border-t border-border pt-[14px]">
            <Link
              href="/account?mode=mobile"
              onClick={closeSidebar}
              className="flex min-w-0 flex-1 items-center gap-[10px] rounded-[12px] px-2 py-[10px] text-foreground transition-colors hover:bg-muted"
            >
              <UserCircle className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate text-[13.5px] font-semibold">{dictionary.common.account}</span>
            </Link>
            <Link
              href={mobileNavBugs.href}
              onClick={closeSidebar}
              aria-current={activeItem === mobileNavBugs.id ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-[7px] rounded-[12px] px-[12px] py-[10px] text-[13px] font-semibold transition-colors hover:bg-muted hover:text-foreground",
                activeItem === mobileNavBugs.id ? "text-primary" : "text-muted-foreground",
              )}
            >
              <BugIcon className="size-4 shrink-0" aria-hidden="true" />
              {getNavigationLabel(mobileNavBugs, locale)}
            </Link>
            <form action={signOut} className="shrink-0">
              <button
                type="submit"
                className="flex items-center gap-[7px] rounded-[12px] px-[12px] py-[10px] text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut className="size-4" aria-hidden="true" />
                {dictionary.common.logout}
              </button>
            </form>
          </div>
        </aside>

        <MobileSideNav
          activeItem={activeItem}
          badges={badges}
          editIcon={EDIT_ICON}
          labels={{
            account: dictionary.common.account,
            collapse: dictionary.common.collapseMenu,
            edit: dictionary.common.edit,
            editBottomBar: dictionary.common.editBottomBar,
            expand: dictionary.common.expandMenu,
            logout: dictionary.common.logout,
            menu: dictionary.common.menu,
            notifications: dictionary.navigation.utility.notifications,
          }}
          locale={locale}
          menuItems={mobileSidebarNavigation.filter((item) => canSeeNavItem(item, session.capabilities))}
          onEdit={() => setCreateOpen(true)}
          onMenu={openSidebar}
          opsItems={opsNavItems}
          opsTitle={dictionary.admin.console.navGroupOpsAdmin}
          tabItems={bottomItems}
          userName={session.user.name}
          userRole={dictionary.roles[session.user.role]}
        />

        <div
          className="relative flex h-full w-full flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] fold:min-w-0 fold:flex-1"
          // 화면 스와이프 뒤로가기에서 손가락을 따라 움직이는 판(`translate` — PTR 의 `transform` 과 따로 논다).
          data-swipe-surface=""
          ref={surfaceRef}
          style={{
            // z-index: 2 makes this stacking context sit ABOVE the fixed PTR indicator (z-1),
            // so the header is not covered when contentOffset = 0. When pulling, the shell slides
            // down revealing the indicator through the gap at the top.
            zIndex: 2,
            transform: `translateY(${shellY})`,
            transition: isPulling
              ? "none"
              : "transform 420ms cubic-bezier(0.34,1.56,0.64,1)",
            willChange: isPulling || isRefreshPending || contentOffset > 0 ? "transform" : "auto",
          }}
        >
          {/* Top bar — OVERLAY (mirrors the bottom tab bar). It used to be an in-flow h-16
              block whose inner content merely faded on scroll, leaving the 64px slot occupied.
              Now it is absolutely positioned and slides fully up on scroll-down (and back on
              scroll-up), so the content reclaims that space — exactly like the bottom bar. The
              scroll container carries a CONSTANT top padding to clear it, so there is no reflow
              jump (the height never changes; only the overlay translates). */}
          <div
            data-shell-top=""
            className={cn(
              "absolute inset-x-0 top-[env(safe-area-inset-top)] z-30 h-16 overflow-hidden border-0 motion-reduce:transition-none",
              // 넓은 화면은 레일 · 사이드바가 메뉴 · 알림 · 내 정보를 맡는다.
              "fold:hidden",
              !topChromeVisible && "pointer-events-none",
            )}
            style={{
              transform: topChromeVisible
                ? "translateY(0)"
                : "translateY(calc(-100% - env(safe-area-inset-top)))",
              // Hide (scroll-down): fast ease-in — bar follows the finger quickly.
              // Show (scroll-up):  spring ease — bar settles into place naturally.
              transition: topChromeVisible
                ? "transform 400ms cubic-bezier(0.22, 1, 0.36, 1)"
                : "transform 200ms cubic-bezier(0.4, 0, 1, 1)",
            }}
          >
            <div
              className="relative h-16 bg-background px-4 pt-2"
              // 넓은 모드는 가로 화면에서 노치 · 카메라 옆까지 간다 — 그 밑에 메뉴 버튼이 숨지 않게 안전 영역만큼 민다.
              style={wide ? { paddingLeft: "calc(1rem + env(safe-area-inset-left))", paddingRight: "calc(1rem + env(safe-area-inset-right))" } : undefined}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,var(--background)_0%,color-mix(in_oklab,var(--background)_82%,transparent)_55%,transparent_100%)]"
              />
              {/* 화이트 리디자인(2026-10-09): 세 줄 메뉴(가운데 짧게) · 왼쪽 「Foldy」 · 알림 · 내 이니셜 동그라미. */}
              <div className="relative flex h-12 w-full items-center justify-between pr-1">
                <div className="relative z-10 flex items-center gap-1">
                  <button
                    aria-label={dictionary.common.menu}
                    className="flex size-11 items-center justify-center rounded-[12px] text-foreground transition-colors hover:bg-black/[0.04]"
                    onClick={openSidebar}
                    type="button"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 6h18M3 12h12M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <Link href="/mobile" className="wordmark whitespace-nowrap text-[19px] text-foreground">
                    Foldy
                  </Link>
                </div>

                {/* Notification bell — top-bar shortcut, left of profile */}
                <div className="relative z-10 flex items-center gap-1.5">
                  <Link
                    aria-label={dictionary.navigation.utility.notifications}
                    className="relative flex size-[38px] items-center justify-center text-[#3a3746] transition-colors hover:text-foreground"
                    href="/mobile/notifications"
                  >
                    <Bell className="size-[21px]" aria-hidden="true" />
                    {(badges.notifications ?? 0) > 0 ? (
                      <span
                        aria-label={String(badges.notifications)}
                        className="absolute right-[6px] top-[6px] flex min-w-[14px] items-center justify-center rounded-full bg-rose-500 px-[3px] text-[9px] font-extrabold leading-[14px] text-white"
                      >
                        {(badges.notifications ?? 0) > 99 ? "99+" : badges.notifications}
                      </span>
                    ) : null}
                  </Link>
                  <Link
                    aria-label={dictionary.onboarding.profileTitle}
                    className="flex size-[38px] items-center justify-center"
                    href="/account?mode=mobile"
                  >
                    <span className="flex size-[34px] items-center justify-center rounded-full bg-[#ede7fc] text-[13px] font-bold text-[#5a30cf]">
                      {Array.from(session.user.name?.trim() || "·")[0]}
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Pull-to-refresh wrapper — content scrolls normally; the outer shell div above
              carries the translateY so the entire chrome (header + content + bottom nav) slides
              together (Option-B full-screen pull). The fixed indicator at the top is revealed as
              the shell moves down. No translateY here; no gradient curtain needed. */}
          <div className="relative flex-1 overflow-hidden">
            <div
              data-shell-scroll=""
              className={cn(
                "h-full overflow-y-auto overscroll-y-contain bg-background px-5 pt-[84px] text-foreground fold:px-7 fold:pt-6",
                // 가로 이동은 브라우저가 쓰지 않는다 — 화면 스와이프 뒤로가기의 touchmove 를 언제나 막을 수 있게(안쪽 가로 스크롤 영역은 그대로).
                "touch-pan-y touch-pinch-zoom",
                // 스크롤바를 숨긴다. 실제 기기에서는 쉴 때 보이지 않는 오버레이 스크롤바인데,
                // 데스크톱(그리고 어드민의 아이폰 모양 미리보기)에서는 항상 자리를 차지하는 막대가
                // 생겨 폭 390px 중 15px 을 먹고 기기처럼 보이지도 않는다.
                // 같은 파일의 측면 메뉴 스크롤러가 이미 이렇게 하고 있다 — 그쪽에 맞춘다.
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                hideBottomNav ? "pb-8" : "pb-[124px] fold:pb-10",
              )}
              onScroll={handleContentScroll}
              // 넓은 모드(가로 · 폴드) — 본문도 노치 · 카메라 옆 안전 영역만큼 안쪽으로(세로에서는 0 이라 그대로).
              style={wide ? { paddingLeft: "calc(1.25rem + env(safe-area-inset-left))", paddingRight: "calc(1.25rem + env(safe-area-inset-right))" } : undefined}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              onTouchStart={handleTouchStart}
              ref={scrollElRef}
            >
              {/* 아직 넓은 화면용으로 다듬지 않은 화면은 가운데 760px 한 줄로(폰 화면이 끝없이 늘어나지 않게). `wide` 화면은 폭 전부. */}
              <div
                className={wide ? undefined : cn("fold:mx-auto fold:max-w-[760px]", split && "tablet:max-w-none")}
                data-shell-column=""
                key={contentKey}
              >
                {children}
              </div>
            </div>
          </div>

          {hideBottomNav ? null : (
            <nav
              aria-label={title}
              className={cn(
                "tabbar absolute inset-x-0 bottom-0 z-20 motion-reduce:transition-none fold:hidden",
                wide && "mx-auto max-w-[560px]",
                !topChromeVisible && "pointer-events-none",
              )}
              style={{
                transform: topChromeVisible
                  ? "translateY(0)"
                  : "translateY(calc(100% + 40px))",
                transition: topChromeVisible
                  ? "transform 400ms cubic-bezier(0.22, 1, 0.36, 1)"
                  : "transform 200ms cubic-bezier(0.4, 0, 1, 1)",
              }}
            >
              {leftTabs.map(renderTab)}
              <button
                aria-label={dictionary.common.editBottomBar}
                className="tabbar__fab"
                onClick={() => setCreateOpen(true)}
                type="button"
              >
                <span className="circle">{EDIT_ICON}</span>
                <span className="lbl">{dictionary.common.edit}</span>
              </button>
              {rightTabs.map(renderTab)}
            </nav>
          )}

          {/* Center action ("추가") sheet — bottom-bar editor (pick up to 4 tabs). */}
          {createOpen ? (
            <BottomSheet
              ariaLabel={dictionary.common.editBottomBar}
              header={
                <div className="add-sheet__head">
                  <div className="add-sheet__head-text">
                    <p className="add-sheet__title">
                      {dictionary.common.editBottomBar}
                      <span className="ml-2 text-[12px] font-bold text-primary">
                        {navTabIds.length}/{MAX_BOTTOM_NAV_TABS}
                      </span>
                    </p>
                    <p className="add-sheet__sub">
                      {isBarFull ? dictionary.common.bottomBarFull : dictionary.common.editBottomBarHint}
                    </p>
                  </div>
                </div>
              }
              onClose={closeCreate}
            >
              <div className="add-sheet__scroll">
                <div className="add-grid">
                  {customizableBottomNavItems.filter(canSeeMobileNavItem).map((item) => {
                    const meta = LAUNCHER_META[item.id];
                    const selected = navTabIds.includes(item.id);
                    const disabled = !selected && isBarFull;
                    return (
                      <button
                        key={item.id}
                        aria-pressed={selected}
                        className="add-tile"
                        disabled={disabled}
                        onClick={() => toggleNavTab(item.id)}
                        style={{
                          background: selected
                            ? "color-mix(in oklab, var(--primary) 7%, var(--surface))"
                            : "var(--surface)",
                          boxShadow: selected
                            ? "inset 0 0 0 2px var(--primary)"
                            : "inset 0 0 0 1px var(--border)",
                          opacity: disabled ? 0.45 : 1,
                        }}
                        type="button"
                      >
                        <span
                          className="add-tile__badge"
                          style={{
                            background: selected ? "var(--primary)" : "var(--muted)",
                            color: selected ? "var(--primary-foreground)" : "var(--muted-foreground)",
                          }}
                        >
                          {meta?.icon ?? FALLBACK_ICON}
                        </span>
                        <span className="add-tile__label">{getNavigationLabel(item, locale)}</span>
                        <span
                          aria-hidden="true"
                          className="ml-auto flex size-5 items-center justify-center rounded-full"
                          style={{
                            background: selected ? "var(--primary)" : "transparent",
                            color: "#fff",
                            border: selected ? "none" : "1.5px solid var(--border)",
                          }}
                        >
                          {selected ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path d="M5 12l4 4 10-10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </BottomSheet>
          ) : null}

        </div>
      </div>
    </main>
  );
}
