"use client";

// 앱 스플래시(2026-10-14, 시안 Motion-B-Splash-Phone) — 앱을 켤 때마다(새로고침 · 다시 접속 · 화면 껐다 켬, `entry-replay`) 흰 바탕 위에서
// 로고 세 막대가 3D 로 흩어졌다 흐릿하게 날아와 스프링으로 모이고, 「Foldy」 글자 속으로 빛이 지나간 뒤,
// 로고가 다가오며 흐려지고(초점 빠짐) 뒤의 홈이 드러난다. 약 1.8초. 동작 줄이기면 보여 주지 않는다.
// 붙는 곳은 `src/app/mobile/layout.tsx`(모든 모바일 화면, 로딩 화면보다 먼저).
import { useEffect, useSyncExternalStore } from "react";
import { finishEntry, getEntryPlay, getServerEntryPlay, subscribeEntry } from "@/lib/entry-replay";
import "./app-splash.css";

const FINISH_AT = 7000;

/**
 * 스플래시 한 번의 시계 · 걷기. **혼자 도는 함수** — 인라인 스크립트로 서버 HTML 안에서 바로 실행된다(바깥 변수 쓰지 말 것).
 * 로고가 모이는 앞부분만 CSS 시간표, **걷히는 건 이 스크립트가 `is-out` 을 붙일 때만**(admin-entry 와 같은 이유 — 느린 환경에서
 * 하이드레이션이 메인 스레드를 붙잡는 동안 혼자 걷혀 로더가 비쳤다, 2026-10-14). 로딩 중(.fldr)이면 로더가 두 번 연달아 안 보일
 * 때까지 기다린다(최대 ~5.3초 + CSS 안전장치 6초). 끝나는 시각은 data-end-at.
 */
function runSplash(el: HTMLElement | null) {
  if (!el || el.dataset.run) return;
  el.dataset.run = "1";
  const now = () => (document.timeline && (document.timeline.currentTime as number | null)) || performance.now();
  const t0 = now();
  el.dataset.endAt = String(t0 + 7000);
  let clear = 0;
  const check = () => {
    clear = document.querySelector(".fldr") ? 0 : clear + 1;
    if (clear < 2 && now() - t0 < 5300) {
      setTimeout(check, 120);
      return;
    }
    el.classList.add("is-out");
    el.dataset.endAt = String(now() + 480);
  };
  setTimeout(check, Math.max(0, t0 + 1180 - now()));
}

const subscribeNoop = () => () => {};

export function AppSplash({ tagline }: { tagline: string }) {
  // 서버 HTML 부터(새로 불러올 때) · 화면을 껐다 30초 넘어 돌아올 때(`entry-replay`). 모바일 레이아웃에 붙어 로딩 화면보다 먼저 나온다.
  const play = useSyncExternalStore(subscribeEntry, getEntryPlay, getServerEntryPlay);
  const fromServer = useSyncExternalStore(subscribeNoop, () => false, () => true);

  useEffect(() => {
    if (!play) return;
    const el = document.querySelector<HTMLElement>(".spl");
    runSplash(el); // 서버 HTML 의 스크립트가 이미 돌았으면 아무것도 안 한다
    const nowT = () => (document.timeline && (document.timeline.currentTime as number | null)) || performance.now();
    let id = 0;
    const schedule = () => {
      const r = (Number(el?.dataset.endAt) || nowT() + FINISH_AT) - nowT();
      if (r <= 0) finishEntry(play);
      else id = window.setTimeout(schedule, Math.min(r, 200));
    };
    schedule();
    return () => window.clearTimeout(id);
  }, [play]);

  if (!play) return null;
  return (
    // 인라인 스크립트가 하이드레이션 전에 data-run · data-end-at · is-out 을 붙이므로 속성 차이는 무시
    <div className="spl" aria-hidden="true" key={play} suppressHydrationWarning>
      <div className="spl__c">
        <span className="spl__glow" />
        <span className="spl__hold" />
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
      {fromServer ? (
        <script
          dangerouslySetInnerHTML={{ __html: `(${runSplash.toString()})(document.currentScript.parentElement)` }}
          suppressHydrationWarning
        />
      ) : null}
    </div>
  );
}
