"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * iOS 방식의 앱 하단 시트 드래그로 닫기 — 드래그 전용 기본 요소.
 *
 * 드래그 동작은 한 곳이 맡아 모든 시트가 똑같이 느껴지게 하고, 각 시트는 자기
 * 열기/닫기 수명주기를 그대로 가진다 (이미 있는 `shown ? translate-y-0 : translate-y-full` + `opacity` 슬라이드).
 * 이 훅은 마운트/표시 여부를 소유하지 않고 다음만 한다:
 *   - 그랩 핸들 / 헤더를 드래그하는 동안 손가락을 아래로 따라간다 (0 에서 clamp)
 *   - `sheetRef` 가 있으면: 시트 콘텐츠에서도 iOS 방식으로 (2026-10-21) — 손가락 아래 콘텐츠가 맨 위까지 스크롤된 상태에서 시작한 아래 방향 당김은
 *     목록을 고무줄처럼 늘이는 대신 시트를 끈다.
 *     시트 안 텍스트 필드에 포커스가 있거나, 가로 제스처이거나,
 *     `[data-sheet-drag="off"]` / 슬라이더 / `touch-action: none` 요소(자체 제스처)에서는 하지 않는다.
 *   - 놓을 때: 충분히 멀리/빠르게 당겼으면 시트 자체의 닫기(`onDismiss`)를 호출하고, 아니면 원위치로 복귀
 *   - 드래그 거리에 비례해 스크림을 투명하게 만든다
 *
 * 드래그 중이 아닐 때는 훅이 transform/opacity 를 시트의 className 에 맡기므로
 * 기존 슬라이드 인 / 슬라이드 아웃 / 스크림 페이드(그리고 `motion-reduce` 해제)가 모두 그대로이고,
 * 훅은 실시간 드래그 동안에만 인라인 transform/opacity 를 설정한다 (transition 은 끈다).
 *
 * 드래그 동작은 `reorderable-section-list.tsx` 와 같다: window pointermove/up 리스너를
 * 한 번만 붙이고 실시간 값은 ref 에 비춰 두어 effect 가 다시 바인딩되지 않고 렌더가 깔끔하다
 * (react-hooks/refs + set-state-in-effect 만족).
 *
 * 사용법:
 *   const drag = useSheetDragDismiss({ shown, onDismiss: close });
 *   // scrim:  <div className="... transition-opacity ..." style={drag.scrimStyle} onClick={close}>
 *   // sheet:  <div data-sheet className="... shown ? translate-y-0 : translate-y-full" style={drag.sheetStyle}>
 *   // handle: <div {...drag.handleProps} /> and/or the header block
 */

// 닫기 임계값 (확정된 기본값).
const DISTANCE_RATIO = 0.25; // 시트 높이의 비율
const DISTANCE_FLOOR = 80; // px — 의도한 최소 당김
const VELOCITY_CLOSE = 0.5; // px/ms 아래 방향 플릭
const SCRIM_DIM = 0.5; // 스크림이 전체 높이 드래그에서 (1 - 이 값)까지 옅어진다

type Options = {
  /** 시트가 화면에 놓여 있는 동안 true. 시트는 자기 슬라이드 인/아웃을 계속 소유한다. */
  shown: boolean;
  /** 시트의 기존 close() 를 실행 — 드래그가 닫기 임계값을 넘으면 호출된다. */
  onDismiss: () => void;
  /** 시트 요소 — 콘텐츠에서 드래그하는 것을 가능하게 한다 (위 참고). */
  sheetRef?: RefObject<HTMLElement | null>;
};

/** 콘텐츠 터치가 스크롤인지 시트 드래그인지 판정하기 전의 이동량. */
const CONTENT_SLOP = 6;
const CONTENT_BLOCKED = '[data-sheet-drag="off"], [role="slider"], input[type="range"], [data-swipe-back="off"]';

