"use client";

import type { Dictionary } from "@/lib/i18n";

/** 사용자 차단 확인 — 게시판 삭제 확인과 같은 가운데 정렬 모달(의도된 BottomSheet 예외). */
export function BoardBlockConfirm({
  name,
  copy,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  copy: Pick<Dictionary["board"], "blockConfirmTitle" | "blockConfirmBody" | "blockConfirmCta" | "actionCancel">;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-[320px] rounded-[22px] bg-surface p-[22px] text-center shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]">
        <p className="text-[15.5px] font-black tracking-[-0.01em] text-foreground">
          {copy.blockConfirmTitle.replace("{name}", name || "·")}
        </p>
        <p className="mt-[7px] text-[12.5px] font-semibold leading-[1.5] text-muted-foreground">{copy.blockConfirmBody}</p>
        <div className="mt-[18px] flex gap-[9px]">
          <button
            className="h-11 flex-1 rounded-[13px] border border-border bg-background text-[13.5px] font-extrabold text-[#3a3746]"
            onClick={onCancel}
            type="button"
          >
            {copy.actionCancel}
          </button>
          <button
            className="h-11 flex-1 rounded-[13px] bg-[hsl(4_72%_52%)] text-[13.5px] font-extrabold text-white disabled:opacity-50"
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {copy.blockConfirmCta}
          </button>
        </div>
      </div>
    </div>
  );
}
