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
    const id = window.setTimeout(() => finishEntry(play), 1800);
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
