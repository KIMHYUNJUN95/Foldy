"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { haptic } from "@/lib/haptics";

/**
 * 모바일 판매 캘린더 알림 — 시안 `3a 가격 시트 v3` 의 3e · 3f(2026-10-02 사용자 확정).
 *
 * 시트를 닫은 뒤 진행 · 결과를 **탭 바 위**에 띄운다. **한 줄짜리 작은 알약**(2026-10-02 사용자 지적 「너무 크고
 * 거추장스럽다」 — 처음엔 폭 전부 · 두 줄이었다). 흐린 값 안내 같은 설명 줄은 두지 않는다. 진행 중에는 남아 있고, 결과는 몇 초 뒤 스스로 사라진다.
 * 몸통을 누르면 바로 닫힌다(진행 중 제외). 행동 버튼: 완료 → 「되돌리기」, 일부 실패 · 실패 → 「이력 보기」.
 *
 * 화이트 리디자인(2026-10-16, 시안 SalesToast): 먹색(#16141f) 알약 · 오른쪽 옅은 흰 버튼. 완료는 초록 체크가 **그려지며**
 * `haptic("success")`, 실패는 `haptic("warning")`. 등장은 아래에서 살짝(ease-out 220ms), reduced-motion 이면 끈다.
 */
export type MobileToast = {
  id: number;
  kind: "pending" | "done" | "partial" | "failed" | "slow" | "undoing" | "info";
  count: number;
  /** 작업 큐 쓰기(가격 · 최소숙박)의 작업 번호 — 완료 알림의 「되돌리기」가 쓴다(`revertPriceJob`). */
  jobId?: string;
  /** 차단 · 해제 묶음의 시각 — 완료 알림의 「되돌리기」가 쓴다(`revertBlockChange`). */
  blockAt?: string;
  /** 정해진 문구 대신 쓸 문장(되돌리기 결과 · 차단 완료 등). */
  text?: string;
  /** 완료가 됐을 때만 쓸 문장(최소숙박 「최소숙박 N박 · M칸 완료」). */
  doneText?: string;
  /** 방금 만든 예약 — 완료 알림의 「열기」가 그 상세를 연다. */
  openReservationId?: string;
};

export type MobileToastCopy = {
  queued: string;
  done: string;
  partial: string;
  failed: string;
  slow: string;
  undo: string;
  history: string;
  open: string;
};

const AUTO_DISMISS_MS: Partial<Record<MobileToast["kind"], number>> = {
  done: 6000,
  failed: 8000,
  info: 5000,
  partial: 8000,
  slow: 6000,
};

export function MobileOpsToast({
  copy,
  onAction,
  onDismiss,
  toast,
}: {
  copy: MobileToastCopy;
  onAction?: () => void;
  onDismiss: () => void;
  toast: MobileToast;
}) {
  const wait = AUTO_DISMISS_MS[toast.kind];
  // 부모는 렌더마다 새 onDismiss 를 준다 — 그걸 의존으로 두면 실시간 새로고침마다 타이머가 다시 시작돼 안 사라진다.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => onDismissRef.current(), wait);
    return () => clearTimeout(timer);
  }, [wait, toast.kind]);

  // 반영 완료 · 저장 성공 — 초록 체크가 그려지는 순간 가볍게 울린다(화이트 리디자인 2026-10-16). 실패는 경고.
  useEffect(() => {
    if (toast.kind === "done") haptic("success");
    else if (toast.kind === "failed" || toast.kind === "partial") haptic("warning");
  }, [toast.kind]);

  if (typeof document === "undefined") return null;
  const n = String(toast.count);
  const busy = toast.kind === "pending" || toast.kind === "undoing";
  const bad = toast.kind === "partial" || toast.kind === "failed";
  const title =
    toast.text ??
    (toast.kind === "done" ? toast.doneText : undefined) ??
    (toast.kind === "pending"
      ? copy.queued.replace("{n}", n)
      : toast.kind === "done"
        ? copy.done.replace("{n}", n)
        : toast.kind === "partial"
          ? copy.partial
          : toast.kind === "failed"
            ? copy.failed
            : copy.slow);
  const action =
    toast.kind === "done" && onAction
      ? toast.openReservationId
        ? copy.open
        : copy.undo
      : bad && onAction
        ? copy.history
        : null;

  return createPortal(
    <div
      aria-live="polite"
      className={`mops-toast mops-vars${bad ? " bad" : ""}`}
      onClick={busy ? undefined : onDismiss}
      role="status"
    >
      {busy ? (
        <span aria-hidden="true" className="mops-toast__spin" />
      ) : toast.kind === "done" ? (
        <span aria-hidden="true" className="mops-toast__ok">
          <svg fill="none" viewBox="0 0 16 16">
            <path d="M4 8.4l2.6 2.6L12 5.4" />
          </svg>
        </span>
      ) : null}
      <span className="mops-toast__tx">
        {title}
      </span>
      {action && (
        <button
          className="mops-toast__act"
          onClick={(event) => {
            event.stopPropagation();
            onAction?.();
          }}
          type="button"
        >
          {action}
        </button>
      )}
    </div>,
    document.body,
  );
}
