// 진입 모션 재생 시점(2026-10-14 사용자 결정) — 앱 스플래시(모바일) · PC 진입 모션이 함께 쓴다.
// 「화면을 끄거나 · 새로고침하거나 · 다시 접속할 때마다」:
// - 페이지를 새로 불러올 때마다(새로고침 · 앱 다시 열기 · 다시 접속) 한 번 — 모듈 변수라 새로 불러오면 초기화된다.
// - 화면을 끄거나 다른 앱으로 갔다가 HIDDEN_MS 넘게 지나 돌아오면 다시 한 번.
// - 앱 안에서 화면을 옮겨 다닐 땐(클라이언트 이동) 다시 안 나온다.
// 동작 줄이기면 · 태블릿 상세 칸(프레임) 안에선 안 나온다.

const HIDDEN_MS = 30_000;

let play = 0; // 0 = 지금 안 보임, n = n번째 재생 중(열쇠로 써서 애니메이션을 처음부터 다시)
let started = false;
let hiddenAt: number | null = null;
const listeners = new Set<() => void>();

/** 동작 줄이기 · 태블릿 2분할의 상세 칸(같은 출처 프레임, `html[data-pane]`) 안에선 안 나온다 — 칸은 상세를 열 때마다 새로 불러온다. */
function reducedMotion() {
  try {
    if (document.documentElement.hasAttribute("data-pane") || window.self !== window.top) return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    return;
  }
  if (hiddenAt !== null && Date.now() - hiddenAt >= HIDDEN_MS && !reducedMotion()) {
    play += 1;
    emit();
  }
  hiddenAt = null;
}

export function subscribeEntry(listener: () => void) {
  if (listeners.size === 0) document.addEventListener("visibilitychange", onVisibility);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** 브라우저 스냅숏 — 이번 페이지 불러오기의 첫 호출에서 재생을 시작한다. */
export function getEntryPlay() {
  if (!started) {
    started = true;
    if (!reducedMotion()) play = 1;
  }
  return play;
}

export function getServerEntryPlay() {
  return 0;
}

/** 재생이 끝났을 때(모션 컴포넌트의 타이머). 그사이 새 재생이 시작됐으면 무시. */
export function finishEntry(which: number) {
  if (play !== which) return;
  play = 0;
  emit();
}
