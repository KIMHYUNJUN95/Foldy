"use client";

import { useEffect, useRef, type RefObject } from "react";
import { haptic } from "@/lib/haptics";

/**
 * 왼쪽 메뉴(서랍)를 손가락으로 끌어 닫기 (2026-10-21 네이티브급 움직임 점검).
 *
 * 전엔 열고 닫기가 버튼 · 바깥 탭 · Esc 뿐이었다. 이제 열린 메뉴를 왼쪽으로 밀면 손가락을 따라 밀리고(넓은 화면은 뒤 어둠도 같이 걷힘),
 * 메뉴 폭의 30% 넘게 밀었거나 왼쪽으로 빠르게 튕겼으면 닫힌다. 아니면 제자리로.
 * - 세로로 먼저 움직이면 그 손짓은 메뉴 목록 스크롤 몫. 입력칸(메뉴 검색)에서 시작한 손짓은 받지 않는다.
 * - 끄는 동안은 누름 반응을 끈다(`html[data-gesture]`, globals.css 「누름 반응」).
 * - 서랍의 `transform` · `transition` 은 React(셸)가 열림 상태로 쥐고 있다 — 끄는 동안만 인라인으로 덮고, 닫을 때는 전환을 되돌린 뒤
 *   `onClose` 로 React 가 -100% 를 쓰게 한다.
 */

const SLOP = 8;
const CLOSE_RATIO = 0.3;
const FLICK = 0.4; // px/ms

export function useDrawerDragClose({
  drawerRef,
  backdropRef,
  open,
  onClose,
}: {
  drawerRef: RefObject<HTMLElement | null>;
  backdropRef?: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    openRef.current = open;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    let phase: "idle" | "pending" | "dragging" = "idle";
    let startX = 0;
    let startY = 0;
    let width = 0;
    let offset = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let baseTransition = "";
    let frame = 0;

    function render() {
      frame = 0;
      drawer!.style.transform = `translate3d(${offset}px, 0, 0)`;
      const backdrop = backdropRef?.current;
      if (backdrop && width > 0) backdrop.style.opacity = String(1 + offset / width);
    }

    function onTouchStart(event: TouchEvent) {
      phase = "idle";
      if (!openRef.current || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [data-swipe-back="off"]')) return;
      phase = "pending";
      startX = lastX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      lastT = event.timeStamp;
      velocity = 0;
    }

    function onTouchMove(event: TouchEvent) {
      if (phase === "idle") return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (phase === "pending") {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // 왼쪽으로 뚜렷이 가로인 손짓만 — 세로 · 오른쪽은 목록 스크롤 몫.
        if (dx >= 0 || Math.abs(dx) <= Math.abs(dy) * 1.2) {
          phase = "idle";
          return;
        }
        phase = "dragging";
        startX = touch.clientX; // 판정 거리만큼 튀지 않게
        width = drawer!.getBoundingClientRect().width;
        baseTransition = drawer!.style.transition;
        drawer!.style.transition = "none";
        if (backdropRef?.current) backdropRef.current.style.transition = "none";
        document.documentElement.setAttribute("data-gesture", "");
      }
      if (event.cancelable) event.preventDefault();
      const dt = event.timeStamp - lastT;
      if (dt > 0) velocity = (touch.clientX - lastX) / dt;
      lastX = touch.clientX;
      lastT = event.timeStamp;
      offset = Math.min(0, touch.clientX - startX);
      if (!frame) frame = requestAnimationFrame(render);
    }

    function onTouchEnd(event: TouchEvent) {
      if (phase !== "dragging") {
        phase = "idle";
        return;
      }
      phase = "idle";
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      document.documentElement.removeAttribute("data-gesture");
      const close = event.type === "touchend" && (-offset >= width * CLOSE_RATIO || velocity <= -FLICK);
      // 남은 거리를 원래 곡선으로 마저 간다(닫힘: React 가 -100% 를 쓴다 · 취소: 제자리).
      drawer!.style.transition = baseTransition;
      const backdrop = backdropRef?.current;
      if (backdrop) {
        // 지금 어둠에서 이어서 걷히거나(닫힘) 돌아온다(취소) — 클래스 값으로 바로 돌리면 한 번 번쩍인다.
        backdrop.style.transition = "";
        backdrop.style.opacity = close ? "0" : "";
        if (close) window.setTimeout(() => (backdrop.style.opacity = ""), 400);
      }
      if (close) {
        haptic("light");
        onCloseRef.current();
      } else {
        drawer!.style.transform = "translate3d(0, 0, 0)";
      }
      offset = 0;
    }

    drawer.addEventListener("touchstart", onTouchStart, { passive: true });
    drawer.addEventListener("touchmove", onTouchMove, { passive: false });
    drawer.addEventListener("touchend", onTouchEnd);
    drawer.addEventListener("touchcancel", onTouchEnd);
    return () => {
      drawer.removeEventListener("touchstart", onTouchStart);
      drawer.removeEventListener("touchmove", onTouchMove);
      drawer.removeEventListener("touchend", onTouchEnd);
      drawer.removeEventListener("touchcancel", onTouchEnd);
      if (frame) cancelAnimationFrame(frame);
      document.documentElement.removeAttribute("data-gesture");
    };
  }, [drawerRef, backdropRef]);
}
