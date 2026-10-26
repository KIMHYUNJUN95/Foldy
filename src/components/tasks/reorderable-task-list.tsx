"use client";

import { useEffect, useRef, useState } from "react";
import { TaskCard } from "@/components/tasks/task-card";
import type { TaskRecord } from "@/lib/tasks";
import { isStandardRecurrence } from "@/lib/tasks-recurrence";
import { cn } from "@/lib/utils";

// 화이트 리디자인(2026-10-15) — 줄 사이 간격 없이 얇은 가로 줄로 나뉜다. 지나친 줄은 끌고 있는 줄 높이만큼 밀린다.
const GAP = 0;

type CardProps = Omit<
  React.ComponentProps<typeof TaskCard>,
  "task" | "reorderable" | "reordering" | "onReorderHandleDown"
>;

type RowMetric = { id: string; top: number; height: number };

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Vertical drag-reorder list for the Todo "Today" sections.
 *
 * The drag is started only from each card's dedicated grip handle (see TaskCard `reorderable`),
 * so it never conflicts with the card's tap, long-press menu, or swipe. While dragging, the order
 * array is held fixed and the move is previewed by translating the dragged row to follow the finger
 * and shifting the crossed rows by one slot; the array is committed once on drop and persisted.
 *
 * When `disabled` (active search/filter, or multi-select mode) it renders plain cards with no handle
 * and no drag — the list still honours whatever order the parent passed in.
 */
