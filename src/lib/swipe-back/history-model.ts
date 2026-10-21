/**
 * 스와이프 뒤로가기 — 순수 판정(단위 테스트: `src/lib/__tests__/swipe-back.test.ts`).
 * 문서: docs/product/16-mobile-navigation.md 「뒤로가기 — 화면 스와이프」
 */

export type BackTarget = {
  /** `history.go()` 에 넘길 음수. 같은 화면 쿼리 기록을 건너뛰면 -2 이하가 된다. */
  delta: number;
  index: number;
  url: string;
};

function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * 지금 기록(`index`)보다 앞에 있는, **pathname 이 다른** 가장 가까운 기록.
 * 주소를 모르는 칸(null — 표가 끊긴 곳)을 만나면 거기서 멈춘다(어디로 갈지 모르면 가지 않는다).
 */
export function findBackTarget(urls: readonly (string | null)[], index: number): BackTarget | null {
  const current = urls[index];
  if (!current) return null;
  const here = pathOf(current);
  for (let i = index - 1; i >= 0; i -= 1) {
    const url = urls[i];
    if (!url) return null;
    if (pathOf(url) !== here) return { delta: i - index, index: i, url };
  }
  return null;
}

/**
 * 모바일 앱 화면인가(`/mobile` 과 그 아래 — 쿼리 · 해시가 붙어도 된다). 스와이프는 이런 화면에서만 받고, 돌아갈 곳도 이런 화면일
 * 때만 간다(로그인 · 온보딩 · 계정으로 밀려 나가지 않게).
 *
 * 메뉴 첫 화면(홈 · 청소 · 요청 …)도 받는다(2026-10-09 사용자 결정). 원래는 「뒤가 없는 화면」으로 막았는데, 사용자가 실제로
 * 머무는 화면 대부분이 메뉴 첫 화면이라 「안 되는 화면이 더 많다」가 됐고, Android 뒤로가기 버튼은 거기서도 이전 화면으로 가서
 * 기기마다 달랐다. 이제 돌아갈 곳(`findBackTarget`)이 있으면 어디서든 받는다 — 앱을 막 열어 이전 화면이 없을 때만 받지 않는다.
 */
