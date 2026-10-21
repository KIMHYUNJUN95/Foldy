"use client";

import { useToastMotion } from "@/components/shell/use-toast-motion";

/** 게시판 짧은 알림(1.8초) — 글만 있는 알약이라 밀어서 치우기는 없고, 사라질 때만 공용 움직임(`useToastMotion`). */
export function BoardToast({ text }: { text: string }) {
  const ref = useToastMotion<HTMLDivElement>();
  return (
    <div aria-live="polite" className="bdw-toast" ref={ref} role="status">
      <span>{text}</span>
    </div>
  );
}
