"use client";

import { useEffect, useRef, useState } from "react";
import { useSplitPush } from "@/components/shell/split-list";
import { GripVertical, Sun, Sunrise } from "lucide-react";
import { moveTaskToToday, moveTaskToTomorrow } from "@/app/mobile/tasks/[id]/actions";
import { haptic } from "@/lib/haptics";
import type { Dictionary, Locale } from "@/lib/i18n";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { recvInstr } from "@/lib/task-directives";
import type { TaskRecord } from "@/lib/tasks";
import {
  formatCustomWeekdays,
  isStandardRecurrence,
  nextRecurringOccurrence,
} from "@/lib/tasks-recurrence";
import { cn } from "@/lib/utils";
import { tokyoDateOf, ymdShift } from "@/lib/tokyo-date";
import "./tasks-white.css";

// 날짜 유틸은 순수 모듈 `@/lib/tokyo-date` 가 정본이다(서버·클라이언트 공용).
const shiftYmd = ymdShift;

type Copy = Dictionary["tasks"];

function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 반복 규칙 → 사람이 읽는 라벨. 워크스페이스의 반복 삭제 시트도 같은 표현을 써야 해서 내보낸다. */
export function repeatLabel(rule: string, copy: Copy, locale: Locale): string {
  // 사용자 지정 요일 반복(`custom:1,3,5`)은 고정 매핑에 없으므로 먼저 처리한다 — 빠뜨리면
  // 어드민에서 만든 반복이 여기서 원문 그대로("custom:1,3,5") 노출된다.
  const customDays = formatCustomWeekdays(rule, locale);
  if (customDays) return copy.repeatWeeklyOn.replace("{w}", customDays);
  const map: Record<string, string> = {
    daily: copy.repeatDaily,
    weekly: copy.repeatWeekly,
    monthly: copy.repeatMonthly,
    weekdays: copy.repeatWeekdays,
    weekends: copy.repeatWeekends,
    yearly: copy.repeatYearly,
    custom: copy.repeatCustom,
  };
  return map[rule] ?? rule;
}

// End of a time block (start "HH:MM" + duration minutes), wrapping within the day.
export function addMinutesHHMM(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** 우선순위 → 고리 모양 클래스(화이트 리디자인). 긴급 빨강 · 중요 주황 · 보통 파랑 · 없음 회색. */
export function prioRingClass(priority: string): string {
  return priority === "urgent" ? "is-u" : priority === "important" ? "is-i" : priority === "medium" ? "is-m" : "";
}

/** 체크 표시(그리기 애니메이션용 경로 — `stroke-dasharray` 로 그린다). */
export function CheckMark() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} viewBox="0 0 24 24">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/** 맥락(건물 · 객실 · 손님) 한 줄 — 줄의 회색 메타와 상세의 「연결」이 같은 표현을 쓴다. */
export function contextLabelOf(
  task: TaskRecord,
  buildingLabels: Record<string, string>,
  roomSuffix: string,
): string | null {
  const ctx = task.resolvedContext;
  if (!ctx) return null;
  return (
    [
      ctx.propertyName ? localizePropertyName(ctx.propertyName, buildingLabels) : null,
      // For Okubo-style buildings, roomLabel === propertyName (canonical); suppress to avoid redundancy.
      ctx.roomLabel && ctx.roomLabel !== ctx.propertyName ? `${ctx.roomLabel}${roomSuffix}` : null,
    ]
      .filter(Boolean)
      .join(" ") ||
    ctx.guestName ||
    null
  );
}

