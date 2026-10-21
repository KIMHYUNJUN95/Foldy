/**
 * 화면 스와이프 뒤로가기 — 제스처 엔진(2026-10-08). React 밖에서 DOM 을 직접 움직인다(손가락을 따라가는 동안 렌더 0회).
 *
 * 문서: docs/product/16-mobile-navigation.md 「뒤로가기 — 화면 스와이프」 · 순수 판정: `history-model.ts`
 *
 * 화면 **어디서든** 오른쪽으로 밀면 지금 화면이 손가락을 따라 밀리고, 아래에서 이전 화면(떠날 때 복제해 둔 DOM —
 * `snapshot-store.ts`)이 iOS 처럼 30% 뒤에서 따라 들어온다. 놓으면 거리 · 속도로 뒤로 갈지 정하고, 가면 이전 기록으로
 * `history.go()` 한다. 새 화면이 그려지는 그 순간(옛 화면이 DOM 에서 빠지는 순간 — MutationObserver, 그리기 전)에 밑그림을
 * 걷으므로 빈 프레임이 없다.
 *
 * 우선순위(네이티브 iOS 26 의 화면 전체 뒤로 제스처와 같은 규칙):
 * 1. 열린 시트 · 대화상자 · 메뉴가 있으면 받지 않는다(그쪽이 먼저 — Android 뒤로가기 버튼과 같은 순서).
 * 2. `[data-swipe-back="off"]`(자체 가로 스와이프가 있는 줄 · 캐러셀 · 그리드), 입력칸, 슬라이더 위에서는 받지 않는다.
 * 3. 가로 스크롤 영역이 아직 왼쪽으로 더 갈 수 있으면 스크롤이 먼저, 왼쪽 끝에 닿아 있으면 뒤로가기.
 * 4. 세로 · 왼쪽으로 먼저 움직였으면 그 터치는 끝까지 스크롤 몫.
 * 5. 입력을 시작한 화면(작성 · 수정 폼)에서는 받지 않는다 — 실수로 밀어 쓰던 내용을 잃지 않게. 그런 화면은 OS 뒤로가기만.
 *    검색칸 · 체크 · 선택은 「쓰던 내용」이 아니므로 세지 않는다(2026-10-20 — 검색 한 번에 그 화면 스와이프가 꺼졌다).
 * 6. iOS Safari 탭에서는 왼쪽 가장자리를 Safari 가 쓰므로 비켜 준다(설치한 PWA · 앱은 가장자리도 우리가 받는다).
 *
 * 앱 안 이전 기록이 없으면(알림 · 링크로 바로 들어옴) **위 화면**(`parentScreen` — 상세 → 목록 → 메뉴 첫 화면 → 홈)으로 간다.
 * 2026-10-20 다듬기: 미는 동안 판 모서리를 화면 모서리처럼 둥글게(인스타그램), 놓은 뒤엔 손가락 속도를 이어받아(`settleMotion`)
 * 튀지 않게, 넘어가는 움직임이 거의 끝날 때 이동을 시작해 새 화면이 빨리 살아나게.
 * 2026-10-21 120Hz 점검: 판은 `transform` 으로 민다(전엔 `translate` 속성). iOS Safari · 홈 화면 PWA 는 JS 가 그리는 움직임을
 * 60Hz 로 돌리므로, 놓은 뒤의 움직임만이라도 시스템 합성기(Core Animation)가 돌게 — 합성기 가속이 확실한 `transform` 전환이고,
 * 그동안 메인 스레드가 새 화면을 그리느라 바빠도(도착 직전 이동) 끊기지 않는다. 판의 원래 `transform`(당겨서 새로고침이 쓰는
 * `translateY`)은 뒤에 이어 붙이고 끝나면 그대로 돌려놓는다.
 */

