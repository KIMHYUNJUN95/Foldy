"use client";

import { useToastMotion } from "@/components/shell/use-toast-motion";

/**
 * 게시판 짧은 알림 — 글만 있는 알약. 사라질 때 · 밀어서 치우기(`onDismiss` 를 줄 때)는 공용 움직임(`useToastMotion`).
 * `action` 을 주면 오른쪽에 글자 버튼(댓글 지우기 「실행 취소」, unslop 2026-11-20).
 */
export function BoardToast({
  text,
  action,
  onDismiss,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}) {
  const ref = useToastMotion<HTMLDivElement>(onDismiss);
  return (
    <div aria-live="polite" className={action ? "bdw-toast is-undo" : "bdw-toast"} ref={ref} role="status">
      <span>{text}</span>
      {action ? (
        <button className="bdw-toast__act" onClick={action.onClick} type="button">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
