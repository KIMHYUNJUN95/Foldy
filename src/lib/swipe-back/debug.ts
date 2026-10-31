/**
 * 화면 스와이프 뒤로가기 — 실기기 진단 표시(2026-10-09). 개발자용이라 번역하지 않는다.
 *
 * 홈 화면 앱(PWA) · 앱 셸에는 주소창이 없어 `?debug` 같은 스위치를 쓸 수 없다. 그래서 **세 손가락으로 한 번 탭**하면
 * 켜고 끈다(이 기기에만 저장). 켜져 있으면 화면 위쪽에 지금 빌드 · 기록 번호 · 돌아갈 곳 · 마지막 터치를 왜 받았는지/
 * 안 받았는지를 띄운다 — 「반응 없음」을 기기에서 바로 원인으로 좁히려는 것. 꺼져 있으면 아무것도 그리지 않는다.
 *
 * 운영 빌드에서는 꺼 둔다(2026-10-31) — 폴드를 펼쳐 잡다 손가락 세 개가 닿아 직원 기기에 우연히 켜지고, 저장돼서 계속 떴다.
 * 개발 빌드(`npm run dev`)에서만 켤 수 있고, 운영에서 다시 필요하면 `NEXT_PUBLIC_SWIPE_DEBUG=1` 로 빌드한다.
 *
 * 문서: docs/product/16-mobile-navigation.md 「뒤로가기 — 화면 스와이프」 → 진단 표시
 */

import { getBackTarget, getHistoryIndex } from "./history-tracker";

const STORAGE_KEY = "stayops:swipe-debug";
const BUILD = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev";
const ALLOWED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_SWIPE_DEBUG === "1";

let enabled: boolean | null = null;
let panel: HTMLDivElement | null = null;
const lines: string[] = [];

function isEnabled(): boolean {
  if (!ALLOWED) return false;
  if (enabled === null) {
    try {
      enabled = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

function draw() {
  if (!isEnabled()) {
    panel?.remove();
    panel = null;
    return;
  }
  if (!panel || !panel.isConnected) {
    panel = document.createElement("div");
    panel.setAttribute("aria-hidden", "true");
    panel.style.cssText =
      "position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top) + 8px);z-index:2147483647;pointer-events:none;" +
      "padding:6px 8px;border-radius:8px;background:rgba(15,23,42,.82);color:#e2e8f0;font:11px/1.35 ui-monospace,Menlo,monospace;" +
      "white-space:pre-wrap;word-break:break-all";
    document.body.appendChild(panel);
  }
  const target = getBackTarget();
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const head =
    `swipe-back · build ${BUILD} · ${standalone ? "standalone" : "browser"}\n` +
    `index ${getHistoryIndex()} · back → ${target ? `${target.url} (${target.delta})` : "none"}`;
  panel.textContent = [head, ...lines].join("\n");
}

/** 진단 한 줄을 남긴다(켜져 있을 때만 — 꺼져 있으면 즉시 돌아간다). */
export function swipeDebug(message: string) {
  if (!isEnabled()) return;
  lines.unshift(`${Math.round(performance.now()) % 100000} ${message}`);
  lines.length = Math.min(lines.length, 8);
  draw();
}

/** 세 손가락 탭으로 켜고 끄는 스위치를 단다. 루트에서 한 번만 부른다. */
export function installSwipeDebugToggle() {
  if (!ALLOWED) {
    // 예전 빌드에서 켜 두고 저장된 값을 지운다 — 나중에 다시 허용해도 저절로 켜지지 않게.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 저장소가 막힌 기기 — 어차피 그리지 않는다.
    }
    return;
  }
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 1 && isEnabled()) {
      const inside = event.target instanceof Element && event.target.closest("[data-swipe-surface]");
      if (!inside) swipeDebug("touch outside swipe surface");
      return;
    }
    if (event.touches.length !== 3) return;
    enabled = !isEnabled();
    try {
      if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 저장이 막힌 기기에서도 이번 실행 동안은 켜진다.
    }
    lines.length = 0;
    draw();
  };
  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  if (isEnabled()) draw();
}
