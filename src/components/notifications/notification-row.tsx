import type { ReactNode } from "react";
import type { NotificationView } from "@/lib/notifications/grouping";
import { ChevronDownGlyph, NotificationGlyph } from "@/components/notifications/notification-icons";
import "./notification-white.css";

/**
 * 알림 줄 하나의 모양 — 모바일 알림 화면과 PC 종 팝오버가 같이 쓴다(화이트 리디자인 2026-10-15).
 * 아이콘 칸(안 읽음 옅은 보라 · 읽음 회색) · 굵은 짧은 제목 · 대상 · 「N개 더」 · 시각 · 어디서 · 안 읽음 점.
 *
 * 줄 전체를 누르는 건 `hit`(늘어난 버튼/링크 — 줄 위를 덮는다)이고, 「N개 더」는 그 위에 따로 떠 있는 버튼이다(버튼 안에
 * 버튼을 넣지 않는다). `hit` 은 `aria-labelledby={rowLabelIds(id)}` 로 줄 글자를 이름으로 읽는다.
 */
export function rowLabelIds(baseId: string, unread: boolean) {
  return [`${baseId}-t`, `${baseId}-o`, `${baseId}-m`, unread ? `${baseId}-u` : null].filter(Boolean).join(" ");
}

export function NotificationRowBody({
  baseId,
  view,
  object,
  unread,
  unreadLabel,
  hit,
  more,
  check,
  dotIndex,
}: {
  baseId: string;
  view: NotificationView;
  object: string;
  unread: boolean;
  unreadLabel: string;
  hit: ReactNode;
  more?: { count: number; expanded: boolean; onToggle: () => void; label: string; controls: string } | null;
  /** 선택 모드의 동그란 체크. null 이면 없음. */
  check?: { selected: boolean } | null;
  /** 「모두 읽음」 때 점이 차례로 사라지는 순서. */
  dotIndex?: number;
}) {
  return (
    <div className="nfw-row" data-check={check ? "" : undefined} data-selected={check?.selected ? "" : undefined} data-unread={unread ? "" : undefined}>
      {hit}
      {check ? (
        <span aria-hidden="true" className="nfw-check">
          <svg fill="none" height="12" viewBox="0 0 24 24" width="12">
            <path d="M5 12l5 5 9-10" pathLength={1} stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.4" />
          </svg>
        </span>
      ) : null}
      <span aria-hidden="true" className="nfw-ic">
        <NotificationGlyph icon={view.icon} />
      </span>
      <span className="nfw-tx">
        <span className="nfw-t" id={`${baseId}-t`}>
          {view.title}
        </span>
        <span className="nfw-o" id={`${baseId}-o`}>
          {object}
        </span>
        {more ? (
          <button
            aria-controls={more.controls}
            aria-expanded={more.expanded}
            className="nfw-more"
            onClick={(event) => {
              event.stopPropagation();
              more.onToggle();
            }}
            type="button"
          >
            {more.label}
            <ChevronDownGlyph />
          </button>
        ) : null}
        <span className="nfw-m" id={`${baseId}-m`}>
          {view.source ? `${view.time} · ${view.source}` : view.time}
        </span>
      </span>
      {unread && !check ? (
        <span className="nfw-dot" style={dotIndex != null ? ({ "--i": dotIndex } as React.CSSProperties) : undefined}>
          <span className="sr-only" id={`${baseId}-u`}>
            {unreadLabel}
          </span>
        </span>
      ) : null}
    </div>
  );
}