export function useSheetDragDismiss({ shown, onDismiss, sheetRef }: Options) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState(0); // 드래그 시작 시 캡처한 시트 높이 (스크림 흐림용)

  // 실시간 값을 window 리스너용으로 비춰 둔다.
  const draggingRef = useRef(false);
  const dragYRef = useRef(0);
  const startYRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTRef = useRef(0);
  const velRef = useRef(0);
  const heightRef = useRef(0);
  const shownRef = useRef(shown);
  const onDismissRef = useRef(onDismiss);
  const dragRafRef = useRef(0);
  const pendingDragYRef = useRef(0);
  /** 실시간 드래그를 구동하는 입력 — 핸들(pointer 이벤트) 또는 콘텐츠(touch 이벤트). */
  const sourceRef = useRef<"handle" | "content" | null>(null);

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // 시트가 숨겨졌는데 오래된 드래그 오프셋이 남아 있으면 지워서 다음 열기가 깨끗하게 한다.
  useEffect(() => {
    if (shown) return;
    if (dragYRef.current === 0 && !draggingRef.current) return;
    if (draggingRef.current) document.documentElement.removeAttribute("data-gesture");
    draggingRef.current = false;
    dragYRef.current = 0;
    pendingDragYRef.current = 0;
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
    }
    setDragging(false);
    setDragY(0);
  }, [shown]);

  /** 실시간 드래그 단계 — 핸들(pointer)과 콘텐츠(touch) 경로가 공유한다. */
  function follow(y: number, t: number) {
    const dy = y - startYRef.current;
    const clamped = dy > 0 ? dy : 0; // 아래 방향만
    const dt = t - lastTRef.current;
    if (dt > 0) velRef.current = (y - lastYRef.current) / dt;
    lastYRef.current = y;
    lastTRef.current = t;
    dragYRef.current = clamped;
    pendingDragYRef.current = clamped;
    if (!dragRafRef.current) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = 0;
        setDragY(pendingDragYRef.current);
      });
    }
  }

  /** `y` 에서 실시간 드래그를 시작한다 — 스크림 흐림과 거리 임계값을 위해 시트 높이를 캡처한다. */
  function begin(sheet: HTMLElement | null, y: number, t: number, source: "handle" | "content") {
    const h = sheet?.getBoundingClientRect().height ?? 0;
    heightRef.current = h;
    setHeight(h);
    startYRef.current = y;
    lastYRef.current = y;
    lastTRef.current = t;
    velRef.current = 0;
    dragYRef.current = 0;
    pendingDragYRef.current = 0;
    sourceRef.current = source;
    draggingRef.current = true;
    // 끄는 동안은 누름 반응(globals.css 「누름 반응」)을 끈다 — 손가락 아래 줄이 옅어진 채 내려가지 않게.
    document.documentElement.setAttribute("data-gesture", "");
    setDragging(true);
    setDragY(0);
  }

  function release() {
    draggingRef.current = false;
    document.documentElement.removeAttribute("data-gesture");
    sourceRef.current = null;
    setDragging(false);
    const dy = dragYRef.current;
    const threshold = Math.max(DISTANCE_FLOOR, heightRef.current * DISTANCE_RATIO);
    dragYRef.current = 0;
    pendingDragYRef.current = 0;
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
    }
    setDragY(0);
    if (dy >= threshold || velRef.current >= VELOCITY_CLOSE) {
      onDismissRef.current();
    }
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!draggingRef.current || sourceRef.current !== "handle") return;
      e.preventDefault();
      follow(e.clientY, e.timeStamp);
    }
    function onUp() {
      if (!draggingRef.current || sourceRef.current !== "handle") return;
      release();
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
    };
     
  }, []);

  // 콘텐츠 드래그 (iOS 시트): 시트 자체에 붙이는 touch 리스너 — 우리가 가져온
  // 당김이 목록 자체의 스크롤 / 고무줄을 멈출 수 있도록 `touchmove` 는 non-passive 여야 한다. 판정되지 않은 터치는 네이티브 스크롤로 남는다.
  useEffect(() => {
    const sheet = sheetRef?.current;
    if (!sheet) return;
    let candidate = false;
    let startX = 0;
    let startY = 0;
    let scroller: HTMLElement | null = null;

    function scrollerFor(target: Element | null): HTMLElement | null {
      for (let el = target; el && el !== sheet; el = el.parentElement) {
        if (!(el instanceof HTMLElement)) continue;
        const overflowY = getComputedStyle(el).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
      }
      return null;
    }

    function onTouchStart(e: TouchEvent) {
      candidate = false;
      if (!shownRef.current || draggingRef.current || e.touches.length !== 1) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest("[data-sheet-handle]") || target.closest(CONTENT_BLOCKED)) return;
      for (let el: Element | null = target; el && el !== sheet; el = el.parentElement) {
        if (getComputedStyle(el).touchAction === "none") return;
      }
      const active = document.activeElement;
      if (active && sheet!.contains(active) && active.matches("input, textarea, select, [contenteditable='true']")) return;
      candidate = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      scroller = scrollerFor(target);
    }

    function onTouchMove(e: TouchEvent) {
      const touch = e.touches[0];
      if (!touch) return;
      if (draggingRef.current && sourceRef.current === "content") {
        if (e.cancelable) e.preventDefault();
        follow(touch.clientY, e.timeStamp);
        return;
      }
      if (!candidate) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < CONTENT_SLOP && Math.abs(dy) < CONTENT_SLOP) return;
      candidate = false;
      if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) return;
      if (scroller && scroller.scrollTop > 0) return;
      if (e.cancelable) e.preventDefault();
      // 터치 시작 지점이 아니라 여기서부터 시작 — 슬롭 거리만큼 튀지 않는다
      begin(sheet!, touch.clientY, e.timeStamp, "content");
    }

    function onTouchEnd() {
      candidate = false;
      if (draggingRef.current && sourceRef.current === "content") release();
    }

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd);
    sheet.addEventListener("touchcancel", onTouchEnd);
    return () => {
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("touchcancel", onTouchEnd);
    };
     
  }, [sheetRef]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!shownRef.current) return;
    const handle = e.currentTarget as HTMLElement;
    begin(handle.closest("[data-sheet]") as HTMLElement | null, e.clientY, e.timeStamp, "handle");
     
  }, []);

  const dim = height > 0 ? Math.min(1, dragY / height) : 0;

  return {
    /** 손가락이 닿아 드래그하는 동안에만 true. */
    dragging,
    /**
     * 시트 컨테이너의 인라인 스타일 (`data-sheet` 도 붙인다). 드래그 중에만 설정되고
     * 아니면 undefined 여서 시트 자체의 `translate-y-0 / translate-y-full` 클래스가 슬라이드를 구동한다.
     */
    sheetStyle: {
      transform: dragging ? `translateY(${dragY}px)` : undefined,
      transition: dragging ? "none" : undefined,
    } as React.CSSProperties,
    /** 스크림/백드롭의 인라인 스타일 — 드래그에 따라 흐려지고, 아니면 클래스가 구동한다. */
    scrimStyle: {
      opacity: dragging ? 1 - dim * SCRIM_DIM : undefined,
      transition: dragging ? "none" : undefined,
    } as React.CSSProperties,
    /** 그랩 핸들(선택적으로 헤더 블록)에 펼쳐 넣는다. */
    handleProps: {
      "data-sheet-handle": "",
      onPointerDown,
      // 시트는 <body> 로 포털되지만 React 합성 touch 이벤트는 여전히 React
      // 트리를 따라 버블링된다 — 즉 모바일 셸 콘텐츠 div 로 올라가 그곳의 당겨서 새로고침 / 스와이프 내비
      // 핸들러가 시트와 함께 배경 화면을 끌어내릴 수 있다. touch 이벤트는
      // 시작 대상에 묶여 있으므로 여기서 막으면 드래그 제스처 전체가 격리된다.
      onTouchStart: stopTouch,
      onTouchMove: stopTouch,
      onTouchEnd: stopTouch,
      style: { touchAction: "none" as const },
    },
  };
}

function stopTouch(e: React.TouchEvent) {
  e.stopPropagation();
}
