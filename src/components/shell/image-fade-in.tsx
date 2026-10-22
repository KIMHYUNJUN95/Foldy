"use client";

import { useEffect } from "react";

const SCOPE = "[data-shell-frame] img, [data-sheet] img";

/**
 * 사진 부드럽게 나타나기 — 공용 (2026-10-22 네이티브급 움직임 점검). 모바일 셸 · 시트 안 사진은 다 받아질 때까지 숨겼다가
 * 0.22초에 걸쳐 나타난다(전엔 위에서부터 줄줄이 그려지거나 툭 떴다 — 부드럽게 나타나는 곳이 1곳뿐이었다).
 *
 * 안전장치가 먼저다 — 사진이 안 보이는 것보다 툭 뜨는 게 낫다:
 * - CSS 의 숨김은 `html[data-img-fade]` 일 때만 걸린다. 이 컴포넌트가 붙으며 **이미 받아진 사진부터 표시한 뒤** 켠다.
 *   스크립트가 안 돌면 속성이 없어 사진은 평소처럼 보인다.
 * - 받기 실패(`error`)도 표시해 깨진 그림 · 대체 글이 보이게.
 * - 붙은 뒤 새로 생긴 사진은 `load` · `error` 를 문서에서 잡는다(캡처 — 두 이벤트는 거품이 안 올라온다). 이미 받아져 있던 사진이
 *   새로 붙는 경우는 MutationObserver 가 바로 표시한다.
 * 상세 docs/product/16-mobile-navigation.md 「사진 부드럽게 나타나기」.
 */
export function ImageFadeIn() {
  useEffect(() => {
    const root = document.documentElement;
    const mark = (img: HTMLImageElement) => {
      if (!img.hasAttribute("data-loaded")) img.setAttribute("data-loaded", "");
    };
    const markIfDone = (img: HTMLImageElement) => {
      if (img.complete) mark(img);
    };
    document.querySelectorAll<HTMLImageElement>(SCOPE).forEach(markIfDone);

    const onDone = (event: Event) => {
      if (event.target instanceof HTMLImageElement) mark(event.target);
    };
    document.addEventListener("load", onDone, true);
    document.addEventListener("error", onDone, true);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          // src 가 바뀐 사진은 새 사진을 기다린다.
          const img = record.target as HTMLImageElement;
          if (img.complete) mark(img);
          else img.removeAttribute("data-loaded");
          continue;
        }
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLImageElement) markIfDone(node);
          else if (node instanceof Element) node.querySelectorAll<HTMLImageElement>("img").forEach(markIfDone);
        });
      }
    });
    observer.observe(document.body, { attributeFilter: ["src", "srcset"], childList: true, subtree: true });

    root.setAttribute("data-img-fade", "");
    return () => {
      root.removeAttribute("data-img-fade");
      observer.disconnect();
      document.removeEventListener("load", onDone, true);
      document.removeEventListener("error", onDone, true);
    };
  }, []);
  return null;
}
