"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { ReactNode, UIEvent } from "react";
import { Bell } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { MobileMenuPanel } from "@/components/shell/mobile-menu-panel";
import { FALLBACK_GLYPH, NAV_GLYPHS } from "@/components/shell/nav-glyphs";
import { MobileSideNav } from "@/components/shell/mobile-side-nav";
import { TabEditor } from "@/components/shell/tab-editor";
import { SPLIT_PANE_MESSAGE } from "@/lib/split-pane";
import { attachSwipeBack } from "@/lib/swipe-back/controller";
import { canStartSwipeBack } from "@/lib/swipe-back/history-model";
import { getHistoryIndex, getHistoryUrl } from "@/lib/swipe-back/history-tracker";
import { trackScreen } from "@/lib/swipe-back/snapshot-store";
import { updateBottomNavTabs } from "@/app/account/actions";
import {
  canSeeNavItem,
  customizableBottomNavItems,
  isMobileOpsAdminNavItem,
  getNavigationTabLabel,
  mobileNavBugs,
  mobileOpsAdminNavigation,
  mobileSidebarNavigation,
  resolveBottomNavItems,
} from "@/config/navigation";
import { hasAdminWebAccess } from "@/config/capabilities";
import { haptic } from "@/lib/haptics";
import { commitScreenEntrance, consumeScreenEntrance, setNavDirection, type ScreenEntrance } from "@/lib/nav-direction";
import { getDictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import "@/components/shell/pull-refresh.css";
import { useDrawerDragClose } from "@/components/shell/use-drawer-drag-close";
import { OfflinePill } from "@/components/shell/offline-pill";
import { useToastMotion } from "@/components/shell/use-toast-motion";

type MobileShellProps = {
  // 버그 신고는 사이드바 내비 목록에 없지만(로그아웃 옆 푸터에 있다)
  // 그 페이지들이 스스로 활성으로 표시하므로, 사이드바 id 와 함께 그 id 도 허용한다.
  activeItem?:
    | (typeof mobileSidebarNavigation)[number]["id"]
    | (typeof mobileOpsAdminNavigation)[number]["id"]
    | typeof mobileNavBugs.id;
  appearance?: "default" | "announcement" | "cleaning";
  children: React.ReactNode;
  title: string;
  /** 사이드바 내비 id 별 미처리 운영 건수(예: requests, notifications). */
  badges?: Partial<Record<string, number>>;
  /**
   * 자체 하단 고정 제출 바가 있는 생성 폼처럼, 집중하는 전체 화면 흐름에서는 하단 탭 바를 숨긴다
   * (안 그러면 탭 바와 겹친다). 기본은 false — 사이드 메뉴로 모든 기능에 닿을 수 있다.
   * true 이면 비울 탭 바가 없으므로 콘텐츠 아래 여백이 줄어든다.
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
  /**
   * 로딩 자리 셸(`MobileShellPlaceholder` ← `loading.tsx`, 2026-10-21). 화면 데이터가 오기 전에 탭바 · 위 줄을 그대로 둔 채
   * 들어오는 전환을 먼저 시작한다. 스와이프 뒤로가기 · 밑그림 · 스크롤 위치 저장은 하지 않는다(진짜 화면이 한다).
   */
  placeholder?: boolean;
};

/**
 * 화면 들어오는 움직임(2026-10-21 네이티브 점검) — **본문 칸만** 움직인다. 탭바 · 위 줄은 화면마다 같은 자리에 같은 모양으로
 * 다시 그려지므로 움직이지 않으면 고정돼 보인다(네이티브 탭바처럼). 키프레임은 globals.css.
 */
const ENTRANCE_CLASS: Partial<Record<ScreenEntrance["kind"], string>> = {
  back: "screen-pop",
  forward: "screen-push",
  reveal: "screen-reveal",
  tab: "screen-tab",
};

/** 로딩 자리 셸이 진짜 화면의 모양을 흉내 내도록 — 경로별로 마지막에 그린 셸 설정 · 마지막 배지. */
type ShellHint = Pick<MobileShellProps, "activeItem" | "hideBottomNav" | "title" | "wide" | "split">;
const SHELL_HINTS = new Map<string, ShellHint>();
let lastBadges: Partial<Record<string, number>> = {};

export function getShellHint(pathname: string): { hint: ShellHint | undefined; badges: Partial<Record<string, number>> } {
  return { badges: lastBadges, hint: SHELL_HINTS.get(pathname) };
}

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

// 가운데 FAB 아이콘 — 앱 그리드 스퀴클("Bottom Bar (Squircle Edit)" 디자인). 편집 시트를 연다.
const EDIT_ICON = (
  <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
  </svg>
);

/**
 * "추가" 런처 메타데이터, 사이드바 내비 항목 id 기준.
 * 기능마다 색조가 다르다. 런처 그리드는
 * `mobileSidebarNavigation` 에서 만들어지므로 내비 항목을 추가하면 타일이 자동으로 늘어난다.
 * 색은 명도/채도를 고정하고 색조만 바꿔 통일된 팔레트로 만든다.
 */
const LAUNCHER_META: Record<string, { hue: number; icon: ReactNode }> = {
  home: { hue: 185, icon: NAV_GLYPHS.home },
  calendar: { hue: 250, icon: NAV_GLYPHS.calendar },
  cleaning: { hue: 155, icon: NAV_GLYPHS.cleaning },
  requests: { hue: 70, icon: NAV_GLYPHS.requests },
  announcements: { hue: 30, icon: NAV_GLYPHS.announcements },
  "ops-calendar": { hue: 225, icon: NAV_GLYPHS["ops-calendar"] },
  notifications: { hue: 305, icon: NAV_GLYPHS.notifications },
  directory: { hue: 225, icon: NAV_GLYPHS.directory },
  suggestions: { hue: 345, icon: NAV_GLYPHS.suggestions },
  attendance: { hue: 200, icon: NAV_GLYPHS.attendance },
};

const FALLBACK_ICON = FALLBACK_GLYPH;


/**
 * 셸 자체 오류 알림(하단 탭 저장 실패, 2026-10-26) — 탭바 위 짧은 알약. 움직임(사라짐 · 밀어서 치우기)은 모바일 토스트 공용
 * `useToastMotion`.
 */
function ShellErrorToast({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  // 바깥 띠는 화면 폭 전체라 터치를 통과시키고(pointer-events-none), 움직임 · 밀어서 치우기는 알약에만 건다.
  const ref = useToastMotion<HTMLSpanElement>(onDismiss);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] z-[90] flex justify-center px-6 fold:bottom-6"
      role="alert"
    >
      <span
        ref={ref}
        className="pointer-events-auto rounded-full bg-slate-900/92 px-[18px] py-2.5 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.6)]">
        {text}
      </span>
    </div>
  );
}