export function ReorderableTaskList({
  items,
  cardProps,
  disabled = false,
  onPersist,
  occurrenceDate,
  onPersistDate,
  behindByTask,
}: {
  items: TaskRecord[];
  cardProps: CardProps;
  /** taskId → 밀린 회차 수. 반복 카드에 「N일 밀림」 배지로 붙는다(2026-09-08). */
  behindByTask?: Map<string, number>;
  disabled?: boolean;
  /** 날짜 목록이 아닌 곳(관리함)에서 쓰는 단순 순서 저장. */
  onPersist?: (orderedIds: string[]) => void;
  /**
   * 날짜 목록(오늘/내일)에서는 일회성과 반복 회차가 섞이고 저장처가 갈리므로, 항목별로 반복 여부를
   * 함께 넘긴다. 서버가 `tasks.sort_order` / `task_occurrence_order` 로 나눠 쓴다.
   */
  occurrenceDate?: string;
  onPersistDate?: (
    occurrenceDate: string,
    items: { taskId: string; recurring: boolean }[],
  ) => void;
}) {
  const [order, setOrder] = useState<TaskRecord[]>(items);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragDelta, setDragDelta] = useState(0);
  const [overIndex, setOverIndex] = useState(0);
  // State copies of the drag start index / slot height for use during render (the matching refs
  // below feed the window listeners, which can't read render state). Reading refs during render is
  // disallowed, so the sibling-shift math reads these instead.
  const [dragStartIndex, setDragStartIndex] = useState(0);
  const [dragSlot, setDragSlot] = useState(0);

  const draggingRef = useRef(false);
  const orderRef = useRef(order);
  const overIndexRef = useRef(0);
  const startIndexRef = useRef(0);
  const startYRef = useRef(0);
  const slotRef = useRef(0);
  const metricsRef = useRef<RowMetric[]>([]);
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const isRecurringItem = (t: TaskRecord) =>
    !!occurrenceDate && isStandardRecurrence(t.recurrenceRule);
  const onPersistRef = useRef(onPersist);
  const onPersistDateRef = useRef(onPersistDate);
  const occurrenceDateRef = useRef(occurrenceDate);

  // Mirror live render state/props into refs so the once-attached window listeners (below) read
  // current values. Refs may not be written during render, so this happens post-commit in effects.
  useEffect(() => {
    orderRef.current = order;
  }, [order]);
  useEffect(() => {
    overIndexRef.current = overIndex;
  }, [overIndex]);
  useEffect(() => {
    onPersistRef.current = onPersist;
    onPersistDateRef.current = onPersistDate;
    occurrenceDateRef.current = occurrenceDate;
  }, [onPersist, onPersistDate, occurrenceDate]);

  // Resync from the server list — but never mid-drag (that would yank the row out from under the
  // finger). After a persisted reorder the revalidated list arrives here.
  //
  // 부모는 렌더마다 새 배열을 만든다. 예전엔 그때마다 순서를 덮어써, 방금 끌어 놓은 순서가 저장
  // 응답이 오기도 전에(다른 상태 변화로 부모가 다시 그려지면) 옛 순서로 튀었다(2026-10-26).
  // 이제 **id 순서가 실제로 바뀐 때만** 순서를 다시 받고, 같으면 카드 내용(제목 · 상태)만 새 객체로 바꾼다.
  const lastItemKeyRef = useRef(items.map((t) => t.id).join("\u0000"));
  useEffect(() => {
    if (draggingRef.current) return;
    const key = items.map((t) => t.id).join("\u0000");
    if (key === lastItemKeyRef.current) {
      const byId = new Map(items.map((t) => [t.id, t] as const));
      setOrder((cur) => {
        const next = cur.map((t) => byId.get(t.id) ?? t);
        return next.every((t, i) => t === cur[i]) ? cur : next;
      });
      return;
    }
    lastItemKeyRef.current = key;
    setOrder(items);
  }, [items]);

  // Window listeners are attached once and gated on `draggingRef`, so their references stay stable
  // (clean add/remove) and they always read live values through refs.
  useEffect(() => {
    function finishDrag() {
      draggingRef.current = false;
      const si = startIndexRef.current;
      const ti = overIndexRef.current;
      setDragId(null);
      setDragDelta(0);
      if (ti !== si) {
        const next = moveItem(orderRef.current, si, ti);
        setOrder(next);
        const date = occurrenceDateRef.current;
        if (date && onPersistDateRef.current) {
          onPersistDateRef.current(
            date,
            next.map((t) => ({ taskId: t.id, recurring: isStandardRecurrence(t.recurrenceRule) })),
          );
        } else {
          onPersistRef.current?.(next.map((t) => t.id));
        }
      }
    }
    function onMove(e: PointerEvent) {
      if (!draggingRef.current) return;
      e.preventDefault();
      const rows = metricsRef.current;
      const si = startIndexRef.current;
      if (!rows.length || si < 0) return;
      const dy = e.clientY - startYRef.current;
      setDragDelta(dy);
      const draggedCenter = rows[si].top + rows[si].height / 2 + dy;
      let ti = si;
      for (let i = si + 1; i < rows.length; i++) {
        if (draggedCenter > rows[i].top + rows[i].height / 2) ti = i;
        else break;
      }
      if (ti === si) {
        for (let i = si - 1; i >= 0; i--) {
          if (draggedCenter < rows[i].top + rows[i].height / 2) ti = i;
          else break;
        }
      }
      setOverIndex(ti);
    }
    function onUp() {
      if (!draggingRef.current) return;
      finishDrag();
    }
    // While dragging, swallow touchmove in the CAPTURE phase so it never reaches the mobile shell's
    // pull-to-refresh / scroll handlers (which are touchmove-driven and would otherwise translate the
    // whole page along with the finger). preventDefault stops native scroll; stopPropagation stops the
    // shell's JS pull. No-op when not dragging, so normal scrolling/PTR are untouched.
    function blockTouch(e: TouchEvent) {
      if (!draggingRef.current) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", blockTouch, { passive: false, capture: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", blockTouch, { capture: true });
    };
  }, []);

  function beginDrag(e: React.PointerEvent, task: TaskRecord) {
    if (disabled) return;
    const cur = orderRef.current;
    const si = cur.findIndex((t) => t.id === task.id);
    if (si < 0) return;
    // Snapshot every row's geometry up front; the preview math runs off this cache (no reflow reads
    // mid-drag). Variable card heights are fine — each row carries its own measured height.
    const rows: RowMetric[] = [];
    for (const t of cur) {
      const el = rowRefs.current.get(t.id);
      if (!el) return; // a row isn't mounted yet — abort rather than drag with stale metrics
      const r = el.getBoundingClientRect();
      rows.push({ id: t.id, top: r.top, height: r.height });
    }
    metricsRef.current = rows;
    slotRef.current = rows[si].height + GAP;
    startIndexRef.current = si;
    startYRef.current = e.clientY;
    overIndexRef.current = si;
    draggingRef.current = true;
    setDragStartIndex(si);
    setDragSlot(rows[si].height + GAP);
    setOverIndex(si);
    setDragDelta(0);
    setDragId(task.id);
  }

  return (
    <div className="tkw-list">
      {order.map((t, i) => {
        const isDragged = t.id === dragId;
        let translateY = 0;
        if (dragId) {
          if (isDragged) {
            translateY = dragDelta;
          } else {
            const si = dragStartIndex;
            const ti = overIndex;
            if (ti > si && i > si && i <= ti) translateY = -dragSlot;
            else if (ti < si && i >= ti && i < si) translateY = dragSlot;
          }
        }
        return (
          <div
            key={t.id}
            ref={(el) => {
              rowRefs.current.set(t.id, el);
            }}
            className="relative"
            style={{
              transform: translateY ? `translateY(${translateY}px)` : undefined,
              transition: isDragged ? "none" : "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
              zIndex: isDragged ? 50 : undefined,
            }}
          >
            <div className={cn(isDragged && "will-change-transform")}>
              {/* 날짜 목록에서 반복 항목은 **그 날짜의 회차**로 렌더해야 한다 — `occurrence` 를
                  빠뜨리면 체크박스가 회차가 아니라 행 전체를 완료 처리한다(TaskCard `done` /
                  `onCompleteToggle` 분기). 스와이프 이동도 회차엔 의미가 없어 끈다. */}
              <TaskCard
                task={t}
                reorderable={!disabled}
                reordering={isDragged}
                onReorderHandleDown={beginDrag}
                {...cardProps}
                {...(isRecurringItem(t)
                  ? {
                      occurrence: { date: occurrenceDate as string, done: false },
                      swipe: false,
                      behindDays: behindByTask?.get(t.id),
                    }
                  : null)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
