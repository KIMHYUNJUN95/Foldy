/**
 * Android 예측 뒤로가기(시스템 가장자리 제스처) → 화면 스와이프 엔진 (2026-10-20, 앱 출시 계획 17번 N12).
 *
 * 문서: docs/product/16-mobile-navigation.md 「뒤로가기 — 화면 스와이프」 · 네이티브: android/.../PredictiveBackPlugin.java
 *
 * Android 는 화면 양쪽 가장자리 밀기를 OS 가 먼저 가져간다(구글 지침상 앱이 가로채면 안 되고, 가로챌 수 있는 길이도 한쪽 200dp 뿐).
 * 대신 OS 가 그 제스처의 시작 · 진행(손가락 위치) · 취소 · 확정을 알려 주므로, 그 값을 손가락 대신 같은 엔진
 * (`getExternalBackGesture`)에 넣는다 — 가장자리에서 밀어도 지금 화면이 손가락을 따라 밀리고 아래에 이전 화면이 보인다.
 * 오른쪽 가장자리에서 밀면 거울처럼 판이 왼쪽으로 간다.
 *
 * OS 가 제스처를 우리에게 줄지는 **제스처가 시작되기 전에** 정해져 있어야 한다. 그래서 「뒤로 갈 곳이 있는가」를 이동 · 시트
 * 열림/닫힘마다 미리 알려 둔다(`setEnabled`). 갈 곳이 없으면(홈) 꺼 두어 OS 기본 — 홈 화면으로 나가는 미리보기 — 가 나온다.
 */

import type { PluginListenerHandle } from "@capacitor/core";
import { getExternalBackGesture, hasOpenOverlay } from "./controller";
import { isSwipeBackScreen, parentScreen } from "./history-model";
import { getBackTarget, subscribeHistory } from "./history-tracker";
import { MOBILE_SCREENS } from "./mobile-screens";

type BackEvent = { touchX: number; touchY: number; progress: number; edge: number };

type PredictiveBackPlugin = {
  setEnabled: (options: { enabled: boolean }) => Promise<void>;
  addListener: (
    event: "backStarted" | "backProgressed" | "backCancelled" | "backInvoked",
    listener: (event: BackEvent) => void,
  ) => Promise<PluginListenerHandle>;
};

/** 시스템 제스처가 아닌 뒤로(3버튼 내비게이션의 버튼). */
const EDGE_NONE = 2;
const EDGE_RIGHT = 1;

/** 지금 뒤로가기를 앱이 받아야 하는가 — 열린 시트, 앱 안 이전 화면, 위 화면. 앱 밖 화면(계정 등)은 이전 기록이 있으면. */
export function wantsBack(): boolean {
  if (hasOpenOverlay()) return true;
  const path = window.location.pathname;
  const back = getBackTarget();
  if (!isSwipeBackScreen(path)) return back !== null;
  return (back !== null && isSwipeBackScreen(back.url)) || parentScreen(path, MOBILE_SCREENS) !== null;
}

/**
 * 붙이고 떼는 함수를 돌려준다. `onInvoke` — 미리보기 없이 확정된 뒤로(버튼, 열린 시트, 입력 중인 화면 등)를 처리한다.
 */
export async function attachPredictiveBack(onInvoke: () => void): Promise<() => void> {
  const { registerPlugin } = await import("@capacitor/core");
  const plugin = registerPlugin<PredictiveBackPlugin>("PredictiveBack");

  let enabled: boolean | null = null;
  let frame = 0;
  const sync = () => {
    frame = 0;
    const next = wantsBack();
    if (next === enabled) return;
    enabled = next;
    void plugin.setEnabled({ enabled: next }).catch(() => undefined);
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(sync);
  };

  let swiping = false;
  let startX = 0;
  const toCss = (x: number) => x / (window.devicePixelRatio || 1);

  const handles = await Promise.all([
    plugin.addListener("backStarted", (event) => {
      startX = toCss(event.touchX);
      swiping = event.edge !== EDGE_NONE && Boolean(getExternalBackGesture()?.begin(event.edge === EDGE_RIGHT ? -1 : 1));
    }),
    plugin.addListener("backProgressed", (event) => {
      if (swiping) getExternalBackGesture()?.move(Math.abs(toCss(event.touchX) - startX));
    }),
    plugin.addListener("backCancelled", () => {
      if (swiping) getExternalBackGesture()?.cancel();
      swiping = false;
      schedule();
    }),
    plugin.addListener("backInvoked", () => {
      const handled = swiping && Boolean(getExternalBackGesture()?.commit());
      swiping = false;
      if (!handled) onInvoke();
      schedule();
    }),
  ]);

  // 이동마다, 시트 · 메뉴 · 뷰어가 열리고 닫힐 때마다 다시 알린다.
  const unsubscribe = subscribeHistory(schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    attributeFilter: ["aria-modal", "role", "data-native-back-overlay"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  window.addEventListener("popstate", schedule);
  sync();

  return () => {
    unsubscribe();
    observer.disconnect();
    window.removeEventListener("popstate", schedule);
    if (frame) window.cancelAnimationFrame(frame);
    for (const handle of handles) void handle.remove();
    void plugin.setEnabled({ enabled: false }).catch(() => undefined);
  };
}
