"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { hasNativePlugin, IN_APP_BROWSER_OPTIONS, isNativeApp, nativePlatform } from "@/lib/native-app";
import { resetPrivacyScreenOnStart } from "@/lib/native/privacy-screen";
import { hasOpenOverlay } from "@/lib/swipe-back/controller";
import { isSwipeBackScreen, parentScreen } from "@/lib/swipe-back/history-model";
import { getBackTarget } from "@/lib/swipe-back/history-tracker";
import { MOBILE_SCREENS } from "@/lib/swipe-back/mobile-screens";
import { attachPredictiveBack } from "@/lib/swipe-back/native-predictive-back";

/**
 * 앱(Capacitor) WebView 보정 (2026-10-06, 앱 출시 준비 B3). 루트 레이아웃에 한 번만 둔다. 브라우저 · PWA 에서는 아무것도 안 한다.
 *
 * 1. **바깥 링크 · 새 창 · 다운로드** — WebView 는 `target="_blank"` · `window.open` · 첨부 다운로드를 조용히 무시하거나
 *    앱 밖 브라우저로 튕긴다. 다른 출처(http/https) 링크, `target="_blank"`, `download` 링크는 앱 안 브라우저
 *    (`@capacitor/browser` — iOS SFSafariViewController · Android Custom Tab)로 연다. 같은 출처 새 창은 WebView 에서 그대로 연다
 *    (시스템 브라우저는 로그인 쿠키가 달라 다시 로그인을 요구한다). `tel:` · `mailto:` 등은 Capacitor 가 OS 로 넘긴다.
 * 2. **Android 뒤로가기 버튼** — 열린 시트 · 대화상자 · 메뉴 · 사진 뷰어가 있으면 먼저 닫고(Esc 와 같은 경로), 없으면 이전 화면,
 *    더 갈 곳이 없으면 앱을 최소화한다(종료하지 않는다). Esc 를 받지 않는 대화상자에서 막히지 않도록, 1.2초 안에 다시 누르면 화면 이동.
 * 3. **상태바 아이콘** — 어두운 아이콘 고정(앱 화면은 늘 밝다). 2026-10-08 네이티브 품질 N1.
 * 4. **길게 누르기 브라우저 메뉴 차단** — 링크 · 사진의 「링크 주소 복사 · Chrome 에서 열기」 메뉴(입력칸 제외). N8.
 * 5. **iOS 키보드 위 「‹ › 완료」 막대 숨김** — 웹 입력칸 티가 가장 많이 나는 곳(2026-10-09, N13).
 * 6. **기기 글자 크기** — OS 글자 크기 설정을 따르되 0.85~1.35 배로 묶는다(N14, 2026-10-22 1.15 → 1.35). Android WebView 는 원래 기기 글자 크기를 제한 없이
 *    따라가 큰 글씨에서 화면이 깨질 수 있었고, iOS WebView 는 아예 무시했다. 앱으로 돌아올 때마다 다시 맞춘다(설정을 바꿨을 수 있다).
 *
 * 네이티브 플러그인은 모두 `hasNativePlugin` 으로 거른다 — 옛 설치본에 없는 플러그인을 불러 멈추지 않게(웹 · 앱 버전 어긋남).
 */

/**
 * 기기 글자 크기 배율의 허용 범위 — 화면이 깨지지 않는 선에서 따른다. 위 1.35 = iOS 일반 글자 크기의 가장 큰 단계(본문 17 → 23pt).
 * 그보다 큰 「손쉬운 사용」 큰 글씨는 1.35 에서 멈춘다. 2026-10-22 에 1.15 → 1.35 로 넓혔다(모바일 화면 1.35 배 점검,
 * 16 「접근성 — 공용 규칙」). 더 넓히려면 그 배율로 화면을 다시 점검한다.
 */
const TEXT_ZOOM_MIN = 0.85;
const TEXT_ZOOM_MAX = 1.35;

/**
 * 두 플랫폼 모두 **CSS(`body` 의 text-size-adjust)** 로 키운다 — 탭바 · 촘촘한 표는 `data-text-fixed` 로 원래 크기를 지키게
 * (globals.css). Android WebView 는 기본으로 기기 글자 크기를 통째로 따라가(textZoom) CSS 로 막을 수 없으므로 그쪽은 100% 로 되돌린다.
 * iOS 플러그인의 set 도 body 의 text-size-adjust 를 쓰는 같은 방식이다.
 */
async function syncTextZoom() {
  if (!hasNativePlugin("TextZoom")) return;
  try {
    const { TextZoom } = await import("@capacitor/text-zoom");
    const { value } = await TextZoom.getPreferred();
    const clamped = Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, Number.isFinite(value) ? value : 1));
    if (nativePlatform() === "android") await TextZoom.set({ value: 1 });
    const pct = `${Math.round(clamped * 100)}%`;
    document.body.style.setProperty("-webkit-text-size-adjust", pct);
    document.body.style.setProperty("text-size-adjust", pct);
  } catch {
    // 실패하면 WebView 기본값 그대로 — 기능에는 영향 없음
  }
}

