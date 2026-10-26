"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { isTopOverlay, pushOverlay } from "@/components/shell/bottom-sheet";
import { useBodyScrollLock } from "@/components/shell/use-body-scroll-lock";
import { getDictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Controlled full-screen, swipeable image viewer (scroll-snap carousel + counter) with
 * **pinch-to-zoom**, double-tap zoom, and drag-to-pan while zoomed.
 *
 * Why this exists: in an installed standalone PWA, opening an image via `<a target="_blank">`
 * ejects the user into a separate mobile-Safari tab. This keeps photo viewing **inside the app** —
 * tap a thumbnail to open, swipe between photos, pinch to zoom, double-tap to toggle, drag to pan,
 * close to return exactly where you were. Portals to <body> so the mobile shell's transformed scroll
 * container can't trap its `position: fixed`.
 *
 * Zoom is implemented directly (no library): while at scale 1 the native scroll-snap carousel handles
 * horizontal swiping between photos; a two-finger pinch (or double-tap) zooms the ACTIVE photo and
 * disables the carousel (`touch-action: none` + `overflow: hidden`) so a one-finger drag pans instead
 * of switching photos. Releasing back to scale 1 re-enables swiping. Zoom resets on slide change/close.
 *
 * Controlled: parent owns `openIndex` (the index to show, or null when closed) and `onClose`.
 */
const MAX_SCALE = 4;

type Transform = { scale: number; tx: number; ty: number };
const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };

