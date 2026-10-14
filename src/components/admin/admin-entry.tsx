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
// 시계 · 날아갈 자리 재기 · 콘솔 깔기(`runEntry`)는 오버레이 HTML 바로 뒤의 인라인 스크립트로 **그 자리에서** 돈다 — React 가 화면을
// 붙이는(하이드레이션) 걸 기다리면 개발 모드 등 느린 환경에선 1.3초를 넘겨, 로고가 자리를 모른 채 엉뚱한 방향으로 날았다
// (2026-10-14 사용자 지적). 화면을 껐다 켜서 브라우저에서만 다시 그릴 땐 같은 함수를 effect 가 부른다.
// 동작 줄이기면 보이지 않는다(CSS 로도 숨김).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { finishEntry, getEntryPlay, getServerEntryPlay, subscribeEntry } from "@/lib/entry-replay";
import "./admin-entry.css";

const FINISH_AT = 2000;

/**
 * 진입 한 번의 시계 · 자리 재기 · 콘솔 깔기. **혼자 도는 함수**여야 한다 — 인라인 스크립트로 문자열이 되어 서버 HTML 안에서 실행된다
 * (바깥 변수 · import 를 쓰지 말 것). 시간은 오버레이 시작 기준(ms): 로고는 1300ms 에 날기 시작해 ~1860ms 에 사이드바 로고 자리에 앉는다.
 */
function runEntry(logo: HTMLElement | null) {
  if (!logo || logo.dataset.run) return;
  logo.dataset.run = "1";
  const now = () => (document.timeline && (document.timeline.currentTime as number | null)) || performance.now();
  const t0 = now();
  const root = document.documentElement;
  const ease = "cubic-bezier(.23, 1, .32, 1)";
  type Step = [string, Keyframe[], (i: number, el: Element) => number, number, string];
  const steps: Step[] = [
    [".adm .side", [{ transform: "translateX(-100%)" }, { transform: "none" }], () => 1150, 480, "cubic-bezier(.32, .72, 0, 1)"],
    [
      ".adm .side .navi",
      [{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }],
      (_i, el) => {
        const grp = el.closest(".navgrp");
        const n = grp && grp.parentElement ? Array.prototype.indexOf.call(grp.parentElement.children, grp) : 0;
        return 1420 + Math.min(n, 3) * 60;
      },
      380,
      ease,
    ],
    [".adm .top", [{ opacity: 0, transform: "translateY(-10px)" }, { opacity: 1, transform: "none" }], () => 1380, 420, ease],
    [".adm .dh-kpis > *", [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], (i) => 1520 + i * 50, 600, ease],
    [
      ".adm .dh > *:not(:first-child), .adm .cwrap > *:not(.dh)",
      [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }],
      (i) => 1640 + Math.min(i, 4) * 60,
      650,
      ease,
    ],
  ];

  // 날아갈 자리 = 사이드바 로고(최종 자리 — 들어오는 중인 사이드바의 이동은 뺀다). 로고 쪽은 움직이기 전 자리를 **처음 한 번만** 잰다 —
  // 느린 환경에서 다시 재기가 늦게 돌면 날고 있는 로고를 재서 뒤로 튀었다.
  const l = logo.getBoundingClientRect();
  const lx = l.left + l.width / 2;
  const ly = l.top + l.height / 2;
  // 날기 · 착지는 Web Animations 에 **실제 숫자**로 — CSS 변수를 쓴 키프레임은 메인 스레드에서 돌아, 대시보드가 화면을 붙이느라
  // 바쁜 동안 로고가 중간에서 멈췄다(2026-10-14 사용자 지적 3차). 숫자 transform · opacity 는 컴포지터에서 돌아 안 멈춘다.
  const fly = logo.animate([{ transform: "none" }, { transform: "translate(0px, 0px) scale(.6)" }], {
    delay: 1300,
    duration: 560,
    easing: "cubic-bezier(.5, 0, .1, 1)",
    fill: "forwards",
  });
  fly.startTime = t0;
  const land = logo.animate([{ opacity: 1 }, { opacity: 0 }], { delay: 1800, duration: 140, easing: "ease-out", fill: "forwards" });
  land.startTime = t0;
  const measure = () => {
    const mark = document.querySelector<HTMLElement>(".adm .side__mark");
    if (!mark) return;
    const side = mark.closest<HTMLElement>(".side");
    const tf = side ? getComputedStyle(side).transform : "none";
    const shift = tf && tf !== "none" ? new DOMMatrixReadOnly(tf).m41 : 0;
    const m = mark.getBoundingClientRect();
    const fx = m.left - shift + m.width / 2 - lx;
    const fy = m.top + m.height / 2 - ly;
    (fly.effect as KeyframeEffect).setKeyframes([
      { transform: "translate(0px, 0px) scale(1)" },
      { transform: "translate(" + fx + "px, " + fy + "px) scale(" + m.width / l.width + ")" },
    ]);
  };
  measure();
  setTimeout(measure, 1240);

  // 화면 모션(대시보드 숫자 굴림 · 막대 등)은 진입 화면이 걷힐 때(~1450ms) 시작하게 미룬다.
  root.style.setProperty("--entry-d0", "1450ms");
  setTimeout(() => root.style.removeProperty("--entry-d0"), 6500);

  // 콘솔 깔기 — 모두 같은 시계(startTime = t0). 늦게 들어온 요소(로딩 → 실제 화면)도 현재 진행 지점부터 이어 간다.
  const done = new WeakSet<Element>();
  const apply = () => {
    const el0 = now() - t0;
    if (el0 > 2700) return;
    for (const [sel, keyframes, delayOf, duration, easing] of steps) {
      document.querySelectorAll(sel).forEach((el, i) => {
        if (done.has(el)) return;
        done.add(el);
        const delay = delayOf(i, el);
        if (el0 > delay + duration) return;
        const anim = (el as HTMLElement).animate(keyframes, { delay, duration, easing, fill: "backwards" });
        anim.startTime = t0;
      });
    }
  };
  apply();
  let raf = 0;
  const mo = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      apply();
    });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 2700);
  logo.dataset.t0 = String(t0);
}

