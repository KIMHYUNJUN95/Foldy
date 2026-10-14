"use client";

// PC 진입 모션(2026-10-14, 시안 Motion-PC-Entry-PC) — 하루 첫 대시보드 진입에만 약 1.8초.
// 흰 화면 가운데에서 로고 세 막대가 3D 로 모이고 「Foldy」 → 로고가 작아지며 사이드바 로고 자리로 날아가 앉고,
// 그사이 사이드바 · 위 줄 · 본문이 차례로 깔린다(html[data-adm-entry] 동안만 — admin-entry.css).
// 동작 줄이기면 보이지 않는다. 같은 날 다시 들어오거나 새로고침하면 없음(localStorage 에 도쿄 날짜).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./admin-entry.css";

const KEY = "foldy:adm-entry-day";

function tokyoDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shouldShow() {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    return window.localStorage.getItem(KEY) !== tokyoDay();
  } catch {
    return false;
  }
}

function subscribe() {
  return () => {};
}

export function AdminEntry() {
  const wanted = useSyncExternalStore(subscribe, shouldShow, () => false);
  const [done, setDone] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wanted) return;
    const root = document.documentElement;
    try {
      window.localStorage.setItem(KEY, tokyoDay());
    } catch {
      /* 저장 못 해도 한 번 보여 주고 끝 */
    }
    // 날아갈 자리 = 사이드바 로고. 로고 묶음 가운데 → 그 가운데로.
    const mark = document.querySelector<HTMLElement>(".adm .side__mark");
    const logo = logoRef.current;
    if (mark && logo) {
      const m = mark.getBoundingClientRect();
      const l = logo.getBoundingClientRect();
      logo.style.setProperty("--fx", `${m.left + m.width / 2 - (l.left + l.width / 2)}px`);
      logo.style.setProperty("--fy", `${m.top + m.height / 2 - (l.top + l.height / 2)}px`);
      logo.style.setProperty("--fs", String(m.width / l.width));
    }
    root.setAttribute("data-adm-entry", "");
    const t1 = window.setTimeout(() => setDone(true), 1850);
    const t2 = window.setTimeout(() => root.removeAttribute("data-adm-entry"), 2600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      root.removeAttribute("data-adm-entry");
    };
  }, [wanted]);

  if (!wanted || done) return null;
  return (
    <div className="aden" aria-hidden="true">
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