/** 고무줄 저항: 빠르게 시작해 MAX_DISPLAY_H 에서 점근적으로 한계에 닿는다. */
function computeContentOffset(raw: number): number {
  if (raw <= 0) return 0;
  return MAX_DISPLAY_H * raw / (raw + MAX_PULL * 0.4);
}

// 라우트별 스크롤 복원. 앱은 창이 아니라 안쪽 div 를 스크롤하는데, Next 의
// 기본 스크롤 복원은 이를 추적하지 못해서 뒤로 가면 긴 목록에서 보던 위치를
// 항상 잃었다. 경로 기준 키이고 모듈 범위라 라우트별 셸 재마운트 사이에도 유지된다
// (셸은 페이지마다 그려지므로 이 Map 만 세션 동안 남는다).
const SCROLL_POSITIONS = new Map<string, number>();

// useSyncExternalStore 로 「지금 하이드레이션 중인가」를 읽는다 — 서버 · 하이드레이션 그림은 true, 그 뒤 클라이언트 그림은 false.
const noopSubscribe = () => () => {};
const hydratingOnClient = () => false;
const hydratingOnServer = () => true;



export function MobileShell({
  activeItem,
  appearance = "default",
  children,
  title,
  badges = {},
  hideBottomNav = false,
  wide = false,
  split = false,
  placeholder = false,
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
  // 하이드레이션 중이면 true — 서버와 같은 「움직임 없음」으로 첫 그림을 맞춘다(`consumeScreenEntrance` 머리말).
  const hydrating = useSyncExternalStore(noopSubscribe, hydratingOnClient, hydratingOnServer);
  const [entrance] = useState(() => consumeScreenEntrance(pathname, placeholder, hydrating));
  // 화면에 붙었다 — 그리다 버려진 셸이 다시 불러도 같은 등장을 받게 해 두던 것을 비운다(`commitScreenEntrance`).
  useEffect(() => {
    commitScreenEntrance(pathname, placeholder);
    // 마운트 때 한 번만(등장은 마운트 때 정해진다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [entranceDone, setEntranceDone] = useState(false);
  const entranceClass = entranceDone ? undefined : ENTRANCE_CLASS[entrance.kind];
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  /**
   * 위 줄 작은 제목(HIG 다듬기 2차, 2026-10-19 — iOS Large Title). 화면의 큰 제목(`[data-large-title]` 또는 첫 `h1`)이
   * 위 줄 아래로 스크롤돼 사라지면, 위 줄 가운데에 그 제목(`data-compact-title` 이 있으면 그 값)을 작게 띄운다.
   * 맨 위로 돌아오면 다시 숨긴다. 앱 이름(「Foldy」)은 위 줄에 쓰지 않는다 — HIG 「Don't title windows with your app name」.
   */
  const [compactTitle, setCompactTitle] = useState("");
  const [largeTitleGone, setLargeTitleGone] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerBackdropRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef(0);
  const touchStartXRef = useRef(0);
  const isPullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  // PTR 은 맨 위에서 시작한 제스처에서만 켤 수 있다. scrollTop 이 0보다 커지는 순간 해제하여,
  // 손가락을 댄 채 관성/고무줄로 0까지 돌아와도 오래된 기준점으로 PTR 이 켜지지 않는다.
  const ptrEligibleRef = useRef(false);
  const sidebarChromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // rAF 로 모은 touchmove → setState: ref 는 샘플마다 동기적으로 갱신하지만, 화면에 보이는 React
  // state setter 는 애니메이션 프레임당 최대 한 번만 호출한다(~120Hz 에서 전체 하위 트리 재렌더를 피한다).
  const pullRafRef = useRef(0);
  const { session } = useSession();

  // 큰 제목 관찰 — 화면이 바뀌거나(경로 · 탭 다시 누름) 내용이 늦게 들어와도(스트리밍) 찾을 때까지 몇 번 다시 본다.
  useEffect(() => {
    const root = scrollElRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const attach = () => {
      const el = root.querySelector<HTMLElement>("[data-large-title], h1");
      if (!el) {
        // 새 화면에 큰 제목이 (아직) 없다 — 앞 화면의 작은 제목을 남기지 않는다.
        setCompactTitle("");
        setLargeTitleGone(false);
        return false;
      }
      setCompactTitle((el.dataset.compactTitle ?? el.textContent ?? "").trim());
      // 위 줄(64px) 아래로 완전히 지나가면 「사라짐」.
      io = new IntersectionObserver(([entry]) => setLargeTitleGone(!entry.isIntersecting), {
        root,
        rootMargin: "-64px 0px 0px 0px",
      });
      io.observe(el);
      return true;
    };
    // 첫 시도도 타이머로 — 효과 본문에서 바로 setState 하지 않는다(react-hooks/set-state-in-effect).
    for (const ms of [0, 120, 400, 1200]) {
      timers.push(
        setTimeout(() => {
          if (!io) attach();
        }, ms),
      );
    }
    return () => {
      timers.forEach(clearTimeout);
      io?.disconnect();
    };
  }, [pathname, contentKey]);

  // 사용자 맞춤 하단 탭(가운데 "추가" 편집 시트로 바꾼다).
  const initialNavIds = resolveBottomNavItems(session?.user.bottomNavTabs).map(
    (item) => item.id,
  );
  const [navTabIds, setNavTabIds] = useState<string[]>(initialNavIds);
  const savedNavRef = useRef<string[]>(initialNavIds);
  const sheetWasOpenRef = useRef(false);
  const [, startNavSave] = useTransition();
  const [navSaveFailed, setNavSaveFailed] = useState(false);
  const dismissNavSaveFailed = useCallback(() => setNavSaveFailed(false), []);
  useEffect(() => {
    if (!navSaveFailed) return;
    const timer = setTimeout(() => setNavSaveFailed(false), 3200);
    return () => clearTimeout(timer);
  }, [navSaveFailed]);

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

  // 스크롤 이벤트마다 새로 만들지 않는다 — 한 번 만든 MediaQueryList 의 `matches` 는 화면 폭이 바뀌면 저절로 갱신된다.
  const foldMqlRef = useRef<MediaQueryList | null>(null);
  const requestVisibilityUpdate = useCallback(
    (currentY: number) => {
      foldMqlRef.current ??= window.matchMedia(FOLD_QUERY);
      if (foldMqlRef.current.matches) {
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

  // 복원 키는 경로만이 아니라 전체 url(경로 + 쿼리)로 잡는다 — 목록 화면은 한 경로에서도 쿼리(?view=, ?month=, ?date=)에 따라
  // 내용이 달라서, 경로만의 키는 다른(더 길거나 짧은)
  // 변형에서 저장한 위치를 복원했다.
  const routeKey = useCallback(
    () =>
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : pathname,
    [pathname],
  );

  const handleContentScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    if (placeholder) return requestVisibilityUpdate(top);
    const key = routeKey();
    // 뒤로 가기 복원을 위해 현재 위치를 기억한다. 지운 뒤 다시 넣어 이 키가 가장 최근이 되게 하고
    // (Map 은 삽입 순서를 유지한다) Map 이 무한히 커지지 않도록 개수를 제한한다.
    SCROLL_POSITIONS.delete(key);
    SCROLL_POSITIONS.set(key, top);
    if (SCROLL_POSITIONS.size > 30) {
      SCROLL_POSITIONS.delete(SCROLL_POSITIONS.keys().next().value as string);
    }
    requestVisibilityUpdate(top);
  };

  // 마운트할 때 이 라우트에 저장된 스크롤 위치를 복원한다(네이티브 뒤로 가기 동작). 셸이 마운트될 때
  // 한 번 실행된다(라우트 이동마다 셸이 다시 마운트된다). layout effect 라서 처음 그려진 프레임이 이미
  // 저장된 위치에 있다 — 스와이프 뒤로 뒤에는 화면이 손가락 바로 밑에 있던 밑그림과 같아야 한다.
  //
  // 2026-10-21: **앞으로 들어온 화면(push)은 맨 위에서** 시작한다 — 네이티브 앱에서 새로 연 화면은 늘 맨 위다. 예전에는 링크로 다시
  // 들어와도 지난번 위치로 내려가 있었다. 되돌아온 화면(뒤로 · 스와이프) · 탭 전환 · 같은 화면은 그대로 복원.
  const restoreScroll = !placeholder && entrance.direction !== "forward";
  useLayoutEffect(() => {
    const el = scrollElRef.current;
    if (!el || !restoreScroll) return;
    const saved = SCROLL_POSITIONS.get(routeKey());
    if (saved && saved > 0) {
      el.scrollTop = saved;
      lastScrollYRef.current = saved; // 첫 스크롤 이벤트에서 큰 델타가 튀지 않게 한다
    }
  }, [pathname, restoreScroll, routeKey]);

  // 로딩 자리 셸이 다음에 이 경로를 흉내 낼 수 있게.
  useEffect(() => {
    if (placeholder) return;
    SHELL_HINTS.set(pathname, { activeItem, hideBottomNav, split, title, wide });
    lastBadges = badges;
  }, [activeItem, badges, hideBottomNav, pathname, placeholder, split, title, wide]);

  function syncPullDistance(v: number) {
    pullDistanceRef.current = v;
    if (pullRafRef.current) return;
    pullRafRef.current = window.requestAnimationFrame(() => {
      pullRafRef.current = 0;
      setPullDistanceState(pullDistanceRef.current);
    });
  }

  // 숫자 오프셋 — 표시기의 불투명도/크기 애니메이션에 쓴다(0..REFRESH_DISPLAY_H 범위).
  const contentOffset = isRefreshPending
    ? REFRESH_DISPLAY_H
    : computeContentOffset(pullDistanceState);
  // 셸 translateY 용 CSS 값. 새로 고치는 중에는 env(safe-area-inset-top)를 더해
  // 표시기 내용이 노치/상태 바 뒤에 숨지 않고 완전히 그 아래에 놓이게 한다.
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
      // 부적격으로 표시하고 기준점을 다시 잡아, 나중에 0으로 돌아와도 오래된 Y 와 비교하지 않게 한다.
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
      // 맨 위이지만 이 제스처가 scrollTop>0 에서 시작했거나 지나갔다 — PTR 을 켜지 않는다. 기준점은 최신으로 유지한다.
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
    // 확정 임계값에서 햅틱 한 번 — 사용자가 72px 를 넘을 때 제스처당 한 번만 울린다.
    const wasBelowThreshold = pullDistanceRef.current < PULL_THRESHOLD;
    syncPullDistance(deltaY);
    if (wasBelowThreshold && deltaY >= PULL_THRESHOLD) {
      haptic("light");
    }
  }

  // PC 「모바일 보기」(iframe) 안에서는 마우스로 끌어내려도 당겨서 새로고침(2026-10-15 사용자 지적 — 마우스는 터치 이벤트가 없어
  // 미리보기에서만 안 됐다). 마우스 포인터를 손가락처럼 같은 처리로 넘긴다. 진짜 폰 · 태블릿 칸(data-pane)에는 영향 없음.
  const mouseDragRef = useRef(false);
  const suppressClickRef = useRef(false);
  const inPreviewRef = useRef(false);
  useEffect(() => {
    try {
      inPreviewRef.current = window.self !== window.top && !document.documentElement.hasAttribute("data-pane");
    } catch {
      inPreviewRef.current = true; // 다른 출처 부모 — 그래도 미리보기다.
    }
  }, []);
  const asTouch = (e: React.PointerEvent<HTMLDivElement>) =>
    ({ currentTarget: e.currentTarget, touches: [{ clientX: e.clientX, clientY: e.clientY }] }) as unknown as React.TouchEvent<HTMLDivElement>;
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || e.button !== 0 || !inPreviewRef.current) return;
    mouseDragRef.current = true;
    suppressClickRef.current = false;
    handleTouchStart(asTouch(e));
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!mouseDragRef.current) return;
    handleTouchMove(asTouch(e));
    if (isPullingRef.current) {
      suppressClickRef.current = true;
      e.preventDefault(); // 끄는 동안 글자 선택 안 되게
    }
  }
  function handlePointerUp() {
    if (!mouseDragRef.current) return;
    mouseDragRef.current = false;
    handleTouchEnd();
  }

  function handleTouchEnd() {
    const wasPulling = isPullingRef.current;
    ptrEligibleRef.current = false;
    if (!wasPulling) return;
    const dist = pullDistanceRef.current;
    isPullingRef.current = false;
    setIsPulling(false);
    syncPullDistance(0);
    // 대기 중인 프레임을 취소하고 쉬는 값 0을 지금 확정해, 되돌아가는 애니메이션이 지연 없이 돈다.
    if (pullRafRef.current) {
      cancelAnimationFrame(pullRafRef.current);
      pullRafRef.current = 0;
    }
    setPullDistanceState(0);
    if (dist >= PULL_THRESHOLD) {
      haptic("light");
      startRefreshTransition(() => { router.refresh(); });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // 이 앱은 overflow-hidden 셸과 안쪽 스크롤 컨테이너를 쓰며
    // 창 스크롤을 쓰지 않는다. window "scroll" 이나 "resize" 를 들으면
    // 매번 scrollY=0 이 넘어와 headerVisible→true 로 되돌리고
    // 스크롤 뒤로 숨김을 취소해 버린다. 캘린더 뷰가 보내는 커스텀 mobile-shell-scroll 이벤트와
    // 콘텐츠 div 의 onScroll 핸들러만 쓴다.
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

  // 열린 메뉴를 왼쪽으로 밀어 닫기(2026-10-21 네이티브 점검) — docs/product/16-mobile-navigation.md 「메뉴 끌어 닫기」.
  useDrawerDragClose({ backdropRef: drawerBackdropRef, drawerRef, onClose: closeSidebar, open: sidebarOpen });

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

  // 스와이프 엔진은 화면마다 한 번 붙는다 — 최신 router · 사용자는 ref 로 본다.
  const swipeDepsRef = useRef({ router, userId: session?.user.id ?? "" });
  useEffect(() => {
    swipeDepsRef.current = { router, userId: session?.user.id ?? "" };
  });

  // 화면 스와이프 뒤로가기(2026-10-08) — 제스처 엔진을 붙이고, 이 화면의 복제본을 한가할 때 만들어 두었다가 떠날 때 맡긴다
  // (다음 화면에서 밀 때 아래에 깔린다). 뒤로 떠날 때(기록 번호가 줄었을 때)는 맡기지 않는다 — 그 화면으로 다시 「뒤로」 올
  // 일이 없다. 2분할 칸 안에서는 둘 다 하지 않는다. docs/product/16-mobile-navigation.md 「뒤로가기 — 화면 스와이프」
  useLayoutEffect(() => {
    const main = mainRef.current;
    const surface = surfaceRef.current;
    if (placeholder || !main || !surface || document.documentElement.hasAttribute("data-pane")) return;
    const ownIndex = getHistoryIndex();
    const ownUrl = getHistoryUrl(ownIndex);
    const capture = trackScreen(main, swipeDepsRef.current.userId);
    const detach = attachSwipeBack({
      isSwipeScreen: () => canStartSwipeBack(window.location.pathname),
      main,
      replace: (url) => swipeDepsRef.current.router.replace(url),
      surface,
    });
    return () => {
      detach();
      if (ownUrl && getHistoryIndex() >= ownIndex) capture.commit(ownIndex, ownUrl);
      capture.dispose();
    };
  }, [placeholder]);

  // 2분할 오른쪽 칸(`html[data-pane]`) 안이면 주소가 바뀔 때마다 부모 목록에 알린다 — 상세 밖으로 가면 부모가 칸을 닫는다.
  useEffect(() => {
    if (!document.documentElement.hasAttribute("data-pane")) return;
    window.parent.postMessage(
      { kind: "nav", path: window.location.pathname + window.location.search, type: SPLIT_PANE_MESSAGE },
      window.location.origin,
    );
  }, [pathname]);

  // 시트가 닫힐 때(어떤 닫기 경로든) 바뀐 하단 바 편집을 저장한다.
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
    const previous = savedNavRef.current;
    savedNavRef.current = next;
    startNavSave(async () => {
      // 오프라인 · 서버 오류로 액션이 던지면 오류 화면으로 튕기지 않게 잡는다(2026-10-26). 실패하면 탭을 저장 전으로 되돌리고 알린다.
      let ok = false;
      try {
        ok = (await updateBottomNavTabs(next)).ok;
      } catch {
        ok = false;
      }
      if (ok) {
        router.refresh();
        return;
      }
      if (savedNavRef.current === next) savedNavRef.current = previous;
      setNavTabIds((current) => (current === next ? previous : current));
      haptic("error");
      setNavSaveFailed(true);
    });
  }, [createOpen, navTabIds, router, startNavSave]);

  if (!session) return null;

  void appearance;

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);

  // 사용자 맞춤 하단 탭을 가운데 FAB 기준 왼쪽 / 오른쪽으로 나눈다.
  // 권한이 붙은 항목은 권한이 없으면 하단 바에 고정돼 있어도 그리지 않는다(운영 관리자 메뉴는 애초에 후보가 아니다).
  // 판매 캘린더 페이지는 권한 키에 더해 **관리자 웹 역할**도 요구한다(쓰기 액션이 `requireAdminSession` 을 거친다).
  // 메뉴도 같은 두 조건으로 거른다 — 키만 받은 현장 역할에게 메뉴를 보여 주면 눌러도 홈으로 튕긴다(2026-10-01).
  const canSeeMobileNavItem = (item: { id: string }) =>
    canSeeNavItem(item, session.capabilities) &&
    (!isMobileOpsAdminNavItem(item.id) || hasAdminWebAccess(session));
  const opsNavItems = mobileOpsAdminNavigation.filter(canSeeMobileNavItem);
  const bottomItems = resolveBottomNavItems(navTabIds).filter(canSeeMobileNavItem);
  const splitAt = Math.ceil(bottomItems.length / 2);
  const leftTabs = bottomItems.slice(0, splitAt);
  const rightTabs = bottomItems.slice(splitAt);
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

      {/* 하단 탭 저장 실패 알림 — 셸(당겨서 새로고침으로 transform 이 걸리는 판) 밖에 두어 화면 기준으로 고정한다. */}
      {navSaveFailed ? <ShellErrorToast onDismiss={dismissNavSaveFailed} text={dictionary.common.bottomNavSaveFailed} /> : null}

      {/* Option-B PTR 표시기 — 맨 위 고정, 셸 전체가 내려오면서 드러난다 */}
      {/* 셸(헤더 + 콘텐츠 + 하단 내비)이 함께 이동하고, 이 고정 레이어가
          그 위에 열리는 틈을 채운다. 배경을 캔버스와 맞춰 드러나는 모습이 매끄럽다. */}
      <div
        aria-atomic="true"
        aria-live="polite"
        data-ptr-indicator=""
        // 당기는 동안 바뀌는 띠 — 스와이프 뒤로가기 밑그림 다시 찍기에서 뺀다(snapshot-store).
        data-snapshot-ignore=""
        className="pointer-events-none fixed inset-x-0 top-0 z-[1] flex flex-col items-center justify-start bg-background"
        style={{
          height: `calc(env(safe-area-inset-top, 0px) + ${REFRESH_DISPLAY_H}px)`,
          // 셸이 내려올 때 보이도록 콘텐츠를 노치/상태 바 아래로 민다.
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        {/* 로고 막대(2026-10-15, 시안 Motion-C-Pull-Phone) — 당긴 만큼 위에서부터 하나씩, 다 모이면 딸깍,
            새로고침 중엔 공용 로더처럼 숨 쉼. 막대 묶음은 벌어진 틈의 가운데에 둔다. */}
        <span
          aria-hidden="true"
          className={cn("ptrb-w", isReadyToRefresh && !isRefreshPending && "is-ready")}
          style={{
            translate: `0 ${Math.max(0, contentOffset / 2 - 25)}px`,
            transition: isPulling ? "none" : "translate 260ms cubic-bezier(.23, 1, .32, 1)",
          }}
        >
          <span className={cn("ptrb", isRefreshPending && "is-busy")}>
            {[0, 1, 2].map((k) => {
              const p = Math.min(1, pullDistanceState / PULL_THRESHOLD);
              const v = isRefreshPending ? 1 : Math.max(0, Math.min(1, (p - k * 0.28) / 0.44));
              return (
                <i
                  key={k}
                  style={{
                    opacity: v,
                    transform: `translateY(${(v - 1) * 6}px) scaleX(${0.3 + 0.7 * v})`,
                    transition: isPulling ? "none" : "opacity 220ms ease, transform 260ms cubic-bezier(.23, 1, .32, 1)",
                  }}
                />
              );
            })}
          </span>
        </span>
        <span className="sr-only">
          {isRefreshPending
            ? dictionary.mobile.homeRefreshing
            : isReadyToRefresh
              ? dictionary.mobile.homeReleaseToRefresh
              : ""}
        </span>
      </div>

      {/* 폰 = 430px 한 줄. 넓은 화면(`fold:`)은 폭 전부 — 왼쪽 레일/사이드바 + 본문(2026-10-05 태블릿 · 폴드 적응형). */}
      <div
        data-shell-frame=""
        // 탭바 · 사이드 메뉴 · 레일에서 고른 이동은 탭 전환 — 화면을 밀어 넣지 않고 내용만 바꾼다(네이티브 탭바).
        onClickCapture={(event) => {
          const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
          if (link?.closest(".tabbar, aside, [data-shell-sidenav]")) setNavDirection("tab");
        }}
        className={cn(
          "relative mx-auto flex h-full w-full flex-col overflow-hidden fold:max-w-none fold:flex-row",
          wide ? "max-w-none" : "max-w-[430px]",
        )}
      >
        {/* 넓은 화면에서 서랍(전체 메뉴)이 열리면 뒤를 어둡게 — 서랍이 화면 일부만 덮으므로. */}
        <div
          aria-hidden="true"
          ref={drawerBackdropRef}
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
          // 닫혀 있으면 화면 밖에 있어도 화면 읽기(VoiceOver · TalkBack)와 키보드가 메뉴 20여 개를 본문보다 먼저 읽었다 — 닫힌 동안은 없는
          // 것으로(inert). 열려 있으면 뒤 화면을 읽지 않게 모달로 알린다(2026-10-22 접근성 점검).
          inert={!sidebarOpen}
          role={sidebarOpen ? "dialog" : undefined}
          aria-modal={sidebarOpen ? true : undefined}
          ref={drawerRef}
          className={cn(
            "absolute inset-y-0 left-0 z-[60] flex w-full flex-col overflow-hidden px-4 pb-[18px] pt-[max(24px,env(safe-area-inset-top))] text-foreground",
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
          <MobileMenuPanel
            activeItem={activeItem}
            badges={badges}
            frequentItems={bottomItems}
            labels={{
              accountSettings: dictionary.common.accountSettings,
              clear: dictionary.common.clear,
              close: dictionary.common.menu,
              comms: dictionary.common.menuGroupComms,
              frequent: dictionary.common.menuFrequent,
              search: dictionary.common.menuSearch,
              searchEmpty: dictionary.common.menuSearchEmpty,
              work: dictionary.common.menuGroupWork,
            }}
            locale={locale}
            menuItems={mobileSidebarNavigation.filter((item) => canSeeNavItem(item, session.capabilities))}
            onClose={closeSidebar}
            open={sidebarOpen}
            opsItems={opsNavItems}
            opsTitle={dictionary.admin.console.navGroupOpsAdmin}
            userName={session.user.name}
            userSub={[session.organization.name, dictionary.roles[session.user.role]].filter(Boolean).join(" · ")}
          />
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
          // 당겨서 새로고침이 판을 움직이는 동안 — 스와이프 뒤로가기가 시작하지 않는다(controller `canBegin`).
          data-ptr-active={isPulling || isRefreshPending || pullDistanceState > 0 ? "" : undefined}
          ref={surfaceRef}
          style={{
            // z-index: 2 로 이 쌓임 맥락을 고정 PTR 표시기(z-1) 위에 올려,
            // contentOffset = 0 일 때 헤더가 가려지지 않게 한다. 당기는 동안에는 셸이
            // 내려가며 맨 위 틈으로 표시기가 드러난다.
            zIndex: 2,
            transform: `translateY(${shellY})`,
            transition: isPulling
              ? "none"
              : "transform 420ms cubic-bezier(0.34,1.56,0.64,1)",
            willChange: isPulling || isRefreshPending || contentOffset > 0 ? "transform" : "auto",
          }}
        >
          {/* 상단 바 — OVERLAY(하단 탭 바와 같은 방식). 예전에는 흐름 안의 h-16
              블록이었고 안쪽 내용만 스크롤하면 흐려져서 64px 자리가 계속 차지됐다.
              이제는 절대 위치로 놓여 아래로 스크롤하면 완전히 위로 올라가고(위로 스크롤하면 다시 내려와),
              콘텐츠가 그 공간을 되찾는다 — 하단 바와 똑같다. 스크롤
              컨테이너는 이를 비키도록 항상 같은 위 패딩을 가지므로 레이아웃이 튀지
              않는다(높이는 변하지 않고 오버레이만 움직인다). */}
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
              // 숨김(아래로 스크롤): 빠른 ease-in — 바가 손가락을 빠르게 따라온다.
              // 표시(위로 스크롤): 스프링 ease — 바가 자연스럽게 자리 잡는다.
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
              {/* 세 줄 메뉴(가운데 짧게) · 가운데 작은 제목(큰 제목이 스크롤로 사라졌을 때만) · 알림 · 내 이니셜 동그라미.
                  예전 왼쪽 「Foldy」 글자는 뺐다(HIG 다듬기 2차 — 위 줄에는 앱 이름 대신 화면 이름). */}
              <span
                aria-hidden={!largeTitleGone}
                className={cn("shell-title", largeTitleGone && compactTitle && "is-on")}
              >
                {compactTitle}
              </span>
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
                </div>

                {/* 알림 벨 — 상단 바 바로가기, 프로필 왼쪽 */}
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

          {/* Pull-to-refresh 래퍼 — 콘텐츠는 평소처럼 스크롤된다. 위의 바깥 셸 div 가
              translateY 를 가지므로 크롬 전체(헤더 + 콘텐츠 + 하단 내비)가 함께
              내려온다(Option-B 전체 화면 당기기). 맨 위의 고정 표시기는
              셸이 내려가면서 드러난다. 여기에는 translateY 가 없고 그라디언트 커튼도 필요 없다. */}
          <div className="relative flex-1 overflow-hidden">
            <OfflinePill label={dictionary.common.offlineBanner} />
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
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onClickCapture={(e) => {
                // 끌어내린 뒤 손을 뗀 자리가 링크여도 열리지 않게.
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              ref={scrollElRef}
            >
              {/* 아직 넓은 화면용으로 다듬지 않은 화면은 가운데 760px 한 줄로(폰 화면이 끝없이 늘어나지 않게). `wide` 화면은 폭 전부. */}
              <div
                className={cn(wide ? undefined : cn("fold:mx-auto fold:max-w-[760px]", split && "tablet:max-w-none"), entranceClass)}
                data-shell-column=""
                key={contentKey}
                // 끝나면 클래스를 뗀다 — `animation-fill-mode: both` 가 남기는 transform 이 이 칸을 `position: fixed` 자손의
                // 기준 상자로 만든다(스와이프 뒤로가기 · 시트 · 고정 막대).
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget) setEntranceDone(true);
                }}
              >
                {children}
              </div>
            </div>
          </div>

          {hideBottomNav ? null : (
            <nav
              aria-label={dictionary.common.tabBarLabel}
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

          {/* 가운데 액션("추가") 시트 — 하단 바 편집기(탭 최대 4개 선택). */}
          {createOpen ? (
            <BottomSheet
              ariaLabel={dictionary.common.editBottomBar}
              header={
                <div className="te-head">
                  <p className="te-head__title">{dictionary.common.tabEditTitle}</p>
                  <p className="te-head__sub">{dictionary.common.tabEditSub}</p>
                </div>
              }
              onClose={closeCreate}
            >
              <TabEditor
                candidates={customizableBottomNavItems.filter(canSeeMobileNavItem)}
                ids={navTabIds}
                labels={{
                  addable: dictionary.common.tabEditAddable,
                  done: dictionary.common.tabEditDone,
                  full: dictionary.common.bottomBarFull,
                  remove: dictionary.common.tabEditRemove,
                }}
                locale={locale}
                setIds={setNavTabIds}
              />
            </BottomSheet>
          ) : null}

        </div>
      </div>
    </main>
  );
}
