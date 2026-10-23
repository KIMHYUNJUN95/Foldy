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

type TopCapacitor = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
};
type CountBox = { __privacyHolders?: number };

/** iframe(분할 화면 칸)이면 같은 출처인 top 창, 아니면 자기 창. 접근이 막히면 자기 창. */
function ownerWindow(): Window {
  try {
    if (window.top && window.top !== window) {
      void window.top.location.href; // 다른 출처면 여기서 던진다
      return window.top;
    }
  } catch {
    // 다른 출처 — 자기 창
  }
  return window;
}

function topCapacitor(): TopCapacitor | null {
  const owner = ownerWindow();
  if (owner === window) return null;
  return (owner as unknown as { Capacitor?: TopCapacitor }).Capacitor ?? null;
}

/** 이 창(또는 iframe 이면 top 의 Capacitor)에서 화면 가리기 플러그인을 쓸 수 있는가. */
function privacyAvailable(): boolean {
  if (hasNativePlugin("PrivacyScreen")) return true;
  const cap = topCapacitor();
  try {
    return Boolean(cap?.isNativePlatform?.() && cap.isPluginAvailable?.("PrivacyScreen"));
  } catch {
    return false;
  }
}

function holders(): number {
  return (ownerWindow() as unknown as CountBox).__privacyHolders ?? 0;
}
function setHolders(n: number) {
  (ownerWindow() as unknown as CountBox).__privacyHolders = n;
}

/** 켜고 끄는 호출이 순서대로 가게 한 줄로 잇는다. */
let queue: Promise<unknown> = Promise.resolve();

async function callPlugin(method: "enable" | "disable") {
  const cap = topCapacitor();
  // iframe — top 의 네이티브 다리로 바로 부른다(이 프레임에는 다리가 없다).
  if (cap?.nativePromise && !hasNativePlugin("PrivacyScreen")) {
    await cap.nativePromise("PrivacyScreen", method, {});
    return;
  }
  const { PrivacyScreen } = await import("@capgo/capacitor-privacy-screen");
  await PrivacyScreen[method]();
}

function apply(enable: boolean) {
  queue = queue
    .then(async () => {
      // 끝난 시점의 수를 다시 본다 — 빠르게 열고 닫으면 마지막 상태만 맞으면 된다.
      if (enable && holders() > 0) await callPlugin("enable");
      else if (!enable && holders() === 0) await callPlugin("disable");
    })
    .catch(() => undefined);
}

/** 앱 시작 때 한 번 — 새로고침 · 비정상 종료로 켜진 채 남은 가리기를 끈다(켠 곳이 없을 때만). */
export function resetPrivacyScreenOnStart() {
  if (window !== ownerWindow() || holders() > 0 || !privacyAvailable()) return;
  apply(false);
}

/** 이 컴포넌트가 떠 있는 동안 화면 가리기를 켠다. `active` 가 false 면 아무것도 하지 않는다. */
export function usePrivacyScreen(active = true) {
  useEffect(() => {
    if (!active || !privacyAvailable()) return;
    setHolders(holders() + 1);
    if (holders() === 1) apply(true);
    return () => {
      setHolders(Math.max(0, holders() - 1));
      if (holders() === 0) apply(false);
    };
  }, [active]);
}
