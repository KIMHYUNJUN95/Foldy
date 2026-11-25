"use client";

import { useEffect, useState } from "react";

export type AdminToastAction = { label: string; onAction: () => void };

type AdminToastState = {
  id: number;
  message: string;
  sticky?: boolean;
  /** 「실행 취소」 같은 버튼 하나(2026-11-25) — 있으면 `.adm-toast--undo` 모양이고 눌러도 닫히지 않는다(버튼만 동작). */
  action?: AdminToastAction;
  duration: number;
} | null;

const DEFAULT_MS = 1800;
/** 실패 · 오류 안내 — 문장이 길고 다음 할 일을 알려 주므로 읽을 시간을 준다(2차 점검 2). */
export const ADMIN_TOAST_ERROR_MS = 5000;

/**
 * 자동 닫힘 타이머가 돌지(2차 점검 9) — 멈춤은 **그 토스트 id** 에만 걸린다. 마우스를 올린 채 새 토스트로 바뀌면
 * 새 토스트는 처음부터 다시 센다(예전엔 멈춤이 이어져 새 토스트도 안 닫혔다).
 */
export function adminToastTimerRuns(toast: { id: number; sticky?: boolean } | null, pausedId: number | null): boolean {
  return Boolean(toast && !toast.sticky && pausedId !== toast.id);
}

let toastSeq = 0;
/** 버튼 있는 토스트 — 읽고 누를 시간(급여 설정 · 청소 완료 취소 공용). */
export const ADMIN_TOAST_ACTION_MS = 6000;

/**
 * 관리자 콘솔 하단 중앙 토스트(admin-console.css 의 `.adm-toast`)의
 * 공용 상태/동작. `sticky` 가 아니면 1.8초 뒤 자동으로 사라지고, 클릭해도 닫힌다.
 * `showActionToast` 는 버튼(실행 취소 등) 하나를 단 토스트 — 기본 6초, 마우스를 올리거나 초점이 들어오면 멈춘다.
 */
export function useAdminToast() {
  const [toast, setToast] = useState<AdminToastState>(null);
  const [pausedId, setPausedId] = useState<number | null>(null);

  /** `duration` — 실패 안내는 `ADMIN_TOAST_ERROR_MS`. */
  const showToast = (message: string, sticky = false, duration = DEFAULT_MS) => {
    setToast({ id: ++toastSeq, message, sticky, duration });
  };
  const showActionToast = (message: string, action: AdminToastAction, duration = ADMIN_TOAST_ACTION_MS) => {
    setToast({ id: ++toastSeq, message, action, duration });
  };
  const dismiss = () => {
    setPausedId(null);
    setToast(null);
  };
  /** 지금 보이는 토스트만 멈춘다 — 바뀐 새 토스트에는 이어지지 않는다. */
  const setPaused = (paused: boolean) => setPausedId(paused ? (toast?.id ?? null) : null);

  const runs = adminToastTimerRuns(toast, pausedId);
  useEffect(() => {
    if (!runs || !toast) return;
    // 멈췄다 풀리면 처음부터 다시 센다 — 버튼을 누르려던 사람이 손을 뗀 순간 사라지지 않게.
    const t = setTimeout(() => setToast(null), toast.duration);
    return () => clearTimeout(t);
  }, [toast, runs]);

  return { toast, showToast, showActionToast, dismiss, setPaused };
}

export function AdminToast({
  message,
  onDismiss,
  action,
  onPauseChange,
}: {
  message: string;
  onDismiss: () => void;
  action?: AdminToastAction;
  /** 마우스 올림 · 초점 동안 자동 닫힘을 멈춘다(`useAdminToast().setPaused`). */
  onPauseChange?: (paused: boolean) => void;
}) {
  if (action) {
    return (
      <div
        className="adm-toast adm-toast--undo"
        role="status"
        onMouseEnter={() => onPauseChange?.(true)}
        onMouseLeave={() => onPauseChange?.(false)}
        onFocus={() => onPauseChange?.(true)}
        onBlur={() => onPauseChange?.(false)}
      >
        <span>{message}</span>
        <button
          type="button"
          onClick={() => {
            onDismiss();
            action.onAction();
          }}
        >
          {action.label}
        </button>
      </div>
    );
  }
  return (
    <div className="adm-toast" onClick={onDismiss} role="status">
      {message}
    </div>
  );
}