import { clearNavDirection, setNavDirection } from "@/lib/nav-direction";
import { getBackTarget } from "./history-tracker";
import {
  NAVIGATE_AT_PROGRESS,
  decideCommit,
  decideLock,
  followOffset,
  isSwipeBackScreen,
  parentScreen,
  settleMotion,
  timeForProgress,
} from "./history-model";
import { MOBILE_SCREENS } from "./mobile-screens";
import { swipeDebug } from "./debug";
import { getSnapshot, getSnapshotByUrl, restoreSnapshotScroll } from "./snapshot-store";

/** 이전 화면이 시작하는 자리 — 화면 폭의 30% 왼쪽(iOS 내비게이션 전환과 같다). */
const PARALLAX = 0.3;
/** 이전 화면을 덮는 어둠의 최대치. */
const DIM_MAX = 0.12;
/** iOS Safari 가 뒤로가기로 쓰는 왼쪽 가장자리 폭. */
const SAFARI_EDGE = 24;
/** 뒤로 갔는데 새 화면이 이 시간 안에 안 그려지면(이동 실패) 화면을 제자리로 되돌린다. */
const NAVIGATION_TIMEOUT_MS = 4000;
/**
 * 미는 동안 판의 모서리 반경(px) — 기기 화면 모서리에 맞춘다. 웹에서는 기기 곡률을 읽을 수 없어 `--screen-corner`(앱 셸이 정해 줄
 * 수 있다)가 없으면 iPhone(홈 버튼 없는 기종 39~62pt)은 44, 그 밖은 28. 쉬는 동안엔 각진 판이라 화면 모서리와 맞물려 안 보인다.
 */
function screenCorner(): number {
  const custom = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--screen-corner"));
  if (Number.isFinite(custom)) return custom;
  const ua = navigator.userAgent;
  return /iP(hone|od)/.test(ua) ? 44 : 28;
}
/** 「쓰던 내용」이 아닌 입력 — 화면 스와이프를 끄지 않는다. */
const NON_DRAFT_INPUT_TYPES = new Set(["search", "checkbox", "radio", "range", "color", "hidden"]);

const OVERLAY_SELECTOR = '[aria-modal="true"], [role="dialog"], [data-native-back-overlay]';
const UNDERLAY_SELECTOR = "[data-swipe-back-underlay]";

/**
 * 열린 시트 · 대화상자 · 메뉴 · 사진 뷰어가 있는가. 밑그림(이전 화면 복제본) 속의 표식은 세지 않는다 — 떠날 때 열려 있던
 * 메뉴가 복제본에 남아 있어도 지금 화면의 것이 아니다. Android 뒤로가기 버튼(`NativeShellBridge`)도 이 판정을 쓴다.
 */
export function hasOpenOverlay(): boolean {
  for (const element of document.querySelectorAll(OVERLAY_SELECTOR)) {
    if (!element.closest(UNDERLAY_SELECTOR)) return true;
  }
  return false;
}
const BLOCKED_TARGET_SELECTOR = [
  '[data-swipe-back="off"]',
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="slider"]',
].join(", ");

/**
 * 손가락 대신 **바깥에서 진행을 넣는** 제스처 — Android 예측 뒤로가기(시스템 가장자리 제스처, `NativeShellBridge` ←
 * `PredictiveBackPlugin`). 같은 엔진 · 같은 밑그림 · 같은 마무리를 쓴다. 지금 붙어 있는 화면의 엔진 하나만 있다.
 */
export type ExternalBackGesture = {
  /** 시작 — 받을 수 있는 화면 · 상태면 true. `direction` 1 = 왼쪽 가장자리(판이 오른쪽으로), -1 = 오른쪽 가장자리(거울). */
  begin: (direction: 1 | -1) => boolean;
  /** 시작점에서 손가락이 움직인 거리(CSS px, 양수). */
  move: (distance: number) => void;
  cancel: () => void;
  /** OS 가 뒤로가기를 확정했다 — 시작한 제스처가 있으면 마저 넘기고 true. */
  commit: () => boolean;
};

let externalGesture: ExternalBackGesture | null = null;

