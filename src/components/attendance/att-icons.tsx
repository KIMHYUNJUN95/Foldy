/**
 * "Attendance Module v2.html" 에서 1:1 로 옮긴 인라인 SVG 아이콘 (홈과
 * 캡처 화면에서 쓰는 부분집합). 부모의 `.ic` 래퍼(1em)가 크기를 정한다. UI/UX 전용.
 */
import type { ReactNode } from "react";

export const AttIcon = {
  back: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  qr: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.9" />
      <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.9" />
      <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.9" />
      <path d="M14 14h3v3M20 14v6M14 20h3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  wifi: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M2.5 9.5a14 14 0 0119 0M5.5 13a10 10 0 0113 0M8.5 16.5a6 6 0 017 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="20" r="1.3" fill="currentColor" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v5l3.2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M10 4H6a1.5 1.5 0 00-1.5 1.5v13A1.5 1.5 0 006 20h4M16 8l4 4-4 4M20 12H10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  coffee: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 8h12v5a4 4 0 01-4 4H9a4 4 0 01-4-4V8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M17 9h2.2a2.3 2.3 0 010 4.6H17" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M8 5.5l11 6.5-11 6.5v-13z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  checkc: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12.2l2.6 2.6L16 9.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  warn: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 4l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" />
    </svg>
  ),
  gpsoff: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 21s7-5.5 7-11a7 7 0 00-1-3.5M8 4.2A7 7 0 005 10c0 5.5 7 11 7 11M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 20l.8-3.6L15.4 5.8a2 2 0 0 1 2.8 2.8L7.6 19.2 4 20z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M20 11a8 8 0 10-1.5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M20 5v6h-6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 17l4.5-4 3 2.5L16 12l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  chevR: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  caret: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M21 3.5L10 14.5M21 3.5l-7 17-3-7.5-7.5-3 17.5-6.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
    </svg>
  ),
  arrowR: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10.5V8a4 4 0 018 0v2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="6" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 10h17M16 14.5h1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9.6 5.8A10 10 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3 3.7M6.3 7.8A17 17 0 002.5 12S6 18.5 12 18.5a9.6 9.6 0 003.7-.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M7 3h7.5L19 7.5V20a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 016 20V4.5A1.5 1.5 0 017 3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14.5 3v5h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 19c.9-2.7 3-4.2 5.5-4.2S13.6 16.3 14.5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 6.2a3 3 0 010 5.6M18 18.6c-.5-1.7-1.6-2.9-3-3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="5.5" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h16M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  bus: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 9h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 17v2M16 17v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.5" cy="14.5" r="1.3" fill="currentColor" />
      <circle cx="15.5" cy="14.5" r="1.3" fill="currentColor" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6.62 10.79a15.5 15.5 0 006.59 6.59l2.2-2.2a1.02 1.02 0 011.05-.24c1.12.37 2.33.57 3.54.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4.5c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.22.2 2.42.57 3.54.11.36.03.76-.25 1.04l-2.2 2.17z" fill="currentColor" />
    </svg>
  ),
  // 연차 · 휴가 바로가기 — 파라솔(휴가) 아이콘
  beach: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 20V9M12 9a7 7 0 00-8 3l16-2a7 7 0 00-8-1z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  // 휴가 종류 아이콘 (경조=heart · 특별=gift · 유급=coin · 기타=doc[기존])
  heart: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 20s-7-4.4-7-9.5A3.5 3.5 0 0112 8a3.5 3.5 0 017 2.5C19 15.6 12 20 12 20z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  gift: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="10" width="16" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 7.5h18V10H3zM12 7.5V20M12 7.5S10.5 4 8.5 4.6 10 7.5 12 7.5zM12 7.5S13.5 4 15.5 4.6 14 7.5 12 7.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  coin: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5v9M9.5 9.5h4a1.7 1.7 0 010 3.4h-3a1.7 1.7 0 000 3.4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  ),
  save: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 4.5h11l3 3V19a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 19V6A1.5 1.5 0 015 4.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 4.5v4h6M8 20v-5h8v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 11.5L12 5l8 6.5M6 10.5V19h12v-8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M4 6h.5M4 12h.5M4 18h.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 3l7 2.5v5.2c0 4.5-3 8-7 10-4-2-7-5.5-7-10V5.5L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ban: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M9 7V4.5A1.5 1.5 0 0110.5 3h3A1.5 1.5 0 0115 4.5V7M6 7l1 12.5A1.5 1.5 0 008.5 21h7a1.5 1.5 0 001.5-1.5L18 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9 7L5 11l4 4M5 11h9a5 5 0 010 10h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
} satisfies Record<string, ReactNode>;

/** 진행 링이 쓰는 SVG 그라디언트 정의 (navy = 근무 중, amber = 휴게). 한 번만 렌더링. */
export function AttRingDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="attGradNavy" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(223 50% 46%)" />
          <stop offset="1" stopColor="hsl(223 54% 26%)" />
        </linearGradient>
        <linearGradient id="attGradAmber" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(38 84% 52%)" />
          <stop offset="1" stopColor="hsl(32 76% 38%)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** 디자인 전반에서 쓰는 `.ic` span 으로 아이콘을 감싼다 (1em 크기). */
export function AIc({ children }: { children: ReactNode }) {
  return <span className="ic">{children}</span>;
}