export function ImageLightbox({
  urls,
  openIndex,
  onClose,
  closeLabel,
}: {
  urls: string[];
  openIndex: number | null;
  onClose: () => void;
  closeLabel: string;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [smooth, setSmooth] = useState(true);
  const open = openIndex !== null;

  const tRef = useRef(transform);
  const applyTransform = useCallback((next: Transform) => {
    tRef.current = next;
    setTransform(next);
  }, []);
  const resetZoom = useCallback(
    (animate = true) => {
      setSmooth(animate);
      applyTransform(IDENTITY);
    },
    [applyTransform],
  );

  const zoomed = transform.scale > 1.01;

  useBodyScrollLock(open);

  // 이전 · 다음 · 점 버튼 읽기 이름(2026-10-26 — 전엔 「←」 「→」 「1」 그대로 읽혔다). 관리자 · 모바일 모두 루트 SessionProvider 안이다.
  const { session } = useSession();
  const copy = getDictionary(session?.user.preferredLanguage ?? "ko").common;

  // Esc closes — 맨 위 오버레이일 때만(시트 안에서 연 뷰어면 뷰어만 닫히고 시트는 남는다). 오버레이 쌓임은 BottomSheet 와 공용.
  useEffect(() => {
    if (!open) return;
    const id = Symbol("lightbox");
    const release = pushOverlay(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopOverlay(id)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      release();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // On open / requested index change, jump the rail to the slide and reset any zoom.
  useEffect(() => {
    if (openIndex === null) return;
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollTo({ left: openIndex * rail.clientWidth, behavior: "auto" });
    setActiveIndex(openIndex);
    resetZoom(false);
  }, [openIndex, resetZoom]);

  const goTo = (index: number) => {
    const rail = railRef.current;
    if (!rail) return;
    resetZoom(false);
    rail.scrollTo({ left: index * rail.clientWidth, behavior: "smooth" });
  };

  // Only reachable at scale 1 (zoom disables native scroll), so the active slide is never zoomed.
  const onRailScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const i = Math.max(0, Math.min(urls.length - 1, Math.round(rail.scrollLeft / rail.clientWidth)));
    setActiveIndex((prev) => (i === prev ? prev : i));
  }, [urls.length]);

  // Touch gesture handling (pinch / pan / double-tap) attached as non-passive native listeners so
  // we can preventDefault during a zoom gesture.
  const gesture = useRef({
    mode: "none" as "none" | "pinch" | "pan",
    startDist: 0,
    startContent: { x: 0, y: 0 },
    startT: IDENTITY,
    panStart: { x: 0, y: 0, tx: 0, ty: 0 },
    lastTap: null as { time: number; x: number; y: number } | null,
  });

  useEffect(() => {
    if (!open) return;
    const rail = railRef.current;
    if (!rail) return;

    const dist = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a: Touch, b: Touch) => ({
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    });
    const center = () => {
      const r = rail.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
    };
    const clampT = (tx: number, ty: number, scale: number, w: number, h: number) => {
      const maxX = (Math.max(scale, 1) - 1) * w * 0.5;
      const maxY = (Math.max(scale, 1) - 1) * h * 0.5;
      return {
        tx: Math.max(-maxX, Math.min(maxX, tx)),
        ty: Math.max(-maxY, Math.min(maxY, ty)),
      };
    };

    const onStart = (e: TouchEvent) => {
      const g = gesture.current;
      if (e.touches.length === 2) {
        const { cx, cy } = center();
        g.mode = "pinch";
        g.startDist = dist(e.touches[0], e.touches[1]);
        g.startT = tRef.current;
        const m = mid(e.touches[0], e.touches[1]);
        g.startContent = {
          x: (m.x - cx - g.startT.tx) / g.startT.scale,
          y: (m.y - cy - g.startT.ty) / g.startT.scale,
        };
        setSmooth(false);
        e.preventDefault();
      } else if (e.touches.length === 1 && tRef.current.scale > 1.01) {
        g.mode = "pan";
        g.panStart = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          tx: tRef.current.tx,
          ty: tRef.current.ty,
        };
        setSmooth(false);
        e.preventDefault();
      } else {
        g.mode = "none";
      }
    };

    const onMove = (e: TouchEvent) => {
      const g = gesture.current;
      const { cx, cy, w, h } = center();
      if (g.mode === "pinch" && e.touches.length === 2) {
        const d = dist(e.touches[0], e.touches[1]);
        const m = mid(e.touches[0], e.touches[1]);
        const scale = Math.max(1, Math.min(MAX_SCALE, (g.startT.scale * d) / g.startDist));
        const raw = {
          tx: m.x - cx - g.startContent.x * scale,
          ty: m.y - cy - g.startContent.y * scale,
        };
        const c = clampT(raw.tx, raw.ty, scale, w, h);
        applyTransform({ scale, tx: c.tx, ty: c.ty });
        e.preventDefault();
      } else if (g.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        const c = clampT(
          g.panStart.tx + (t.clientX - g.panStart.x),
          g.panStart.ty + (t.clientY - g.panStart.y),
          tRef.current.scale,
          w,
          h,
        );
        applyTransform({ scale: tRef.current.scale, tx: c.tx, ty: c.ty });
        e.preventDefault();
      }
    };

    const onEnd = (e: TouchEvent) => {
      const g = gesture.current;

      if (g.mode === "pinch") {
        setSmooth(true);
        if (tRef.current.scale <= 1.02) {
          applyTransform(IDENTITY);
          g.mode = "none";
        } else if (e.touches.length === 1) {
          // one finger remains on a still-zoomed image → continue as a pan
          g.mode = "pan";
          g.panStart = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            tx: tRef.current.tx,
            ty: tRef.current.ty,
          };
        } else {
          g.mode = "none";
        }
        return;
      }

      if (g.mode === "pan") {
        if (e.touches.length === 0) g.mode = "none";
        return;
      }

      // Double-tap toggle (only when not mid-gesture).
      if (e.changedTouches.length === 1 && e.touches.length === 0) {
        const t = e.changedTouches[0];
        const now = Date.now();
        const last = g.lastTap;
        if (
          last &&
          now - last.time < 300 &&
          Math.abs(t.clientX - last.x) < 30 &&
          Math.abs(t.clientY - last.y) < 30
        ) {
          setSmooth(true);
          if (tRef.current.scale > 1.01) {
            applyTransform(IDENTITY);
          } else {
            const { cx, cy, w, h } = center();
            const scale = 2.5;
            const c = clampT(
              -(t.clientX - cx) * (scale - 1),
              -(t.clientY - cy) * (scale - 1),
              scale,
              w,
              h,
            );
            applyTransform({ scale, tx: c.tx, ty: c.ty });
          }
          g.lastTap = null;
        } else {
          g.lastTap = { time: now, x: t.clientX, y: t.clientY };
        }
      }
    };

    rail.addEventListener("touchstart", onStart, { passive: false });
    rail.addEventListener("touchmove", onMove, { passive: false });
    rail.addEventListener("touchend", onEnd, { passive: false });
    rail.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      rail.removeEventListener("touchstart", onStart);
      rail.removeEventListener("touchmove", onMove);
      rail.removeEventListener("touchend", onEnd);
      rail.removeEventListener("touchcancel", onEnd);
    };
  }, [open, applyTransform]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-label={copy.lightboxDialog}
      aria-modal="true"
      className="fixed inset-0 z-[95] flex flex-col bg-slate-950/95 backdrop-blur-sm"
      // 앱(Android) 뒤로가기 버튼이 먼저 이 뷰어를 닫게 하는 표식 — NativeShellBridge.
      data-native-back-overlay=""
      role="dialog"
      style={{ animation: "modal-overlay-in 200ms ease-out both" }}
    >
      {/* Top glass bar — counter + close. */}
      <div className="flex items-center justify-between px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))]">
        <span className="rounded-full bg-white/12 px-3 py-1 text-[12.5px] font-bold tabular-nums text-white/90 backdrop-blur-md ring-1 ring-inset ring-white/15">
          {activeIndex + 1} / {urls.length}
        </span>
        <button
          aria-label={closeLabel}
          className="flex size-9 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur-md ring-1 ring-inset ring-white/15 transition-colors active:bg-white/20"
          onClick={onClose}
          type="button"
        >
          <X className="size-[18px]" aria-hidden="true" />
        </button>
      </div>

      {/* Scroll-snap carousel. Zooming disables native horizontal scroll so panning takes over. */}
      <div
        className={cn(
          "flex flex-1 overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          zoomed ? "overflow-x-hidden" : "snap-x snap-mandatory overflow-x-auto",
        )}
        style={{ touchAction: zoomed ? "none" : "pan-x" }}
        onScroll={onRailScroll}
        ref={railRef}
      >
        {urls.map((url, i) => {
          const isActive = i === activeIndex;
          const t = isActive ? transform : IDENTITY;
          return (
            <div
              className="flex h-full w-full shrink-0 snap-center items-center justify-center overflow-hidden px-3"
              key={i}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="max-h-full max-w-full select-none rounded-lg object-contain shadow-[0_24px_70px_-20px_rgba(0,0,0,0.7)]"
                draggable={false}
                onDoubleClick={() => {
                  // Desktop parity for double-tap.
                  setSmooth(true);
                  if (isActive && transform.scale > 1.01) applyTransform(IDENTITY);
                  else if (isActive) applyTransform({ scale: 2.5, tx: 0, ty: 0 });
                }}
                src={url}
                style={{
                  transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`,
                  transformOrigin: "center center",
                  transition: smooth ? "transform 0.18s ease-out" : "none",
                  willChange: "transform",
                  cursor: isActive && zoomed ? "grab" : "auto",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Prev / next (multi-photo, pointer devices) + dots. Hidden while zoomed. */}
      {urls.length > 1 && !zoomed ? (
        <>
          {activeIndex > 0 ? (
            <button
              aria-label={copy.lightboxPrev}
              className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md ring-1 ring-inset ring-white/15 transition-colors active:bg-white/20 sm:flex"
              onClick={() => goTo(activeIndex - 1)}
              type="button"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          {activeIndex < urls.length - 1 ? (
            <button
              aria-label={copy.lightboxNext}
              className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md ring-1 ring-inset ring-white/15 transition-colors active:bg-white/20 sm:flex"
              onClick={() => goTo(activeIndex + 1)}
              type="button"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          ) : null}

          <div className="flex items-center justify-center gap-1.5 pb-[max(18px,env(safe-area-inset-bottom))] pt-3">
            {urls.map((_, i) => (
              <button
                aria-current={i === activeIndex ? "true" : undefined}
                aria-label={copy.lightboxGoTo.replace("{index}", String(i + 1)).replace("{total}", String(urls.length))}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === activeIndex ? "w-5 bg-white" : "w-1.5 bg-white/35",
                )}
                key={i}
                onClick={() => goTo(i)}
                type="button"
              />
            ))}
          </div>
        </>
      ) : (
        <div className="pb-[max(18px,env(safe-area-inset-bottom))]" />
      )}
    </div>,
    document.body,
  );
}
