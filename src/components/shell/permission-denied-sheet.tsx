"use client";

import { Lock } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";

/**
 * 표준 모바일 "권한 없음" 팝업 — 리포트 시트의 forbidden 상태
 * (자물쇠 아이콘 + 제목 + 본문)와 같은 시각 패턴으로, `/mobile/*` 에서 서버 액션이 동작을
 * `unauthorized`/`forbidden` 으로 거부할 때마다 재사용한다.
 */
export function PermissionDeniedSheet({
  title,
  body,
  closeLabel,
  onClose,
}: {
  title: string;
  body: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <BottomSheet ariaLabel={title} onClose={onClose}>
      {({ close }) => (
        <div className="flex flex-col items-center px-2 pb-2 pt-1 text-center">
          <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
            <Lock className="size-6" aria-hidden="true" />
          </span>
          <p className="text-[15px] font-extrabold text-foreground">{title}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
          <button
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground"
            onClick={close}
            type="button"
          >
            {closeLabel}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
