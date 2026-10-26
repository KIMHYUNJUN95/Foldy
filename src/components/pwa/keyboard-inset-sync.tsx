"use client";

import { useEffect } from "react";

/**
 * 화면 키보드 높이를 <html> 의 `--keyboard-inset` CSS 변수로 내보낸다 (VisualViewport
 * API 사용). 하단 고정 바(예: 폼 제출 바)는 이제
 * `bottom: var(--keyboard-inset, 0px)` 에 놓아 키보드가 가리지 않게 할 수 있다 — iOS(키보드가 열려도
 * 레이아웃 뷰포트가 줄지 않음)에서 네이티브 느낌을 해치던 키보드 관련 가장 큰 격차다.
 * 아무것도 렌더하지 않으며, VisualViewport 가 없으면 아무 동작도 하지 않는다.
 */
export function KeyboardInsetSync() {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      // 키보드(및 하단 브라우저 UI)가 레이아웃 뷰포트 하단을 얼마나 가리는지.
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);

  return null;
}
