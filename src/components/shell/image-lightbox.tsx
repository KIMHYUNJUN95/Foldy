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
 * 제어형 전체 화면 이미지 뷰어(scroll-snap 캐러셀 + 카운터)로,
 * **핀치 줌**, 더블탭 줌, 확대 중 드래그 이동을 지원한다.
 *
 * 만든 이유: 설치된 standalone PWA 에서 `<a target="_blank">` 로 이미지를 열면
 * 사용자가 별도의 모바일 Safari 탭으로 튕겨 나간다. 이 뷰어는 사진 보기를 **앱 안에서** 하게 한다 —
 * 썸네일을 눌러 열고, 사진 사이를 스와이프하고, 핀치로 확대하고, 더블탭으로 전환하고, 드래그로 이동하고,
 * 닫으면 있던 자리로 정확히 돌아온다. <body> 로 portal 하므로 모바일 셸의 transform 된 스크롤
 * 컨테이너가 `position: fixed` 를 가두지 못한다.
 *
 * 줌은 라이브러리 없이 직접 구현했다: 배율 1에서는 네이티브 scroll-snap 캐러셀이
 * 사진 사이 가로 스와이프를 맡고, 두 손가락 핀치(또는 더블탭)는 활성 사진을 확대하며
 * 캐러셀을 끈다(`touch-action: none` + `overflow: hidden`). 그러면 한 손가락 드래그가 사진 전환 대신 이동이 된다.
 * 배율 1로 돌아오면 스와이프가 다시 켜진다. 줌은 슬라이드 전환/닫기 때 초기화된다.
 *
 * 제어형: 부모가 `openIndex`(보여줄 인덱스, 닫혀 있으면 null)와 `onClose` 를 가진다.
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

  // 열릴 때 / 요청된 인덱스가 바뀔 때, 레일을 해당 슬라이드로 옮기고 줌을 초기화한다.
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

  // 배율 1에서만 닿을 수 있다(줌이면 네이티브 스크롤이 꺼짐). 그래서 활성 슬라이드는 확대된 상태가 아니다.
  const onRailScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const i = Math.max(0, Math.min(urls.length - 1, Math.round(rail.scrollLeft / rail.clientWidth)));
    setActiveIndex((prev) => (i === prev ? prev : i));
  }, [urls.length]);

  // 터치 제스처 처리(핀치 / 이동 / 더블탭)를 non-passive 네이티브 리스너로 붙여서
  // 줌 제스처 중에 preventDefault 를 호출할 수 있게 한다.
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
          // 손가락 하나가 확대된 이미지에 남아 있음 → 이동으로 이어간다
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

      // 더블탭 전환(제스처 중이 아닐 때만).
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
      {/* 상단 글래스 바 — 카운터 + 닫기. */}
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

      {/* scroll-snap 캐러셀. 줌 중에는 네이티브 가로 스크롤이 꺼져 이동이 대신한다. */}
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
                  // 더블탭과 같은 데스크톱 동작.
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

      {/* 이전 / 다음(사진이 여러 장일 때, 포인터 기기) + 점. 확대 중에는 숨김. */}
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
