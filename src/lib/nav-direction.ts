import { consumeRecentTraverse } from "@/lib/swipe-back/history-tracker";

/**
 * Direction of the next mobile navigation, so the route transition (`src/app/mobile/template.tsx`) can play an iOS-style
 * push (forward) vs pop (back) slide — or nothing when the screen already moved under the user's finger.
 *
 * - **"none"** — set by the swipe-back gesture right before it navigates: the screen was already dragged off and the
 *   previous screen is sitting underneath, so a second slide would play the transition twice.
 * - **back / forward history traversal** (OS edge swipe, browser back, Android back button) is read from the history
 *   tracker. Until 2026-10-08 nothing set "back", so every back navigation played the *forward* push slide. When the
 *   browser already animated the traversal itself (Safari edge swipe — `PopStateEvent.hasUAVisualTransition`), we play
 *   nothing, for the same double-animation reason.
 *
 * - **"tab"** — set by the bottom tab bar, side menu and rail (2026-10-21): switching sections is a tab switch, not a
 *   push — native tab bars swap the content in place (a short fade), they never slide the screen in.
 *
 * The mobile shell consumes the value once on mount (`consumeScreenEntrance`), then it resets to "forward".
 */
export type NavDirection = "forward" | "back" | "none" | "tab";

let pending: NavDirection | null = null;
let stampedAt = 0;

/** An explicit direction is only honored briefly — a navigation that never mounts the mobile template must not leave it stuck. */
const EXPLICIT_TTL_MS = 3000;
/** A popstate older than this is not the reason the template is mounting now. */
const TRAVERSE_TTL_MS = 3000;

export function setNavDirection(direction: NavDirection): void {
  pending = direction;
  stampedAt = typeof performance !== "undefined" ? performance.now() : 0;
}

export function clearNavDirection(): void {
  pending = null;
  stampedAt = 0;
}

/** Read and reset the pending direction (defaults to "forward"). */
export function consumeNavDirection(): NavDirection {
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  const explicit = pending && stampedAt > 0 && now - stampedAt < EXPLICIT_TTL_MS ? pending : null;
  clearNavDirection();
  const traverse = consumeRecentTraverse(TRAVERSE_TTL_MS);
  if (explicit) return explicit;
  if (traverse?.direction === "back") return traverse.uaVisual ? "none" : "back";
  if (traverse?.direction === "forward") return traverse.uaVisual ? "none" : "forward";
  return "forward";
}

/**
 * How a mobile screen enters — the nav direction, or **"reveal"** when a placeholder shell (`loading.tsx` →
 * `MobileShellPlaceholder`) already played the entrance for this path and the real screen only needs to fade its content in.
 * `"same"` = the shell remounted on the same path (search-param change etc.) — no animation, no scroll restore change.
 *
 * Placeholder → real: the direction is consumed by the placeholder (it shows right after the tap — the push starts
 * immediately, like a native app), remembered with its path, and the real screen of that path takes "reveal" plus the
 * remembered direction (so the scroll restore still knows it was a back navigation). A second placeholder for the same
 * path (outer `/mobile` boundary, then the section's own) takes "none".
 */
export type ScreenEntrance = { kind: NavDirection | "reveal" | "same"; direction: NavDirection };

let placeholderFor: { path: string; direction: NavDirection } | null = null;
let lastScreenPath: string | null = null;
/**
 * 아직 화면에 붙지 않은(커밋 전) 셸이 받은 등장 — React 가 그리던 것을 버리고 다시 그리면(로딩 중 재시도) `useState` 초기값이 한 번
 * 더 불린다. 그때 같은 답을 돌려줘야 한다 — 전엔 버려진 쪽이 「reveal」을 써 버려 진짜 화면은 「same」(효과 없음)을 받았다
 * (2026-10-22 태블릿 측정: 요청 탭으로 갈 때 셸이 두 번 그려져 나타남 효과가 빠짐). 셸이 붙으면 `commitScreenEntrance` 로 비운다.
 */
let uncommitted: { path: string; placeholder: boolean; entrance: ScreenEntrance } | null = null;

/**
 * 서버 · 하이드레이션 (2026-10-26) — 이 판정은 **브라우저 한 곳의 탐색 기록**이라 모듈 변수에 둔다. 서버에서 부르면 그 변수가
 * 요청 사이에 공유돼(다른 사람의 앞 요청 경로가 「same」 · 「reveal」 판정에 섞였다) 서버 HTML 과 클라이언트 첫 그림이 달라졌다.
 * 그래서 서버에서는 아무것도 바꾸지 않고 `none` 을 돌려주고, 클라이언트도 **하이드레이션 중에는** 같은 `none` 을 그린다(앱을 처음
 * 열 때 화면이 밀려 들어오지 않는다 — 네이티브 앱도 실행 첫 화면은 그냥 떠 있다). 하이드레이션 중에도 판정은 해서 모듈 상태
 * (`lastScreenPath` 등)는 맞춰 두고 방향은 돌려준다 — 같은 화면 다시 그림 「same」 · 스크롤 복원이 그대로 동작한다.
 */
export function consumeScreenEntrance(path: string, placeholder: boolean, hydrating = false): ScreenEntrance {
  // 서버(문서 없음) — 모듈 상태를 건드리지 않는다.
  if (typeof document === "undefined") return { kind: "none", direction: "none" };
  let entrance: ScreenEntrance;
  if (uncommitted && uncommitted.path === path && uncommitted.placeholder === placeholder) {
    entrance = uncommitted.entrance;
  } else {
    entrance = computeScreenEntrance(path, placeholder);
    uncommitted = { entrance, path, placeholder };
  }
  return hydrating ? { kind: "none", direction: entrance.direction } : entrance;
}

/** 셸이 화면에 붙었다(마운트 effect) — 다음 셸은 새로 판정한다. */
export function commitScreenEntrance(path: string, placeholder: boolean): void {
  if (uncommitted && uncommitted.path === path && uncommitted.placeholder === placeholder) uncommitted = null;
}

function computeScreenEntrance(path: string, placeholder: boolean): ScreenEntrance {
  if (placeholder) {
    if (placeholderFor?.path === path) return { kind: "none", direction: placeholderFor.direction };
    const direction = path === lastScreenPath ? "none" : consumeNavDirection();
    placeholderFor = { path, direction };
    return { kind: direction, direction };
  }
  const pending = placeholderFor;
  placeholderFor = null;
  const previous = lastScreenPath;
  lastScreenPath = path;
  if (pending?.path === path) return { kind: "reveal", direction: pending.direction };
  if (previous === path) {
    clearNavDirection();
    return { kind: "same", direction: "none" };
  }
  const direction = consumeNavDirection();
  return { kind: direction, direction };
}
