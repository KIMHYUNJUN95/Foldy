"use client";

// PC 진입 모션(2026-10-14, 시안 Motion-PC-Entry-PC) — 관리자 콘솔을 새로 불러올 때마다(새로고침 · 다시 접속 · 화면 껐다 30초 넘어 돌아옴,
// `entry-replay`). 콘솔 안에서 화면을 옮길 땐 다시 안 나온다. 2026-10-19 줄임: 로고 모션(약 1.1초)은 **하루 첫 진입 · 로그인 직후만**,
// 그 외엔 이미 모인 로고가 화면 가운데 0.4초 → 사이드바 로고 자리로 짧게 날아가 앉는다(콘솔 깔기 없음, 2026-10-19).
// 흰 화면 가운데에서 로고 세 막대가 3D 로 모이고 「Foldy」 → 로고가 작아지며 사이드바 로고 자리로 날아가 앉고,
// 그사이 사이드바 · 위 줄 · 본문이 차례로 깔린다.
//
// **진입 화면은 React 바깥에 있다.** 서버 HTML 의 인라인 스크립트(`mountEntry`)가 body 에 직접 붙이고, 끝나면 직접 지운다.
// - React 안에 두면 하이드레이션이 어긋나 화면을 다시 그릴 때(확장 프로그램 · 시간대 차이 등) 진입 화면도 지워졌다 처음부터 다시 나와
//   「가운데 로고가 떴다 꺼진 뒤 모션 로고가 또 나옴」이 됐다(2026-10-14 사용자 지적).
// - 하이드레이션을 기다리면 느린 환경에서 1.3초를 넘겨 로고가 자리를 모른 채 날았다 → 스크립트가 그 자리에서 바로 돈다.
// - 레이아웃에서 내용(children)보다 **앞**에 둬 콘솔 HTML 보다 먼저 실행된다(콘솔이 잠깐 보였다 덮이는 깜빡임 없음).
// - 콘솔 깔기는 Web Animations 로 걷기 시작 시각에 묶는다 — 로딩 화면 → 실제 화면으로 바뀌며 사이드바가 새로 그려져도 이어 간다.
// 화면을 껐다 돌아와 다시 띄울 땐 같은 함수를 effect 가 부른다. 동작 줄이기면 안 나온다.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { getEntryPlay, getServerEntryPlay, subscribeEntry } from "@/lib/entry-replay";
import "./admin-entry.css";

/**
 * 진입 한 번 — 화면 만들기 · 시계 · 걷기 · 콘솔 깔기 · 지우기. **혼자 도는 함수**여야 한다 — 인라인 스크립트로 문자열이 되어
 * 서버 HTML 안에서 실행된다(바깥 변수 · import 를 쓰지 말 것). `id` 는 재생 번호(같은 번호는 두 번 안 띄움).
 *
 * 로고가 모이는 앞부분(0~약 700ms)만 CSS 시간표이고 **걷히는 건 이 스크립트가 `lift()` 할 때만**(.aden.is-out) — 혼자 걷히게 두면
 * 느린 환경에서 하이드레이션이 메인 스레드를 붙잡는 동안 걷혀 로더가 비쳤다. 로딩 중(.fldr)이면 로더가 두 번 연달아(≈0.25초)
 * 안 보일 때까지 모인 로고를 든 채 기다린다(뒤 빛이 숨 쉼, 시작부터 최대 2초 + CSS 안전장치 3초 + 4초엔 무조건 치움).
 */
