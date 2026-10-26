import { consumeRecentTraverse } from "@/lib/swipe-back/history-tracker";

/**
 * 다음 모바일 이동의 방향. 라우트 전환(`src/app/mobile/template.tsx`)이 iOS 식
 * 푸시(앞으로) 대 팝(뒤로) 슬라이드를 재생하게 하며 — 화면이 이미 사용자 손가락 아래에서 움직였다면 아무것도 재생하지 않는다.
 *
 * - **"none"** — 스와이프 뒤로가기 제스처가 이동 직전에 설정한다: 화면은 이미 끌려 나갔고
 *   이전 화면이 아래에 깔려 있어서, 슬라이드를 또 하면 전환이 두 번 재생된다.
 * - **뒤로 / 앞으로 히스토리 이동** (OS 가장자리 스와이프, 브라우저 뒤로, Android 뒤로 버튼)은 히스토리
 *   트래커에서 읽는다. 2026-10-08 까지는 아무도 "back" 을 설정하지 않아 모든 뒤로 이동이 *앞으로* 푸시 슬라이드를 재생했다.
 *   브라우저가 이미 이동을 직접 애니메이션했으면 (Safari 가장자리 스와이프 — `PopStateEvent.hasUAVisualTransition`),
 *   같은 이중 애니메이션 이유로 아무것도 재생하지 않는다.
 *
 * - **"tab"** — 하단 탭 바, 사이드 메뉴, 레일이 설정한다 (2026-10-21): 섹션 전환은 탭 전환이지
 *   푸시가 아니다 — 네이티브 탭 바는 콘텐츠를 제자리에서 바꾸고 (짧은 페이드), 화면을 밀어 넣지 않는다.
 *
 * 모바일 셸은 값을 마운트 때 한 번 소비하고 (`consumeScreenEntrance`), 이후 "forward" 로 되돌린다.
 */
export type NavDirection = "forward" | "back" | "none" | "tab";

let pending: NavDirection | null = null;
let stampedAt = 0;

/** 명시적 방향은 잠깐만 유효하다 — 모바일 템플릿을 마운트하지 않는 이동이 값을 붙들고 있으면 안 된다. */
const EXPLICIT_TTL_MS = 3000;
/** 이보다 오래된 popstate 는 지금 템플릿이 마운트되는 이유가 아니다. */
const TRAVERSE_TTL_MS = 3000;

export function setNavDirection(direction: NavDirection): void {
  pending = direction;
  stampedAt = typeof performance !== "undefined" ? performance.now() : 0;
}

export function clearNavDirection(): void {
  pending = null;
  stampedAt = 0;
}

/** 대기 중인 방향을 읽고 리셋한다 (기본값 "forward"). */
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
 * 모바일 화면이 들어오는 방식 — 내비 방향, 또는 플레이스홀더 셸(`loading.tsx` →
 * `MobileShellPlaceholder`)이 이 경로의 진입을 이미 재생해서 실제 화면은 콘텐츠만 페이드인하면 될 때 **"reveal"**.
 * `"same"` = 같은 경로에서 셸이 다시 마운트됨 (search-param 변경 등) — 애니메이션 없음, 스크롤 복원 변경 없음.
 *
 * 플레이스홀더 → 실제: 방향은 플레이스홀더가 소비하고 (탭 직후 보이므로 — 푸시가
 * 네이티브 앱처럼 즉시 시작된다), 경로와 함께 기억해 두며, 그 경로의 실제 화면은 "reveal" 과
 * 기억해 둔 방향을 받는다 (스크롤 복원이 뒤로 이동이었음을 계속 알 수 있게). 같은 경로의 두 번째
 * 플레이스홀더 (바깥 `/mobile` 경계, 그다음 섹션 자체의 것)는 "none" 을 받는다.
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
