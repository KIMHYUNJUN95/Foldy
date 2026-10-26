"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useBodyScrollLock } from "@/components/shell/use-body-scroll-lock";
import { cn } from "@/lib/utils";

/**
 * 할 일 / 업데이트 로그 사진용 첨부 갤러리.
 *
 * 흐름(요청대로): 작은 **인라인 썸네일** 몇 장 → 탭하면 모든 첨부를 나열하는 **바텀 시트**가 열리고
 * → 사진을 탭하면 **전체 화면 스와이프 라이트박스**(scroll-snap 캐러셀 +
 * 실시간 카운터)가 열린다. 앱 콘셉트에 맞춰 — 아이보리/흰 면, 딥 잉크 네이비 강조, 어두운 라이트박스 오버레이에는 선택적으로
 * Liquid Glass 크롬을 쓴다. 두 오버레이 모두 <body> 로 포털되어 모바일
 * 셸의 transform 이 걸린 스크롤 컨테이너가 `position: fixed` 를 가두지 못한다.
 *
 * 목록은 공용 `BottomSheet` 다(2026-10-19 — 손으로 만든 시트를 공용으로: 태블릿 가운데 카드 · 끌어 닫기 ·
 * 바탕 잠금이 다른 시트와 같다). 라이트박스는 시트가 아니라 전체 화면 오버레이라서 여기에 그대로 둔다.
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

  // 마운트 / 인덱스 변경 후 라이트박스 레일을 활성 슬라이드로 스크롤 (열 때는 부드러운 점프 없음).
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
      {/* 인라인 썸네일 — 아무거나 탭하면 시트가 열린다. */}
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

      {/* 전체 화면 스와이프 라이트박스. */}
      {lightbox !== null && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[95] flex flex-col bg-slate-950/95 backdrop-blur-sm"
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
                  onClick={closeLightbox}
                  type="button"
                >
                  <X className="size-[18px]" aria-hidden="true" />
                </button>
              </div>

              {/* Scroll-snap 캐러셀. */}
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

              {/* 이전 / 다음 (여러 장일 때) — 큰 탭 영역, 양 끝에서는 숨김. */}
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

                  {/* 점. */}
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
