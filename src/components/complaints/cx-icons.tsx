import type { ReactNode } from "react";

/** "컴플레인 기록" 목업에서 가져온 인라인 SVG 아이콘 세트. 크기는 `.ic`(1em)가 정한다. */
export const CxIcon = {
  building: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="5" y="3.5" width="14" height="17" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  door: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 20V4.5A1.5 1.5 0 017.5 3h7A1.5 1.5 0 0116 4.5V20M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  cal: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="5.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M4 9.5h16M8 4v3M16 4v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  person: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3.4l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.8l-5.08 2.67.98-5.68L3.75 9.4l5.7-.83z" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="1.4" fill="currentColor" />
      <path d="M5 17l4.5-4.5 3 3L16 11l3 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  zoom: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16l4 4M11 8.5v5M8.5 11h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
  clip: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M19 11l-7.5 7.5a4 4 0 01-5.7-5.7L13 5.6a2.6 2.6 0 013.7 3.7l-7.2 7.2a1.2 1.2 0 01-1.7-1.7l6.6-6.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  chevR: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 7v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 13a9 9 0 1016.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  warn: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 4l9 16H3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M21 15a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h13a2 2 0 012 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  chevL: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9.5 14.5l5-5M8 12l-2 2a3.2 3.2 0 004.5 4.5l2-2M16 12l2-2a3.2 3.2 0 00-4.5-4.5l-2 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  translate: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.6c2.3 2.3 3.5 5.3 3.5 8.4s-1.2 6.1-3.5 8.4M12 3.6c-2.3 2.3-3.5 5.3-3.5 8.4s1.2 6.1 3.5 8.4M3.9 9h16.2M3.9 15h16.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
} satisfies Record<string, ReactNode>;

/** 아이콘을 `.ic` span(1em 크기)으로 감싼다. */
export function CIc({ children }: { children: ReactNode }) {
  return <span className="ic">{children}</span>;
}
