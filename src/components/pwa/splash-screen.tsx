"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 실행 스플래시 — 문서가 처음 로드될 때(콜드 런치 / 새로고침 / 설치된 PWA) 잠깐
 * 아이보리 캔버스 가운데에 앱 아이콘을 보여 주고,
 * 이후 페이드 아웃하며 언마운트된다. 클라이언트 컴포넌트지만
 * 서버 렌더되므로 스플래시가 초기 HTML 에 들어 있어 첫 페인트에서 보인다
 * (하이드레이션 전 빈 캔버스가 번쩍이지 않음). 앱 내부 라우트
 * 전환은 문서를 다시 로드하지 않으므로 실제 실행 때만 나타난다.
 */
const HOLD_MS = 160;
const FADE_MS = 180;

export function SplashScreen() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible");
  // /admin · /mobile 은 자기 진입 모션(admin-entry · app-splash)이 있다 — 이 아이콘 스플래시까지 뜨면 「가만히 있는 로고가
  // 떴다 꺼진 뒤 모션 로고가 또 나옴」이 됐다(2026-10-14 사용자 지적). 로그인 · 온보딩 같은 나머지 화면에서만.
  const pathname = usePathname() ?? "";
  const hasOwnEntry = pathname.startsWith("/admin") || pathname.startsWith("/mobile");

  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase("fading"), HOLD_MS);
    const goneTimer = setTimeout(() => setPhase("gone"), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(goneTimer);
    };
  }, []);

  if (phase === "gone" || hasOwnEntry) return null;

  return (
    <div
      aria-hidden="true"
      // 2분할 오른쪽 칸(`html[data-pane]`) 안에서는 뜨지 않는다 — 상세를 열 때마다 앱 아이콘이 깜빡이면 안 된다.
      data-splash=""
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        /* 콜드 PWA 실행에서 CSS 변수가 풀리기 전에도 아이보리가 보이도록 하드코딩한다. */
        background: "#ffffff",
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        src="/icons/icon-192.png"
        width={88}
        height={88}
        style={{
          width: 88,
          height: 88,
          borderRadius: 22,
          animation: "splash-pop 520ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "calc(env(safe-area-inset-bottom) + 48px)",
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <span
          className="wordmark"
          style={{
            fontSize: 22,
            color: "var(--foreground)",
            animation: "splash-pop 520ms cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          Foldy
        </span>
      </div>
    </div>
  );
}
