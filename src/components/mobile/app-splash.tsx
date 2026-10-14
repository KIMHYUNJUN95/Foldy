"use client";

// 앱 스플래시(2026-10-14, 시안 Motion-B-Splash-Phone) — 앱을 켤 때(브라우저 세션당 한 번) 흰 바탕 위에서
// 로고 세 막대가 3D 로 흩어졌다 흐릿하게 날아와 스프링으로 모이고, 「Foldy」 글자 속으로 빛이 지나간 뒤,
// 로고가 다가오며 흐려지고(초점 빠짐) 뒤의 홈이 드러난다. 약 1.7초. 동작 줄이기면 보여 주지 않는다.
import { useEffect, useState, useSyncExternalStore } from "react";
import "./app-splash.css";

const KEY = "foldy:splash-shown";

function subscribe() {
  return () => {};
}

function shouldShow() {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    return window.sessionStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

export function AppSplash({ tagline }: { tagline: string }) {
  // 서버에선 그리지 않고(=false), 브라우저에서 이번 세션 처음일 때만.
  const wanted = useSyncExternalStore(subscribe, shouldShow, () => false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!wanted) return;
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      /* 저장 못 해도 한 번 보여 주고 끝 */
    }
    const id = window.setTimeout(() => setDone(true), 1800);
    return () => window.clearTimeout(id);
  }, [wanted]);

  if (!wanted || done) return null;
  return (
    <div className="spl" aria-hidden="true">
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
