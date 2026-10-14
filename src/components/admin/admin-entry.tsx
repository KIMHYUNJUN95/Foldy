"use client";

// PC 진입 모션(2026-10-14, 시안 Motion-PC-Entry-PC) — 관리자 콘솔을 새로 불러올 때마다(새로고침 · 다시 접속 · 화면 껐다 30초 넘어 돌아옴,
// `entry-replay`) 약 1.8초. 콘솔 안에서 화면을 옮길 땐 다시 안 나온다.
// 흰 화면 가운데에서 로고 세 막대가 3D 로 모이고 「Foldy」 → 로고가 작아지며 사이드바 로고 자리로 날아가 앉고,
// 그사이 사이드바 · 위 줄 · 본문이 차례로 깔린다(html[data-adm-entry] 동안만 — admin-entry.css).
// 동작 줄이기면 보이지 않는다.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { finishEntry, getEntryPlay, getServerEntryPlay, subscribeEntry } from "@/lib/entry-replay";
import "./admin-entry.css";

export function AdminEntry() {
  const play = useSyncExternalStore(subscribeEntry, getEntryPlay, getServerEntryPlay);
  const logoRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(0);

  useEffect(() => {
    if (!play) return;
    const root = document.documentElement;
    activeRef.current = play;
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
    const t1 = window.setTimeout(() => finishEntry(play), 1850);
    // 겉 화면이 사라진 뒤에도 콘솔이 깔리는 끝부분(~2.6초)까지 표시를 둔다 — 그사이 새 재생이 시작됐으면 그쪽이 맡는다.
    window.setTimeout(() => {
      if (activeRef.current === play) root.removeAttribute("data-adm-entry");
    }, 2600);
    return () => window.clearTimeout(t1);
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
