"use client";

/**
 * 판매 캘린더 PC — 아래로 내리면 뜨는 바 (2026-11-02, 시안 「R · 안 ① 다듬음」).
 *
 * 「가격 수정」 · 「수기 예약」은 맨 위 도구 줄(`.scw-bar`)에만 있어서, 객실을 아래까지 내려 보다가
 * 고치려면 맨 위로 돌아갔다가 다시 내려와야 했다(사용자 지적). 도구 줄이 화면 위로 사라지면 이 바가
 * 격자 열 아래 가운데에 떠오른다 — 맨 위로 · 지금 보는 건물 + 기간 · 수기 예약 · 가격 수정.
 *
 * - **`position: sticky; bottom`** 이다(`fixed` 아님). 격자 열(`.scw-main`) 안에서만 붙어 있어 오른쪽
 *   패널과 겹치지 않고, 바 높이만큼 자리를 차지하므로 **목록 맨 끝의 방이 바에 가리지 않는다.**
 * - 도구 줄이 다시 보이면 숨는다 — 같은 단추가 한 화면에 두 번 보이는 순간은 없다.
 * - 「가격 수정」(바 · `E` 키)은 **보던 자리 그대로** 편집 모드로 들어간다. 모드가 바뀌면 도구 줄 2가
 *   빠지고 오른쪽 열이 생겨 격자가 위로 밀린다 — 화면 맨 위에 보이던 객실 줄을 기억해 두었다가 같은
 *   높이로 되돌린다(`keepRowInPlace`).
 * - 편집 중에는 그리지 않는다 — 「수정 끝내기」는 오른쪽 열 탭 줄 끝에 있다.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ArrowUp, PencilLine, Plus } from "lucide-react";

export type FloatBarCopy = {
  editMode: string;
  floatBarLabel: string;
  floatToTop: string;
  floatNewBooking: string;
  floatEditHint: string;
};

/** 관리자 본문의 스크롤 상자. 판매 캘린더는 창이 아니라 `.adm .content` 가 스크롤된다. */
function scrollRootOf(element: HTMLElement | null): HTMLElement | null {
  return element?.closest<HTMLElement>(".content") ?? null;
}

/**
 * `action` 이 화면을 다시 그린 뒤에도 **지금 맨 위에 보이는 객실 줄**이 같은 높이에 있게 한다.
 * 붙어 있는 날짜 머리글 바로 아래 첫 줄을 기준으로 잰다.
 */
function keepRowInPlace(gridRoot: HTMLElement | null, action: () => void) {
  const scroller = scrollRootOf(gridRoot);
  if (!gridRoot || !scroller) {
    action();
    return;
  }
  const headBottom = gridRoot.querySelector<HTMLElement>(".opsg__head")?.getBoundingClientRect().bottom ?? 0;
  const anchor = Array.from(gridRoot.querySelectorAll<HTMLElement>("[data-ops-row]")).find(
    (row) => row.getBoundingClientRect().bottom > headBottom + 1,
  );
  const key = anchor?.dataset.opsRow;
  const before = anchor?.getBoundingClientRect().top;
  flushSync(action);
  if (!key || before === undefined) return;
  const after = gridRoot.querySelector<HTMLElement>(`[data-ops-row="${CSS.escape(key)}"]`)?.getBoundingClientRect().top;
  if (after !== undefined) scroller.scrollTop += after - before;
}

/** 입력 중인 키는 가로채지 않는다. */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [role='combobox'], [role='dialog']") !== null;
}