const subscribeNoop = () => () => {};

export function AdminEntry() {
  const play = useSyncExternalStore(subscribeEntry, getEntryPlay, getServerEntryPlay);
  // 서버 HTML · 하이드레이션 첫 렌더에서만 true — 그때만 인라인 스크립트를 넣는다(브라우저에서 새로 그린 스크립트는 실행되지 않는다).
  const fromServer = useSyncExternalStore(subscribeNoop, () => false, () => true);
  const logoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!play) return;
    const logo = logoRef.current;
    runEntry(logo); // 서버 HTML 의 스크립트가 이미 돌았으면 아무것도 안 한다
    const t0 = Number(logo?.dataset.t0) || performance.now();
    const elapsed = ((document.timeline && (document.timeline.currentTime as number | null)) || performance.now()) - t0;
    const tDone = window.setTimeout(() => finishEntry(play), Math.max(0, FINISH_AT - elapsed));
    return () => window.clearTimeout(tDone);
  }, [play]);

  if (!play) return null;
  return (
    <div className="aden" aria-hidden="true" key={play}>
      {/* 인라인 스크립트가 하이드레이션 전에 data-run · data-t0 를 붙이므로 속성 차이는 무시 */}
      <div className="aden__logo" ref={logoRef} suppressHydrationWarning>
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
      {/* 마지막에 둔다 — 실행 시점에 글자까지 그려져 있어야 로고 자리를 정확히 잰다. */}
      {fromServer ? (
        <script
          dangerouslySetInnerHTML={{ __html: `(${runEntry.toString()})(document.currentScript.parentElement.querySelector(".aden__logo"))` }}
          suppressHydrationWarning
        />
      ) : null}
    </div>
  );
}
