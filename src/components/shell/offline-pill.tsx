"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * 오프라인 표시 (2026-10-22 출시 점검 D2 · N6) — 연결이 끊기면 셸 위쪽에 작은 알약이 내려온다.
 *
 * 전엔 끊겨도 아무 표시가 없다가, 다른 화면으로 가는 순간 앱 전체가 오프라인 화면으로 바뀌었다. 네이티브 앱처럼 지금 화면은 그대로
 * 두고 「불러온 내용만 보여요」를 알린다. 연결이 돌아오면 저절로 걷힌다. 위치는 위 줄 바로 아래(폰) · 본문 위(폴드 · 태블릿).
 */
export function OfflinePill({ label }: { label: string }) {
  const offline = useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute inset-x-0 top-[72px] z-30 flex justify-center px-4 transition-[opacity,translate] duration-300 ease-out fold:top-3",
        offline ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
      )}
      role="status"
    >
      {offline ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.6)]">
          <WifiOff aria-hidden="true" className="size-[14px]" strokeWidth={2.4} />
          {label}
        </span>
      ) : null}
    </div>
  );
}
