"use client";

// 앱 스플래시(2026-10-14, 시안 Motion-B-Splash-Phone) — 앱을 켤 때마다(새로고침 · 다시 접속 · 화면 껐다 켬, `entry-replay`) 흰 바탕 위에서
// 로고 세 막대가 3D 로 흩어졌다 흐릿하게 날아와 스프링으로 모이고, 「Foldy」 글자 속으로 빛이 지나간 뒤,
// 로고가 다가오며 흐려지고(초점 빠짐) 뒤의 홈이 드러난다. 약 1.8초. 동작 줄이기면 보여 주지 않는다.
// 붙는 곳은 `src/app/mobile/layout.tsx`(모든 모바일 화면, 내용보다 앞 — 로딩 화면보다 먼저).
//
// **스플래시 화면은 React 바깥에 있다**(admin-entry 와 같은 이유) — 서버 HTML 의 인라인 스크립트(`mountSplash`)가 body 에 직접
// 붙이고 끝나면 직접 지운다. React 가 화면을 다시 그려도 지워졌다 다시 나오지 않는다.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { getEntryPlay, getServerEntryPlay, subscribeEntry } from "@/lib/entry-replay";
import "./app-splash.css";

/**
 * 스플래시 한 번 — 화면 만들기 · 걷기 · 지우기. **혼자 도는 함수** — 인라인 스크립트로 서버 HTML 안에서 바로 실행된다(바깥 변수 쓰지 말 것).
 * 로고가 모이는 앞부분만 CSS 시간표, **걷히는 건 이 스크립트가 `is-out` 을 붙일 때만**. 로딩 중(.fldr)이면 로더가 두 번 연달아
 * 안 보일 때까지 기다린다(최대 ~5.3초 + CSS 안전장치 6초 + 8초엔 무조건 치움). `id` 는 재생 번호(같은 번호는 두 번 안 띄움).
 */
function mountSplash(id: number, tagline: string, host: Element | null) {
  const w = window as unknown as { __foldySplashLast?: number };
  if (w.__foldySplashLast === id) return;
  w.__foldySplashLast = id;
  try {
    if (document.documentElement.hasAttribute("data-pane") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    return;
  }
  const prev = document.querySelector(".spl");
  if (prev) prev.remove();
  const el = document.createElement("div");
  el.className = "spl";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<div class="spl__c"><span class="spl__glow"></span><span class="spl__hold"></span><span class="spl__tile">' +
    '<span class="spl__bw spl__b3"><span class="spl__bar"></span></span>' +
    '<span class="spl__bw spl__b2"><span class="spl__bar"></span></span>' +
    '<span class="spl__bw spl__b1"><span class="spl__bar"><i></i></span></span>' +
    '</span><span class="spl__ww"><span class="spl__word">Foldy</span></span><span class="spl__tag"></span></div>';
  const tag = el.querySelector(".spl__tag");
  if (tag) tag.textContent = tagline;
  (host || document.body).appendChild(el);
  // 로그인 직후(20초 안) — 로그인 버튼이 오므라든 보라 점 자리에서 로고가 떠오른다(시안 Motion-C-Login-Phone).
  try {
    const raw = sessionStorage.getItem("foldy.loginRise");
    sessionStorage.removeItem("foldy.loginRise");
    const rise = raw ? (JSON.parse(raw) as { t: number; x: number; y: number }) : null;
    const tile = el.querySelector(".spl__tile");
    if (rise && tile && Date.now() - rise.t < 20000) {
      const r = tile.getBoundingClientRect();
      el.style.setProperty("--rise-x", `${Math.round(rise.x - (r.left + r.width / 2))}px`);
      el.style.setProperty("--rise-y", `${Math.round(rise.y - (r.top + r.height / 2))}px`);
      el.classList.add("spl--rise");
    }
  } catch {
    // 저장소를 못 쓰면 평소 스플래시.
  }

  const now = () => (document.timeline && (document.timeline.currentTime as number | null)) || performance.now();
  const t0 = now();
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    el.remove();
  };
  setTimeout(remove, 8000);
  let clear = 0;
  const check = () => {
    clear = document.querySelector(".fldr") ? 0 : clear + 1;
    if (clear < 2 && now() - t0 < 5300) {
      setTimeout(check, 120);
      return;
    }
    el.classList.add("is-out");
    setTimeout(remove, 500);
  };
  setTimeout(check, Math.max(0, t0 + 1180 - now()));
}

// 스플래시가 붙는 빈 상자 — React 는 안(innerHTML)을 한 번 넣고 다시 건드리지 않는다(admin-entry 와 같은 방식). 안의 스크립트는
// 서버 HTML 에서만 실행된다.
export function AppSplash({ tagline }: { tagline: string }) {
  const play = useSyncExternalStore(subscribeEntry, getEntryPlay, getServerEntryPlay);
  const hostRef = useRef<HTMLDivElement>(null);
  const script = `<script>(${mountSplash.toString()})(1, ${JSON.stringify(tagline).replace(/</g, "\\u003c")}, document.currentScript.parentElement)</script>`;

  useEffect(() => {
    // 새로 불러온 재생(1)은 서버 HTML 의 스크립트가 이미 띄웠다(같은 번호는 안에서 걸러짐). 화면을 껐다 돌아온 재생은 여기서.
    if (play) mountSplash(play, tagline, hostRef.current);
  }, [play, tagline]);

  return <div className="spl-host" dangerouslySetInnerHTML={{ __html: script }} ref={hostRef} suppressHydrationWarning />;
}
