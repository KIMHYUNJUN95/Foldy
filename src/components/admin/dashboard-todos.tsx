"use client";

import { useState, useTransition } from "react";
import { toggleConsoleComplete } from "@/app/admin/tasks/actions";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { AdminUndoToast } from "@/components/admin/shared/admin-undo-toast";
import { LiveWash } from "@/components/shared/live-wash";
import type { TodoItem } from "@/lib/admin-dashboard";

export type DashboardTodosCopy = {
  todoTitle: string;
  todoEmpty: string;
  todoDoneToast: string;
  todoReopenToast: string;
  todoUndo: string;
  todoFailed: string;
  todoToggleLabel: string;
};

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * 대시보드 「오늘 할 일」 — 누르면 바로 완료 · 되돌리기(2026-10-28). 예전엔 체크 칸 모양만 그린 표시용 줄이라 눌러도 아무 일이 없었다.
 *
 * 저장은 할 일 콘솔과 같은 `toggleConsoleComplete`(권한 · 반복 회차 판정 그대로). 화면은 먼저 바꾸고, 실패하면 되돌리며
 * 「저장하지 못했어요」. 성공하면 「실행 취소」 토스트(공용 `AdminUndoToast`) — 단건 완료는 확인 창 없이 즉시 + 되돌리기 규칙.
 */
export function DashboardTodos({ todos, copy }: { todos: TodoItem[]; copy: DashboardTodosCopy }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [undo, setUndo] = useState<{ stamp: number; id: string; title: string; done: boolean; occurrenceDate: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast, showToast, dismiss } = useAdminToast();

  const items = todos.map((t) => ({ ...t, done: overrides[t.id] ?? t.done }));
  const doneCount = items.filter((t) => t.done).length;

  const save = (t: { id: string; title: string; occurrenceDate: string }, done: boolean, offerUndo: boolean) => {
    setOverrides((prev) => ({ ...prev, [t.id]: done }));
    startTransition(async () => {
      const result = await toggleConsoleComplete(t.id, done, t.occurrenceDate);
      if (!result.ok) {
        setOverrides((prev) => ({ ...prev, [t.id]: !done }));
        setUndo(null);
        showToast(copy.todoFailed);
        return;
      }
      setUndo(offerUndo ? { stamp: Date.now(), id: t.id, title: t.title, done, occurrenceDate: t.occurrenceDate } : null);
    });
  };

  return (
    <>
      <div className="dh-ch dh-ch--next">
        <span className="dh-ct">{copy.todoTitle}</span>
        <span className="dh-cc" style={{ marginLeft: "auto" }}>{doneCount} / {items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="dh-empty">{copy.todoEmpty}</div>
      ) : (
        <LiveWash sig={items.map((t) => `${t.id}:${t.done ? 1 : 0}`).join(",")}>
          {items.map((t) => (
            <label className={`dh-todo dh-todo--action${t.done ? " is-done" : ""}`} data-live={`${t.id}:${t.done ? 1 : 0}`} key={t.id}>
              <input
                aria-label={copy.todoToggleLabel.replace("{title}", t.title)}
                checked={t.done}
                className="dh-todo__input"
                onChange={(event) => save(t, event.currentTarget.checked, true)}
                type="checkbox"
              />
              <span aria-hidden="true" className="dh-todo__box">{t.done ? <span className="ic">{CHECK}</span> : null}</span>
              <span className="dh-todo__t">{t.title}</span>
            </label>
          ))}
        </LiveWash>
      )}
      {undo ? (
        <AdminUndoToast
          message={(undo.done ? copy.todoDoneToast : copy.todoReopenToast).replace("{title}", undo.title)}
          onExpire={() => setUndo(null)}
          onUndo={() => save(undo, !undo.done, false)}
          pending={pending}
          stamp={undo.stamp}
          undoLabel={copy.todoUndo}
        />
      ) : null}
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
