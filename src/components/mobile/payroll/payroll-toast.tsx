"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";
import { useToastMotion } from "@/components/shell/use-toast-motion";

/** 급여 준비 알림 — 한 줄 먹색 알약. `undo` 는 6초 · 줄어드는 줄, `done` 2초, `bad` 5초(빨간 기운). 모양은 사용자 관리와 같은 가족. */
export type PayrollToastState = { id: number; kind: "undo" | "done" | "bad"; text: string; onUndo?: () => void };

const WAIT: Record<PayrollToastState["kind"], number> = { undo: 6000, done: 2000, bad: 5000 };

export function PayrollToast({ toast, undoLabel, onDismiss }: { toast: PayrollToastState; undoLabel: string; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  const wait = WAIT[toast.kind];
  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), wait);
    return () => clearTimeout(timer);
  }, [wait]);
  const ref = useToastMotion<HTMLDivElement>(onDismiss);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`mpp-toast${toast.kind === "bad" ? " is-bad" : ""}`} ref={ref} role={toast.kind === "bad" ? "alert" : "status"}>
      {toast.kind === "bad" ? <CircleAlert aria-hidden="true" /> : null}
      <span>{toast.text}</span>
      {toast.kind === "undo" && toast.onUndo ? (
        <button
          type="button"
          onClick={() => {
            toast.onUndo?.();
            onDismiss();
          }}
        >
          {undoLabel}
        </button>
      ) : null}
      {toast.kind === "undo" ? <i className="mpp-toast__life" aria-hidden="true" style={{ animationDuration: `${wait}ms` }} /> : null}
    </div>,
    document.body,
  );
}
