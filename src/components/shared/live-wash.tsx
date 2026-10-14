"use client";

// 실시간 줄 표시(2026-10-14, 시안 Motion-Dash-D3 · D4) — 안쪽 `[data-live]` 줄 가운데 처음 그릴 땐 아무것도 안 하고,
// 새로 고침 뒤 새로 나타난 열쇠(새 요청 · 열쇠에 상태를 섞으면 할 일 완료 · 체크인 완료 같은 상태 바뀜까지)에만 `is-fresh` 를 잠깐 붙인다.
// 모양은 쓰는 쪽 CSS 가 정한다. React 상태 없음 — DOM 클래스만 만진다.
import { useEffect, useRef } from "react";

export function LiveWash({ sig, children }: { sig: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-live]"));
    const prev = seen.current;
    seen.current = new Set(nodes.map((n) => n.dataset.live ?? ""));
    if (!prev) return;
    const fresh = nodes.filter((n) => !prev.has(n.dataset.live ?? ""));
    fresh.forEach((n) => {
      n.classList.remove("is-fresh");
      void n.offsetWidth;
      n.classList.add("is-fresh");
    });
    const timer = window.setTimeout(() => fresh.forEach((n) => n.classList.remove("is-fresh")), 2000);
    return () => window.clearTimeout(timer);
  }, [sig]);

  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