export function getExternalBackGesture(): ExternalBackGesture | null {
  return externalGesture;
}

export type SwipeBackOptions = {
  /** 화면 루트(`MobileShell` 의 `<main>`) — 미는 동안 바탕을 투명하게 해 아래 밑그림이 보이게 한다. */
  main: HTMLElement;
  /** 손가락을 따라 움직이는 판(폰: 화면 전체, 폴드 · 태블릿: 레일 · 사이드바 오른쪽 본문). */
  surface: HTMLElement;
  /** 이 화면이 스와이프를 받는 화면인가(`/mobile` 화면). */
  isSwipeScreen: () => boolean;
  /** 앱 안 이전 기록이 없을 때 위 화면으로 — 기록을 바꿔치기한다(Next `router.replace`). */
  replace: (url: string) => void;
};

/** 갈 곳 — 이전 기록(`history.go`) 또는 기록이 없을 때의 위 화면(`replace`). */
type Destination = { delta: number; index: number; url: string; replace?: boolean };

type Phase = "idle" | "pending" | "dragging" | "settling" | "navigating";

type Layer = {
  root: HTMLDivElement;
  content: HTMLElement | null;
  dim: HTMLDivElement;
  /** 이 층이 그리는 이전 화면의 주소. */
  url: string;
};

function isIosSafariTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const native = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  return !standalone && !native;
}

/** `target` 부터 `stop` 까지 — 왼쪽으로 더 스크롤할 수 있는 가로 스크롤 영역이 있으면 그쪽이 먼저다. */
function hasLeftScrollableAncestor(target: Element | null, stop: HTMLElement): boolean {
  for (let element = target; element && element !== stop; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    if (element.scrollLeft <= 0 || element.scrollWidth <= element.clientWidth + 1) continue;
    const overflowX = getComputedStyle(element).overflowX;
    if (overflowX === "auto" || overflowX === "scroll") return true;
  }
  return false;
}

/** 2분할(태블릿 가로)에서 오른쪽 칸이 열려 있다 — 칸의 이동이 같은 history 에 섞이므로 그동안은 받지 않는다. */
function isSplitPaneOpen(): boolean {
  return document.querySelector('.split-list[data-split="on"] iframe') !== null;
}