function mountEntry(id: number, host: Element | null) {
  const w = window as unknown as { __foldyEntryLast?: number };
  if (w.__foldyEntryLast === id) return;
  w.__foldyEntryLast = id;
  try {
    if (document.documentElement.hasAttribute("data-pane") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    return;
  }
  const prev = document.querySelector(".aden");
  if (prev) prev.remove();
  const overlay = document.createElement("div");
  overlay.className = "aden";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML =
    '<div class="aden__logo"><span class="aden__glow"></span><span class="aden__hold"></span><span class="aden__tile">' +
    '<span class="aden__bw aden__b3"><span class="aden__bar"></span></span>' +
    '<span class="aden__bw aden__b2"><span class="aden__bar"></span></span>' +
    '<span class="aden__bw aden__b1"><span class="aden__bar"><i></i></span></span>' +
    '</span></div><span class="aden__ww"><span class="aden__word">Foldy</span></span>';
  (host || document.body).appendChild(overlay);
  const logo = overlay.firstChild as HTMLElement;

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    overlay.remove();
  };
  setTimeout(remove, 4000); // 무슨 일이 있어도 4초 뒤엔 치운다

  // 로고 모션은 하루 첫 진입 · 로그인 직후(20초 안)만(2026-10-19). 그 외(새로고침 · 30초 넘어 돌아옴 · 같은 날 두 번째부터)는
  // 짧은 쪽 — 이미 모인 로고(글자 없음)가 가운데 0.4초 있다가 사이드바 로고 자리로 420ms 에 날아가 앉고, 콘솔 깔기는 없다.
  // 흰 바탕만 걷히던 때는 흰 콘솔 위라 아무것도 안 보였다(사용자 「아무리 빨라도 로고는 좀 보여야」). 날짜는 도쿄 기준. 저장소를 못 쓰면 짧은 쪽.
  let full = false;
  try {
    const raw = sessionStorage.getItem("foldy.loginRise");
    if (raw) {
      sessionStorage.removeItem("foldy.loginRise");
      full = Date.now() - (JSON.parse(raw) as { t: number }).t < 20000;
    }
    const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (localStorage.getItem("foldy.entryDay.admin") !== day) full = true;
    if (full) localStorage.setItem("foldy.entryDay.admin", day);
  } catch {
    // 짧은 쪽으로.
  }
  // 글자를 숨긴 뒤에 로고 자리를 재야 가운데에서 출발한다(아래 측정보다 먼저).
  if (!full) overlay.classList.add("aden--quick");
  const flyMs = full ? 560 : 420;
  const holdMs = full ? 680 : 250;

  const now = () => (document.timeline && (document.timeline.currentTime as number | null)) || performance.now();
  const t0 = now();
  const root = document.documentElement;
  const ease = "cubic-bezier(.23, 1, .32, 1)";
  // 화면 모션(대시보드 숫자 굴림 · 막대 등)은 걷힐 때까지 미뤄 둔다(걷을 때 실제 값으로 바꿈).
  root.style.setProperty("--entry-d0", "60s");

  // 로고 쪽은 움직이기 전 자리(화면 가운데)를 처음 한 번만 잰다.
  const l = logo.getBoundingClientRect();
  const lx = l.left + l.width / 2;
  const ly = l.top + l.height / 2;

  // 콘솔이 깔리는 차례 — 시간은 걷기 시작(lift) 기준(ms). 로고는 0ms 에 날기 시작해 560ms 에 사이드바 로고 자리에 앉는다.
  type Step = [string, Keyframe[], (i: number, el: Element) => number, number, string];
  const steps: Step[] = [
    [".adm .side", [{ transform: "translateX(-100%)" }, { transform: "none" }], () => 0, 480, "cubic-bezier(.32, .72, 0, 1)"],
    [
      ".adm .side .navi",
      [{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }],
      (_i, el) => {
        const grp = el.closest(".navgrp");
        const n = grp && grp.parentElement ? Array.prototype.indexOf.call(grp.parentElement.children, grp) : 0;
        return 120 + Math.min(n, 3) * 60;
      },
      380,
      ease,
    ],
    [".adm .top", [{ opacity: 0, transform: "translateY(-10px)" }, { opacity: 1, transform: "none" }], () => 80, 420, ease],
    [".adm .dh-kpis > *", [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], (i) => 220 + i * 50, 600, ease],
    [
      ".adm .dh > *:not(:first-child), .adm .cwrap > *:not(.dh)",
      [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }],
      (i) => 340 + Math.min(i, 4) * 60,
      650,
      ease,
    ],
  ];

  const lift = () => {
    const L = now();
    // 날아갈 자리 = 사이드바 로고. 날기 · 착지는 Web Animations 에 실제 숫자로(컴포지터 — 메인 스레드가 바빠도 안 멈춤).
    const mark = document.querySelector<HTMLElement>(".adm .side__mark");
    let to = "translate(0px, 0px) scale(.6)";
    if (mark) {
      const m = mark.getBoundingClientRect();
      to = "translate(" + (m.left + m.width / 2 - lx) + "px, " + (m.top + m.height / 2 - ly) + "px) scale(" + m.width / l.width + ")";
    }
    logo.animate([{ transform: "translate(0px, 0px) scale(1)" }, { transform: to }], { duration: flyMs, easing: "cubic-bezier(.5, 0, .1, 1)", fill: "forwards" });
    logo.animate([{ opacity: 1 }, { opacity: 0 }], { delay: flyMs - 60, duration: 140, easing: "ease-out", fill: "forwards" });
    overlay.classList.add("is-out");
    root.style.setProperty("--entry-d0", Math.round(L - t0 + 150) + "ms");
    setTimeout(() => root.style.removeProperty("--entry-d0"), 6500);
    setTimeout(remove, flyMs + 200);
    if (!full) return;

    // 콘솔 깔기 — 모두 같은 시계(startTime = L). 걷는 동안 늦게 들어온 요소도 현재 진행 지점부터 이어 간다.
    const done = new WeakSet<Element>();
    const apply = () => {
      const el0 = now() - L;
      if (el0 > 1400) return;
      for (const [sel, keyframes, delayOf, duration, easing] of steps) {
        document.querySelectorAll(sel).forEach((el, i) => {
          if (done.has(el)) return;
          done.add(el);
          const delay = delayOf(i, el);
          if (el0 > delay + duration) return;
          const anim = (el as HTMLElement).animate(keyframes, { delay, duration, easing, fill: "backwards" });
          anim.startTime = L;
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
    setTimeout(() => mo.disconnect(), 1400);
  };

  // 0.7초쯤 걷는다 — 로더가 두 번 연달아(≈0.25초) 안 보일 때. 로딩 중이면 기다리되 시작부터 2초까지만.
  let clear = 0;
  const check = () => {
    clear = document.querySelector(".fldr") ? 0 : clear + 1;
    if (clear < 2 && now() - t0 < 2000) {
      setTimeout(check, 120);
      return;
    }
    lift();
  };
  setTimeout(check, Math.max(0, t0 + holdMs - now()));
}

// 진입 화면이 붙는 빈 상자 — React 는 이 상자의 안(innerHTML)을 한 번 넣고 다시 건드리지 않는다(값이 안 바뀌므로). 그래서 스크립트가
// 안에 붙인 진입 화면이 하이드레이션 · 다시 그리기와 부딪히지 않는다. body 에 바로 붙였더니 React 가 예상한 자리가 어긋나 화면을
// 통째로 다시 그렸다. 안의 스크립트는 서버 HTML 에서만 실행된다(브라우저가 innerHTML 로 넣은 스크립트는 실행 안 됨).
const ENTRY_SCRIPT = `<script>(${mountEntry.toString()})(1, document.currentScript.parentElement)</script>`;

export function AdminEntry() {
  const play = useSyncExternalStore(subscribeEntry, getEntryPlay, getServerEntryPlay);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 새로 불러온 재생(1)은 서버 HTML 의 스크립트가 이미 띄웠다 — 같은 번호는 안에서 걸러진다. 브라우저에서만 붙은 경우(앱 안 이동으로
    // 처음 관리자 화면에 온 경우)와 화면을 껐다 돌아온 재생(2, 3 …)은 여기서 띄운다.
    if (play) mountEntry(play, hostRef.current);
  }, [play]);

  return <div className="aden-host" dangerouslySetInnerHTML={{ __html: ENTRY_SCRIPT }} ref={hostRef} suppressHydrationWarning />;
}
