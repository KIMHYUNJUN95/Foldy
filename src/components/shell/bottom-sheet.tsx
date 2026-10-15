"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useSheetDragDismiss } from "@/components/shell/use-sheet-drag-dismiss";

/**
 * BottomSheet — the single canonical bottom sheet for the whole app.
 *
 * Every slide-up sheet (anchored to the bottom of the screen, dimmed scrim behind)
 * must use this so they all look and feel identical:
 *   - portals to <body> (so the mobile shell's pull-to-refresh transform can't trap it)
 *   - slate scrim (`bg-slate-950/45`) that dims as you drag the sheet down
 *   - iOS-style drag-to-dismiss on the grab handle / header (shared `useSheetDragDismiss`)
 *   - rounded-top cream surface, 38px grab handle, 460px max width, 20px safe-area pad
 *   - body scroll lock + Esc-to-close while open
 *   - dismiss via drag past threshold, scrim tap, or Esc — NO top-right X button
 *
 * Mount-driven (matches every existing sheet): the parent conditionally renders the
 * sheet; it plays the slide-in on mount, and on dismiss it plays the slide-out and
 * THEN calls `onClose` (so the parent unmounts only after the exit animation).
 *
 *   {open && <BottomSheet onClose={() => setOpen(false)}>…</BottomSheet>}
 *
 * Programmatic close from inside (Cancel button, post-submit): use the render-prop
 * `children={({ close }) => …}` or `useBottomSheetClose()`. Make any extra element a
 * drag-to-dismiss zone with `useBottomSheetDragHandle()`.
 */

type HandleProps = ReturnType<typeof useSheetDragDismiss>["handleProps"];

/*
 * ── 움직임 — 모든 하단 시트가 같은 곡선 · 같은 길이(2026-10-02 사용자 지시 「물 흐르듯이, 너무 빠르지 않게, 닫을 때도」) ──
 * iOS 시트 곡선(빠르게 출발 → 길게 감속). 여는 쪽이 조금 더 길다 — 닫힘은 손을 뗀 뒤라 기다리게 하지 않는다.
 * 내용이 늦게 와서 시트가 **커지면** 위 끝이 툭 튀지 않고 같은 곡선으로 미끄러져 올라간다(아래 FLIP).
 */
const SHEET_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SHEET_OPEN_MS = 480;
const SHEET_CLOSE_MS = 380;
const SHEET_GROW_MS = 420;

/*
 * ── 바탕 스크롤 잠금 — **참조 수로 센다**(2026-10-02) ──
 * 시트마다 「잠그기 전 값」을 따로 기억했더니, 시트가 겹치거나(하나가 닫히는 동안 다른 하나가 열림) 순서가 엇갈리면
 * 나중에 풀린 시트가 「잠긴 값」을 복원해 **바탕이 영영 안 넘어가는** 일이 생길 수 있었다(사용자 지적 「가격 수정 뒤
 * 캘린더 스크롤 안 됨」). 첫 시트가 잠글 때 한 번 기억하고, 마지막 시트가 풀 때 한 번 되돌린다.
 */
let scrollLockCount = 0;
let scrollLockSaved: {
  scrollY: number;
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  bodyTouchAction: string;
  htmlOverflow: string;
  htmlOverscroll: string;
} | null = null;

function lockBodyScroll() {
  scrollLockCount += 1;
  if (scrollLockCount > 1) return;
  const body = document.body.style;
  const html = document.documentElement.style;
  scrollLockSaved = {
    bodyOverflow: body.overflow,
    bodyPosition: body.position,
    bodyTop: body.top,
    bodyTouchAction: body.touchAction,
    bodyWidth: body.width,
    htmlOverflow: html.overflow,
    htmlOverscroll: html.overscrollBehavior,
    scrollY: window.scrollY,
  };
  body.overflow = "hidden";
  body.position = "fixed";
  body.top = `-${scrollLockSaved.scrollY}px`;
  body.width = "100%";
  body.touchAction = "none";
  html.overflow = "hidden";
  html.overscrollBehavior = "none";
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount > 0 || !scrollLockSaved) return;
  const saved = scrollLockSaved;
  scrollLockSaved = null;
  const body = document.body.style;
  const html = document.documentElement.style;
  body.overflow = saved.bodyOverflow;
  body.position = saved.bodyPosition;
  body.top = saved.bodyTop;
  body.width = saved.bodyWidth;
  body.touchAction = saved.bodyTouchAction;
  html.overflow = saved.htmlOverflow;
  html.overscrollBehavior = saved.htmlOverscroll;
  window.scrollTo(0, saved.scrollY);
}

