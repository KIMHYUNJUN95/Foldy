"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativeApp } from "@/lib/native-app";

/**
 * 서비스 워커를 등록해 (프로덕션에서만) 설치된 PWA 가 Android 에서 설치 가능하게 하고
 * (Chrome 설치 프롬프트는 fetch 핸들러가 있는 SW 를 요구함) 오프라인 대체 화면을 제공한다.
 * 개발 환경은 건너뛴다 — 캐시된 SW 가 HMR 을 방해하지 않게 하기 위함이다. 같은 오리진에서 이전 프로덕션 실행이 남긴 SW 는
 * 개발 전용 `/sw.js` 킬 스위치(`public/sw-dev-reset.js`,
 * `next.config.ts` 에서 연결)가 제거한다. 아무것도 렌더하지 않는다.
 *
 * **iOS · Android 앱에서는 쓰지 않는다 (2026-10-09).** 앱은 항상 배포된 라이브 사이트를 불러오므로, 거기서 SW 는 배포 직후마다
 * 낡은 첫 화면(캐시된 옛 HTML)과 별도의 두 번째 오프라인 페이지만 만든다.
 * 앱의 오프라인은 `server.errorPath` (`capacitor-www/index.html`, ko/ja/en)가 네이티브로 처리한다.
 * 이전 빌드가 등록한 SW 는 다음 실행 때 등록 해제되고 캐시도 지워진다.
 */
async function removeServiceWorkerForApp() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* 최선 시도 — 남은 SW 가 있어도 앱은 동작한다 */
  }
}

export function ServiceWorkerRegister() {
  const router = useRouter();

  // SW 는 콜드 런치 문서를 stale-while-revalidate 캐시에서 내어 즉시
  // 그려주고, 재검증이 끝나면 메시지를 보낸다: 서버 최신 데이터를 조용히 가져와(router.refresh)
  // 잠시 낡았던 화면이 스스로 바로잡히게 하거나, 재검증이 리디렉션했다면 강제 새로고침한다
  // (예: 세션이 만료되어 서버가 로그인으로 보내려는 경우).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const type = (event.data as { type?: string } | null)?.type;
      if (type === "sw-nav-fresh") {
        router.refresh();
      } else if (type === "sw-nav-redirected") {
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (isNativeApp()) {
      void removeServiceWorkerForApp();
      return;
    }

    // 새로 설치된 SW 가 (배포 후) 제어권을 가져오면 한 번만 새로고침해, 클라이언트가
    // 옛 버전에 갇히지 않고 새 앱 셸 + 콘텐츠 해시 청크를 받게 한다 (청크 로드 오류의
    // 원인이 되기도 한다). 옛 SW 가 이미 이 페이지를 제어하고 있었을 때만 새로고침한다 —
    // 그렇지 않으면 첫 설치의 clients.claim() 이 불필요한 새로고침 루프를 일으킨다.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 등록 실패는 치명적이지 않다 — 온라인에서는 앱이 그대로 동작한다 */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
