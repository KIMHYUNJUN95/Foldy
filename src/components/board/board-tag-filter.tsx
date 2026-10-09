"use client";
import { cn } from "@/lib/utils";

export function BoardTagFilter({
  tags,
  selected,
  onSelect,
}: {
  tags: string[];
  selected: string;
  onSelect: (tag: string) => void;
}) {
  return (
    <div className="flex gap-[7px] overflow-x-auto px-[18px] py-[1px] pb-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tags.map((tag) => {
        const isActive = tag === selected;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onSelect(tag)}
            className={cn(
              "inline-flex h-8 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full border px-[14px] text-[12.5px] font-bold transition-colors",
              isActive
                ? "border-primary/[0.26] bg-primary/[0.09] font-extrabold text-primary"
                : "border-border bg-surface text-[#3a3746]",
            )}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}
