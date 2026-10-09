"use client";
import { cn } from "@/lib/utils";

type Reaction = { emoji: string; count: number; isMine: boolean };

export function BoardReactionBar({
  reactions,
  onToggle,
}: {
  reactions: Reaction[];
  onToggle?: (emoji: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle?.(r.emoji)}
          className={cn(
            "inline-flex h-9 items-center gap-[6px] rounded-full border px-[13px] text-[13px] font-extrabold",
            r.isMine
              ? "border-primary/[0.36] bg-primary/[0.12] text-primary"
              : "border-border bg-surface text-[#3a3746]",
          )}
        >
          <span className="text-[16px] leading-none">{r.emoji}</span>
          {r.count}
        </button>
      ))}
    </div>
  );
}