const BottomSheetDragContext = createContext<HandleProps>({} as HandleProps);
const BottomSheetCloseContext = createContext<() => void>(() => {});

/** Spread onto any element inside a BottomSheet to make it a drag-to-dismiss zone. */
export function useBottomSheetDragHandle() {
  return useContext(BottomSheetDragContext);
}
/** Animate the enclosing BottomSheet closed (slide-out, then the parent's onClose). */
export function useBottomSheetClose() {
  return useContext(BottomSheetCloseContext);
}

type BottomSheetProps = {
  /** Fired AFTER the slide-out completes — the parent should unmount the sheet here. */
  onClose: () => void;
  children:
    | ReactNode
    | ((api: { close: () => void; dragHandleProps: HandleProps }) => ReactNode);
  /** Optional title/header row rendered under the handle; it becomes a drag zone. */
  header?: ReactNode;
  /** Extra classes for the sheet container (e.g. `max-h-[82dvh] flex flex-col`). */
  className?: string;
  /** Scrim/sheet z-index. Default `z-[80]`; raise when stacking over another sheet. */
  zIndexClassName?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /**
   * 태블릿 가로(`tablet:`)에서의 모양. 기본은 가운데 카드(2026-10-05). `"bottom"` 이면 태블릿에서도 바닥에서
   * 올라오는 시트(폭 560) — 약관 보기 · 출근 QR 결과처럼 사용자가 정한 예외(2026-10-09, 16번 「BottomSheet — 넓은 화면」).
   */
  tabletLayout?: "card" | "bottom";
};

