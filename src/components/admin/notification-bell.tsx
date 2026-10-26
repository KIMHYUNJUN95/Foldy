"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  getAdminNotifications,
  markAllAdminNotificationsRead,
  type AdminNotifData,
} from "@/app/admin/notification-actions";
import { NotificationRowBody, rowLabelIds } from "@/components/notifications/notification-row";
import { groupNotificationViews, type NotificationGroup } from "@/lib/notifications/grouping";
import "@/components/notifications/notification-white.css";

/**
 * Admin 콘솔 알림 벨 — 벨에 고정되는 드롭다운 팝오버
 * (모바일 알림 페이지로 이동하지 않음). 최근 알림과 실제 안 읽은 수를
 * 가져오고 "모두 읽음"을 지원하며
 * 전체 알림 센터로 연결한다. docs/product/05-admin-web-ia.md → "Notification Center" 참고.
 *
 * 화이트 리디자인(2026-10-15, 시안 NotifPop-PC): 400px · 머리 「알림 · 안 읽음 N · 모두 읽음」 · 모바일 알림 화면과 같은 줄
 * (짧은 제목 · 대상 · 시각 · 어디서, 같은 날 같은 종류는 묶어서 「N개 더」) · 아래 「알림 전체 보기 →」.
 * 종에서 커지며 열림(오른쪽 위 기준 .96 → 1 + 페이드 160ms), Esc · 바깥 클릭으로 닫힘.
 */
const MAX_GROUPS = 6;
const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);

export function NotificationBell({
  labels,
}: {
  labels: { title: string; markAll: string; viewAll: string; empty: string };
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AdminNotifData>({ unread: 0, items: [], copy: null });
  const [reading, setReading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    getAdminNotifications()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => groupNotificationViews(data.items).slice(0, MAX_GROUPS), [data.items]);

  async function markAll() {
    setReading(true); // 점이 차례로 사라진다
    await markAllAdminNotificationsRead();
    const fresh = await getAdminNotifications().catch(() => null);
    window.setTimeout(() => {
      if (fresh) setData(fresh);
      setReading(false);
    }, 380);
  }

  const copy = data.copy;
  let dotIndex = 0;

  return (
    <div className="bellwrap" ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={labels.title}
        className="tbtn"
        onClick={() => setOpen((v) => !v)}
        ref={buttonRef}
        type="button"
      >
        <span className="ic"><Bell /></span>
        {data.unread > 0 && <span className="dot">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>

      {open && (
        <div aria-label={labels.title} className="nfw-pop" data-reading={reading ? "" : undefined} role="dialog">
          <div className="nfw-pop__h">
            <b>{labels.title}</b>
            {data.unread > 0 && copy ? <span>{fill(copy.unreadShort, { n: data.unread })}</span> : null}
            <button disabled={data.unread === 0 || reading} onClick={markAll} type="button">
              {labels.markAll}
            </button>
          </div>

          {groups.length === 0 ? (
            <div className="nfw-pop__empty">{labels.empty}</div>
          ) : (
            <div className="nfw-pop__list">
              {groups.map((group) => {
                const headDot = group.unread ? dotIndex++ : undefined;
                const restDots = group.rest.map((item) => (item.unread ? dotIndex++ : undefined));
                return (
                  <PopGroup
                    copy={copy}
                    expanded={expanded.has(group.head.id)}
                    group={group}
                    headDot={headDot}
                    key={group.head.id}
                    onNavigate={() => setOpen(false)}
                    onToggle={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.head.id)) next.delete(group.head.id);
                        else next.add(group.head.id);
                        return next;
                      })
                    }
                    restDots={restDots}
                    unreadLabel={copy?.unread ?? ""}
                  />
                );
              })}
            </div>
          )}

          <Link className="nfw-pop__foot" href="/notifications" onClick={() => setOpen(false)}>
            {copy?.viewAll ?? labels.viewAll} →
          </Link>
        </div>
      )}
    </div>
  );
}

function PopGroup({
  group,
  copy,
  expanded,
  headDot,
  restDots,
  unreadLabel,
  onToggle,
  onNavigate,
}: {
  group: NotificationGroup;
  copy: AdminNotifData["copy"];
  expanded: boolean;
  headDot: number | undefined;
  restDots: (number | undefined)[];
  unreadLabel: string;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const restId = useId();
  const hasMore = group.rest.length > 0 && copy != null;
  const object =
    hasMore && !expanded && copy ? fill(copy.objectMore, { object: group.head.object }) : group.head.object;
  return (
    <>
      <PopRow
        dotIndex={headDot}
        more={
          hasMore && copy
            ? {
                count: group.rest.length,
                expanded,
                onToggle,
                label: expanded ? copy.less : fill(copy.more, { n: group.rest.length }),
                controls: restId,
              }
            : null
        }
        object={object}
        onNavigate={onNavigate}
        unread={expanded ? group.head.unread : group.unread}
        unreadLabel={unreadLabel}
        view={group.head}
      />
      {hasMore ? (
        <div className="nfw-rest" data-open={expanded ? "" : undefined} id={restId} inert={!expanded}>
          <div>
            {group.rest.map((item, index) => (
              <PopRow
                dotIndex={restDots[index]}
                key={item.id}
                more={null}
                object={item.object}
                onNavigate={onNavigate}
                unread={item.unread}
                unreadLabel={unreadLabel}
                view={item}
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PopRow({
  view,
  object,
  unread,
  unreadLabel,
  more,
  dotIndex,
  onNavigate,
}: {
  view: NotificationGroup["head"];
  object: string;
  unread: boolean;
  unreadLabel: string;
  more: { count: number; expanded: boolean; onToggle: () => void; label: string; controls: string } | null;
  dotIndex: number | undefined;
  onNavigate: () => void;
}) {
  const baseId = useId();
  return (
    <div className="nfw-item">
      <div className="nfw-item__in">
        <div className="nfw-sw">
          <NotificationRowBody
            baseId={baseId}
            dotIndex={dotIndex}
            hit={
              <Link
                aria-labelledby={rowLabelIds(baseId, unread)}
                className="nfw-hit"
                href={view.href || "/notifications"}
                onClick={onNavigate}
              />
            }
            more={more}
            object={object}
            unread={unread}
            unreadLabel={unreadLabel}
            view={view}
          />
        </div>
      </div>
    </div>
  );
}
