"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export type PopoverAlign = "start" | "end";

/** 화면 끝과 띄울 여백(px) — `.adp__pop` 의 `max-width: calc(100vw - 32px)` 과 같은 값. */
export const POPOVER_VIEWPORT_MARGIN = 16;

/**
 * 달력 팝오버를 버튼 왼쪽 끝에 맞출지(start, 오른쪽으로 펼침) 오른쪽 끝에 맞출지(end, 왼쪽으로 펼침).
 * 오른쪽으로 펼쳐도 오른쪽 경계 안이면 start — 본문 맨 왼쪽 버튼의 달력이 사이드바를 덮지 않게.
 * 아니면 왼쪽으로 펼쳐 왼쪽 경계 안이면 end(오른쪽 끝 버튼 · 창 안 오른쪽 칸).
 * 양쪽 다 모자라면(아주 좁은 창) 자리가 넓은 쪽.
 * 경계는 화면 끝에서 여백을 뺀 값과, 잘라 내는 상자(모달 몸통 등) 끝 중 안쪽 값.
 */
export function popoverAlign(input: {
  triggerLeft: number;
  triggerRight: number;
  popoverWidth: number;
  boundLeft: number;
  boundRight: number;
}): PopoverAlign {
  const roomRight = input.boundRight - input.triggerLeft;
  const roomLeft = input.triggerRight - input.boundLeft;
  if (input.popoverWidth <= roomRight) return "start";
  if (input.popoverWidth <= roomLeft) return "end";
  return roomRight >= roomLeft ? "start" : "end";
}

/** 팝오버를 잘라 낼 수 있는 가장 가까운 조상(가로 overflow 가 visible 이 아닌 상자). position:fixed 조상을 만나면 화면 기준. */
function clipBoxOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible") return node;
    if (style.position === "fixed") return null;
  }
  return null;
}

/** 열려 있는 동안(그리기 전에 한 번, 창 크기 · 스크롤이 바뀔 때마다) 자리를 재서 `data-align` 값을 준다. 닫혀 있으면 undefined. */
export function usePopoverAlign(open: boolean, rootRef: RefObject<HTMLElement | null>, popoverRef: RefObject<HTMLElement | null>): PopoverAlign | undefined {
  const [align, setAlign] = useState<PopoverAlign | undefined>(undefined);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const popover = popoverRef.current;
    if (!open || !root || !popover) return;
    const clip = clipBoxOf(root);
    const measure = () => {
      const trigger = root.getBoundingClientRect();
      const clipRect = clip?.getBoundingClientRect();
      const viewportRight = document.documentElement.clientWidth - POPOVER_VIEWPORT_MARGIN;
      setAlign(
        popoverAlign({
          triggerLeft: trigger.left,
          triggerRight: trigger.right,
          popoverWidth: popover.offsetWidth,
          boundLeft: Math.max(POPOVER_VIEWPORT_MARGIN, clipRect?.left ?? Number.NEGATIVE_INFINITY),
          boundRight: Math.min(viewportRight, clipRect?.right ?? Number.POSITIVE_INFINITY),
        }),
      );
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    // 스크롤 상자 안에서는 버튼 자리가 바뀔 수 있다 — 캡처 단계로 모든 스크롤을 받는다.
    window.addEventListener("scroll", measure, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
    };
  }, [open, rootRef, popoverRef]);
  return open ? align : undefined;
}
