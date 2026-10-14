"use client";

// 모바일 공지 목록 — 화이트 리디자인(2026-10-15, 시안 Notice-Phone · Notice-Fold · Notice-Tablet).
// 맨 위 「고정」 묶음(날짜를 meta 에) → 날짜 묶음. 안 읽은 공지는 보라 점 + 굵은 제목. 누르면 점이 바로 사라진다
// (상세에 들어가면 서버가 읽음으로 남긴다 — 태블릿 2분할에서는 목록을 다시 읽기 전까지 이 화면이 먼저 지운다).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import "./announcements-mobile.css";

export type MobileNoticeRow = {
  id: string;
  title: string;
  meta: string;
  important: boolean;
  unread: boolean;
  hasImages: boolean;
};

export type MobileNoticeGroup = { key: string; label: string; items: MobileNoticeRow[] };

export function AnnouncementListMobile({
  title,
  groups,
  copy,
}: {
  title: string;
  groups: MobileNoticeGroup[];
  copy: { important: string; unreadN: string; allRead: string; unreadSr: string; hasPhoto: string; empty: string; emptyHint: string };
}) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const markOpened = (id: string) => setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  // 태블릿 2분할은 줄 클릭을 가로채 오른쪽 칸에 연다(줄의 onClick 까지 오지 않음) — 그 칸에 열린 줄 표시(data-split-active)를 보고 지운다.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const el = record.target as HTMLElement;
        if (el.hasAttribute("data-split-active") && el.dataset.noticeId) markOpened(el.dataset.noticeId);
      }
    });
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["data-split-active"] });
    return () => observer.disconnect();
  }, []);
  const unread = groups.reduce((sum, group) => sum + group.items.filter((item) => item.unread && !opened.has(item.id)).length, 0);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="ntw" ref={rootRef}>
      <header className="ntw-head">
        <h1>{title}</h1>
        {total > 0 ? <span className="num" aria-live="polite">{unread > 0 ? copy.unreadN.replace("{n}", String(unread)) : copy.allRead}</span> : null}
      </header>

      {total === 0 ? (
        <div className="ntw-empty">
          <b>{copy.empty}</b>
          <span>{copy.emptyHint}</span>
        </div>
      ) : (
        <div className="ntw-groups">
          {groups.map((group) => (
            <section key={group.key} className="ntw-group" aria-label={group.label}>
              <h2>{group.label}</h2>
              {group.items.map((item) => {
                const isUnread = item.unread && !opened.has(item.id);
                return (
                  <Link
                    key={item.id}
                    href={`/mobile/announcements/${item.id}`}
                    className={`ntw-row${isUnread ? " is-unread" : ""}`}
                    data-notice-id={item.id}
                    onClick={() => markOpened(item.id)}
                  >
                    <span className="ntw-dot" aria-hidden="true" />
                    <span className="ntw-row__b">
                      {item.important ? <span className="ntw-tag">{copy.important}</span> : null}
                      <span className="ntw-row__t">
                        {isUnread ? <span className="sr-only">{copy.unreadSr} · </span> : null}
                        {item.title}
                      </span>
                      <span className="ntw-row__m">{item.meta}</span>
                    </span>
                    {item.hasImages ? (
                      <svg className="ntw-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={copy.hasPhoto}>
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <circle cx="9" cy="10" r="1.6" />
                        <path d="M21 16l-5-5-8 8" />
                      </svg>
                    ) : null}
                  </Link>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