export function BottomSheet({
  onClose,
  children,
  header,
  className,
  zIndexClassName = "z-[80]",
  ariaLabel,
  ariaLabelledBy,
  tabletLayout = "card",
}: BottomSheetProps) {
  const tabletCard = tabletLayout === "card";
  const [shown, setShown] = useState(false);

  // `onClose` 는 보통 인라인 화살표라 렌더마다 새 함수다. 그걸 의존으로 두면 `close` 가 렌더마다 바뀌고, 아래
  // 잠금 효과가 **렌더마다 풀었다 다시 잠갔다**(body 고정 해제 → 재고정 · scrollTo — 버벅임, 2026-10-02). `close` 는
  // 상태만 바꾸는 고정 함수로 두고, 미끄러져 나간 뒤 부르는 onClose 는 효과에서 최신 값을 읽는다. 두 번 눌러도 한 번만
  // 닫히고, 닫히는 도중 부모가 이 시트를 내리면(다른 시트로 바꿈) 타이머가 함께 취소돼 새 시트를 닫지 않는다.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    setClosing(true);
    setShown(false);
  }, []);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => onCloseRef.current(), SHEET_CLOSE_MS); // matches the slide-out transition
    return () => clearTimeout(timer);
  }, [closing]);

  const drag = useSheetDragDismiss({ shown, onDismiss: close });

  // 스크림 탭으로 닫으려면 **포인터가 스크림 위에서 눌렸어야** 한다.
  //
  // 시트는 <body> 로 포털되어 화면 전체를 덮는다. 모바일에서 한 번의 탭은
  // pointerdown → pointerup → click 순으로 오는데, 그 사이에 시트가 마운트되면
  // 뒤따라오는 click 이 방금 생긴 스크림 위에 떨어진다. 시트를 연 그 탭이 곧바로
  // 시트를 닫아버려서 "잠깐 떴다 사라지는" 것처럼 보인다(2026-07-31, 근태 결과 시트).
  // 시트가 열리기 전에 눌린 탭에는 스크림 pointerdown 이 없으므로 이 가드로 걸러진다.
  const scrimArmedRef = useRef(false);

  /*
   * 내용이 커지면(불러오는 중 → 다 받음) 시트 위 끝이 한 번에 튀어 오른다. 커진 만큼 아래로 내린 자리에서 0 으로
   * 미끄러뜨린다(FLIP — `translate` 속성만 움직여 합성기에서 돈다. 끌기 · 열고 닫기의 `transform` 과 따로 논다).
   * 작아질 때는 그대로 둔다 — 같은 방법이면 시트가 바닥에서 떠서 아래로 스크림이 비친다.
   */
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || typeof ResizeObserver === "undefined" || typeof sheet.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let last = sheet.offsetHeight;
    let grow: Animation | null = null;
    const observer = new ResizeObserver(() => {
      const next = sheet.offsetHeight;
      const delta = next - last;
      last = next;
      if (delta <= 2) return;
      // 미끄러지는 도중에 또 커지면 남은 거리에 더한다(멈칫하지 않게).
      let carry = 0;
      if (grow && grow.playState === "running") {
        carry = Number.parseFloat(getComputedStyle(sheet).translate.split(" ")[1] ?? "0") || 0;
        grow.cancel();
      }
      grow = sheet.animate([{ translate: `0 ${delta + carry}px` }, { translate: "0 0" }], {
        duration: SHEET_GROW_MS,
        easing: SHEET_EASE,
      });
    });
    observer.observe(sheet);
    return () => {
      observer.disconnect();
      grow?.cancel();
    };
  }, []);

  // Slide in on mount (double rAF so the initial translate-y-full paints first).
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  /*
   * ── 키보드(2026-10-02 사용자 지시 「기기 키보드 그대로, 네이티브처럼」) ──
   * 키보드가 가린 만큼은 바닥 여백(`--keyboard-inset`, `KeyboardInsetSync`)이 이미 시트 **안쪽**에서 받는다 — 최대 높이는
   * 그대로라 내용 칸이 그만큼 줄어든다. 여기서는 입력칸에 들어가면 키보드가 다 올라온 뒤 그 칸이 시트 안에서 보이게
   * 한 번 끌어온다(맨 아래 메모 칸이 키보드 밑에 숨던 것).
   */
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocusIn = (event: FocusEvent) => {
      const field = event.target as HTMLElement | null;
      if (!field?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => field.scrollIntoView({ block: "nearest", behavior: "smooth" }), 320);
    };
    sheet.addEventListener("focusin", onFocusIn);
    return () => {
      if (timer) clearTimeout(timer);
      sheet.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  // Body scroll lock + Esc-to-close while mounted.
  useEffect(() => {
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlockBodyScroll();
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <BottomSheetCloseContext.Provider value={close}>
      <BottomSheetDragContext.Provider value={drag.handleProps}>
        <div
          className={cn(
            "fixed inset-0 flex items-end justify-center bg-slate-950/45 motion-reduce:transition-none!",
            // 태블릿 가로(`tablet:`) — 바닥에 붙지 않고 **가운데 카드**(아이패드 양식 시트, 2026-10-05 시안 7c).
            tabletCard && "tablet:items-center tablet:p-6",
            zIndexClassName,
            shown ? "opacity-100" : "opacity-0",
          )}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            if (!scrimArmedRef.current) return;
            scrimArmedRef.current = false;
            close();
          }}
          onPointerDown={(e) => {
            scrimArmedRef.current = e.target === e.currentTarget;
            // 포털이어도 React 포인터 이벤트는 React 트리를 따라 셸까지 올라간다 — PC 「모바일 보기」의 마우스 당겨서 새로고침이
            // 시트를 끌어내리는 손짓을 새로고침으로도 읽던 것(2026-10-15 사용자 지적). 시트 안 손짓은 셸로 넘기지 않는다.
            // **누름(pointerdown)만** 막는다 — 셸은 누름에서만 끌기를 시작하니 이것으로 충분하다. move/up 까지 막으면 React 의
            // stopPropagation 이 실제 이벤트도 멈춰 window 에서 듣는 시트 끌어내리기(useSheetDragDismiss)가 죽는다(같은 날 확인).
            e.stopPropagation();
          }}
          style={{
            ...drag.scrimStyle,
            transition: drag.dragging
              ? "none"
              : `opacity ${shown ? SHEET_OPEN_MS : SHEET_CLOSE_MS}ms ${SHEET_EASE}`,
          }}
        >
          <div
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-modal="true"
            className={cn(
              "w-full max-w-[460px] rounded-t-[24px] bg-surface px-5 pb-[calc(max(20px,env(safe-area-inset-bottom))+var(--keyboard-inset,0px))] pt-0",
              "motion-reduce:transition-none!",
              // 키 낮은 화면(가로 모드) — 더 넓고 더 높게. 폭 460px · 높이 88% 로는 가로에서 내용이 몇 줄밖에 안 보였다(2026-10-02).
              "[@media(max-height:560px)]:max-w-[600px] [@media(max-height:560px)]:max-h-[94dvh]",
              // 넓은 화면 — 폭 560 가운데(펼친 폴드 · 태블릿 세로는 바닥에서, 태블릿 가로는 가운데 카드로).
              "fold:max-w-[560px]",
              tabletCard && "tablet:max-h-[86dvh] tablet:rounded-[24px] tablet:pb-5 tablet:shadow-[0_30px_80px_-30px_rgba(2,6,23,0.6)]",
              // 가운데 카드는 아래에서 조금만 올라오며 나타난다(바닥 시트처럼 화면 밖에서 오면 거리가 너무 길다).
              shown ? "translate-y-0" : tabletCard ? "translate-y-full tablet:translate-y-10" : "translate-y-full",
              className,
            )}
            data-sheet
            onClick={(e) => e.stopPropagation()}
            // Sheets portal to <body>, but React synthetic touch events still bubble through the
            // React tree into the mobile shell's content div, whose pull-to-refresh / swipe-nav
            // handlers would otherwise scroll/drag the background when the user touches a
            // non-handle area of the sheet (gutter, padding, the gap above the scroll region).
            // Isolating touchmove here keeps the background frozen while a sheet is open; the
            // sheet's own scroll regions still scroll natively (stopPropagation ≠ preventDefault).
            onTouchMove={(e) => e.stopPropagation()}
            ref={sheetRef}
            role="dialog"
            style={{
              ...drag.sheetStyle,
              // **`translate` 도 함께 전환한다**(2026-10-05). 열고 닫는 `translate-y-full` / `translate-y-0` 은 Tailwind v4 에서
              // `transform` 이 아니라 **`translate` 속성**으로 나온다 — 전에는 `transform` 만 전환해서 시트가 미끄러지지 않고
              // 툭 나타났다 툭 사라졌다(스크림만 서서히). `transform` 은 끌기(`drag.sheetStyle`)가 쓴다.
              transition: drag.dragging
                ? "none"
                : `transform ${shown ? SHEET_OPEN_MS : SHEET_CLOSE_MS}ms ${SHEET_EASE}, translate ${shown ? SHEET_OPEN_MS : SHEET_CLOSE_MS}ms ${SHEET_EASE}`,
              willChange: "transform, translate",
            }}
          >
            <div
              className="-mx-5 flex min-h-[44px] cursor-grab items-start justify-center px-5 pt-[10px] active:cursor-grabbing"
              {...drag.handleProps}
            >
              <div className="h-1 w-[38px] rounded-full bg-slate-200" />
            </div>
            {header != null ? <div {...drag.handleProps}>{header}</div> : null}
            {typeof children === "function"
              ? children({ close, dragHandleProps: drag.handleProps })
              : children}
          </div>
        </div>
      </BottomSheetDragContext.Provider>
    </BottomSheetCloseContext.Provider>,
    document.body,
  );
}
