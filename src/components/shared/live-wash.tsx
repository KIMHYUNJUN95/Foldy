"use client";

// 실시간 줄 표시(2026-10-14, 시안 Motion-Dash-D3 · D4) — 안쪽 `[data-live]` 줄 가운데 처음 그릴 땐 아무것도 안 하고,
// 새로 고침 뒤 새로 나타난 열쇠(새 요청 · 열쇠에 상태를 섞으면 할 일 완료 같은 상태 바뀜까지)에만 `is-fresh` 를 잠깐 붙인다.
// 모양은 쓰는 쪽 CSS 가 정한다. React 상태 없음 — DOM 클래스만 만진다.
// `move`(2026-10-15, 시안 D4 · 예약 현황): 새 줄이 위에서 스르륵 내려와 끼어들고(흐림 → 또렷), 원래 있던 줄은 새 자리로 스프링처럼
// 밀려 간다 — 지난번 자리(offsetTop)를 기억해 뒀다가 Web Animations 로 그 차이만큼 되돌려 놓고 0 으로 푼다(FLIP). 동작 줄이기면 안 움직임.
import { useEffect, useLayoutEffect, useRef } from "react";

const SPRING =
  "linear(0,0.0286,0.1038,0.2108,0.3366,0.4699,0.6017,0.7251,0.8353,0.9293,1.0057,1.0642,1.1059,1.1322,1.1452,1.1473,1.1409,1.1282,1.1114,1.0924,1.0726,1.0534,1.0357,1.0201,1.0069,0.9964,0.9885,0.983,0.9797,0.9783,0.9784,0.9796,0.9817,0.9843,0.9872,0.9901,0.9929,0.9954,0.9976,0.9995,1.0009,1.002,1.0027,1.0031,1)";

export function LiveWash({ sig, move = false, children }: { sig: string; move?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const tops = useRef<Map<string, number> | null>(null);

  useLayoutEffect(() => {
    if (!move) return;
    const root = ref.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-live]"));
    const prev = tops.current;
    tops.current = new Map(nodes.map((n) => [n.dataset.live ?? "", n.offsetTop]));
    if (!prev || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    nodes.forEach((n) => {
      const was = prev.get(n.dataset.live ?? "");
      if (was === undefined) {
        n.animate([{ transform: `translateY(${-n.offsetHeight}px)` }, { transform: "none" }], { duration: 700, easing: SPRING });
        n.animate([{ opacity: 0, filter: "blur(3px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 400, easing: "cubic-bezier(.23, 1, .32, 1)" });
        return;
      }
      const dy = was - n.offsetTop;
      if (dy) n.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 700, easing: SPRING });
    });
  }, [sig, move]);

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
