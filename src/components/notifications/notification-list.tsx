"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import {
  deleteNotifications,
  markAllNotificationsRead,
  markNotificationsAsRead,
} from "@/app/mobile/notifications/actions";
import { EnvelopeOpenGlyph, NotificationGlyph, TrashGlyph } from "@/components/notifications/notification-icons";
import { NotificationRowBody, rowLabelIds } from "@/components/notifications/notification-row";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet, useSplitPush } from "@/components/shell/split-list";
import { haptic } from "@/lib/haptics";
import {
  filterByTab,
  groupNotificationViews,
  NOTIFICATION_TABS,
  sectionizeGroups,
  unreadByTab,
  type NotificationGroup,
  type NotificationSection,
  type NotificationTab,
  type NotificationView,
} from "@/lib/notifications/grouping";
import type { Dictionary } from "@/lib/i18n";
import "./notification-white.css";

/**
 * 모바일 알림 화면 — 화이트 리디자인(2026-10-15, 시안 Notif-Phone · NotifSelect-Phone · NotifClear-Phone · Notif-Fold · Notif-Tablet).
 *
 * 도메인 계약: docs/product/14-notification-design.md 「알림 화면 — 화이트 리디자인」 · 「알림 지우기」
 *
 * - 줄: 무엇이(굵은 짧은 제목) · 어느 것 · 언제 · 어디서 + 안 읽음 점. 글자는 서버(`brief.ts`)가 만든다.
 * - 같은 날 · 같은 종류가 이어지면 한 줄로 묶고 「N개 더」로 펼친다(`grouping.ts`). 구간 오늘 · 이번 주 · 이전, 종류 탭.
 * - 「지우기」 → 선택 모드: 골라서 지우기는 바로, 「모두 지우기」는 공용 BottomSheet 로 확인(지금 탭만). 되돌리기 없음(하드 삭제).
 * - 폰 · 폴드: 줄을 왼쪽으로 밀면 「읽음 · 지우기」 타일. 끝까지 밀고 놓으면 지운다. 열린 줄은 하나만, 다른 데를 누르면 닫힌다.
 *   열렸거나 미는 중인 줄만 `data-swipe-back="off"`(화면 스와이프 뒤로가기와 겹치지 않게).
 * - 태블릿 가로: 2분할(`SplitList`) — 누른 알림의 상세를 오른쪽 칸에, 고른 줄은 옅은 보라.
 */

type Copy = Dictionary["mobile"]["notifications"]["w"] & { title: string };

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);

const COLLAPSE_MS = 280;
const READ_STAGGER_MS = 420;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type NotificationListProps = {
  items: NotificationView[];
  todayKey: string;
  copy: Copy;
};

