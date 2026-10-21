"use client";

import type { LucideIcon } from "lucide-react";
import { RotateCcw } from "lucide-react";
import { createPortal } from "react-dom";
import { useToastMotion } from "@/components/shell/use-toast-motion";
import { cn } from "@/lib/utils";

/**
 * 투두 화면의 떠 있는 토스트 — 완료/삭제 실행 취소, 회차 건너뛰기 되돌리기, 이동 거절 안내.
 *
 * **위치가 계약이다.** 예전에는 네 곳이 각자 `bottom-[92px]` 를 하드코딩했는데, 그 값은
 * `env(safe-area-inset-bottom)` 을 무시한다. 탭바는 `padding-bottom: max(16px, safe)` 로 자라고
 * 중앙 스퀘어클 버튼은 탭바 위로 26px 더 솟아 있어서, 홈 인디케이터가 있는 기기에서는 토스트가
 * 탭바에 딱 붙거나 스퀘어클과 겹쳤다. `.toast-dock`(globals.css) 이 그 높이를 한 곳에서 계산한다.
 *
 * 마크업도 네 곳에 복붙돼 있었다 — 이 도메인의 반복된 실패 모드가 쌍둥이 어긋남이라 하나로 모은다.
 *
 * 닫기(X) 버튼은 없다. 토스트는 모두 스스로 사라지고(4~6초), 실행 취소라는 진짜 행동이 이미
 * 있으므로 X 는 좁은 알약 안에서 시선만 나눠 가졌다. 대신 옆 · 아래로 밀면 치워지고, 사라질 때는 살짝 내려가며 흐려진다
 * (`useToastMotion`, 2026-10-21).
 */
export function TaskToast({
  action,
  icon: Icon,
  message,
  onDismiss,
  tone = "neutral",
}: {
  /** 실행 취소 같은 단일 행동. 없으면 안내 전용 토스트. */
  action?: { label: string; onAction: () => void };
  icon?: LucideIcon;
  message: string;
  /** 밀어서 치웠을 때 — 부모가 이 토스트 상태를 비운다. */
  onDismiss?: () => void;
  /** `danger` 는 되돌릴 수 없는 쪽(건너뛰기/삭제)의 아이콘 칩만 물들인다. */
  tone?: "neutral" | "danger";
}) {
  const ref = useToastMotion<HTMLDivElement>(onDismiss);
  return createPortal(
    <div className="toast-dock pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4" ref={ref}>
      <div
        className={cn(
          "toast-pop pointer-events-auto flex max-w-[440px] items-center gap-2.5 rounded-[20px]",
          "border border-white/10 bg-slate-900/95 py-2 pl-2 pr-2 backdrop-blur-xl",
          "shadow-[0_22px_50px_-20px_rgba(15,23,42,0.85)]",
          !action && "px-4 py-2.5",
        )}
        role="status"
      >
        {Icon ? (
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-[13px]",
              tone === "danger" ? "bg-rose-500/20 text-rose-300" : "bg-white/10 text-white",
            )}
          >
            <Icon className="size-[15px]" strokeWidth={2.2} aria-hidden="true" />
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 text-[13px] font-bold leading-[1.35] tracking-[-0.01em] text-white",
            action ? "pl-0.5" : "text-center",
          )}
        >
          {message}
        </span>
        {action ? (
          <button
            className={cn(
              "inline-flex h-9 flex-none items-center gap-1.5 rounded-[14px] bg-white/12 px-3",
              "text-[12.5px] font-extrabold tracking-[-0.01em] text-white",
              "transition-[transform,background-color] duration-150 active:scale-[0.94] active:bg-white/20",
            )}
            onClick={action.onAction}
            type="button"
          >
            <RotateCcw className="size-[13px]" strokeWidth={2.4} aria-hidden="true" />
            {action.label}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