export function isSwipeBackScreen(path: string): boolean {
  return path === "/mobile" || /^\/mobile[/?#]/.test(path);
}

/**
 * 앱 안 이전 기록이 없을 때(알림 · 링크로 바로 들어옴, 앱을 새로 엶) 돌아갈 **위 화면** — 주소를 한 칸씩 올라가며 처음 만나는 실제
 * 화면(`screens`). 상세는 목록으로, 목록은 메뉴 첫 화면으로, 끝은 홈(`/mobile`). 홈이면 null(더 갈 곳이 없다 — 앱을 나간다).
 * 뒤로 버튼이 없는 앱이라 이게 없으면 그런 화면에서 갇혔다(2026-10-20 점검).
 */
function isScreen(path: string, screens: readonly string[]): boolean {
  const parts = path.split("/");
  return screens.some((screen) => {
    const pattern = screen.split("/");
    return pattern.length === parts.length && pattern.every((part, i) => part.startsWith("[") || part === parts[i]);
  });
}

export function parentScreen(path: string, screens: readonly string[]): string | null {
  const cut = path.search(/[?#]/);
  let current = (cut === -1 ? path : path.slice(0, cut)).replace(/\/+$/, "");
  if (!isSwipeBackScreen(current) || current === "/mobile") return null;
  while (current.length > "/mobile".length) {
    current = current.slice(0, current.lastIndexOf("/"));
    if (current === "/mobile" || isScreen(current, screens)) return current;
  }
  return "/mobile";
}

/** 방향 잠금 — 손가락이 이만큼(px) 움직이기 전에는 가로 · 세로를 정하지 않는다. */
export const LOCK_DISTANCE = 10;

/**
 * 첫 움직임으로 제스처를 정한다. 오른쪽으로, 세로보다 충분히 가로(약 40° 이내)일 때만 뒤로가기다.
 * 아직 덜 움직였으면 "pending", 세로 · 왼쪽이면 "reject"(이 터치는 끝까지 스크롤 · 다른 제스처 몫).
 */
export function decideLock(dx: number, dy: number): "pending" | "accept" | "reject" {
  if (Math.hypot(dx, dy) < LOCK_DISTANCE) return "pending";
  return dx > 0 && dx > Math.abs(dy) * 1.2 ? "accept" : "reject";
}

/** 넘어가는 거리의 상한(px) — 폴드 · 태블릿처럼 판이 넓어도 엄지로 이만큼 끌면 넘어간다(태블릿 가로 35% 는 326px 이었다). */
export const COMMIT_MAX_PX = 220;

/**
 * 손을 뗐을 때 뒤로 갈지. 판 폭의 35%(최대 `COMMIT_MAX_PX`)를 넘겼거나, 오른쪽으로 빠르게 튕겼으면 간다(짧게 휙 쳐도 간다 —
 * iOS 와 같다). 마지막에 왼쪽으로 되돌리고 있었으면 가지 않는다. `velocity` 는 px/ms(오른쪽 +).
 */
export function decideCommit(offset: number, velocity: number, width: number): boolean {
  if (velocity < -0.15) return false;
  if (offset > Math.min(width * 0.35, COMMIT_MAX_PX)) return true;
  return velocity > 0.35 && offset > 16;
}

/** 손가락이 움직이기 시작한 뒤 이만큼(px) 더 가는 동안 방향 판정에 쓴 거리를 따라잡는다. */
export const CATCH_UP_PX = 48;

/**
 * 미는 동안 판이 갈 자리. 방향 판정(10px) 동안 판은 멈춰 있으므로, 잠근 뒤 판을 손가락 자리로 바로 옮기면 튀고, 판정 거리를 계속
 * 빼면 판이 손가락보다 늘 그만큼 늦는다(2026-10-20 점검). 그래서 다음 `CATCH_UP_PX` 동안 조금씩 따라잡아 손가락 밑에 붙인다.
 */
export function followOffset(dx: number, lockDx: number): number {
  const moved = dx - lockDx;
  if (moved <= 0) return 0;
  return moved + lockDx * Math.min(1, moved / CATCH_UP_PX);
}

export type Curve = readonly [x1: number, y1: number, x2: number, y2: number];
export type SettleMotion = { duration: number; curve: Curve; easing: string };

const SETTLE_MIN_MS = 220;
const SETTLE_MAX_MS = 380;
/** 손가락이 멈춘 채 놓아도 판이 이 정도(px/ms)로는 출발한다 — 0 에서 가속하면 굼떠 보인다. */
const SETTLE_FLOOR_VELOCITY = 0.3;
const CURVE_X1 = 0.3;

/**
 * 손을 놓은 뒤 남은 거리를 마저 가는 움직임 — **손가락 속도를 그대로 이어받는다**(2026-10-20 점검).
 *
 * 전에는 140~320ms 에 시작이 아주 가파른 곡선이라, 손가락이 0.18px/ms 로 가던 화면이 놓는 첫 프레임에 77px(약 25배) 튀었다.
 * iOS · Ionic(`swipe-back.ts`)처럼 시작 기울기가 손가락 속도와 같도록 곡선의 첫 조절점을 정하고, 끝은 부드럽게 멈춘다.
 * `velocity` 는 가는 방향 기준 px/ms(반대 방향 움직임은 0 으로 본다 — 판이 거꾸로 출발하지 않게).
 */
export function settleMotion(remaining: number, velocity: number): SettleMotion {
  const distance = Math.abs(remaining);
  const speed = Math.max(velocity, SETTLE_FLOOR_VELOCITY);
  const duration = Math.round(Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, (distance * 2.5) / speed)));
  // 곡선 시작 기울기(진행률/시간 비율) = y1/x1. 실제 속도 = 기울기 × 거리 / 시간 → 손가락 속도와 같게.
  const slope = distance > 0 ? (speed * duration) / distance : 0;
  const y1 = Math.round(Math.min(1, slope * CURVE_X1) * 1000) / 1000;
  const curve: Curve = [CURVE_X1, y1, 0.2, 1];
  return { curve, duration, easing: `cubic-bezier(${curve.join(", ")})` };
}

function bezier(a: number, b: number, s: number): number {
  const r = 1 - s;
  return 3 * r * r * s * a + 3 * r * s * s * b + s * s * s;
}

/** 곡선이 진행률 `progress` 에 닿는 시간 비율(0~1). */
export function timeForProgress(curve: Curve, progress: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezier(curve[1], curve[3], mid) < progress) lo = mid;
    else hi = mid;
  }
  return bezier(curve[0], curve[2], hi);
}

/**
 * 넘어가는 움직임이 이만큼 진행됐을 때 이동을 시작한다(2026-10-20). 끝난 뒤에 시작하면 새 화면을 그리는 동안(저가 폰 300ms)
 * 그림만 있는 화면이 눌리지 않았다. 남은 4% 는 새 화면이 그려지는 순간 사라져도 눈에 안 띈다.
 */
export const NAVIGATE_AT_PROGRESS = 0.96;

/**
 * 아이폰 화면 모서리 반경(pt = CSS px) — 화면 크기(세로 기준 폭 × 높이) · 배율로 기종을 가린다(2026-10-22). 미는 동안 판 모서리를
 * 기기 모서리에 맞추려고 쓴다(전엔 아이폰 전부 44). 웹은 기기 곡률을 못 읽어 공개된 기종별 값을 표로 둔다.
 * - 홈 버튼 기종(SE · 8 이하)은 모서리가 각져 0.
 * - 375×812@3x 는 X · XS · 11 Pro(39)와 12 · 13 mini(44)가 같은 크기라 사이 값 41.
 * - 모르는 크기(새 기종)는 null — 부르는 쪽이 기본값을 쓴다.
 */
const IPHONE_CORNERS: Record<string, number> = {
  "320x568": 0,
  "375x667": 0,
  "414x736": 0,
  "375x812@3": 41,
  "414x896@3": 39,
  "414x896@2": 41.5,
  "390x844": 47.33,
  "428x926": 53.33,
  "393x852": 55,
  "430x932": 55,
  "402x874": 62,
  "420x912": 62,
  "440x956": 62,
};

export function iphoneScreenCorner(width: number, height: number, dpr: number): number | null {
  const w = Math.round(Math.min(width, height));
  const h = Math.round(Math.max(width, height));
  const key = `${w}x${h}`;
  return IPHONE_CORNERS[`${key}@${Math.round(dpr)}`] ?? IPHONE_CORNERS[key] ?? null;
}
