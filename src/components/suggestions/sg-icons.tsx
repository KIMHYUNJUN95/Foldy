/**
 * "Feedback Box.html" 핸드오프 목업에서 1:1 로 가져온 인라인 SVG 아이콘.
 * 각 아이콘은 `currentColor` 로 색을 상속받고 부모 `.ic`
 * 래퍼(`width/height: 1em`)가 크기를 정한다. UI/UX 전용 — 동작은 붙어 있지 않다.
 */
import type { ReactNode } from "react";

export const SgIcon = {
  menu: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M4 12h11M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8.5" r="3.4" stroke="currentColor" strokeWidth="2" />
      <path d="M5.5 19c1.1-3 3.7-4.5 6.5-4.5S17.4 16 18.5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevR: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevD: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevU: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M21 3.5L10 14.5M21 3.5l-7 17-3-7.5-7.5-3 17.5-6.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 13l2.2-7.2A2 2 0 018.1 4.4h7.8a2 2 0 011.9 1.4L20 13v4.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5V13z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 13h4l1.2 2.2h5.6L16 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  comment: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 5.5h16a1 1 0 011 1V16a1 1 0 01-1 1H9l-4 3.5V17H4a1 1 0 01-1-1V6.5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 20.3l-1.45-1.32C5.4 14.36 2 11.28 2 7.5 2 4.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09C13.09 2.81 14.76 2 16.5 2 19.58 2 22 4.42 22 7.5c0 3.78-3.4 6.86-8.55 11.49L12 20.3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  paperclip: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M19 11l-7.5 7.5a4 4 0 01-5.7-5.7L13 5.6a2.6 2.6 0 013.7 3.7l-7.2 7.2a1.2 1.2 0 01-1.7-1.7l6.6-6.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 17l4.5-4 3 2.5L16 12l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  building: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="5" y="3.5" width="14" height="17" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  door: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 20V4.5A1.5 1.5 0 017.5 3h7A1.5 1.5 0 0116 4.5V20M4 20h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  tag: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3.5 11.5v-7a1 1 0 011-1h7L20.5 12 12 20.5 3.5 12v-.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    </svg>
  ),
  arrowR: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="6.5" y="5" width="3.5" height="14" rx="1.2" fill="currentColor" />
      <rect x="14" y="5" width="3.5" height="14" rx="1.2" fill="currentColor" />
    </svg>
  ),
  flag: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 21V4.5M6 4.5c2.5-1.6 5-1.6 7.5 0s5 1.6 7 .3V14c-2 1.3-4.5 1.3-7 -.3s-5-1.6-7.5 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10.5V8a4 4 0 018 0v2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 10a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 19.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
} satisfies Record<string, ReactNode>;

/** 디자인 전반에서 쓰는 `.ic` span(1em 크기)으로 아이콘을 감싼다. */
export function Ic({ children }: { children: ReactNode }) {
  return <span className="ic">{children}</span>;
}
