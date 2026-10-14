"use client";

// PC 진입 모션(2026-10-14, 시안 Motion-PC-Entry-PC) — 관리자 콘솔을 새로 불러올 때마다(새로고침 · 다시 접속 · 화면 껐다 30초 넘어 돌아옴,
// `entry-replay`) 약 2초. 콘솔 안에서 화면을 옮길 땐 다시 안 나온다.
// 흰 화면 가운데에서 로고 세 막대가 3D 로 모이고 「Foldy」 → 로고가 작아지며 사이드바 로고 자리로 날아가 앉고,
// 그사이 사이드바 · 위 줄 · 본문이 차례로 깔린다.
//
// 콘솔이 깔리는 움직임은 CSS 가 아니라 Web Animations 로, 모두 오버레이와 **같은 시계**(startTime = 오버레이 시작)에 묶는다.
// 새로고침하면 먼저 로딩 화면(공용 틀)이 뜨고 1초쯤 뒤 실제 화면이 들어오며 사이드바가 새로 그려지는데, CSS 애니메이션이면
// 새 사이드바가 처음부터 다시 시작해 로고가 날아갈 자리가 비어 버렸다(2026-10-14 사용자 지적 「중간에 끊김」).
// 지금은 새로 들어온 요소도 MutationObserver 로 잡아 같은 시계의 현재 진행 지점부터 이어 간다.
//
// 서버에서도 오버레이를 그려(새로 불러올 때만 서버가 그리므로) 첫 화면부터 흰 바탕 — 콘솔이 잠깐 보였다 덮이는 깜빡임이 없다.
// 동작 줄이기면 보이지 않는다(CSS 로도 숨김).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { finishEntry, getEntryPlay, getServerEntryPlay, subscribeEntry } from "@/lib/entry-replay";
import "./admin-entry.css";

const SPRING_OUT = "cubic-bezier(.23, 1, .32, 1)";

type Step = { sel: string; keyframes: Keyframe[]; delay: (i: number, el: Element) => number; duration: number; easing: string };

/** 콘솔이 깔리는 차례 — 시간은 오버레이 시작 기준(ms). 로고는 1300ms 에 날기 시작해 ~1860ms 에 사이드바 로고 자리에 앉는다. */
const STEPS: Step[] = [
  { sel: ".adm .side", keyframes: [{ transform: "translateX(-100%)" }, { transform: "none" }], delay: () => 1150, duration: 480, easing: "cubic-bezier(.32, .72, 0, 1)" },
  {
    sel: ".adm .side .navi",
    keyframes: [{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }],
    delay: (_i, el) => {
      const grp = el.closest(".navgrp");
      const n = grp?.parentElement ? Array.prototype.indexOf.call(grp.parentElement.children, grp) : 0;
      return 1420 + Math.min(n, 3) * 60;
    },
    duration: 380,
    easing: SPRING_OUT,
  },
  { sel: ".adm .top", keyframes: [{ opacity: 0, transform: "translateY(-10px)" }, { opacity: 1, transform: "none" }], delay: () => 1380, duration: 420, easing: SPRING_OUT },
  { sel: ".adm .dh-kpis > *", keyframes: [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], delay: (i) => 1520 + i * 50, duration: 600, easing: SPRING_OUT },
  {
    sel: ".adm .dh > *:not(:first-child), .adm .cwrap > *:not(.dh)",
    keyframes: [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }],
    delay: (i) => 1640 + Math.min(i, 4) * 60,
    duration: 650,
    easing: SPRING_OUT,
  },
];
const BUILD_END = 2700;
const FINISH_AT = 2000;

export function AdminEntry() {
  const play = useSyncExternalStore(subscribeEntry, getEntryPlay, getServerEntryPlay);
  const logoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!play) return;
    const logo = logoRef.current;
    const now = () => (document.timeline.currentTime as number | null) ?? performance.now();
    // 오버레이의 CSS 애니메이션이 시작한 시각 = 모든 움직임의 0ms. (서버에서 그렸으면 페이지가 처음 그려질 때부터 돌고 있다.)
    const own = logo?.getAnimations().find((a) => typeof a.startTime === "number");
    const t0 = typeof own?.startTime === "number" ? own.startTime : now();

    // 날아갈 자리 = 사이드바 로고. 날기 직전에 잰다(그때 실제 화면의 사이드바가 들어와 있을 가능성이 높다).
    const measure = () => {
      const mark = document.querySelector<HTMLElement>(".adm .side__mark");
      if (!mark || !logo) return;
      const side = mark.closest<HTMLElement>(".side");
      // 사이드바가 들어오는 중이면 transform 을 빼고 최종 자리로 잰다.
      const sideShift = side ? new DOMMatrixReadOnly(getComputedStyle(side).transform === "none" ? undefined : getComputedStyle(side).transform).m41 : 0;
      const m = mark.getBoundingClientRect();
      const l = logo.getBoundingClientRect();
      logo.style.setProperty("--fx", `${m.left - sideShift + m.width / 2 - (l.left + l.width / 2)}px`);
      logo.style.setProperty("--fy", `${m.top + m.height / 2 - (l.top + l.height / 2)}px`);
      logo.style.setProperty("--fs", String(m.width / l.width));
    };
    measure();
    // 화면 모션(대시보드 숫자 굴림 · 막대 등)은 진입 화면이 걷힐 때(~1450ms) 시작하게 미룬다 — 덮인 채 끝나 버리지 않게.
    const root = document.documentElement;
    root.style.setProperty("--entry-d0", `${Math.round(Math.max(0, t0 + 1450 - now()))}ms`);
    const tVar = window.setTimeout(() => root.style.removeProperty("--entry-d0"), Math.max(0, t0 + 6500 - now()));
    const tMeasure = window.setTimeout(measure, Math.max(0, t0 + 1240 - now()));

    // 콘솔 깔기 — 같은 시계.
    const done = new WeakSet<Element>();
    const apply = () => {
      if (now() - t0 > BUILD_END) return;
      for (const step of STEPS) {
        document.querySelectorAll(step.sel).forEach((el, i) => {
          if (done.has(el)) return;
          done.add(el);
          const delay = step.delay(i, el);
          if (now() - t0 > delay + step.duration) return; // 이미 끝났을 시점에 들어온 건 그냥 보인다
          const anim = (el as HTMLElement).animate(step.keyframes, { delay, duration: step.duration, easing: step.easing, fill: "backwards" });
          anim.startTime = t0;
        });
      }
    };
    apply();
    let raf = 0;
    const mo = new MutationObserver(() => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const tStop = window.setTimeout(() => mo.disconnect(), Math.max(0, t0 + BUILD_END - now()));
    const tDone = window.setTimeout(() => finishEntry(play), Math.max(0, t0 + FINISH_AT - now()));
    return () => {
      window.clearTimeout(tMeasure);
      window.clearTimeout(tVar);
      root.style.removeProperty("--entry-d0");
      window.clearTimeout(tStop);
      window.clearTimeout(tDone);
      window.cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, [play]);

  if (!play) return null;
  return (
    <div className="aden" aria-hidden="true" key={play}>
      <div className="aden__logo" ref={logoRef}>
        <span className="aden__glow" />
        <span className="aden__tile">
          <span className="aden__bw aden__b3">
            <span className="aden__bar" />
          </span>
          <span className="aden__bw aden__b2">
            <span className="aden__bar" />
          </span>
          <span className="aden__bw aden__b1">
            <span className="aden__bar">
              <i />
            </span>
          </span>
        </span>
      </div>
      <span className="aden__ww">
        <span className="aden__word">Foldy</span>
      </span>
    </div>
  );
}