export function attachSwipeBack({ main, surface, isSwipeScreen, replace }: SwipeBackOptions): () => void {
  let phase: Phase = "idle";
  let dirty = false;
  let startX = 0;
  let startY = 0;
  let lockDx = 0;
  let offset = 0;
  let width = 0;
  let samples: { t: number; x: number }[] = [];
  let layer: Layer | null = null;
  let frame = 0;
  let settleTimer = 0;
  let navigationTimer = 0;
  let observer: MutationObserver | null = null;
  let target: Destination | null = null;
  let corner = 0;
  /** 1 = 판이 오른쪽으로(보통), -1 = 왼쪽으로(Android 오른쪽 가장자리 제스처). */
  let direction: 1 | -1 = 1;
  const hidden: HTMLElement[] = [];
  /** 미는 동안 덮어쓴 판의 원래 인라인 `transform` · `transition` · `will-change`(React 가 당겨서 새로고침용으로 건 값). */
  let surfaceBase: { transform: string; transition: string; willChange: string } | null = null;

  function reset() {
    phase = "idle";
    samples = [];
    target = null;
    direction = 1;
  }

  function render() {
    frame = 0;
    if (!layer) return;
    const progress = width > 0 ? Math.min(1, offset / width) : 0;
    surface.style.transform = `translate3d(${direction * offset}px, 0, 0) ${surfaceBase?.transform ?? ""}`;
    if (layer.content) layer.content.style.transform = `translate3d(${-direction * PARALLAX * width * (1 - progress)}px, 0, 0)`;
    layer.dim.style.opacity = String(DIM_MAX * (1 - progress));
  }

  function scheduleRender() {
    if (!frame) frame = window.requestAnimationFrame(render);
  }

  /**
   * 밑그림 층을 **미리** 깔아 둔다(보이지 않게). 붙여 배치하는 비용(긴 화면은 수십 ms)을 드래그 첫 프레임이 아니라
   * 화면이 뜬 뒤 한가할 때 치른다. `contain: strict` 라 이 층은 지금 화면의 배치에 끼어들지 않는다.
   */
  function prepareLayer(destination: Destination): Layer {
    if (layer && layer.url === destination.url && layer.root.isConnected) return layer;
    removeLayer();
    const startedAt = performance.now();
    const root = document.createElement("div");
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("data-swipe-back-underlay", "");
    root.inert = true;
    // z-index -1 · body 맨 끝: 화면의 어떤 층보다 아래(루트 배경 바로 위)에 깔리고, 문서 순서로는 진짜 요소들 뒤라
    // `document.querySelector` 가 복제본을 먼저 집지 않는다. 미는 동안 화면 루트 바탕을 투명하게 하면 판 뒤로 이 층이 보인다.
    root.style.cssText =
      "position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;contain:strict;visibility:hidden;background:var(--background);";

    let content: HTMLElement | null = null;
    const snapshot = destination.replace ? getSnapshotByUrl(destination.url) : getSnapshot(destination.index, destination.url);
    if (snapshot) {
      content = snapshot.node;
      root.appendChild(content);
    }
    const dim = document.createElement("div");
    dim.style.cssText = "position:absolute;inset:0;background:#0f172a;opacity:0;";
    root.appendChild(dim);
    document.body.append(root);
    if (snapshot) restoreSnapshotScroll(snapshot);
    layer = { content, dim, root, url: destination.url };
    performance.measure?.("swipe-back:prepare", { start: startedAt });
    return layer;
  }

  function removeLayer() {
    if (!layer) return;
    if (layer.content) {
      layer.content.style.transform = "";
      layer.content.style.transition = "";
      layer.content.style.willChange = "";
    }
    layer.root.remove();
    layer = null;
  }

  function showLayer(current: Layer) {
    const rect = surface.getBoundingClientRect();
    // 판(본문) 자리만 보이게 자른다 — 폴드 · 태블릿에서 레일 · 사이드바는 진짜가 그 자리에 그대로 있다.
    current.root.style.clipPath = `inset(${Math.max(0, rect.top)}px ${Math.max(0, window.innerWidth - rect.right)}px ${Math.max(0, window.innerHeight - rect.bottom)}px ${Math.max(0, rect.left)}px round ${corner}px)`;
    current.root.style.visibility = "visible";
    if (current.content) current.content.style.willChange = "transform";
  }

  function beginDrag() {
    const startedAt = performance.now();
    width = surface.getBoundingClientRect().width;
    if (!target) return;
    corner = screenCorner();
    showLayer(prepareLayer(target));
    if (!layer) return;
    // 화면 루트 · body 의 바탕 · 당겨서 새로고침 띠는 판보다 아래, 밑그림(z-index -1)보다는 위에 그려진다 — 판이 비키면
    // 그 자리에 밑그림이 보여야 하므로 미는 동안만 투명하게(노치 뒤는 html 바탕이 그대로 칠한다).
    main.style.background = "transparent";
    document.body.style.background = "transparent";
    for (const element of main.querySelectorAll<HTMLElement>("[data-ptr-indicator]")) {
      element.style.visibility = "hidden";
      hidden.push(element);
    }
    surfaceBase ??= {
      transform: surface.style.transform,
      transition: surface.style.transition,
      willChange: surface.style.willChange,
    };
    surface.style.transition = "none";
    surface.style.willChange = "transform";
    // 미는 동안은 누름 반응(globals.css 「누름 반응」)을 끈다 — 손가락 아래 줄이 옅어진 채 밀리지 않게.
    document.documentElement.setAttribute("data-gesture", "");
    surface.style.boxShadow = `${-12 * direction}px 0 32px -8px rgba(15, 23, 42, 0.22)`;
    // 미는 동안만 둥근 판(인스타그램처럼) — 판은 이미 overflow: hidden 이라 내용도 같이 잘린다.
    surface.style.borderRadius = `${corner}px`;
    if (layer.content) layer.content.style.transition = "none";
    layer.dim.style.transition = "none";
    render();
    performance.measure?.("swipe-back:begin", { start: startedAt });
  }

  /** 제스처를 끝내고 화면을 원래대로. `keepLayer` 면 밑그림 층은 다음 스와이프를 위해 숨겨서 남긴다. */
  function teardown(keepLayer = false) {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    window.clearTimeout(settleTimer);
    window.clearTimeout(navigationTimer);
    observer?.disconnect();
    observer = null;
    if (keepLayer && layer) {
      layer.root.style.visibility = "hidden";
      layer.dim.style.transition = "";
      layer.dim.style.opacity = "0";
      if (layer.content) {
        layer.content.style.transition = "";
        layer.content.style.transform = "";
        layer.content.style.willChange = "";
      }
    } else {
      removeLayer();
    }
    main.style.background = "";
    document.body.style.background = "";
    document.documentElement.removeAttribute("data-gesture");
    for (const element of hidden.splice(0)) element.style.visibility = "";
    if (surfaceBase) {
      // 전환을 끈 채 원래 값으로 돌려놓고 스타일을 한 번 확정한 뒤 전환을 되살린다 — 안 그러면 원래 전환(420ms)이 헛돈다.
      surface.style.transition = "none";
      surface.style.transform = surfaceBase.transform;
      void getComputedStyle(surface).transform;
      surface.style.willChange = surfaceBase.willChange;
      surface.style.transition = surfaceBase.transition;
      surfaceBase = null;
    }
    surface.style.boxShadow = "";
    surface.style.borderRadius = "";
    reset();
  }

  /**
   * 남은 거리를 마저 간다. `velocity` 는 가는 방향 기준 손가락 속도(px/ms) — 곡선이 그 속도로 출발한다.
   * `doneAt`(0~1 진행률)에 `done` 을 부른다 — 넘어갈 때는 거의 끝났을 때 이동을 시작한다.
   */
  function settle(to: number, velocity: number, done: () => void, doneAt = 1) {
    phase = "settling";
    const { curve, duration, easing } = settleMotion(to - offset, velocity);
    surface.style.transition = `transform ${duration}ms ${easing}`;
    if (layer?.content) layer.content.style.transition = `transform ${duration}ms ${easing}`;
    if (layer) layer.dim.style.transition = `opacity ${duration}ms ${easing}`;
    offset = to;
    if (frame) window.cancelAnimationFrame(frame);
    render();
    settleTimer = window.setTimeout(done, doneAt >= 1 ? duration + 20 : duration * timeForProgress(curve, doneAt));
  }

  function navigate() {
    const destination = target;
    if (!destination) {
      teardown();
      return;
    }
    phase = "navigating";
    // 옛 화면(이 판)이 DOM 에서 빠지는 순간 = 새 화면이 그려진 커밋. 그리기 전에 밑그림을 걷는다.
    observer = new MutationObserver(() => {
      if (surface.isConnected) return;
      // 새 화면의 전환 템플릿은 이미 렌더에서 "none" 을 읽었다. 같은 구역 안 이동이라 템플릿이 다시 안 그려졌으면 남은 값을 지운다.
      clearNavDirection();
      teardown();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // 이동이 안 됐으면(오프라인 등) 화면을 제자리로.
    navigationTimer = window.setTimeout(() => {
      clearNavDirection();
      if (!surface.isConnected) {
        teardown();
        return;
      }
      window.clearTimeout(settleTimer);
      settle(0, 0, () => teardown(true));
    }, NAVIGATION_TIMEOUT_MS);
    // 화면이 이미 손가락으로 넘어갔다 — 새 화면은 전환 애니메이션 없이 그 자리에 나타난다.
    setNavDirection("none");
    if (destination.replace) replace(destination.url);
    else window.history.go(destination.delta);
  }

  function velocity(): number {
    const now = performance.now();
    const recent = samples.filter((sample) => now - sample.t <= 100);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0;
  }

  /** 갈 곳 — 앱 안 이전 화면, 없으면(알림 · 링크로 바로 들어옴) 위 화면. 홈이면 갈 곳이 없다. */
  function pickDestination(): Destination | null {
    const back = getBackTarget();
    if (back && isSwipeBackScreen(back.url)) return back;
    const parent = parentScreen(window.location.pathname, MOBILE_SCREENS);
    if (parent) return { delta: 0, index: -1, replace: true, url: parent };
    swipeDebug(back ? `start: skip — back leaves the app (${back.url})` : "start: skip — no back target");
    return null;
  }

  /** 이 화면이 지금 뒤로 미는 제스처를 받을 수 있는가(손가락 · 바깥 진행 공통). */
  function canBegin(): boolean {
    const why = dirty
      ? "typed on this screen"
      : !isSwipeScreen()
        ? "not an app screen"
        : document.documentElement.hasAttribute("data-pane") || isSplitPaneOpen()
          ? "split pane"
          : hasOpenOverlay()
            ? "overlay open"
            : null;
    if (why) swipeDebug(`start: skip — ${why}`);
    return why === null;
  }

  function onTouchStart(event: TouchEvent) {
    if (phase === "settling" || phase === "navigating") return;
    reset();
    if (event.touches.length !== 1) return;
    if (!canBegin()) return;
    const touch = event.touches[0];
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest(BLOCKED_TARGET_SELECTOR)) return swipeDebug("start: skip — blocked target");
    if (touch.clientX < SAFARI_EDGE && isIosSafariTab()) return swipeDebug("start: skip — safari edge");
    target = pickDestination();
    if (!target) return;
    startX = touch.clientX;
    startY = touch.clientY;
    phase = "pending";
    swipeDebug(`start: pending at ${Math.round(startX)},${Math.round(startY)}`);
  }

  function onTouchMove(event: TouchEvent) {
    if (phase !== "pending" && phase !== "dragging") return;
    if (event.touches.length !== 1) {
      if (phase === "dragging") settle(0, 0, () => teardown(true));
      else reset();
      return;
    }
    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (phase === "pending") {
      const decision = decideLock(dx, dy);
      if (decision === "pending") {
        // iOS(WebKit)는 우리가 정하기 전(10px)에 스크롤 팬을 시작해 버린다 — 그 뒤 touchmove 는 막을 수 없어 제스처가
        // 통째로 무시됐다(2026-10-08 아이폰에서 「반응 없음」). 아직 판정 전이라도 오른쪽으로 뚜렷이 가로인 움직임이면
        // 브라우저의 팬 시작부터 막는다. 세로가 섞인 움직임은 건드리지 않는다(세로 스크롤은 그대로).
        if (dx > 2 && dx > Math.abs(dy) * 1.5 && event.cancelable) event.preventDefault();
        if (!event.cancelable) swipeDebug(`move: not cancelable at dx ${Math.round(dx)}`);
        return;
      }
      if (decision === "reject" || hasLeftScrollableAncestor(event.target instanceof Element ? event.target : null, surface)) {
        swipeDebug(decision === "reject" ? `move: reject dx ${Math.round(dx)} dy ${Math.round(dy)}` : "move: inner scroller first");
        reset();
        return;
      }
      // 막을 수 없는 touchmove(브라우저가 이미 팬을 시작)여도 가로로 잠갔으면 간다 — 세로로는 거의 안 움직인 상태다.
      phase = "dragging";
      lockDx = dx;
      beginDrag();
      swipeDebug(`move: drag (cancelable ${event.cancelable}, layer ${layer ? "yes" : "no"})`);
    }

    if (event.cancelable) event.preventDefault();
    offset = followOffset(dx, lockDx);
    const now = performance.now();
    samples.push({ t: now, x: offset });
    if (samples.length > 12) samples.shift();
    scheduleRender();
  }

  function onTouchEnd(event: TouchEvent) {
    if (phase === "pending") {
      swipeDebug(`${event.type}: before lock`);
      reset();
      return;
    }
    if (phase !== "dragging") return;
    const speed = velocity();
    const commit = event.type === "touchend" && decideCommit(offset, speed, width);
    swipeDebug(`${event.type}: offset ${Math.round(offset)}/${Math.round(width)} v ${speed.toFixed(2)} → ${commit ? "back" : "cancel"}`);
    if (commit) {
      settle(width, Math.max(0, speed), navigate, NAVIGATE_AT_PROGRESS);
    } else {
      settle(0, Math.max(0, -speed), () => teardown(true));
    }
  }

  // 입력을 시작한 화면은 스와이프를 받지 않는다(쓰던 내용 보호). 검색 · 체크 · 선택은 쓰던 내용이 아니다.
  function onInput(event: Event) {
    const element = event.target;
    if (element instanceof HTMLInputElement && NON_DRAFT_INPUT_TYPES.has(element.type)) return;
    if (element instanceof HTMLSelectElement) return;
    if (element instanceof Element && element.closest('[role="search"]')) return;
    dirty = true;
  }

  // 화면이 뜨고 한가해지면 밑그림을 미리 깐다(받을 화면이고, 갈 곳의 복제본이 있을 때만).
  let idleHandle = 0;
  const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
  const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
  idleHandle = idle(() => {
    idleHandle = 0;
    if (phase !== "idle" || !isSwipeScreen()) return;
    const destination = getBackTarget();
    if (destination && isSwipeBackScreen(destination.url) && getSnapshot(destination.index, destination.url)) prepareLayer(destination);
  });

  const external: ExternalBackGesture = {
    begin(nextDirection) {
      if (phase === "settling" || phase === "navigating") return false;
      reset();
      if (!canBegin()) return false;
      target = pickDestination();
      if (!target) return false;
      direction = nextDirection;
      phase = "dragging";
      offset = 0;
      beginDrag();
      swipeDebug(`external: begin (${direction === 1 ? "left" : "right"} edge)`);
      return true;
    },
    move(distance) {
      if (phase !== "dragging") return;
      offset = Math.max(0, distance);
      samples.push({ t: performance.now(), x: offset });
      if (samples.length > 12) samples.shift();
      scheduleRender();
    },
    cancel() {
      if (phase !== "dragging") return;
      swipeDebug("external: cancel");
      settle(0, 0, () => teardown(true));
    },
    commit() {
      if (phase !== "dragging") return false;
      swipeDebug(`external: commit at ${Math.round(offset)}/${Math.round(width)}`);
      settle(width, Math.max(0, velocity()), navigate, NAVIGATE_AT_PROGRESS);
      return true;
    },
  };
  externalGesture = external;

  surface.addEventListener("touchstart", onTouchStart, { passive: true });
  surface.addEventListener("touchmove", onTouchMove, { passive: false });
  surface.addEventListener("touchend", onTouchEnd);
  surface.addEventListener("touchcancel", onTouchEnd);
  surface.addEventListener("input", onInput, true);

  return () => {
    surface.removeEventListener("touchstart", onTouchStart);
    surface.removeEventListener("touchmove", onTouchMove);
    surface.removeEventListener("touchend", onTouchEnd);
    surface.removeEventListener("touchcancel", onTouchEnd);
    surface.removeEventListener("input", onInput, true);
    if (idleHandle) cancelIdle(idleHandle);
    if (externalGesture === external) externalGesture = null;
    // 이동 중이면 밑그림은 MutationObserver 가 걷는다(이 화면이 빠지는 커밋에서 이미 걷혔다).
    if (phase !== "navigating") teardown();
  };
}
