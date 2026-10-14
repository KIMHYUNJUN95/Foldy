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
    // PC 「모바일 보기」 미리보기도 프레임이지만 진짜 앱을 띄우는 거라 스플래시를 보여 준다 — 프레임 전체를 막았더니
    // 서버 HTML 의 스플래시가 하이드레이션 순간 지워져 「뜰 때도 있고 안 뜰 때도 있음」이 됐다(2026-10-14 사용자 지적).
    if (document.documentElement.hasAttribute("data-pane")) return true;
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

/** 서버 스냅숏 = 재생 중. 서버가 그리는 건 페이지를 새로 불러올 때뿐이라(앱 안 이동은 브라우저가 그린다)
 *  첫 화면부터 흰 진입 화면이 깔려 콘솔 · 홈이 잠깐 보였다 덮이는 깜빡임이 없다. 동작 줄이기 · 상세 칸은 CSS 로 숨김. */
export function getServerEntryPlay() {
  return 1;
}

/** 재생이 끝났을 때(모션 컴포넌트의 타이머). 그사이 새 재생이 시작됐으면 무시. */
export function finishEntry(which: number) {
  if (play !== which) return;
  play = 0;
  emit();
}
