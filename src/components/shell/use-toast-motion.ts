"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

/**
 * 모바일 토스트 공용 움직임 (2026-10-21 네이티브급 움직임 점검) — 모양은 화면마다(시안 확정) 두고 **움직임만** 하나로.
 *
 * - **사라질 때 툭 끊기지 않게** — 토스트는 부모가 상태를 비우면 바로 언마운트돼 한 프레임에 사라졌다. 언마운트 직전 그 자리에
 *   복제본을 두고 살짝 내려가며 흐려지게 한다(`toast-leave`, 180ms). 복제본 안의 등장 · 체크 · 남은 시간 줄 애니메이션은 끝난
 *   모습으로 멈춘다(`[data-toast-leaving]`, globals.css).
 * - **밀어서 치우기** — 옆이나 아래로 밀면 손가락을 따라오고, 충분히(가로 56px · 아래 28px) 밀거나 빠르게 튕기면 `onDismiss`.
 *   아니면 제자리로. 민 방향으로 이어서 나간다. 6px 넘게 움직였으면 그 뒤 클릭(몸통 탭으로 닫기 · 행동 버튼)은 먹지 않는다.
 *
 * 쓰는 법: `const ref = useToastMotion<HTMLDivElement>(onDismiss);` → 화면에 고정된 토스트 바깥 요소에 `ref`.
 * `ref` 는 콜백 ref 다(2026-10-26) — 토스트가 조건부로 나중에 그려져도(`{toast && <div ref={ref}>}`) 그때 붙고, 사라지면 떼면서
 * 복제본을 남긴다. 전엔 훅이 처음 그려질 때의 `ref.current` 에만 붙어, 같은 컴포넌트 안에서 조건부로 그리는 토스트(내 시프트
 * 저장 토스트)는 움직임이 하나도 없었다. `ref.current` 를 읽지 말 것.
 * `onDismiss` 가 없으면 밀어서 치우기는 없고 사라짐만. 상세 docs/product/16-mobile-navigation.md 「토스트 — 공용 움직임」.
 */

const SLOP = 6;
const DISMISS_X = 56;
const DISMISS_Y = 28;
const FLICK = 0.45; // px/ms

export function useToastMotion<T extends HTMLElement>(onDismiss?: () => void) {
  // 붙은 요소는 ref 에, 「붙었다 · 떨어졌다」는 state 로 — state 가 바뀌면 아래 효과가 새 요소에 다시 붙는다.
  const elementRef = useRef<T | null>(null);
  const [attached, setAttached] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => {
    elementRef.current = node;
    setAttached(node);
  }, []);
  const onDismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el || el !== attached) return;
    const parent = el.parentNode;
    const mountedAt = performance.now();
    /** 나갈 방향 — 민 쪽으로 이어서, 아니면 아래로 살짝. */
    let leaveX = 0;
    let leaveY = 10;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let lastT = 0;
    let lastX = 0;
    let lastY = 0;
    let vx = 0;
    let vy = 0;
    let dragging = false;
    let swallowClick = false;

    function place(x: number, y: number) {
      el!.style.translate = `${x}px ${y}px`;
      // 멀리 밀수록 흐려진다.
      el!.style.opacity = String(Math.max(0.35, 1 - Math.max(Math.abs(x) / 220, y / 90)));
    }

    function onPointerDown(event: PointerEvent) {
      if (!onDismissRef.current || pointerId !== null || event.button !== 0) return;
      pointerId = event.pointerId;
      startX = lastX = event.clientX;
      startY = lastY = event.clientY;
      lastT = event.timeStamp;
      dx = dy = vx = vy = 0;
      dragging = false;
      swallowClick = false;
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      dx = event.clientX - startX;
      dy = Math.max(0, event.clientY - startY); // 위로는 안 끌린다
      const dt = event.timeStamp - lastT;
      if (dt > 0) {
        vx = (event.clientX - lastX) / dt;
        vy = (event.clientY - lastY) / dt;
      }
      lastT = event.timeStamp;
      lastX = event.clientX;
      lastY = event.clientY;
      if (!dragging) {
        if (Math.abs(dx) < SLOP && dy < SLOP) return;
        dragging = true;
        swallowClick = true;
        el!.setPointerCapture?.(event.pointerId);
        el!.style.transition = "none";
      }
      place(dx, dy);
    }

    function onPointerUp(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (!dragging) return;
      dragging = false;
      const sideways = Math.abs(dx) > dy;
      const out = sideways
        ? Math.abs(dx) >= DISMISS_X || (Math.abs(vx) >= FLICK && Math.sign(vx) === Math.sign(dx))
        : dy >= DISMISS_Y || vy >= FLICK;
      if (out && event.type === "pointerup") {
        leaveX = sideways ? Math.sign(dx) * (window.innerWidth * 0.6) : dx;
        leaveY = sideways ? dy : dy + 40;
        haptic("light");
        onDismissRef.current?.();
        return;
      }
      el!.style.transition = "translate 260ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms ease-out";
      el!.style.translate = "";
      el!.style.opacity = "";
    }

    function onClickCapture(event: MouseEvent) {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    el.style.touchAction = "none";
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("click", onClickCapture, true);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("click", onClickCapture, true);
      // 개발 모드의 StrictMode 재실행(붙자마자 떼기)이나 바로 바뀐 토스트는 남기지 않는다.
      if (performance.now() - mountedAt < 80) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const host = parent && (parent as Node).isConnected ? parent : document.body;
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.setAttribute("aria-hidden", "true");
      ghost.removeAttribute("role");
      ghost.removeAttribute("aria-live");
      ghost.setAttribute("data-toast-leaving", "");
      ghost.style.pointerEvents = "none";
      ghost.style.transition = "none";
      ghost.style.setProperty("--toast-leave-x", `${leaveX}px`);
      ghost.style.setProperty("--toast-leave-y", `${leaveY}px`);
      ghost.style.setProperty("animation", "toast-leave 180ms cubic-bezier(0.4, 0, 1, 1) forwards", "important");
      host.insertBefore(ghost, el.isConnected && el.parentNode === host ? el.nextSibling : null);
      const remove = () => ghost.remove();
      ghost.addEventListener("animationend", (event) => event.target === ghost && remove());
      window.setTimeout(remove, 400);
    };
  }, [attached]);

  return ref;
}