/**
 * 투두 한 줄 — 화이트 리디자인(2026-10-15, 시안 Todo-Phone).
 *
 * 카드 상자 없이 얇은 가로 줄로 나뉜다. 앞의 고리는 우선순위 색(긴급 · 중요 · 보통 · 없음)이고, 누르면 채워지며 체크가
 * 그려진 뒤 완료된다(낙관적 반영은 워크스페이스가 맡는다). 제목 아래 회색 메타 한 줄 — 「긴급 · / 중요 ·」으로 시작해
 * 날짜 · 시간 · 연결 · 진행 중 · 지시 · 반복 · 태그 · 사진 · 공유 n명 · N일 밀림 순서. 지연은 메타가 빨강.
 *
 * 동작은 전과 같다: 밀어서 오늘로/내일로, 손잡이로 순서 바꾸기, 길게 눌러 메뉴, 선택 모드, 태블릿 2분할에서 오른쪽 칸.
 * 본문은 **상세 주소를 가진 링크**다 — 태블릿 2분할(`SplitList`)이 고른 줄을 옅은 보라 바탕으로 표시하려면 링크여야 한다.
 * 길게 누름 · 밀기 뒤에 따라오는 클릭은 `touchend` 에서 막는다(그래야 2분할이 칸을 열지 않는다).
 */