export function NotificationList({ items, todayKey, copy }: NotificationListProps) {
  const splitPush = useSplitPush();
  const isTablet = useIsTablet();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<NotificationTab>("all");
  const [gone, setGone] = useState<Set<string>>(() => new Set()); // 접히는 중
  const [removed, setRemoved] = useState<Set<string>>(() => new Set()); // 다 접혀 빠짐
  const [readLocal, setReadLocal] = useState<Set<string>>(() => new Set());
  const [reading, setReading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  const views = useMemo(
    () =>
      items
        .filter((item) => !removed.has(item.id))
        .map((item) => (item.unread && readLocal.has(item.id) ? { ...item, unread: false } : item)),
    [items, removed, readLocal],
  );
  const counts = useMemo(() => unreadByTab(views), [views]);
  const tabItems = useMemo(() => filterByTab(views, tab).filter((item) => !gone.has(item.id)), [views, tab, gone]);
  const sections = useMemo(
    () => sectionizeGroups(groupNotificationViews(filterByTab(views, tab)), todayKey),
    [views, tab, todayKey],
  );

  // 열린 줄 — 다른 데를 누르면 닫는다.
  useEffect(() => {
    if (!openRow) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-row-key="${CSS.escape(openRow)}"]`)) return;
      setOpenRow(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [openRow]);

  const tabLabel: Record<NotificationTab, string> = {
    all: copy.tabAll,
    work: copy.tabWork,
    notice: copy.tabNotice,
    board: copy.tabBoard,
    attendance: copy.tabAttendance,
  };
  const sectionLabel: Record<NotificationSection, string> = {
    today: copy.sectionToday,
    week: copy.sectionWeek,
    earlier: copy.sectionEarlier,
  };

  const fail = useCallback(() => {
    setError(copy.actionFailed);
    window.setTimeout(() => setError(""), 3200);
  }, [copy.actionFailed]);

  /** 지우기 — 줄이 접히며 사라지고(낙관적), 서버가 실패하면 되돌린다. 하드 삭제 · 내 알림만(서버 액션 + RLS). */
  const removeIds = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      haptic("medium");
      setOpenRow(null);
      setGone((prev) => new Set([...prev, ...ids]));
      window.setTimeout(
        () => setRemoved((prev) => new Set([...prev, ...ids])),
        prefersReducedMotion() ? 0 : COLLAPSE_MS,
      );
      startTransition(async () => {
        const result = await deleteNotifications(ids).catch(() => ({ ok: false as const }));
        if (!result.ok) {
          setGone((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
          setRemoved((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
          fail();
        }
      });
    },
    [fail],
  );

  const markRead = useCallback(
    (ids: string[]) => {
      const unreadIds = ids.filter((id) => views.find((item) => item.id === id)?.unread);
      if (!unreadIds.length) return;
      setReadLocal((prev) => new Set([...prev, ...unreadIds]));
      startTransition(async () => {
        const result = await markNotificationsAsRead(unreadIds).catch(() => ({ ok: false as const }));
        if (!result.ok) {
          setReadLocal((prev) => new Set([...prev].filter((id) => !unreadIds.includes(id))));
          fail();
        }
      });
    },
    [fail, views],
  );

  function handleMarkAllRead() {
    if (!counts.all || busy) return;
    const unreadIds = views.filter((item) => item.unread).map((item) => item.id);
    haptic("light");
    setBusy(true);
    setReading(true); // 점이 차례로 사라진다
    window.setTimeout(
      () => {
        setReadLocal((prev) => new Set([...prev, ...unreadIds]));
        setReading(false);
      },
      prefersReducedMotion() ? 0 : READ_STAGGER_MS,
    );
    startTransition(async () => {
      const result = await markAllNotificationsRead().catch(() => ({ ok: false as const }));
      setBusy(false);
      if (!result.ok) {
        setReadLocal((prev) => new Set([...prev].filter((id) => !unreadIds.includes(id))));
        fail();
      }
    });
  }

  function openNotification(view: NotificationView) {
    if (view.unread) markRead([view.id]);
    if (isTablet) setActiveId(view.id);
    // 태블릿 가로 2분할 안이면 오른쪽 칸에 연다(`useSplitPush` — 그 밖에서는 그대로 이동).
    splitPush(view.href);
  }

  function enterSelect() {
    setOpenRow(null);
    setSelected(new Set());
    setSelectMode(true);
  }
  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }
  function toggleIds(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }
  const allSelected = tabItems.length > 0 && tabItems.every((item) => selected.has(item.id));
  const selectedCount = tabItems.filter((item) => selected.has(item.id)).length;

  function deleteSelected() {
    const ids = tabItems.filter((item) => selected.has(item.id)).map((item) => item.id);
    if (!ids.length) return;
    removeIds(ids);
    exitSelect();
  }

  function clearTab() {
    const ids = tabItems.map((item) => item.id);
    removeIds(ids);
    exitSelect();
  }

  // ── 그리기 ──
  if (views.length === 0) {
    return (
      <div className="nfw">
        <Header copy={copy} unread={0} onMarkAll={null} onClear={null} />
        <EmptyState body={copy.emptyBody} title={copy.empty} />
      </div>
    );
  }

  let dotIndex = 0;

  return (
    <div className="nfw" data-reading={reading ? "" : undefined}>
      {selectMode ? (
        <div className="nfw-h">
          <div className="nfw-h__t">
            <h1 aria-live="polite">{fill(copy.selectedCount, { n: selectedCount })}</h1>
            <p>{copy.selectHint}</p>
          </div>
          <div className="nfw-h__acts">
            <button
              className="nfw-tbtn"
              data-tone="pri"
              disabled={!tabItems.length}
              onClick={() => setSelected(allSelected ? new Set() : new Set(tabItems.map((item) => item.id)))}
              type="button"
            >
              {allSelected ? copy.deselectAll : copy.selectAll}
            </button>
            <button className="nfw-tbtn" onClick={exitSelect} type="button">
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : (
        <>
          <Header
            copy={copy}
            onClear={views.length ? enterSelect : null}
            onMarkAll={counts.all ? handleMarkAllRead : null}
            unread={counts.all}
          />
          <div aria-label={copy.tabsLabel} className="nfw-tabs" role="tablist">
            {NOTIFICATION_TABS.map((key) => (
              <button
                aria-selected={tab === key}
                className="nfw-tab"
                key={key}
                onClick={() => {
                  setTab(key);
                  setOpenRow(null);
                }}
                role="tab"
                type="button"
              >
                {tabLabel[key]}
                {key !== "all" && counts[key] > 0 ? <b>{counts[key]}</b> : null}
              </button>
            ))}
          </div>
        </>
      )}

      {error ? (
        <p className="nfw-msg" role="alert">
          {error}
        </p>
      ) : null}

      {sections.length === 0 ? (
        <EmptyState body="" title={copy.tabEmpty} />
      ) : (
        <div className="nfw-list" data-wide={isTablet ? "" : undefined} role={selectMode ? "group" : undefined}>
          {sections.map(({ section, groups }) => (
            <SectionBlock key={section} label={sectionLabel[section]}>
              {groups.map((group) => {
                const groupGone = group.ids.every((id) => gone.has(id));
                const isOpen = expanded.has(group.head.id) && !selectMode;
                const headDot = group.unread ? dotIndex++ : undefined;
                const restDots = group.rest.map((item) => (item.unread ? dotIndex++ : undefined));
                return (
                  <GroupBlock
                    activeId={activeId}
                    copy={copy}
                    expanded={isOpen}
                    gone={gone}
                    group={group}
                    groupGone={groupGone}
                    headDot={headDot}
                    key={group.head.id}
                    onDelete={removeIds}
                    onOpen={openNotification}
                    onOpenRow={setOpenRow}
                    onRead={markRead}
                    onToggleExpand={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.head.id)) next.delete(group.head.id);
                        else next.add(group.head.id);
                        return next;
                      })
                    }
                    onToggleSelect={toggleIds}
                    openRow={openRow}
                    restDots={restDots}
                    selected={selected}
                    selectMode={selectMode}
                    swipeable={!selectMode && !isTablet}
                  />
                );
              })}
            </SectionBlock>
          ))}
        </div>
      )}

      {selectMode ? (
        <div className="nfw-bar">
          <button className="nfw-bar__all" disabled={!tabItems.length} onClick={() => setConfirmOpen(true)} type="button">
            {copy.clearAll}
          </button>
          <button className="nfw-bar__del" disabled={!selectedCount} onClick={deleteSelected} type="button">
            <TrashGlyph />
            {fill(copy.deleteSelected, { n: selectedCount })}
          </button>
        </div>
      ) : null}

      {confirmOpen ? (
        <BottomSheet ariaLabel={tab === "all" ? copy.clearConfirmTitle : fill(copy.clearConfirmTitleTab, { tab: tabLabel[tab] })} onClose={() => setConfirmOpen(false)}>
          {({ close }) => (
            <div className="nfw-cf">
              <span aria-hidden="true" className="nfw-cf__ic">
                <TrashGlyph size={22} />
              </span>
              <h2>{tab === "all" ? copy.clearConfirmTitle : fill(copy.clearConfirmTitleTab, { tab: tabLabel[tab] })}</h2>
              <p>
                {fill(copy.clearConfirmBody, { n: tabItems.length })}
                <br />
                {copy.clearConfirmNote}
              </p>
              <button
                className="nfw-cf__go"
                onClick={() => {
                  clearTab();
                  close();
                }}
                type="button"
              >
                {fill(copy.clearConfirmAction, { n: tabItems.length })}
              </button>
              <button className="nfw-cf__no" onClick={close} type="button">
                {copy.cancel}
              </button>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </div>
  );
}

function Header({
  copy,
  unread,
  onMarkAll,
  onClear,
}: {
  copy: Copy;
  unread: number;
  onMarkAll: (() => void) | null;
  onClear: (() => void) | null;
}) {
  const [before, after] = copy.unreadSummary.split("{n}");
  return (
    <div className="nfw-h">
      <div className="nfw-h__t">
        <h1>{copy.title}</h1>
        <p aria-live="polite">
          {unread > 0 ? (
            <>
              {before}
              <b>{unread}</b>
              {after}
            </>
          ) : (
            copy.allRead
          )}
        </p>
      </div>
      {onMarkAll || onClear ? (
        <div className="nfw-h__acts">
          {onMarkAll ? (
            <button className="nfw-tbtn" data-tone="pri" onClick={onMarkAll} type="button">
              {copy.markAllRead}
            </button>
          ) : null}
          {onClear ? (
            <button className="nfw-tbtn" onClick={onClear} type="button">
              {copy.clear}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="nfw-empty">
      <span aria-hidden="true" className="nfw-empty__ic">
        <NotificationGlyph icon="bell" />
      </span>
      <b>{title}</b>
      {body ? <span>{body}</span> : null}
    </div>
  );
}

function SectionBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <h2 className="nfw-sec">{label}</h2>
      {children}
    </>
  );
}

type GroupBlockProps = {
  group: NotificationGroup;
  copy: Copy;
  expanded: boolean;
  gone: Set<string>;
  groupGone: boolean;
  headDot: number | undefined;
  restDots: (number | undefined)[];
  activeId: string | null;
  selectMode: boolean;
  selected: Set<string>;
  swipeable: boolean;
  openRow: string | null;
  onOpenRow: (key: string | null) => void;
  onOpen: (view: NotificationView) => void;
  onRead: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onToggleExpand: () => void;
  onToggleSelect: (ids: string[]) => void;
};

function GroupBlock(props: GroupBlockProps) {
  const { group, copy, expanded, gone, selectMode, selected } = props;
  const restId = useId();
  const liveRest = group.rest.filter((item) => !gone.has(item.id));
  const hasMore = group.rest.length > 0;
  // 묶음 줄 = 대표(가장 최근) + 나머지. 접혀 있으면 「‘대표’ 외」, 지우기 · 읽음 · 선택은 묶음 전부에.
  const rowIds = expanded ? [group.head.id] : group.ids;
  const rowUnread = expanded ? group.head.unread : group.unread;
  const object = hasMore && !expanded ? fill(copy.objectMore, { object: group.head.object }) : group.head.object;
  const selectIds = group.ids;

  return (
    <>
      <SwipeRow
        active={props.activeId === group.head.id}
        copy={copy}
        dotIndex={props.headDot}
        gone={props.groupGone || (expanded && gone.has(group.head.id))}
        ids={selectMode ? selectIds : rowIds}
        more={
          hasMore && !selectMode
            ? {
                count: liveRest.length,
                expanded,
                onToggle: props.onToggleExpand,
                label: expanded ? copy.less : fill(copy.more, { n: liveRest.length }),
                controls: restId,
              }
            : null
        }
        object={object}
        onDelete={props.onDelete}
        onOpen={() => props.onOpen(group.head)}
        onOpenRow={props.onOpenRow}
        onRead={props.onRead}
        onToggleSelect={props.onToggleSelect}
        open={props.openRow === `g:${group.head.id}`}
        rowKey={`g:${group.head.id}`}
        selectMode={selectMode}
        selected={selectMode && selectIds.every((id) => selected.has(id))}
        swipeable={props.swipeable}
        unread={rowUnread}
        view={group.head}
      />
      {hasMore ? (
        <div className="nfw-rest" data-open={expanded ? "" : undefined} id={restId} inert={!expanded}>
          <div>
            {group.rest.map((item, index) => (
              <SwipeRow
                active={props.activeId === item.id}
                copy={copy}
                dotIndex={props.restDots[index]}
                gone={gone.has(item.id)}
                ids={[item.id]}
                key={item.id}
                more={null}
                object={item.object}
                onDelete={props.onDelete}
                onOpen={() => props.onOpen(item)}
                onOpenRow={props.onOpenRow}
                onRead={props.onRead}
                onToggleSelect={props.onToggleSelect}
                open={props.openRow === item.id}
                rowKey={item.id}
                selectMode={false}
                selected={false}
                swipeable={props.swipeable && expanded}
                unread={item.unread}
                view={item}
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── 밀어서 읽음 · 지우기 ──────────────────────────────────────────────────────

const TILE = 64;
const GAP = 6;
const EDGE = 2;
const SPRING = "transform 460ms cubic-bezier(.34, 1.36, .64, 1)";
const SETTLE = "transform 300ms cubic-bezier(.23, 1, .32, 1)";

type SwipeRowProps = {
  rowKey: string;
  view: NotificationView;
  object: string;
  ids: string[];
  unread: boolean;
  copy: Copy;
  more: { count: number; expanded: boolean; onToggle: () => void; label: string; controls: string } | null;
  dotIndex: number | undefined;
  gone: boolean;
  active: boolean;
  selectMode: boolean;
  selected: boolean;
  swipeable: boolean;
  open: boolean;
  onOpenRow: (key: string | null) => void;
  onOpen: () => void;
  onRead: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onToggleSelect: (ids: string[]) => void;
};

function SwipeRow(props: SwipeRowProps) {
  const { rowKey, view, ids, unread, copy, open, swipeable, gone } = props;
  const baseId = useId();
  const swRef = useRef<HTMLDivElement>(null);
  const mvRef = useRef<HTMLDivElement>(null);
  const actsRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ id: -1, x0: 0, y0: 0, base: 0, x: 0, lock: "" as "" | "x" | "y", armed: false, moved: false, width: 0 });
  const suppressClick = useRef(false);

  const reveal = (unread ? TILE * 2 + GAP : TILE) + EDGE + 10;

  const paint = useCallback(
    (x: number, transition: string | null) => {
      const mv = mvRef.current;
      const acts = actsRef.current;
      if (!mv) return;
      mv.style.transition = transition ?? "none";
      mv.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
      if (x) mv.setAttribute("data-shifted", "");
      else if (!transition) mv.removeAttribute("data-shifted");
      const p = Math.max(0, Math.min(1, -x / reveal));
      acts?.style.setProperty("--p", p.toFixed(3));
    },
    [reveal],
  );

  // 열림 상태가 바뀌면(다른 줄을 열었거나 바깥을 눌렀다) 제자리로.
  useEffect(() => {
    if (dragging || gone) return; // 지우는 줄은 밀려 나간 자리에서 그대로 접힌다
    const reduced = prefersReducedMotion();
    const target = open ? -reveal : 0;
    paint(target, reduced ? null : open ? SPRING : SETTLE);
    if (!open) {
      const mv = mvRef.current;
      const timer = window.setTimeout(() => {
        if (mv && !mv.style.transform) mv.removeAttribute("data-shifted");
      }, reduced ? 0 : 320);
      return () => window.clearTimeout(timer);
    }
  }, [open, reveal, paint, dragging, gone]);

  const setArmed = (armed: boolean) => {
    if (drag.current.armed === armed) return;
    drag.current.armed = armed;
    if (armed) {
      swRef.current?.setAttribute("data-armed", "");
      haptic("light");
    } else swRef.current?.removeAttribute("data-armed");
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeable || (event.pointerType === "mouse" && event.button !== 0)) return;
    if ((event.target as HTMLElement).closest(".nfw-acts, .nfw-more")) return;
    drag.current = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      base: open ? -reveal : 0,
      x: open ? -reveal : 0,
      lock: "",
      armed: false,
      moved: false,
      width: swRef.current?.offsetWidth ?? 360,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!swipeable || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x0;
    const dy = event.clientY - d.y0;
    if (!d.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // 세로가 먼저면 스크롤 몫. 닫힌 줄을 오른쪽으로 미는 건 화면 뒤로가기 몫.
      if (Math.abs(dy) >= Math.abs(dx) || (!open && dx > 0)) {
        d.lock = "y";
        return;
      }
      d.lock = "x";
      d.moved = true;
      setDragging(true);
      props.onOpenRow(rowKey);
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        /* 이미 놓였다 */
      }
    }
    if (d.lock !== "x") return;
    event.stopPropagation(); // 셸의 당겨서 새로고침이 가져가지 않게
    let x = d.base + dx;
    if (x > 0) x = x * 0.25; // 오른쪽 끝은 고무줄
    const limit = -d.width;
    if (x < limit) x = limit;
    d.x = x;
    paint(x, null);
    swRef.current?.setAttribute("data-dragging", "");
    setArmed(-x > Math.max(reveal + 72, d.width * 0.55));
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (d.id !== event.pointerId) return;
    d.id = -1;
    if (d.lock !== "x") return;
    suppressClick.current = d.moved;
    swRef.current?.removeAttribute("data-dragging");
    setDragging(false);
    const reduced = prefersReducedMotion();
    if (!cancelled && d.armed) {
      // 끝까지 밀었다 — 줄이 화면 밖으로 나가고 접힌다.
      paint(-d.width, reduced ? null : "transform 220ms cubic-bezier(.4, 0, 1, 1)");
      props.onDelete(ids);
      setArmed(false);
      return;
    }
    setArmed(false);
    const shouldOpen = !cancelled && d.x < -reveal * 0.45;
    if (shouldOpen) {
      paint(-reveal, reduced ? null : SPRING);
      props.onOpenRow(rowKey);
    } else {
      paint(0, reduced ? null : SETTLE);
      props.onOpenRow(null);
    }
  };

  const onHit = (event: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      event.preventDefault();
      return;
    }
    if (props.selectMode) {
      props.onToggleSelect(ids);
      return;
    }
    if (open) {
      props.onOpenRow(null);
      return;
    }
    props.onOpen();
  };

  const offSwipeBack = open || dragging;
  const showDot = unread && !props.selectMode;

  return (
    <div className="nfw-item" data-active={props.active ? "" : undefined} data-gone={props.gone ? "" : undefined}>
      <div className="nfw-item__in">
        <div
          className="nfw-sw"
          data-row-key={rowKey}
          // 열렸거나 미는 중인 줄만 — 화면 스와이프 뒤로가기가 가져가지 않게(16-mobile-navigation 「뒤로가기 — 화면 스와이프」).
          data-swipe-back={offSwipeBack ? "off" : undefined}
          ref={swRef}
        >
          {swipeable || open ? (
            <div aria-hidden={!open} className="nfw-acts" ref={actsRef}>
              {unread ? (
                <button
                  className="nfw-act"
                  data-kind="read"
                  onClick={() => {
                    props.onRead(ids);
                    props.onOpenRow(null);
                  }}
                  tabIndex={open ? 0 : -1}
                  type="button"
                >
                  <EnvelopeOpenGlyph />
                  {copy.swipeRead}
                </button>
              ) : null}
              <button className="nfw-act" data-kind="delete" onClick={() => props.onDelete(ids)} tabIndex={open ? 0 : -1} type="button">
                <TrashGlyph />
                {copy.swipeDelete}
              </button>
            </div>
          ) : null}
          <div
            className="nfw-mv"
            onPointerCancel={(event) => finish(event, true)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finish(event, false)}
            ref={mvRef}
          >
            <NotificationRowBody
              baseId={baseId}
              check={props.selectMode ? { selected: props.selected } : null}
              dotIndex={props.dotIndex}
              hit={
                <button
                  aria-labelledby={rowLabelIds(baseId, showDot)}
                  aria-pressed={props.selectMode ? props.selected : undefined}
                  className="nfw-hit"
                  onClick={onHit}
                  type="button"
                />
              }
              more={props.more}
              object={props.object}
              unread={unread}
              unreadLabel={copy.unread}
              view={view}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