export function NativeShellBridge() {
  // 효과는 한 번만 붙인다 — 최신 router 는 ref 로 본다.
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (!isNativeApp()) return;

    async function openInAppBrowser(url: string) {
      if (!hasNativePlugin("Browser")) {
        window.location.assign(url);
        return;
      }
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, ...IN_APP_BROWSER_OPTIONS });
    }

    function resolve(href: string): URL | null {
      try {
        return new URL(href, window.location.href);
      } catch {
        return null;
      }
    }

    // 1-a. 링크 클릭(사람이 누른 것 + `a.click()` 으로 만든 다운로드 모두 여기로 온다)
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const url = resolve(anchor.getAttribute("href") ?? "");
      if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return;
      const external = url.origin !== window.location.origin;
      const newWindow = anchor.target === "_blank";
      const download = anchor.hasAttribute("download");
      if (!external && !newWindow && !download) return;
      event.preventDefault();
      if (external || download) void openInAppBrowser(url.href);
      else window.location.assign(url.href);
    }
    document.addEventListener("click", onClick, true);

    // 1-b. window.open — 같은 출처는 WebView 안에서, 다른 출처는 앱 안 브라우저로. 빈 창(문서 직접 쓰기)은 원래대로.
    const originalOpen = window.open.bind(window);
    window.open = ((target?: string | URL, name?: string, features?: string) => {
      const href = target ? String(target) : "";
      const url = href ? resolve(href) : null;
      if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return originalOpen(target, name, features);
      if (url.origin === window.location.origin) window.location.assign(url.href);
      else void openInAppBrowser(url.href);
      return null;
    }) as typeof window.open;

    // 4. 길게 누르기 메뉴 — WebView 는 링크 · 사진을 길게 누르면 「Copy link address · Download link · Open in Chrome」 브라우저 메뉴와
    //    주소를 띄운다(N8). 입력칸 · 편집 영역은 붙여넣기가 필요하므로 그대로 두고, 나머지는 막는다. iOS 링크 미리보기는
    //    capacitor.config `ios.allowsLinkPreview: false`, iOS 콜아웃은 globals.css `-webkit-touch-callout`.
    function onContextMenu(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      event.preventDefault();
    }
    document.addEventListener("contextmenu", onContextMenu, true);

    // 3. 상태바 아이콘 — 앱 화면은 늘 밝은 아이보리라 어두운 아이콘으로 고정(N1). Android 는 capacitor.config 의
    //    `SystemBars.style` 로도 정하지만 iOS 는 설정값이 없어 여기서 맞춘다(기기 다크 모드면 흰 아이콘이 되어 안 보였다).
    void (async () => {
      const { SystemBars, SystemBarsStyle } = await import("@capacitor/core");
      await SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => undefined);
    })();

    // 5. iOS 키보드 막대
    if (nativePlatform() === "ios" && hasNativePlugin("Keyboard")) {
      void (async () => {
        const { Keyboard } = await import("@capacitor/keyboard");
        await Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined);
      })();
    }

    // 6. 기기 글자 크기
    void syncTextZoom();

    // 7. 화면 가리기 — 새로고침 · 비정상 종료로 켜진 채 남지 않게 시작 때 한 번 끈다(켠 화면이 있으면 건드리지 않는다).
    resetPrivacyScreenOnStart();

    // 2. Android 뒤로가기 (+ 6. 앱으로 돌아올 때 글자 크기 다시 맞추기)
    let removeBack: (() => void) | null = null;
    let removeResume: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      if (!hasNativePlugin("App")) return;
      const { App } = await import("@capacitor/app");
      const resume = await App.addListener("resume", () => void syncTextZoom());
      if (disposed) void resume.remove();
      else removeResume = () => void resume.remove();
      let lastEscapeAt = 0;
      /** 미리보기 없이 확정된 뒤로 — 열린 시트 닫기 → 이전 화면 → 위 화면 → 앱 내리기. */
      const goBack = (canGoBack: boolean) => {
        // Esc 를 받지 않는 대화상자도 있다 — 1.2초 안에 다시 눌렀는데도 그대로면 화면 이동으로 넘어간다(먹통 방지).
        const now = Date.now();
        if (hasOpenOverlay() && now - lastEscapeAt > 1200) {
          lastEscapeAt = now;
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return;
        }
        lastEscapeAt = 0;
        // 앱 안 이전 기록이 없으면(알림 · 링크로 바로 들어옴) 화면 스와이프와 같이 위 화면으로(2026-10-20). 홈이면 앱을 내린다.
        // 2026-10-26: **홈에서는** 이전 기록이 `/mobile` 화면일 때만 기록 뒤로 — WebView 기록에 남은 로그인 · 온보딩 · 외부 페이지로
        // 돌아가던 것을 막는다(그때는 앱을 내린다). 홈 밖(계정 `/account/id-card` 등 `/mobile` 밖 앱 화면)은 예전처럼 기록 뒤로.
        const back = getBackTarget();
        const backInApp = Boolean(back && isSwipeBackScreen(back.url));
        const onHome = window.location.pathname === "/mobile";
        const parent = parentScreen(window.location.pathname, MOBILE_SCREENS);
        if (!backInApp && parent) routerRef.current.replace(parent);
        else if (canGoBack && (backInApp || !onHome)) window.history.back();
        else void App.minimizeApp();
      };

      // Android 예측 뒤로가기(2026-10-20) — 시스템 가장자리 제스처를 화면 스와이프 엔진으로. 이 플러그인이 있는 앱 빌드는
      // App 플러그인의 뒤로 처리가 꺼져 있다(capacitor.config.ts). 옛 앱 빌드는 아래 `backButton` 그대로.
      if (nativePlatform() === "android" && hasNativePlugin("PredictiveBack")) {
        const detach = await attachPredictiveBack(() => goBack(getBackTarget() !== null));
        if (disposed) detach();
        else removeBack = detach;
        return;
      }

      const listener = await App.addListener("backButton", ({ canGoBack }) => goBack(canGoBack));
      if (disposed) void listener.remove();
      else removeBack = () => void listener.remove();
    })();

    return () => {
      disposed = true;
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.open = originalOpen;
      removeBack?.();
      removeResume?.();
    };
  }, []);

  return null;
}