export function TaskCard({
  buildingLabels,
  copy,
  currentUserId,
  task,
  today,
  showDate = true,
  swipe = true,
  instrMode,
  sentMode = false,
  selectMode = false,
  selectedIds,
  onToggleSelect,
  onLongPress,
  swipeAction = "today",
  behindDays,
  swipeReturnView,
  locale,
  reorderable = false,
  reordering = false,
  onReorderHandleDown,
  onCompleteToggle,
  preview = false,
  occurrence,
  detailReturnView,
  trailing,
}: {
  buildingLabels: Record<string, string>;
  copy: Copy;
  locale: Locale;
  currentUserId: string;
  task: TaskRecord;
  today: string;
  showDate?: boolean;
  swipe?: boolean;
  /**
   * 지시 화면(받은/보낸)에서만 켠다. 받은 지시는 지시자 이름을, 보낸 지시는 「나 → 대상」을 메타 맨 앞에 둔다.
   */
  instrMode?: "recv" | "sent";
  sentMode?: boolean;
  // Multi-select: in select mode tapping toggles selection (instead of navigating) and a
  // checkbox replaces the complete circle. Long-press (outside select mode) opens the context menu.
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (task: TaskRecord) => void;
  /**
   * 두 번째 인자는 이 카드가 **어느 회차로 렌더됐는지**(반복 작업의 날짜). 목록의 삭제가 시리즈 전체를
   * 지울지 그 날짜만 건너뛸지 고르려면 메뉴가 이 날짜를 알아야 한다.
   */
  onLongPress?: (task: TaskRecord, occurrence?: { date: string; done: boolean }) => void;
  // Swipe reveal action: "today" pulls the task to today (Tomorrow/Inbox tabs), "tomorrow" defers
  // it to tomorrow (Today tab). `swipeReturnView` is posted with the action so the server redirect
  // keeps the user on the tab they swiped from.
  swipeAction?: "today" | "tomorrow";
  /**
   * 반복 작업이 밀린 회차 수. 0/undefined 면 표시하지 않는다(2026-09-08).
   * 밀린 회차를 지연 섹션에 따로 세우지 않고 **오늘 줄의 메타로만** 보여 준다.
   */
  behindDays?: number;
  swipeReturnView?: string;
  // Drag-reorder: shows a dedicated grip handle. The handle owns its own pointer gesture and stops
  // propagation, so it never triggers tap / long-press / swipe on the row body.
  // `reordering` is true on the row currently being dragged (suppresses tap navigation on drop).
  reorderable?: boolean;
  reordering?: boolean;
  onReorderHandleDown?: (e: React.PointerEvent, task: TaskRecord) => void;
  // Tapping the leading ring toggles completion. Active → complete, completed → reopen. Omit to render
  // the ring as a static indicator.
  onCompleteToggle?: (task: TaskRecord, occurrence?: { date: string; done: boolean }) => void;
  // 미래 날짜의 미리보기 줄. 완료 토글을 주지 않을 뿐 아니라 **고리 자체를 점 마커로 바꾼다**(2026-09-09) — 못 누르는
  // 체크박스를 남겨 두면 고장난 버튼으로 보인다. 점은 자리(22px)를 그대로 지켜 정렬이 어긋나지 않는다.
  preview?: boolean;
  // Recurring occurrence row (2026-07-30): completion/done state is per this date, not the row's
  // `status` (which stays open). When set, the checkbox toggles this occurrence.
  occurrence?: { date: string; done: boolean };
  /** List tab to restore after a detail action such as skipping one recurring occurrence. */
  detailReturnView?: string;
  /** 줄 오른쪽 끝 회색 글자(완료 · 기록의 완료 시각 등). */
  trailing?: string;
}) {
  // 태블릿 가로 2분할 안이면 오른쪽 칸에 연다(`SplitList`). 아니면 그대로 이동.
  const splitPush = useSplitPush();
  const done = occurrence ? occurrence.done : task.status === "completed";
  const selected = selectMode && !!selectedIds?.has(task.id);
  const dueDate = tokyoDateOf(task.dueAt);
  const w = copy.mobileWhite;
  /**
   * 반복 업무를 «작업 원본» 행으로 그리는 화면(관리함·지시 등)인가.
   *
   * 오늘/내일 탭은 반복을 회차 행으로 그려 `occurrence` 가 들어오지만, 관리함은 원본 행으로
   * 그린다. 그때 `dueAt` 은 **마감일이 아니라 앵커**(「7/30부터 평일마다」의 시작점)라 늘 과거에
   * 있다. 이걸 마감일처럼 다루면 반복 업무가 전부 지연으로 보인다(2026-08-07).
   */
  const recurringRow = !occurrence && isStandardRecurrence(task.recurrenceRule);
  // 반복은 앵커 대신 **다음 회차**를 보여 준다.
  const nextOccurrenceDate = recurringRow
    ? nextRecurringOccurrence(task.recurrenceRule, dueDate ?? task.scheduledDate ?? null, today)
    : null;
  /** 지연 판정에서 반복을 뺀다 — 반복의 밀림은 「N일 밀림」(behindDays)이 맡는다. */
  const overdue = !occurrence && !recurringRow && !done && !!dueDate && dueDate < today;

  // One swipe action (today / tomorrow), revealed at a fixed width sized to its single button.
  const swipeOpen = 70;
  const swipeSnap = swipeOpen / 2;

  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pressed, setPressed] = useState(false); // "press-down" scale while held
  // 완료 고리를 누른 직후 — 채움 + 체크 그리기를 보여 준 뒤에 실제 완료를 부른다.
  const [checking, setChecking] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const axis = useRef<null | "h" | "v">(null); // direction lock so taps/scrolls don't open swipe
  const didSwipe = useRef(false);
  const wasOpen = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    },
    [],
  );

  // Tapping anywhere outside an opened row closes its swipe naturally.
  useEffect(() => {
    if (offset === 0) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOffset(0);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [offset]);

  // 스와이프 목적지에 이미 이 작업이 걸려 있으면 스와이프를 내주지 않는다(2026-08-03).
  const swipeTarget = swipeAction === "tomorrow" ? shiftYmd(today, 1) : today;
  const anchorDate = tokyoDateOf(task.dueAt) ?? task.scheduledDate ?? null;
  // 2026-08-25: 표준 반복 업무는 오늘/내일 스와이프 자체를 내주지 않는다 — 이동이 반복 위상을 바꿔 밀린 회차가
  // 통째로 사라진다. 서버도 `recurring_series` 로 거절한다.
  const isRecurringTask = isStandardRecurrence(task.recurrenceRule);
  const alreadyOnTarget = !isRecurringTask && anchorDate ? anchorDate === swipeTarget : false;
  const canSwipe = swipe && !done && !selectMode && !isRecurringTask && !alreadyOnTarget;

  // Long-press → context menu. A 480ms hold with little movement fires; a drag/scroll cancels it.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef({ x: 0, y: 0 });
  const longFired = useRef(false);
  function startPress(x: number, y: number) {
    if (!onLongPress || selectMode) return;
    longFired.current = false;
    pressStart.current = { x, y };
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      setPressed(false);
      setOffset(0); // close any open swipe so the menu opens over a clean row
      haptic("medium");
      onLongPress(task, occurrence);
    }, 480);
  }
  function movePress(x: number, y: number) {
    if (!pressTimer.current) return;
    if (Math.abs(x - pressStart.current.x) > 8 || Math.abs(y - pressStart.current.y) > 8) {
      cancelPress();
    }
  }
  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    pressStart.current = { x, y };
    wasOpen.current = offset !== 0;
    didSwipe.current = false;
    setPressed(true);
    startPress(x, y);
    if (!canSwipe) return;
    startX.current = x - offset;
    startY.current = y;
    axis.current = null;
    dragging.current = true;
    setIsDragging(true);
  }
  function onTouchMove(e: React.TouchEvent) {
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - pressStart.current.x;
    const dy = y - pressStart.current.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) setPressed(false);
    movePress(x, y);
    if (!dragging.current) return;
    // Lock to an axis only once the finger has clearly moved — a tap or a vertical scroll
    // must never reveal the swipe action.
    if (axis.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (axis.current !== "h") return;
    didSwipe.current = true;
    const sdx = x - startX.current;
    // Track the finger 1:1 up to fully-open, then add elastic resistance past it.
    const next = sdx >= 0 ? 0 : sdx < -swipeOpen ? -swipeOpen + (sdx + swipeOpen) * 0.18 : sdx;
    setOffset(next);
  }
  function onTouchEnd(e: React.TouchEvent) {
    setPressed(false);
    cancelPress();
    // 길게 누름 · 밀기 · 열린 줄 닫기 뒤에 오는 클릭을 없앤다 — 태블릿 2분할이 그 클릭으로 칸을 열지 않게.
    const swallow = longFired.current || didSwipe.current || (wasOpen.current && !didSwipe.current);
    if (swallow && e.cancelable) e.preventDefault();
    if (wasOpen.current && !didSwipe.current) setOffset(0);
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    if (didSwipe.current) {
      const open = offset < -swipeSnap;
      if (open) haptic("light");
      setOffset(open ? -swipeOpen : 0);
    }
  }

  const detailHref = (() => {
    const params = new URLSearchParams();
    if (occurrence && !occurrence.done) params.set("occurrence", occurrence.date);
    // 상세의 빵부스러기(「오늘 · 투두이스트」)와 회차 건너뛰기 뒤 돌아올 탭.
    if (detailReturnView) params.set("view", detailReturnView);
    const query = params.toString();
    return `/mobile/tasks/${task.id}${query ? `?${query}` : ""}`;
  })();

  // Row body tap: suppress the click that follows a long-press; toggle in select mode; else open.
  function onBodyClick(e: React.MouseEvent) {
    e.preventDefault();
    const wasLong = longFired.current;
    const wasSwipe = didSwipe.current;
    longFired.current = false;
    didSwipe.current = false;
    // Ignore the synthetic click that can land on the row right after a drag-reorder drop.
    if (reordering) return;
    if (selectMode) {
      onToggleSelect?.(task);
      return;
    }
    if (offset !== 0) {
      setOffset(0); // tap an open row to close it
      return;
    }
    if (wasLong || wasSwipe) return;
    splitPush(detailHref);
  }

  // ── 회색 메타 한 줄 ─────────────────────────────────────────────────────────
  type Seg = { text: string; tone?: "late" | "pri" };
  const segs: Seg[] = [];
  const ctxLabel = contextLabelOf(task, buildingLabels, copy.contextPickerRoomSuffix);
  const others = task.participants.filter((p) => p.userId !== currentUserId);

  if (instrMode === "recv") segs.push({ text: task.authorName });
  if (instrMode === "sent") {
    const targets = task.participants.filter((p) => p.userId !== task.createdByUserId);
    const first = targets[0]?.name;
    if (first)
      segs.push({ text: `${w.me} → ${first}${targets.length > 1 ? ` +${targets.length - 1}` : ""}` });
  }
  if (!done && task.priority === "urgent") segs.push({ text: copy.prioUrgent, tone: overdue ? "late" : undefined });
  if (!done && task.priority === "important") segs.push({ text: copy.prioImportant });

  const dayWord = (ymd: string) =>
    ymd === today ? copy.todayLabel : ymd === shiftYmd(today, 1) ? copy.viewTomorrow : shortDate(ymd);
  if (showDate) {
    if (recurringRow) {
      if (nextOccurrenceDate)
        segs.push({
          text: nextOccurrenceDate === today ? copy.todayLabel : copy.nextLabel.replace("{date}", shortDate(nextOccurrenceDate)),
        });
    } else if (dueDate || task.scheduledDate) {
      const ymd = (dueDate ?? task.scheduledDate) as string;
      const label = instrMode && !done ? w.until.replace("{date}", dayWord(ymd)) : dayWord(ymd);
      segs.push({ text: label, tone: overdue ? "late" : undefined });
    }
  }
  if (task.timeLabel)
    segs.push({
      text: task.durationMinutes
        ? `${task.timeLabel} – ${addMinutesHHMM(task.timeLabel, task.durationMinutes)}`
        : task.timeLabel,
    });
  if (ctxLabel) segs.push({ text: ctxLabel });
  if (task.status === "in_progress" && !done) segs.push({ text: copy.statusInProgress, tone: "pri" });
  if (!instrMode && recvInstr(task, currentUserId)) segs.push({ text: `${copy.viewInstr} · ${task.authorName}` });
  else if (!instrMode && !sentMode && task.createdByUserId !== currentUserId) segs.push({ text: task.authorName });
  if (task.recurrenceRule) segs.push({ text: `↻ ${repeatLabel(task.recurrenceRule, copy, locale)}` });
  if (task.tags.length) segs.push({ text: task.tags.slice(0, 2).map((tg) => `#${tg}`).join(" ") });
  if (task.imageUrls.length) segs.push({ text: w.photos.replace("{n}", String(task.imageUrls.length)) });
  if (task.isShared && instrMode !== "sent" && others.length > 0)
    segs.push({ text: w.shared.replace("{n}", String(others.length)) });
  if (behindDays) segs.push({ text: copy.odDaysBehind.replace("{n}", String(behindDays)), tone: "late" });

  const ringCls = prioRingClass(task.priority);

  function onRingClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!onCompleteToggle || checking) return;
    if (done) {
      haptic("light");
      onCompleteToggle(task, occurrence);
      return;
    }
    // 채움 + 체크 그리기를 먼저 보여 주고(320ms), 그 뒤에 목록에서 빠지며 「완료」로 내려앉는다.
    haptic("success");
    setChecking(true);
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    checkTimer.current = setTimeout(
      () => {
        onCompleteToggle(task, occurrence);
        // 실패해 줄이 돌아오면 다시 빈 고리로 — 낙관적 반영이 버려져도 체크가 남지 않게.
        checkTimer.current = setTimeout(() => setChecking(false), 1500);
      },
      reduce ? 0 : 340,
    );
  }

  const ring = selectMode ? (
    <button
      aria-label={copy.actionSelect}
      aria-pressed={selected}
      className={cn("tkw-ck is-pick", selected && "is-on")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        haptic("light");
        onToggleSelect?.(task);
      }}
      type="button"
    >
      <CheckMark />
    </button>
  ) : preview && !done ? (
    <span aria-hidden="true" className={cn("tkw-ck is-preview", ringCls)} />
  ) : onCompleteToggle && !preview ? (
    <button
      aria-label={done ? copy.reopen : copy.complete}
      className={cn("tkw-ck", ringCls, done && "is-done", checking && "is-checking")}
      onClick={onRingClick}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      type="button"
    >
      <CheckMark />
    </button>
  ) : (
    <span aria-hidden="true" className={cn("tkw-ck is-static", ringCls, done && "is-done")}>
      <CheckMark />
    </span>
  );

  const bodyInner = (
    <>
      <span className="tkw-row__t">{task.title}</span>
      {segs.length ? (
        <span className={cn("tkw-row__m", overdue && "is-late")}>
          {segs.map((s, i) => (
            <span key={i}>
              {i > 0 ? " · " : ""}
              <span className={s.tone === "late" ? "is-late" : s.tone === "pri" ? "is-pri" : undefined}>{s.text}</span>
            </span>
          ))}
        </span>
      ) : null}
    </>
  );

  const onContextMenu = (e: React.MouseEvent) => {
    if (!onLongPress || selectMode) return;
    e.preventDefault();
    onLongPress(task, occurrence);
  };

  const rowInner = (
    <div
      className="tkw-row__in"
      onContextMenu={onContextMenu}
      onTouchCancel={onTouchEnd}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
      style={
        canSwipe
          ? {
              transform: offset ? `translateX(${offset}px)` : undefined,
              transition: isDragging ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
            }
          : undefined
      }
    >
      {ring}
      {selectMode ? (
        // 선택 모드에서는 링크가 아니다 — 태블릿 2분할이 탭을 칸 열기로 가로채지 않게.
        <button className="tkw-row__b" onClick={onBodyClick} type="button">
          {bodyInner}
        </button>
      ) : (
        <a className="tkw-row__b" draggable={false} href={detailHref} onClick={onBodyClick}>
          {bodyInner}
        </a>
      )}
      {trailing ? <span className="tkw-row__tr">{trailing}</span> : null}
      {/* Drag handle. Owns its own pointer gesture; stops touch/pointer/click propagation and sets
          touch-action:none so it never starts the row's tap, long-press, or swipe. */}
      {reorderable ? (
        <button
          aria-label={copy.reorderHandle}
          className="tkw-row__grip"
          data-swipe-back="off"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            haptic("light");
            onReorderHandleDown?.(e, task);
          }}
          onTouchStart={(e) => e.stopPropagation()}
          type="button"
        >
          <GripVertical aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "tkw-row",
        done && "is-done",
        selected && "is-sel",
        reordering && "is-drag",
        pressed && !selectMode && "is-press",
      )}
      // 열려 있는 줄에서 오른쪽으로 밀면 줄을 닫는다 — 화면 스와이프 뒤로가기가 가져가지 않게(16-mobile-navigation).
      data-swipe-back={offset !== 0 ? "off" : undefined}
      ref={rootRef}
    >
      {canSwipe ? (
        <div
          className="tkw-swipe"
          style={{
            opacity: Math.min(1, Math.abs(offset) / swipeOpen),
            pointerEvents: offset === 0 ? "none" : undefined,
          }}
        >
          <form action={swipeAction === "tomorrow" ? moveTaskToTomorrow : moveTaskToToday}>
            <input name="taskId" type="hidden" value={task.id} />
            {swipeReturnView ? <input name="view" type="hidden" value={swipeReturnView} /> : null}
            <button onClick={() => haptic("light")} type="submit">
              {swipeAction === "tomorrow" ? <Sunrise aria-hidden="true" /> : <Sun aria-hidden="true" />}
              {swipeAction === "tomorrow" ? copy.swipeTomorrow : copy.swipeToday}
            </button>
          </form>
        </div>
      ) : null}
      {rowInner}
    </div>
  );
}
