import { cn } from "@/lib/utils";
import type { BugStatus } from "./bug-types";

const STATUS_STYLE: Record<BugStatus, string> = {
  submitted: "text-[hsl(214_64%_44%)] bg-[hsl(214_72%_95.5%)]",
  reviewing: "text-[hsl(33_82%_40%)] bg-[hsl(37_86%_93.5%)]",
  fixed: "text-[hsl(150_52%_32%)] bg-[hsl(148_46%_93.5%)]",
  closed: "text-[hsl(222_9%_46%)] bg-[hsl(220_16%_94%)]",
};

export function BugStatusBadge({
  status,
  size = "sm",
  label,
}: {
  status: BugStatus;
  size?: "sm" | "md";
  /** 현지화된 상태 라벨 — 호출하는 쪽이 `bugStatusLabel(copy, status)` 로 구한다. */
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-[6px] font-extrabold",
        size === "sm" && "px-2 py-[3px] text-[10.5px]",
        size === "md" && "px-[9px] py-[3px] text-[11px]",
        STATUS_STYLE[status],
      )}
    >
      {label}
    </span>
  );
}
