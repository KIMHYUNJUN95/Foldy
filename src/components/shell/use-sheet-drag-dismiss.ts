"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * iOS-style drag-to-dismiss for the app's bottom sheets — a drag-only primitive.
 *
 * One place owns the drag mechanics so every sheet feels identical, while each sheet keeps its own
 * open/close lifecycle (the `shown ? translate-y-0 : translate-y-full` + `opacity` slide it already
 * has). The hook never owns mounting/visibility — it only:
 *   - follows the finger downward while dragging the grab handle / header (clamped at 0)
 *   - with `sheetRef`: also from the sheet's CONTENT, iOS-style (2026-10-21) — a downward pull that starts
 *     while the content under the finger is scrolled to the top drags the sheet instead of rubber-banding
 *     the list. Not while a text field in the sheet is focused, not on horizontal gestures, not on
 *     `[data-sheet-drag="off"]` / sliders / `touch-action: none` elements (their own gestures).
 *   - on release: calls the sheet's own close (`onDismiss`) if pulled far/fast enough, else snaps back
 *   - dims the scrim in proportion to the drag distance
 *
 * Because the hook leaves transform/opacity to the sheet's className whenever it is NOT dragging,
 * the existing slide-in / slide-out / scrim-fade (and `motion-reduce` opt-out) all stay intact; the
 * hook only sets inline transform/opacity (and disables the transition) for the live drag.
 *
 * Drag mechanics mirror `reorderable-section-list.tsx`: window pointermove/up listeners attached
 * once, live values mirrored into refs so the effect never re-binds and render stays clean
 * (satisfies react-hooks/refs + set-state-in-effect).
 *
 * Usage:
 *   const drag = useSheetDragDismiss({ shown, onDismiss: close });
 *   // scrim:  <div className="... transition-opacity ..." style={drag.scrimStyle} onClick={close}>
 *   // sheet:  <div data-sheet className="... shown ? translate-y-0 : translate-y-full" style={drag.sheetStyle}>
 *   // handle: <div {...drag.handleProps} /> and/or the header block
 */

// Dismiss thresholds (confirmed defaults).
const DISTANCE_RATIO = 0.25; // fraction of sheet height
const DISTANCE_FLOOR = 80; // px — minimum deliberate pull
const VELOCITY_CLOSE = 0.5; // px/ms downward flick
const SCRIM_DIM = 0.5; // scrim fades to (1 - this) at a full-height drag

type Options = {
  /** True while the sheet rests on-screen. The sheet keeps owning its own slide in/out. */
  shown: boolean;
  /** Run the sheet's existing close() — fired when a drag crosses the dismiss threshold. */
  onDismiss: () => void;
  /** The sheet element — enables dragging from the content (see above). */
  sheetRef?: RefObject<HTMLElement | null>;
};

/** Movement before a content touch is read as a scroll or a sheet drag. */
const CONTENT_SLOP = 6;
const CONTENT_BLOCKED = '[data-sheet-drag="off"], [role="slider"], input[type="range"], [data-swipe-back="off"]';

export function useSheetDragDismiss({ shown, onDismiss, sheetRef }: Options) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState(0); // sheet height captured at drag start (for scrim dim)

  // Live mirrors for the window listeners.
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
  /** Which input drives the live drag — the handle (pointer events) or the content (touch events). */
  const sourceRef = useRef<"handle" | "content" | null>(null);

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // If the sheet is hidden while a stale drag offset lingers, clear it so the next open is clean.
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

  /** Live drag step — shared by the handle (pointer) and content (touch) paths. */
  function follow(y: number, t: number) {
    const dy = y - startYRef.current;
    const clamped = dy > 0 ? dy : 0; // downward only
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

  /** Begin a live drag at `y` — the sheet height is captured for the scrim dim and the distance threshold. */
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

  // Content drag (iOS sheets): touch listeners on the sheet itself — `touchmove` must be non-passive so a claimed
  // pull can stop the list's own scroll / rubber band. Undecided touches stay native scrolls.
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
      // Start from here, not from the touch-down point — no jump by the slop distance.
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
    /** True only while the finger is down and dragging. */
    dragging,
    /**
     * Inline style for the sheet container (also tag it with `data-sheet`). Only set while dragging;
     * otherwise undefined so the sheet's own `translate-y-0 / translate-y-full` class drives the slide.
     */
    sheetStyle: {
      transform: dragging ? `translateY(${dragY}px)` : undefined,
      transition: dragging ? "none" : undefined,
    } as React.CSSProperties,
    /** Inline style for the scrim/backdrop — dims with the drag, otherwise class-driven. */
    scrimStyle: {
      opacity: dragging ? 1 - dim * SCRIM_DIM : undefined,
      transition: dragging ? "none" : undefined,
    } as React.CSSProperties,
    /** Spread onto the grab handle (and optionally the header block). */
    handleProps: {
      "data-sheet-handle": "",
      onPointerDown,
      // Sheets portal to <body>, but React synthetic touch events still bubble through the React
      // tree — i.e. up into the mobile shell's content div, whose pull-to-refresh / swipe-nav
      // handlers would otherwise drag the background screen down with the sheet. Touch events stay
      // bound to their start target, so stopping them here isolates the whole drag gesture.
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
