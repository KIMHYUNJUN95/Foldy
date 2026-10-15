"use client";

import { useRef, useState } from "react";
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { useBottomSheetClose } from "@/components/shell/bottom-sheet";
import { MAX_BOTTOM_NAV_TABS, getNavigationTabLabel, type NavigationItem } from "@/config/navigation";
import { haptic } from "@/lib/haptics";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import "@/components/shell/mobile-menu.css";

/**
 * 하단 탭 편집 시트의 본문 — 화이트 리디자인(2026-10-15, 시안 TabEdit-Phone).
 *
 * 위: 지금 탭(옅은 보라 판) — 끌어서 순서를 바꾸고, 흰 「−」 로 뺀다(줄어들며 사라짐). 마지막 하나는 뺄 수 없다.
 * 아래: 더할 수 있는 기능 — 누르면 탭 끝에 들어간다(톡 튀어나옴). 4개가 차면 흐려지고 안내가 바뀐다.
 * 저장은 예전 그대로 — 시트가 닫힐 때(「완료」 · 끌어내림 · 바깥 탭 · Esc) 바뀐 게 있으면 셸이 `profiles.bottom_nav_tabs` 에 쓴다.
 */

const LEAVE_MS = 180;
const DRAG_SLOP = 6;

export function TabEditor({
  candidates,
  ids,
  labels,
  locale,
  setIds,
}: {
  /** 하단 탭 후보 전체(권한으로 거른 것). */
  candidates: NavigationItem[];
  ids: string[];
  labels: { addable: string; done: string; full: string; remove: string };
  locale: Locale;
  setIds: Dispatch<SetStateAction<string[]>>;
}) {
  const close = useBottomSheetClose();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [popId, setPopId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; startIndex: number; colW: number } | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startIndex: number; moved: boolean } | null>(null);

  const byId = new Map(candidates.map((item) => [item.id, item]));
  const current = ids.map((id) => byId.get(id)).filter((item): item is NavigationItem => Boolean(item));
  const addable = candidates.filter((item) => !ids.includes(item.id));
  const isFull = ids.length >= MAX_BOTTOM_NAV_TABS;

  function remove(id: string) {
    if (leaving || ids.length <= 1) return;
    haptic("light");
    setLeaving(id);
    window.setTimeout(() => {
      setIds((prev) => {
        const next = prev.filter((x) => x !== id);
        return next.length > 0 ? next : prev;
      });
      setPopId(id);
      setLeaving(null);
    }, LEAVE_MS);
  }

  function add(id: string) {
    if (isFull) return;
    haptic("light");
    setIds((prev) => (prev.includes(id) || prev.length >= MAX_BOTTOM_NAV_TABS ? prev : [...prev, id]));
    setPopId(id);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>, id: string, index: number) {
    if (current.length < 2 || leaving) return;
    dragRef.current = { id, moved: false, startIndex: index, startX: e.clientX };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    const row = rowRef.current;
    if (!d || !row) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
    d.moved = true;
    const colW = row.clientWidth / MAX_BOTTOM_NAV_TABS;
    const target = Math.max(0, Math.min(ids.length - 1, d.startIndex + Math.round(dx / colW)));
    if (ids[target] !== d.id) {
      haptic("light");
      setIds((prev) => {
        const next = prev.filter((x) => x !== d.id);
        next.splice(target, 0, d.id);
        return next;
      });
    }
    setDrag({ colW, dx, id: d.id, startIndex: d.startIndex });
  }

  function onPointerEnd() {
    dragRef.current = null;
    setDrag(null);
  }

  return (
    <div className="te">
      <div className="te__cur" data-swipe-back="off" ref={rowRef}>
        {current.map((item, index) => {
          const Icon = item.icon;
          const label = getNavigationTabLabel(item, locale);
          const dragging = drag?.id === item.id;
          return (
            <div
              className={cn(
                "te__slot",
                dragging && "is-dragging",
                leaving === item.id && "is-leaving",
                popId === item.id && "te-pop",
              )}
              key={item.id}
              onPointerCancel={onPointerEnd}
              onPointerDown={(e) => onPointerDown(e, item.id, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              style={
                dragging && drag
                  ? { transform: `translateX(${drag.dx - (index - drag.startIndex) * drag.colW}px)` }
                  : undefined
              }
            >
              <span className="te__ico">
                <Icon aria-hidden="true" className="size-[23px]" strokeWidth={1.7} />
                {ids.length > 1 ? (
                  <button
                    aria-label={labels.remove.replace("{name}", label)}
                    className="te__minus"
                    onClick={() => remove(item.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    type="button"
                  >
                    <i aria-hidden="true">
                      <svg fill="none" height="10" viewBox="0 0 10 10" width="10">
                        <path d="M2 5h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                      </svg>
                    </i>
                  </button>
                ) : null}
              </span>
              <span className="te__lbl">{label}</span>
            </div>
          );
        })}
      </div>

      <span className="te__label">{isFull ? labels.full : labels.addable}</span>
      <div className="te__scroll">
        <div className="te__grid">
          {addable.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={cn("te__add", popId === item.id && "te-pop")}
                disabled={isFull}
                key={item.id}
                onClick={() => add(item.id)}
                type="button"
              >
                <span className="te__ico">
                  <Icon aria-hidden="true" className="size-[22px]" strokeWidth={1.7} />
                </span>
                <span className="te__lbl">{getNavigationTabLabel(item, locale)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button className="te__done" onClick={close} type="button">
        {labels.done}
      </button>
    </div>
  );
}
