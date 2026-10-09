"use client";

import { useEffect, useRef, useState } from "react";
import { useSplitPush } from "@/components/shell/split-list";
import {
  CalendarDays,
  Check,
  Clock,
  Flag,
  GripVertical,
  ImageIcon,
  Loader,
  MapPin,
  Repeat2,
  Share2,
  Sun,
  Sunrise,
  Users,
} from "lucide-react";
import { moveTaskToToday, moveTaskToTomorrow } from "@/app/mobile/tasks/[id]/actions";
import type { Dictionary, Locale } from "@/lib/i18n";
import { localizePropertyName } from "@/lib/room-label-normalization";
import type { TaskRecord } from "@/lib/tasks";
import {
  formatCustomWeekdays,
  isStandardRecurrence,
  nextRecurringOccurrence,
} from "@/lib/tasks-recurrence";
import { cn } from "@/lib/utils";
import { tokyoDateOf, ymdShift } from "@/lib/tokyo-date";

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
function addMinutesHHMM(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function shareSummary(task: TaskRecord, currentUserId: string): string | null {
  if (!task.isShared) return null;
  const others = task.participants
    .filter((p) => p.userId !== currentUserId)
    .map((p) => p.name)
    .filter(Boolean);
  if (others.length === 0) return null;
  return others.length === 1 ? others[0] : `${others[0]} +${others.length - 1}`;
}

// 우선순위 1~4 (Todoist): urgent=빨강, important=주황, medium=파랑, normal=회색(기본).
const PRIO_RING: Record<string, string> = {
  urgent: "border-rose-500 text-rose-500",
  important: "border-amber-500 text-amber-500",
  medium: "border-blue-500 text-blue-500",
  normal: "border-slate-300 text-slate-300",
};


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
   * 지시 화면(받은/보낸)에서만 켠다. 카드에서 "누구인지"를 텍스트 접두사가 아니라
   * 아바타 칩으로 올려, 지시 목록의 첫 관심사(보낸 사람 / 담당자)를 먼저 읽히게 한다.
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
   * 반복 작업이 밀린 회차 수. 0/undefined 면 배지를 달지 않는다(2026-09-08).
   * 밀린 회차를 지연 섹션에 따로 세우지 않고 **오늘 카드의 배지로만** 보여 준다.
   */
  behindDays?: number;
  swipeReturnView?: string;
  // Drag-reorder (Today view): shows a dedicated grip handle. The handle owns its own pointer
  // gesture and stops propagation, so it never triggers tap / long-press / swipe on the card body.
  // `reordering` is true on the card currently being dragged (suppresses tap navigation on drop).
  reorderable?: boolean;
  reordering?: boolean;
  onReorderHandleDown?: (e: React.PointerEvent, task: TaskRecord) => void;
  // Tapping the leading status circle toggles completion. The button owns its own pointer gesture
  // (stops propagation) so it never starts the card's tap / long-press / swipe. Active → complete,
  // completed → reopen. Omit to render the circle as a static indicator (e.g. calendar day sheet).
  onCompleteToggle?: (task: TaskRecord, occurrence?: { date: string; done: boolean }) => void;
  // 미래 날짜의 미리보기 행(다가오는 일정 · 미래 날짜 시트). 완료 토글을 주지 않을 뿐 아니라
  // **동그라미 자체를 점 마커로 바꾼다**(2026-09-09) — 못 누르는 체크박스를 남겨 두면 고장난
  // 버튼으로 보인다. 점은 자리(22px)를 그대로 지켜 오늘·과거 행과 정렬이 어긋나지 않는다.
  preview?: boolean;
  // Recurring occurrence row (2026-07-30): completion/done state is per this date, not the row's
  // `status` (which stays open). When set, the checkbox toggles this occurrence.
  occurrence?: { date: string; done: boolean };
  /** List tab to restore after a detail action such as skipping one recurring occurrence. */
  detailReturnView?: string;
}) {
  // 태블릿 가로 2분할 안이면 오른쪽 칸에 연다(`SplitList`). 아니면 그대로 이동.
  const splitPush = useSplitPush();
  const done = occurrence ? occurrence.done : task.status === "completed";
  const selected = selectMode && !!selectedIds?.has(task.id);
  const dueDate = tokyoDateOf(task.dueAt);
  /**
   * 반복 업무를 «작업 원본» 행으로 그리는 화면(관리함·지시 등)인가.
   *
   * 오늘/내일 탭은 반복을 회차 행으로 그려 `occurrence` 가 들어오지만, 관리함은 원본 행으로
   * 그린다. 그때 `dueAt` 은 **마감일이 아니라 앵커**(「7/30부터 평일마다」의 시작점)라 늘 과거에
   * 있다. 이걸 마감일처럼 다루면 반복 업무가 전부 지연으로 보인다 — 2026-08-07 관리함에서
   * 실제로 그랬고, 어드민 콘솔(`helpers.ts` `isOverdue`)과 이 화면의 탭 분류
   * (`tasks-workspace.tsx` `isOverdue`)는 둘 다 반복을 제외하고 있었는데 카드만 자체 계산을
   * 하고 있었다.
   */
  const recurringRow = !occurrence && isStandardRecurrence(task.recurrenceRule);
  // 반복은 앵커 대신 **다음 회차**를 보여 준다. 날짜를 통째로 지우면 반복 칩(「평일」)만 남아
  // «언제 하는 일인지»가 사라진다.
  const nextOccurrenceDate = recurringRow
    ? nextRecurringOccurrence(task.recurrenceRule, dueDate ?? task.scheduledDate ?? null, today)
    : null;
  /**
   * 지연 판정에서 반복을 뺀다. 반복에도 **진짜 밀린 회차**는 있지만, 그건 회차 상태
   * (`task_occurrence_state`)를 알아야 셀 수 있어 카드가 판단할 수 없다. 오늘 탭의 「지연」
   * backlog 가 「N일 밀림」 + 가져오기/건너뛰기까지 이미 담당한다 — 여기서 흉내 내면 근거 없는
   * 숫자만 하나 더 생긴다.
   */
  const overdue = !occurrence && !recurringRow && !done && !!dueDate && dueDate < today;

  // One swipe action (today / tomorrow), revealed at a fixed width sized to its single button.
  const swipeOpen = 74;
  const swipeSnap = swipeOpen / 2;

  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pressed, setPressed] = useState(false); // "press-down" scale while held
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const axis = useRef<null | "h" | "v">(null); // direction lock so taps/scrolls don't open swipe
  const didSwipe = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Tapping anywhere outside an opened card closes its swipe naturally.
  useEffect(() => {
    if (offset === 0) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOffset(0);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [offset]);

  // 스와이프 목적지에 이미 이 작업이 걸려 있으면 스와이프를 내주지 않는다.
  //
  // 목적지는 탭으로 정해진다(오늘 탭 → 내일, 그 밖 → 오늘). 반복 작업은 규칙으로 회차가 생기므로
  // 예컨대 평일 반복은 오늘도 내일도 회차가 있고, 서버(`canMoveRecurringTo`)가 그 이동을
  // `duplicate_occurrence` 로 거절한다. 즉 스와이프해도 아무 일이 일어나지 않는다.
  // 콘솔의 「오늘로/내일로 이동」 메뉴도 같은 이유로 감춘다(2026-08-03).
  const swipeTarget = swipeAction === "tomorrow" ? shiftYmd(today, 1) : today;
  const anchorDate = tokyoDateOf(task.dueAt) ?? task.scheduledDate ?? null;
  // 2026-08-25: 표준 반복 업무는 오늘/내일 스와이프 자체를 내주지 않는다. `moveTaskToToday` /
  // `moveTaskToTomorrow` 가 `recurrence_instance_date`(고정 앵커, 2026-07-30 롤포워드 폐지)를 다시
  // 쓰기 때문에, 이동을 허용하면 그 순간 시리즈 전체의 반복 위상이 바뀌면서 밀린 회차 백로그가
  // 통째로 사라진다. 서버가 표준 반복을 `recurring_series` 로 거절하므로, 위 alreadyOnTarget 중복
  // 방지는 이제 일회성 작업에만 남긴다(반복은 아래에서 이미 스와이프가 꺼진다).
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
      setOffset(0); // close any open swipe so the menu opens over a clean card
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
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
    setPressed(true);
    startPress(x, y);
    if (!canSwipe) return;
    startX.current = x;
    startY.current = y;
    axis.current = null;
    didSwipe.current = false;
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
    // must never reveal the swipe actions.
    if (axis.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (axis.current !== "h") return;
    didSwipe.current = true;
    const sdx = x - startX.current;
    // Track the finger 1:1 up to fully-open, then add elastic resistance past it for a premium pull.
    const next =
      sdx >= 0
        ? 0
        : sdx < -swipeOpen
          ? -swipeOpen + (sdx + swipeOpen) * 0.18
          : sdx;
    setOffset(next);
  }
  function onTouchEnd() {
    setPressed(false);
    cancelPress();
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    setOffset((o) => (o < -swipeSnap ? -swipeOpen : 0));
  }

  // Card body tap: suppress the click that follows a long-press; toggle in select mode; else open.
  function onBodyClick() {
    const wasLong = longFired.current;
    const wasSwipe = didSwipe.current;
    longFired.current = false;
    didSwipe.current = false;
    // Ignore the synthetic click that can land on the card right after a drag-reorder drop.
    if (reordering) return;
    if (selectMode) {
      onToggleSelect?.(task);
      return;
    }
    if (offset !== 0) {
      setOffset(0); // tap an open card to close it
      return;
    }
    if (wasLong || wasSwipe) return;
    if (occurrence && !occurrence.done) {
      const params = new URLSearchParams({ occurrence: occurrence.date });
      if (detailReturnView) params.set("view", detailReturnView);
      splitPush(`/mobile/tasks/${task.id}?${params.toString()}`);
      return;
    }
    splitPush(`/mobile/tasks/${task.id}`);
  }

  const fromLabel =
    !sentMode && !instrMode && task.createdByUserId !== currentUserId
      ? `${task.authorName} → `
      : "";
  const summary = shareSummary(task, currentUserId);
  // 지시 카드의 신원 칩: 받은 지시는 지시자, 보낸 지시는 담당자 수.
  const targetCount = task.participants.filter((p) => p.userId !== task.createdByUserId).length;
  const instrChip =
    instrMode === "recv" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/[0.09] py-0.5 pl-0.5 pr-2 text-[11px] font-bold text-primary">
        <span className="flex size-[15px] items-center justify-center rounded-full bg-primary text-[8px] font-extrabold text-primary-foreground">
          {task.authorName.slice(0, 1)}
        </span>
        {task.authorName}
      </span>
    ) : instrMode === "sent" && targetCount > 0 ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/[0.09] px-2 py-0.5 text-[11px] font-bold text-primary">
        <Users className="size-3" aria-hidden="true" />
        {copy.instrAssigned.replace("{n}", String(targetCount))}
      </span>
    ) : null;

  const dateChip = (() => {
    if (!showDate) return null;
    // 반복 원본 행: 앵커(과거 고정)가 아니라 다음 회차를 보여 준다.
    if (recurringRow)
      return nextOccurrenceDate ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
            nextOccurrenceDate === today
              ? "bg-primary/10 text-primary"
              : "bg-slate-100 text-slate-600",
          )}
        >
          <CalendarDays className="size-3" aria-hidden="true" />
          {/* 완료 토스트가 쓰는 `nextLabel`("다음: {date}")을 그대로 재사용한다 — 같은 개념
              (다음 회차)을 두 문구로 두면 화면마다 다르게 읽힌다. */}
          {nextOccurrenceDate === today
            ? copy.todayLabel
            : copy.nextLabel.replace("{date}", shortDate(nextOccurrenceDate))}
        </span>
      ) : null;
    if (overdue && dueDate)
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600">
          <Clock className="size-3" aria-hidden="true" />
          {shortDate(dueDate)} {copy.overdueLabel}
        </span>
      );
    if (dueDate)
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
            dueDate === today ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-600",
          )}
        >
          <Flag className="size-3" aria-hidden="true" />
          {dueDate === today ? copy.todayLabel : shortDate(dueDate)} {copy.dueLabel}
        </span>
      );
    if (task.scheduledDate)
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
            task.scheduledDate === today
              ? "bg-primary/10 text-primary"
              : "bg-slate-100 text-slate-600",
          )}
        >
          <CalendarDays className="size-3" aria-hidden="true" />
          {task.scheduledDate === today ? copy.todayLabel : shortDate(task.scheduledDate)}
        </span>
      );
    return null;
  })();

  const chip = "inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600";

  const ctx = task.resolvedContext;
  const ctxLabel = ctx
    ? [
        ctx.propertyName ? localizePropertyName(ctx.propertyName, buildingLabels) : null,
        // For Okubo-style buildings, roomLabel === propertyName (canonical); suppress to avoid redundancy.
        ctx.roomLabel && ctx.roomLabel !== ctx.propertyName
          ? `${ctx.roomLabel}${copy.contextPickerRoomSuffix}`
          : null,
      ].filter(Boolean).join(" · ") ||
      ctx.guestName ||
      null
    : null;
  const ctxChip = ctxLabel ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold text-primary" style={{ background: "rgb(122 82 230 / 0.09)" }}>
      <MapPin className="size-3" aria-hidden="true" />
      {ctxLabel}
    </span>
  ) : null;

  const cardInner = (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[18px] border bg-surface px-3.5 py-3 shadow-[0_1px_2px_rgba(20,32,43,0.03)] transition-[transform,border-color,background-color] duration-150 ease-out will-change-transform",
        selectMode && selected ? "border-primary bg-primary/[0.04]" : "border-border",
        pressed ? "scale-[0.97] bg-primary/[0.03]" : "active:scale-[0.98]",
      )}
    >
      {selectMode ? (
        <button
          aria-label={copy.actionSelect}
          className={cn(
            "mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-slate-300",
          )}
          onClick={() => onToggleSelect?.(task)}
          type="button"
        >
          {selected ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : null}
        </button>
      ) : preview && !done ? (
        <span
          className={cn(
            "mt-0.5 flex size-[22px] shrink-0 items-center justify-center",
            PRIO_RING[task.priority] ?? PRIO_RING.normal,
          )}
          aria-hidden="true"
        >
          <span className="size-[7px] rounded-full bg-current opacity-70" />
        </span>
      ) : onCompleteToggle && !preview ? (
        <button
          aria-label={done ? copy.reopen : copy.complete}
          className={cn(
            "mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full transition-colors",
            done
              ? "bg-primary text-primary-foreground"
              : cn("border-2", PRIO_RING[task.priority] ?? PRIO_RING.normal),
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCompleteToggle(task, occurrence);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          type="button"
        >
          {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : null}
        </button>
      ) : done ? (
        <span className="mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : (
        <span
          className={cn(
            "mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border-2",
            PRIO_RING[task.priority] ?? PRIO_RING.normal,
          )}
        />
      )}

      <button
        className="min-w-0 flex-1 text-left"
        onClick={onBodyClick}
        type="button"
      >
        <p
          className={cn(
            "line-clamp-2 break-words text-sm font-extrabold leading-snug tracking-[-0.01em]",
            done ? "text-slate-400 line-through" : "text-foreground",
          )}
        >
          {fromLabel ? <span className="text-muted-foreground">{fromLabel}</span> : null}
          {task.title}
        </p>
        {dateChip ||
        ctxChip ||
        task.timeLabel ||
        task.recurrenceRule ||
        task.tags.length ||
        task.imageUrls.length ||
        instrChip ||
        summary ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {instrChip}
            {dateChip}
            {ctxChip}
            {/* 진행 중 — 이 칩이 없으면 목록에서 대기 상태와 완전히 똑같이 보인다. 콘솔은 3상태를
                쓰는데 모바일 목록이 2상태로만 읽히던 격차(2026-07-30). */}
            {task.status === "in_progress" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                <Loader className="size-3" aria-hidden="true" />
                {copy.statusInProgress}
              </span>
            ) : null}
            {task.timeLabel ? (
              <span className={chip}>
                <Clock className="size-3" aria-hidden="true" />
                {task.timeLabel}
                {task.durationMinutes ? `–${addMinutesHHMM(task.timeLabel, task.durationMinutes)}` : ""}
              </span>
            ) : null}
            {task.recurrenceRule ? (
              <span className={chip}>
                <Repeat2 className="size-3" aria-hidden="true" />
                {repeatLabel(task.recurrenceRule, copy, locale)}
              </span>
            ) : null}
            {behindDays ? (
              // 「N일 밀림」 — 반복이 밀렸다는 사실은 여기에만 남는다(지연 섹션에는 안 뜬다).
              // 완료하면 서버가 밀린 회차를 흡수하므로 배지도 함께 사라진다.
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-extrabold text-rose-600">
                {copy.odDaysBehind.replace("{n}", String(behindDays))}
              </span>
            ) : null}
            {task.tags.slice(0, 2).map((tg) => (
              <span
                className="rounded-full bg-primary/[0.06] px-2 py-0.5 text-[11px] font-bold text-primary"
                key={tg}
              >
                #{tg}
              </span>
            ))}
            {task.imageUrls.length > 0 ? (
              <span className={chip}>
                <ImageIcon className="size-3" aria-hidden="true" />
                {task.imageUrls.length}
              </span>
            ) : null}
            {summary && instrMode !== "sent" ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Share2 className="size-3" aria-hidden="true" />
                {sentMode ? `${summary} ${copy.sharedSuffix}` : summary}
              </span>
            ) : null}
          </div>
        ) : null}
      </button>

      {task.priority !== "normal" ? (
        <Flag
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            task.priority === "urgent"
              ? "text-rose-500"
              : task.priority === "medium"
                ? "text-blue-500"
                : "text-amber-500",
          )}
          aria-hidden="true"
        />
      ) : null}

      {/* Drag handle (Today view only). Owns its own pointer gesture; stops touch/pointer/click
          propagation and sets touch-action:none so it never starts the card's tap, long-press,
          or swipe. `-mr-1` pulls it to the card edge without widening the row. */}
      {reorderable ? (
        <button
          aria-label={copy.reorderHandle}
          className="-mr-1 -my-1 flex shrink-0 cursor-grab touch-none items-center self-stretch px-1 text-slate-300 transition-colors active:cursor-grabbing active:text-slate-400"
          data-swipe-back="off"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onReorderHandleDown?.(e, task);
          }}
          onTouchStart={(e) => e.stopPropagation()}
          type="button"
        >
          <GripVertical className="size-[18px]" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );

  const onContextMenu = (e: React.MouseEvent) => {
    if (!onLongPress || selectMode) return;
    e.preventDefault();
    onLongPress(task, occurrence);
  };

  // 0 → 1 as the card slides open; drives the reveal buttons' scale-in.
  const revealRatio = Math.min(1, Math.abs(offset) / swipeOpen);

  if (!canSwipe) {
    return (
      <div
        className={cn(done && !selectMode && "opacity-60")}
        onContextMenu={onContextMenu}
        onTouchCancel={onTouchEnd}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        onTouchStart={onTouchStart}
      >
        {cardInner}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-[18px]"
      // 열려 있는 카드에서 오른쪽으로 밀면 카드를 닫는다 — 화면 스와이프 뒤로가기가 가져가지 않게(16-mobile-navigation).
      data-swipe-back={offset !== 0 ? "off" : undefined}
    >
      {/* Reveal: floating rounded action buttons. Only visible while actually swiping — never
          peeks on tap/long-press. Reveal scales/fades in as the card slides for a polished feel. */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-stretch gap-2 py-1 pl-2.5 pr-2",
          offset === 0 ? "pointer-events-none opacity-0" : "opacity-100",
        )}
        style={{
          transform: `scale(${0.9 + 0.1 * revealRatio})`,
          transformOrigin: "right center",
          transition: isDragging
            ? "opacity 100ms ease"
            : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease",
        }}
      >
        <form
          action={swipeAction === "tomorrow" ? moveTaskToTomorrow : moveTaskToToday}
          className="flex"
        >
          <input name="taskId" type="hidden" value={task.id} />
          {swipeReturnView ? <input name="view" type="hidden" value={swipeReturnView} /> : null}
          <button
            className="flex w-[56px] flex-col items-center justify-center gap-1 rounded-[14px] bg-muted text-muted-foreground shadow-[0_2px_8px_-4px_rgba(20,16,10,0.22)] transition-transform active:scale-[0.93]"
            type="submit"
          >
            {swipeAction === "tomorrow" ? (
              <Sunrise className="size-4" strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <Sun className="size-4" strokeWidth={2.2} aria-hidden="true" />
            )}
            <span className="text-[10px] font-bold tracking-tight">
              {swipeAction === "tomorrow" ? copy.swipeTomorrow : copy.swipeToday}
            </span>
          </button>
        </form>
      </div>
      <div
        onContextMenu={onContextMenu}
        onTouchCancel={onTouchEnd}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        onTouchStart={onTouchStart}
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {cardInner}
      </div>
    </div>
  );
}
