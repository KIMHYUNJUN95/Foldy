"use client";
import { cn } from "@/lib/utils";
import type { AvatarColor } from "./board-types";

/**
 * 게시판 이니셜 동그라미 — 화이트 리디자인(2026-10-15): 그라데이션 대신 옅은 보라 바탕 + 보라 글자 하나로 통일.
 * `color` 는 예전 호출부와 맞추려고 받기만 한다.
 */
const sizeMap = {
  28: "size-7 text-[11.5px]",
  30: "size-[30px] text-[12px]",
  32: "size-8 text-[13px]",
  36: "size-9 text-[14px]",
  40: "size-10 text-[15px]",
} as const;

export function BoardAvatar({
  initial,
  size = 40,
  className,
}: {
  initial: string;
  color?: AvatarColor;
  size?: keyof typeof sizeMap;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[#f1ecfd] font-bold text-[#5a30cf]",
        sizeMap[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}
