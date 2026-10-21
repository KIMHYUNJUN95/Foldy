"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";
import { useToastMotion } from "@/components/shell/use-toast-motion";

/**
 * 모바일 사용자 관리 알림 — 판매 캘린더와 같은 **한 줄 알약**(먹색, 탭 바 위). 2026-10-20 시안 ⑦.
 * - `undo`: 역할 · 상태를 바꾼 뒤 「되돌리기」 + 알약 아래 가는 줄이 6초 동안 줄어든다(줄어드는 동안만 되돌리기).
 * - `done`: 스위치 등 — 스위치가 곧 되돌리기라 글만 2초.
 * - `bad`: 실패 — 빨간 기운 바탕 + 이유, 5초.
 */
export type UsersToast = { id: number; kind: "undo" | "done" | "bad"; text: string; onUndo?: () => void };

const WAIT: Record<UsersToast["kind"], number> = { undo: 6000, done: 2000, bad: 5000 };

export function MobileUsersToast({ toast, undoLabel, onDismiss }: { toast: UsersToast; undoLabel: string; onDismiss: () => void }) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  const wait = WAIT[toast.kind];
  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), wait);
    return () => clearTimeout(timer);
  }, [wait]);
  // 옆 · 아래로 밀면 치워진다 · 사라질 때 살짝 내려가며 흐려진다 — 모바일 토스트 공용(`useToastMotion`, 2026-10-21).
  const ref = useToastMotion<HTMLDivElement>(onDismiss);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`muw-toast${toast.kind === "bad" ? " is-bad" : ""}`} ref={ref} role={toast.kind === "bad" ? "alert" : "status"}>
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
      {toast.kind === "undo" ? <i className="muw-toast__life" aria-hidden="true" style={{ animationDuration: `${wait}ms` }} /> : null}
    </div>,
    document.body,
  );
}
