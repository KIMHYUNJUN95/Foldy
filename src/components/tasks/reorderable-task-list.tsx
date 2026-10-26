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
 * Todo "오늘" 구역용 세로 드래그 정렬 목록.
 *
 * 드래그는 각 카드 전용 그립 핸들(TaskCard `reorderable` 참고)에서만 시작하므로
 * 카드의 탭, 길게 눌러 메뉴, 스와이프와 부딪히지 않는다. 드래그하는 동안 순서
 * 배열은 고정하고, 끌고 있는 행을 손가락 따라 옮기고 지나친 행을 한 칸씩 밀어서
 * 미리 보여 준다. 배열은 놓을 때 한 번 확정해 저장한다.
 *
 * `disabled`(검색/필터 활성 또는 다중 선택 모드)이면 핸들도 드래그도 없는 일반 카드를 그리고
 * 부모가 넘긴 순서는 그대로 따른다.
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
  // 드래그 시작 인덱스 / 칸 높이의 state 사본으로 렌더 중에 쓴다(짝이 되는 ref 는
  // window 리스너에 쓰이고 렌더 state 를 읽을 수 없다). 렌더 중 ref 읽기는
  // 허용되지 않으므로 형제 밀기 계산은 이 값을 읽는다.
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

  // 한 번만 붙는 window 리스너(아래)가 현재 값을 읽도록 렌더 state/props 를 ref 에 비춘다.
  // 렌더 중에는 ref 에 쓸 수 없으므로 커밋 뒤 effect 에서 한다.
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

  // 서버 목록으로 다시 맞춘다 — 단, 드래그 중에는 하지 않는다(손가락 밑에서 행이 빠져나간다).
  // 저장된 정렬 뒤에는 다시 검증된 목록이 여기로 도착한다.
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

  // window 리스너는 한 번만 붙이고 `draggingRef` 로 게이트하므로 참조가 안정적이고
  // (깔끔한 추가/제거) ref 로 항상 최신 값을 읽는다.
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
    // 드래그 중에는 touchmove 를 CAPTURE 단계에서 삼켜 모바일 셸의
    // pull-to-refresh / 스크롤 핸들러(touchmove 기반이라 막지 않으면 손가락을 따라
    // 페이지 전체를 옮긴다)에 닿지 않게 한다. preventDefault 는 네이티브 스크롤을, stopPropagation 은
    // 셸의 JS 당기기를 막는다. 드래그 중이 아니면 아무 일도 하지 않아 평소 스크롤/PTR 은 그대로다.
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
    // 모든 행의 위치/크기를 미리 찍어 둔다. 미리 보기 계산은 이 캐시로 돈다(드래그 중에
    // 리플로우 읽기가 없다). 카드 높이가 제각각이어도 된다 — 행마다 잰 높이를 가진다.
    const rows: RowMetric[] = [];
    for (const t of cur) {
      const el = rowRefs.current.get(t.id);
      if (!el) return; // 행이 아직 마운트되지 않았다 — 오래된 측정값으로 드래그하지 말고 중단한다
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
