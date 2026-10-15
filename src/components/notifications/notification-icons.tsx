import type { NotificationIconKey } from "@/lib/notifications/grouping";

/** 알림 줄 아이콘(화이트 리디자인 시안 Notif-* 와 같은 선 굵기 1.8 · 24 격자). 장식이므로 늘 aria-hidden. */
const PATHS: Record<NotificationIconKey, React.ReactNode> = {
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  check: <path d="M5 12l5 5 9-10" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3 2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  comment: <path d="M5 18.5V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H9z" />,
  box: (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M4 8l8 4 8-4M12 12v8" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10v4h3l7 4V6l-7 4z" />
      <path d="M17.5 9.5a3.5 3.5 0 0 1 0 5" />
    </>
  ),
  at: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.5 6.9" />
    </>
  ),
  bug: (
    <>
      <rect x="7.5" y="8" width="9" height="12" rx="4.5" />
      <path d="M12 12v8M4 13h3.5M16.5 13H20M5 8l2.5 2M19 8l-2.5 2M9.5 6.5L8.5 4.5M14.5 6.5l1-2" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9V15h7v-1.1A6 6 0 0 0 12 3z" />
    </>
  ),
  folder: <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />,
};

export function NotificationGlyph({ icon }: { icon: NotificationIconKey }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="17"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="17"
    >
      {PATHS[icon] ?? PATHS.bell}
    </svg>
  );
}

/** 밀어서 「읽음」 — 열린 봉투. */
export function EnvelopeOpenGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="18">
      <path d="M4 9l8-5 8 5v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 9l8 5 8-5" />
    </svg>
  );
}

/** 밀어서 「지우기」 · 「N개 지우기」 — 휴지통. */
export function TrashGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width={size}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

export function ChevronDownGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" width="12">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
