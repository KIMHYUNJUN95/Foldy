"use client";

// 앱 스플래시(2026-10-14, 시안 Motion-B-Splash-Phone) — 앱을 켤 때마다(새로고침 · 다시 접속 · 화면 껐다 켬, `entry-replay`) 흰 바탕 위에서
// 로고 세 막대가 3D 로 흩어졌다 흐릿하게 날아와 스프링으로 모이고, 「Foldy」 글자 속으로 빛이 지나간 뒤,
// 로고가 다가오며 흐려지고(초점 빠짐) 뒤의 홈이 드러난다. 약 1.7초. 동작 줄이기면 보여 주지 않는다.
import { useEffect, useSyncExternalStore } from "react";
import { finishEntry, getEntryPlay, getServerEntryPlay, subscribeEntry } from "@/lib/entry-replay";
import "./app-splash.css";

export function AppSplash({ tagline }: { tagline: string }) {
  // 서버에선 그리지 않고(0), 브라우저에서 페이지를 새로 불러올 때 · 화면을 껐다 30초 넘어 돌아올 때마다(`entry-replay`).
  const play = useSyncExternalStore(subscribeEntry, getEntryPlay, getServerEntryPlay);

  useEffect(() => {
    if (!play) return;
    // 서버에서 그렸으면 CSS 애니메이션은 페이지가 처음 그려질 때부터 돌고 있다 — 그 시작 시각 기준으로 1.8초에 걷는다.
    const now = (document.timeline.currentTime as number | null) ?? performance.now();
    const own = document.querySelector(".spl")?.getAnimations({ subtree: true }).find((a) => typeof a.startTime === "number");
    const t0 = typeof own?.startTime === "number" ? own.startTime : now;
    const id = window.setTimeout(() => finishEntry(play), Math.max(0, t0 + 1800 - now));
    return () => window.clearTimeout(id);
  }, [play]);

  if (!play) return null;
  return (
    <div className="spl" aria-hidden="true" key={play}>
      <div className="spl__c">
        <span className="spl__glow" />
        <span className="spl__tile">
          <span className="spl__bw spl__b3">
            <span className="spl__bar" />
          </span>
          <span className="spl__bw spl__b2">
            <span className="spl__bar" />
          </span>
          <span className="spl__bw spl__b1">
            <span className="spl__bar">
              <i />
            </span>
          </span>
        </span>
        <span className="spl__ww">
          <span className="spl__word">Foldy</span>
        </span>
        <span className="spl__tag">{tagline}</span>
      </div>
    </div>
  );
}
