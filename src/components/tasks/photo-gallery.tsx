"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useBodyScrollLock } from "@/components/shell/use-body-scroll-lock";
import { cn } from "@/lib/utils";

/**
 * Attachment gallery for task / update-log photos.
 *
 * Flow (as requested): a few **tiny inline thumbnails** → tap opens a **bottom sheet** listing every
 * attachment → tap a photo opens a **full-screen, swipeable lightbox** (scroll-snap carousel with a
 * live counter). Matches the app concept — ivory/white surfaces, deep-ink-navy accent, and selective
 * Liquid-Glass chrome on the dark lightbox overlay. Both overlays portal to <body> so the mobile
 * shell's transformed scroll container can't trap their `position: fixed`.
 *
 * The list is the shared `BottomSheet`(2026-10-19 — 손으로 만든 시트를 공용으로: 태블릿 가운데 카드 · 끌어 닫기 ·
 * 바탕 잠금이 다른 시트와 같다). The lightbox is a full-screen overlay, not a sheet, so it stays here.
 */
export function PhotoGallery({
  urls,
  size = "sm",
  title,
  closeLabel,
}: {
  urls: string[];
  size?: "sm" | "md";
  /** Bottom-sheet title, e.g. "첨부 사진". */
  title: string;
  closeLabel: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const openLightbox = useCallback((index: number) => {
    setActiveIndex(index);
    setLightbox(index);
  }, []);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  // 시트의 바탕 잠금은 BottomSheet 가 한다. 라이트박스만 따로 잠근다.
  useBodyScrollLock(lightbox !== null);

  // Esc 는 맨 위 겹만 닫는다 — 라이트박스가 열려 있으면 라이트박스만. BottomSheet 도 window 에서 Esc 를 듣기 때문에
  // 캡처 단계에서 먼저 받아 멈춘다(안 그러면 Esc 한 번에 라이트박스와 시트가 함께 닫힌다).
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.stopPropagation();
      closeLightbox();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [lightbox, closeLightbox]);

  // After mount / index change, scroll the lightbox rail to the active slide (no smooth jump on open).
  useEffect(() => {
    if (lightbox === null) return;
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollTo({ left: lightbox * rail.clientWidth, behavior: "auto" });
    setActiveIndex(lightbox);
  }, [lightbox]);

  if (urls.length === 0) return null;

  const thumb = size === "md" ? "size-14" : "size-11";
  const MAX_THUMBS = 4;
  const shown = urls.slice(0, MAX_THUMBS);
  const overflow = urls.length - shown.length;

  const goTo = (index: number) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollTo({ left: index * rail.clientWidth, behavior: "smooth" });
  };

  const onRailScroll = () => {
    const rail = railRef.current;
    if (!rail) return;
    const i = Math.round(rail.scrollLeft / rail.clientWidth);
    if (i !== activeIndex) setActiveIndex(Math.max(0, Math.min(urls.length - 1, i)));
  };

  return (
    <>
      {/* Inline thumbnails — tap any to open the sheet. */}
      <button
        aria-label={title}
        className="mt-2 flex items-center gap-1.5"
        onClick={() => setSheetOpen(true)}
        type="button"
      >
        {shown.map((url, i) => (
          <span
            className={cn(
              "relative shrink-0 overflow-hidden rounded-[10px] border border-border bg-muted/40 shadow-[0_1px_3px_rgba(20,32,43,0.06)]",
              thumb,
            )}
            key={i}
          >
            <Image alt="" aria-hidden="true" className="object-cover" fill sizes="72px" src={url} />
            {overflow > 0 && i === MAX_THUMBS - 1 ? (
              <span className="absolute inset-0 flex items-center justify-center bg-slate-950/55 text-[13px] font-extrabold text-white backdrop-blur-[1px]">
                +{overflow}
              </span>
            ) : null}
          </span>
        ))}
      </button>

      {/* Bottom sheet — full attachment list(공용 BottomSheet). */}
      {sheetOpen ? (
        <BottomSheet
          ariaLabel={title}
          header={
            <div className="mb-3 flex items-center gap-2">
              <p className="text-[16px] font-black text-foreground">{title}</p>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                {urls.length}
              </span>
            </div>
          }
          onClose={() => setSheetOpen(false)}
        >
          <div className="-mx-1 grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {urls.map((url, i) => (
              <button
                className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted/30 transition-transform active:scale-[0.97]"
                key={i}
                onClick={() => openLightbox(i)}
                type="button"
              >
                <Image
                  alt=""
                  aria-hidden="true"
                  className="object-cover transition-transform duration-300 group-active:scale-105"
                  fill
                  sizes="33vw"
                  src={url}
                />
                <span className="absolute bottom-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-slate-950/55 text-[10px] font-bold text-white backdrop-blur-[2px]">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </BottomSheet>
      ) : null}

      {/* Full-screen swipeable lightbox. */}
      {lightbox !== null && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[95] flex flex-col bg-slate-950/95 backdrop-blur-sm"
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
                  onClick={closeLightbox}
                  type="button"
                >
                  <X className="size-[18px]" aria-hidden="true" />
                </button>
              </div>

              {/* Scroll-snap carousel. */}
              <div
                className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                onScroll={onRailScroll}
                ref={railRef}
              >
                {urls.map((url, i) => (
                  <div
                    className="flex h-full w-full shrink-0 snap-center items-center justify-center px-3"
                    key={i}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      className="max-h-full max-w-full select-none rounded-lg object-contain shadow-[0_24px_70px_-20px_rgba(0,0,0,0.7)]"
                      draggable={false}
                      src={url}
                    />
                  </div>
                ))}
              </div>

              {/* Prev / next (multi-photo) — large tap targets, hidden at the ends. */}
              {urls.length > 1 ? (
                <>
                  {activeIndex > 0 ? (
                    <button
                      aria-label="←"
                      className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md ring-1 ring-inset ring-white/15 transition-colors active:bg-white/20 sm:flex"
                      onClick={() => goTo(activeIndex - 1)}
                      type="button"
                    >
                      <ChevronLeft className="size-5" aria-hidden="true" />
                    </button>
                  ) : null}
                  {activeIndex < urls.length - 1 ? (
                    <button
                      aria-label="→"
                      className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md ring-1 ring-inset ring-white/15 transition-colors active:bg-white/20 sm:flex"
                      onClick={() => goTo(activeIndex + 1)}
                      type="button"
                    >
                      <ChevronRight className="size-5" aria-hidden="true" />
                    </button>
                  ) : null}

                  {/* Dots. */}
                  <div className="flex items-center justify-center gap-1.5 pb-[max(18px,env(safe-area-inset-bottom))] pt-3">
                    {urls.map((_, i) => (
                      <button
                        aria-label={`${i + 1}`}
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
          )
        : null}
    </>
  );
}
