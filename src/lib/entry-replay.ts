// 진입 모션 재생 시점(2026-10-14 사용자 결정) — 앱 스플래시(모바일) · PC 진입 모션이 함께 쓴다.
// 「화면을 끄거나 · 새로고침하거나 · 다시 접속할 때마다」:
// - 페이지를 새로 불러올 때마다(새로고침 · 앱 다시 열기 · 다시 접속) 한 번 — 이건 서버 HTML 의 인라인 스크립트가 바로 띄운다.
// - 화면을 끄거나 다른 앱으로 갔다가 HIDDEN_MS 넘게 지나 돌아오면 다시 한 번 — 이 스토어가 번호를 올리고, 컴포넌트가 띄운다.
// - 앱 안에서 화면을 옮겨 다닐 땐(클라이언트 이동) 다시 안 나온다.
// 진입 화면 자체는 React 바깥(스크립트가 body 에 직접 붙이고 끝나면 직접 지움) — React 가 화면을 다시 그려도(하이드레이션 어긋남 등)
// 지워졌다 처음부터 다시 나오지 않는다(2026-10-14 사용자 지적 「로고가 떴다 꺼진 뒤 모션 로고가 또 나옴」).
// 번호는 계속 올라가기만 한다(재생마다 다름) — 같은 번호는 두 번 띄우지 않는다.

const HIDDEN_MS = 30_000;

let seq = 0;
let started = false;
let hiddenAt: number | null = null;
const listeners = new Set<() => void>();

/** 동작 줄이기 · 태블릿 2분할의 상세 칸(같은 출처 프레임, `html[data-pane]`) 안에선 안 나온다 — 칸은 상세를 열 때마다 새로 불러온다.
 *  PC 「모바일 보기」 미리보기도 프레임이지만 진짜 앱을 띄우는 거라 나온다. */
function blocked() {
  try {
    if (document.documentElement.hasAttribute("data-pane")) return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    return;
  }
  if (hiddenAt !== null && Date.now() - hiddenAt >= HIDDEN_MS && !blocked()) {
    seq += 1;
    listeners.forEach((l) => l());
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

/** 브라우저 스냅숏 — 첫 호출에서 1(= 페이지를 새로 불러온 재생, 서버 HTML 의 스크립트가 이미 띄웠다). 이후 돌아올 때마다 +1. */
export function getEntryPlay() {
  if (!started) {
    started = true;
    seq = 1;
  }
  return seq;
}

export function getServerEntryPlay() {
  return 1;
}
