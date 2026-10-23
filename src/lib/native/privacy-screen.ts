/**
 * 민감한 화면 가리기 (2026-10-23, docs/product/41 §10 · docs/planning/17 「신분 서류 촬영 · 화면 가리기」).
 *
 * 재류카드 · 마이넘버 카드 촬영 흐름과 관리자 카드 칸이 떠 있는 동안만 켠다.
 * - Android: FLAG_SECURE — 스크린샷 · 화면 녹화 · 최근 앱 미리보기가 검게 나온다.
 * - iOS: 앱 전환기 미리보기를 가리고, 켜져 있는 동안 화면 캡처를 검게 만든다.
 * - 브라우저 · PWA · 플러그인이 없는 옛 앱 빌드: 아무것도 하지 않는다(`hasNativePlugin`).
 *
 * 여러 곳이 동시에 켤 수 있으므로(예: 관리자 화면의 카드 칸 둘) 켠 수를 세서 0 → 1 에서 켜고 1 → 0 에서 끈다.
 * 플러그인은 `@capgo/capacitor-privacy-screen` — 앱 시작 때는 꺼져 있다(`capacitor.config.ts` `PrivacyScreen.enabled: false`).
 */

import { useEffect } from "react";
import { hasNativePlugin } from "@/lib/native-app";

let holders = 0;
/** 켜고 끄는 호출이 순서대로 가게 한 줄로 잇는다. */
let queue: Promise<unknown> = Promise.resolve();

function apply(enable: boolean) {
  queue = queue
    .then(async () => {
      const { PrivacyScreen } = await import("@capgo/capacitor-privacy-screen");
      // 끝난 시점의 수를 다시 본다 — 빠르게 열고 닫으면 마지막 상태만 맞으면 된다.
      if (enable && holders > 0) await PrivacyScreen.enable();
      else if (!enable && holders === 0) await PrivacyScreen.disable();
    })
    .catch(() => undefined);
}

/** 이 컴포넌트가 떠 있는 동안 화면 가리기를 켠다. `active` 가 false 면 아무것도 하지 않는다. */
export function usePrivacyScreen(active = true) {
  useEffect(() => {
    if (!active || !hasNativePlugin("PrivacyScreen")) return;
    holders += 1;
    if (holders === 1) apply(true);
    return () => {
      holders = Math.max(0, holders - 1);
      if (holders === 0) apply(false);
    };
  }, [active]);
}
