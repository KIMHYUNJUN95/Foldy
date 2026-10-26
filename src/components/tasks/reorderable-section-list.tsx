"use client";

import { useEffect, useRef, useState } from "react";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { ProjectSectionInfo } from "@/lib/projects";
import { cn } from "@/lib/utils";

// 섹션 사이 간격(`.tkw-sec` 의 아래 여백 22px). 지나친 섹션은 끌고 있는 섹션 높이 + 간격만큼 밀린다.
const GAP = 22;

type RowMetric = { id: string; top: number; height: number };

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 프로젝트 섹션의 세로 드래그 재정렬. `reorderable-task-list` 를 따르지만, 드래그되는 각
 * "행"이 섹션 블록 전체다. 컴포넌트가 섹션 헤더(소유자용 그립 핸들,
 * 제목, 개수, 수정/삭제)를 그리고, 본문(할 일 행 + 추가 링크)은 `renderBody` 에서 온다. `beginDrag` 는
 * 그립의 포인터 핸들러에서만 쓰고 `renderBody` 로는 넘기지 않으므로 렌더 밖에 머문다
 * (react-hooks/refs 만족). `disabled` 면 그립이 정적 쉐브론으로 바뀌고 드래그는 없다.
 */
export function ReorderableSectionList({
  sections,
  disabled = false,
  isOwner,
  reorderHandleLabel,
  editLabel,
  deleteLabel,
  countOf,
  countLabel,
  onRename,
  onDelete,
  onPersist,
  renderBody,
}: {
  sections: ProjectSectionInfo[];
  disabled?: boolean;
  isOwner: boolean;
  reorderHandleLabel: string;
  editLabel: string;
  deleteLabel: string;
  countOf: (sectionId: string) => number;
  /** 섹션 머리의 개수 문구(`{n}` 자리). 없으면 숫자만. */
  countLabel?: string;
  onRename: (section: ProjectSectionInfo) => void;
  onDelete: (section: ProjectSectionInfo) => void;
  onPersist: (orderedIds: string[]) => void;
  renderBody: (section: ProjectSectionInfo) => React.ReactNode;
}) {
  const [order, setOrder] = useState<ProjectSectionInfo[]>(sections);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragDelta, setDragDelta] = useState(0);
  const [overIndex, setOverIndex] = useState(0);
  const [dragStartIndex, setDragStartIndex] = useState(0);
  const [dragSlot, setDragSlot] = useState(0);

  const draggingRef = useRef(false);
  const orderRef = useRef(order);
  const overIndexRef = useRef(0);
  const startIndexRef = useRef(0);
  const startYRef = useRef(0);
  const metricsRef = useRef<RowMetric[]>([]);
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const onPersistRef = useRef(onPersist);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);
  useEffect(() => {
    overIndexRef.current = overIndex;
  }, [overIndex]);
  useEffect(() => {
    onPersistRef.current = onPersist;
  }, [onPersist]);

  // 서버 목록이 바뀔 때마다 다시 맞추되 — 드래그 중에는 절대 하지 않는다.
  useEffect(() => {
    if (draggingRef.current) return;
    setOrder(sections);
  }, [sections]);

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
        onPersistRef.current(next.map((s) => s.id));
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
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  function beginDrag(e: React.PointerEvent, section: ProjectSectionInfo) {
    if (disabled) return;
    const cur = orderRef.current;
    const si = cur.findIndex((s) => s.id === section.id);
    if (si < 0) return;
    const rows: RowMetric[] = [];
    for (const s of cur) {
      const el = rowRefs.current.get(s.id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      rows.push({ id: s.id, top: r.top, height: r.height });
    }
    metricsRef.current = rows;
    startIndexRef.current = si;
    startYRef.current = e.clientY;
    overIndexRef.current = si;
    draggingRef.current = true;
    setDragStartIndex(si);
    setDragSlot(rows[si].height + GAP);
    setOverIndex(si);
    setDragDelta(0);
    setDragId(section.id);
  }

  return (
    <div>
      {order.map((s, i) => {
        const isDragged = s.id === dragId;
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
            className="tkw-sec relative"
            key={s.id}
            ref={(el) => {
              rowRefs.current.set(s.id, el);
            }}
            style={{
              transform: translateY ? `translateY(${translateY}px)` : undefined,
              transition: isDragged ? "none" : "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
              zIndex: isDragged ? 50 : undefined,
            }}
          >
            <div
              className={cn(
                isDragged &&
                  "rounded-[14px] bg-white shadow-[0_18px_40px_-14px_rgba(22,20,31,0.35)] will-change-transform",
              )}
            >
              <div className="tkw-sec__h">
                {isOwner ? (
                  <button
                    aria-label={reorderHandleLabel}
                    className="tkw-sech__grip"
                    data-swipe-back="off"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => beginDrag(e, s)}
                    type="button"
                  >
                    <GripVertical aria-hidden="true" />
                  </button>
                ) : null}
                <b>{s.title}</b>
                <span className="tkw-sec__n">{countLabel ? countLabel.replace("{n}", String(countOf(s.id))) : countOf(s.id)}</span>
                {isOwner ? (
                  <span className="tkw-sec__acts" style={{ gap: 0 }}>
                    <button aria-label={editLabel} className="tkw-sech__ic" onClick={() => onRename(s)} type="button">
                      <Pencil aria-hidden="true" />
                    </button>
                    <button aria-label={deleteLabel} className="tkw-sech__ic" onClick={() => onDelete(s)} type="button">
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
              </div>
              {renderBody(s)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
