"use client";
import { cn } from "@/lib/utils";
import type { AvatarColor } from "./board-types";

const gradientMap: Record<AvatarColor, string> = {
  default: "from-[#8a63f0] to-[#5a30cf]",
  red: "from-[hsl(348_62%_56%)] to-[hsl(346_64%_40%)]",
  blue: "from-[hsl(200_58%_48%)] to-[hsl(206_64%_34%)]",
  green: "from-[hsl(158_42%_42%)] to-[hsl(160_48%_28%)]",
};

const sizeMap = {
  28: "size-7 text-[11.5px]",
  32: "size-8 text-[12.5px]",
  36: "size-9 text-[13.5px]",
  40: "size-10 text-[14.5px]",
} as const;

export function BoardAvatar({
  initial,
  color = "default",
  size = 40,
  className,
}: {
  initial: string;
  color?: AvatarColor;
  size?: 28 | 32 | 36 | 40;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-white bg-gradient-to-br tracking-tight",
        gradientMap[color],
        sizeMap[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}
