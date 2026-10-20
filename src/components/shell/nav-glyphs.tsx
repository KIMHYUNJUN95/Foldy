import type { ReactNode } from "react";

/**
 * 메뉴 아이콘 모음 — 하단 탭 · 폴드 레일 · 태블릿 사이드바가 같은 그림을 쓴다(HIG 다듬기 2차, 2026-10-19).
 * 고른 항목은 채운 모양: [data-fill] 은 속을 채우고, [data-knock] 은 채운 면 위에서 바탕색으로 비워 보이게,
 * [data-on] 은 고른 때만 보인다(globals.css 「고른 탭은 채운 아이콘」). 키는 내비게이션 항목 id.
 */
export const NAV_GLYPHS: Record<string, ReactNode> = {
  home: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path data-fill="" d="M4 11.5L12 5l8 6.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path data-fill="" d="M6 10.5V19h12v-8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  calendar: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect data-fill="" x="4" y="5.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path data-knock="" d="M5 9.5h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8 4v3M16 4v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  cleaning: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path data-fill="" d="M12 4l1.4 3.6L17 9l-3.6 1.4L12 14l-1.4-3.6L7 9l3.6-1.4L12 4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path data-fill="" d="M18 14l.7 1.8 1.8.7-1.8.7L18 19l-.7-1.8-1.8-.7 1.8-.7L18 14z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  requests: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect data-fill="" x="5.5" y="4.5" width="13" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.9" />
      <path data-fill="" d="M9 3.5h6v3H9z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path data-knock="" d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  announcements: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path data-fill="" d="M4 10v4h3l6 4V6l-6 4H4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M17.5 9.2a3.6 3.6 0 010 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  "ops-calendar": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect data-fill="" x="4" y="5.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path data-knock="" d="M5 9.5h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8 4v3M16 4v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path data-knock="" d="M13.6 12.4h-2.1a1.2 1.2 0 000 2.4h1a1.2 1.2 0 010 2.4H10.4M12 11.6v.8M12 17.2v.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  notifications: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path data-fill="" d="M6 10a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 19.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  directory: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle data-fill="" cx="9" cy="8.5" r="3.1" stroke="currentColor" strokeWidth="1.8" />
      <path data-fill="" d="M3.6 19c.9-2.6 3-4 5.4-4s4.5 1.4 5.4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16.3 6.3a2.8 2.8 0 010 5M18.2 18.8c-.3-1.3-.8-2.4-1.6-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  users: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle data-fill="" cx="10" cy="8.5" r="3.3" stroke="currentColor" strokeWidth="1.8" />
      <path data-fill="" d="M3.8 19.2c.9-2.8 3.3-4.4 6.2-4.4 1.1 0 2.1.2 3 .6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17.5" cy="17" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M17.5 13.4v1.2M17.5 19.4v1.2M21.1 17h-1.2M15.1 17h-1.2M20 14.5l-.8.8M15.8 18.7l-.8.8M20 19.5l-.8-.8M15.8 15.3l-.8-.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  suggestions: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path data-fill="" d="M4 13l2.2-7.2A2 2 0 018.1 4.4h7.8a2 2 0 011.9 1.4L20 13v4.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5V13z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path data-knock="" d="M4 13h4l1.2 2.2h5.6L16 13h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  attendance: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle data-fill="" cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.9" />
      <path data-knock="" d="M12 7.5v5l3.2 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export const FALLBACK_GLYPH = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle data-fill="" cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.8" />
    <path data-on="" data-knock="" d="M8.6 12.2l2.3 2.3 4.5-4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
