"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isNativeApp, nativeCallbackToWebPath, nativeShortcutToWebPath } from "@/lib/native-app";

/**
 * 앱(Capacitor) 복귀 처리 (2026-10-06, 앱 출시 준비 B2). 루트 레이아웃에 한 번만 둔다.
 *
 * 시스템 브라우저에서 Google 로그인이 끝나면 OS 가 `com.harutokyo.foldy://auth/callback?code=…` 로 앱을 연다.
 * 그 주소를 받아 시스템 브라우저를 닫고, WebView 를 웹 콜백(`/auth/callback?code=…`)으로 보낸다 — 거기서 기존
 * 서버 코드가 세션을 만든다. 앱이 꺼진 상태에서 열렸을 때(콜드 스타트)는 `getLaunchUrl()` 로 같은 처리를 한다.
 * 브라우저 · PWA 에서는 아무것도 하지 않는다.
 *
 * 앱 아이콘 꾹 누르기 메뉴(2026-10-22)도 여기로 온다 — `com.harutokyo.foldy://open/<id>`(`nativeShortcutToWebPath`)를 앱 안
 * 이동(`router.push`)으로 연다. 실행 중 누른 바로가기는 같은 주소여도 매번 연다. 콜드 스타트 주소만 한 번 처리하면 다시 안 본다.
 */
const HANDLED_KEY = "stayops:native-auth-handled";

export function NativeAuthBridge() {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (!isNativeApp()) return;
    let removed = false;
    let remove: (() => void) | null = null;

    async function handle(url: string | undefined, fromLaunch = false) {
      if (!url) return;
      const shortcut = nativeShortcutToWebPath(url);
      if (shortcut) {
        try {
          if (fromLaunch && sessionStorage.getItem(HANDLED_KEY) === url) return;
          sessionStorage.setItem(HANDLED_KEY, url);
        } catch {
          if (fromLaunch) return;
        }
        if (window.location.pathname !== shortcut) routerRef.current.push(shortcut);
        return;
      }
      const path = nativeCallbackToWebPath(url);
      if (!path) return;
      // 콜백으로 이동하면 페이지가 새로 뜨고 이 컴포넌트가 다시 마운트된다. 콜드 스타트의 `getLaunchUrl()` 은
      // 같은 주소를 계속 돌려주므로, 한 번 처리한 주소는 다시 처리하지 않는다(무한 이동 방지).
      try {
        if (sessionStorage.getItem(HANDLED_KEY) === url) return;
        sessionStorage.setItem(HANDLED_KEY, url);
      } catch {
        // 저장소를 못 쓰면 앱 실행 중 이벤트(appUrlOpen)만 믿는다 — 콜드 스타트 주소는 건너뛴다.
        if (fromLaunch) return;
      }
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.close();
      } catch {
        // Android 는 Custom Tab 이 이미 닫혀 있으면 실패할 수 있다 — 무시.
      }
      window.location.replace(path);
    }

    void (async () => {
      const { App } = await import("@capacitor/app");
      const listener = await App.addListener("appUrlOpen", (event) => void handle(event.url));
      if (removed) {
        await listener.remove();
        return;
      }
      remove = () => void listener.remove();
      const launch = await App.getLaunchUrl();
      await handle(launch?.url, true);
    })();

    return () => {
      removed = true;
      remove?.();
    };
  }, []);

  return null;
}