export function OpsFloatBar({
  active,
  buildingLabel,
  canWrite,
  copy,
  createHint,
  gridRootRef,
  onEdit,
  onNewBooking,
  periodLabel,
  showNewBooking,
  toolbarRef,
}: {
  /** 편집 모드가 아닐 때만 true. */
  active: boolean;
  /** 건물 키(정본 이름) → 보이는 이름. */
  buildingLabel: (property: string) => string;
  canWrite: boolean;
  copy: FloatBarCopy;
  createHint: boolean;
  /** 격자 루트(`.scw`) — 건물 머리줄 · 객실 줄을 여기서 찾는다. */
  gridRootRef: RefObject<HTMLElement | null>;
  onEdit: () => void;
  onNewBooking: () => void;
  periodLabel: string;
  showNewBooking: boolean;
  /** 맨 위 도구 줄 — 이것이 화면 밖으로 나가면 바가 뜬다. */
  toolbarRef: RefObject<HTMLElement | null>;
}) {
  const [toolbarGone, setToolbarGone] = useState(false);
  const [property, setProperty] = useState<string | null>(null);
  const shown = active && toolbarGone;

  // 도구 줄이 **위로** 사라졌는지만 본다(아래에 있어 안 보이는 경우는 없지만, 판정은 위쪽으로 한정한다).
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const observer = new IntersectionObserver(
      ([entry]) => setToolbarGone(!entry.isIntersecting && entry.boundingClientRect.top < window.innerHeight / 2),
      { root: scrollRootOf(toolbar), threshold: 0 },
    );
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [toolbarRef]);

  // 지금 보는 건물 — 기준선(아래)을 지난 마지막 건물 머리줄. 바가 떠 있을 때만 잰다.
  useEffect(() => {
    if (!shown) return;
    const gridRoot = gridRootRef.current;
    const scroller = scrollRootOf(gridRoot);
    if (!gridRoot || !scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // 기준선은 머리글 바로 아래가 아니라 **보이는 격자의 위쪽 3분의 1** — 머리글 아래에 앞 건물의 마지막 방
      // 한 줄만 걸려 있을 때 화면 대부분을 차지한 다음 건물이 아니라 그 건물을 말하던 것(2026-11-02 확인).
      const headBottom = gridRoot.querySelector<HTMLElement>(".opsg__head")?.getBoundingClientRect().bottom ?? 0;
      const line = headBottom + (scroller.getBoundingClientRect().bottom - headBottom) / 3;
      const groups = Array.from(gridRoot.querySelectorAll<HTMLElement>("[data-ops-property]"));
      // 끝까지 내렸으면 마지막 건물이다 — 객실 1개짜리 건물이 끝에 몰려 있으면 기준선을 못 넘는다.
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      let current: string | null = atEnd ? (groups.at(-1)?.dataset.opsProperty ?? null) : null;
      if (!atEnd) {
        for (const group of groups) {
          if (group.getBoundingClientRect().top > line + 1) break;
          current = group.dataset.opsProperty ?? null;
        }
      }
      setProperty(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [shown, gridRootRef]);

  const enterEdit = () => keepRowInPlace(gridRootRef.current, onEdit);
  const enterEditRef = useRef(enterEdit);
  useEffect(() => {
    enterEditRef.current = enterEdit;
  });

  // `E` — 편집 모드로. 키보드 동작이라 움직임 없이 바로 바뀐다. 끄는 것은 기존 Esc.
  useEffect(() => {
    if (!active || !canWrite) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "e" && event.key !== "E") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      enterEditRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, canWrite]);

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollRootOf(gridRootRef.current)?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  if (!active) return null;
  const building = property ? buildingLabel(property) : null;

  return (
    <div className={`scw-float${shown ? " is-shown" : ""}`}>
      <div aria-hidden={!shown} aria-label={copy.floatBarLabel} className="scw-float__bar" inert={!shown} role="toolbar">
        <button aria-label={copy.floatToTop} className="scw-float__top" onClick={toTop} title={copy.floatToTop} type="button">
          <ArrowUp aria-hidden="true" />
        </button>
        <div className="scw-float__ctx">
          {building && (
            <span className="scw-float__bld" title={building}>
              {building}
            </span>
          )}
          <span className="scw-float__per">{periodLabel}</span>
        </div>
        {canWrite && showNewBooking && (
          <button aria-pressed={createHint} className="scw-float__btn" onClick={onNewBooking} type="button">
            <Plus aria-hidden="true" />
            {copy.floatNewBooking}
          </button>
        )}
        {canWrite && (
          <button className="scw-float__btn is-primary" data-tip={copy.floatEditHint} onClick={enterEdit} type="button">
            <PencilLine aria-hidden="true" />
            {copy.editMode}
          </button>
        )}
      </div>
    </div>
  );
}
