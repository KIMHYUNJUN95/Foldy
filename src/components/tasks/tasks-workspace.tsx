"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal, useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  MoreHorizontal,
  Megaphone,
  Pencil,
  Plus,
  Repeat,
  Search,
  SearchX,
  SkipForward,
  Sun,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";
import {
  quickCreateTask,
  quickCreateTodayTask,
  quickCreateTomorrowTask,
} from "@/app/mobile/tasks/new/actions";
import {
  completeTask,
  deleteTasksInList,
  dismissOverdueTasks,
  reopenTask,
  reorderDateTasks,
  reorderTasks,
  rescheduleOverdueTo,
  restoreTasksInList,
  skipOccurrenceOn,
  unskipOccurrenceOn,
} from "@/app/mobile/tasks/[id]/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { TaskSchedulePicker } from "@/components/tasks/task-schedule-sheet";
import { repeatLabel, TaskCard } from "@/components/tasks/task-card";
import { ReorderableTaskList } from "@/components/tasks/reorderable-task-list";
import { ReportSheet } from "@/components/tasks/report-sheet";
import { TaskToast } from "@/components/tasks/task-toast";
import {
  anchorDateOf,
  dueDateOf,
  isActiveTask as isActive,
  isOpenOccurrenceOn,
  isOverdueOneOff,
  isTodayOneOff,
  isTomorrowOneOff,
  overdueOccurrenceDatesOf,
  showsOnTodayList,
  prioSort,
} from "@/lib/task-predicates";
import { tokyoDateOf, tokyoToday, ymdShift } from "@/lib/tokyo-date";
import { ProjectsBoard } from "@/components/tasks/projects-board";
import { MiniCalendar } from "@/components/tasks/date-time-fields";
import type { FieldActivityRecord } from "@/lib/field-activity";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { ProjectSummary } from "@/lib/projects";
import type {
  OccurrenceOrderRecord,
  OccurrenceStateRecord,
  ShareableUser,
  TaskCompletionRecord,
  TaskRecord,
} from "@/lib/tasks";
import { myOwn, recvInstr, sentInstr } from "@/lib/task-directives";
import {
  isStandardRecurrence,
  type OccurrenceState,
  recurringOccurrencesInRange,
} from "@/lib/tasks-recurrence";
import { listReportSchedules, type ReportScheduleView } from "@/app/mobile/tasks/report-schedule-actions";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import "./tasks-white.css";

type Copy = Dictionary["tasks"];
type View =
  | "today"
  | "tomorrow"
  | "inbox"
  | "projects"
  | "instr"
  | "completed"
  | "calendar";

// 반복 회차 카드 리스트(오늘/내일 뷰) — 각 카드는 그 날짜의 회차로 완료 처리(행 status 아님).
// viewBody(거대 IIFE) 밖으로 빼서 컴포넌트 크기를 낮추고(React Compiler 최적화 유지) 오늘·내일에서
// 동일하게 재사용한다.

/**
 * 빠른 추가 시트의 제출 버튼 3개(보관함/오늘/내일) — 전송 중에는 셋 다 잠근다.
 *
 * 서버(`quickCreateTask` 등)에는 멱등 키도 유니크 제약도 없어, 전송 중 재탭을 막는 유일한 방어선이
 * 클라이언트 쪽 disable 뿐이다. `useFormStatus` 는 `<form>` **안쪽**에서만 값을 읽을 수 있어 이
 * 하위 컴포넌트로 분리했다.
 *
 * 공용 `SubmitButton`(`@/components/ui/submit-button`)을 쓰지 않은 이유: 그 컴포넌트는 `Button`의
 * 베이스 클래스(`h-11 rounded-xl shadow-glass` 등, `secondary` variant는 `backdrop-blur-xl`까지)를
 * 강제한다. 이 시트의 버튼은 `h-12/h-11 rounded-2xl` 에 그림자·블러 없는 flat 스타일이라 그대로
 * 쓰면 시각이 깨진다. 대신 같은 `useFormStatus` 패턴을 셋이 공유하는 로컬 버전으로 둔다.
 */
/** 만든 순서(오래된 것 먼저). 새 작업이 목록 **아래**, 추가하는 자리 가까이에 붙게 한다. */
const oldestFirst = (a: TaskRecord, b: TaskRecord) => a.createdAt.localeCompare(b.createdAt);
/** 우선순위 먼저, 같으면 만든 순서. */
const byPriorityThenOldest = (a: TaskRecord, b: TaskRecord) => prioSort(a, b) || oldestFirst(a, b);

function QuickAddSubmitButtons({
  copy,
  hasTitle,
  onDetailClick,
}: {
  copy: Copy;
  /** 제목이 비어 있지 않은가. 값 자체가 아니라 **불리언**만 받는다 — 타자마다 부모가 다시 그려지지
   *  않게 하려고 입력을 비제어로 두었기 때문이다(아래 `quickTitleValue` 주석 참고). */
  hasTitle: boolean;
  /** 「자세히」로 넘어갈 때 입력값을 실어 보낸다. 값은 클릭 시점에 참조에서 읽는다. */
  onDetailClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { pending } = useFormStatus();
  const disabled = pending || !hasTitle;
  // 화이트 리디자인(시안 TodoAdd-Phone): 관리함(회색) · 오늘에 추가(보라) · 내일에 추가(옅은 보라) 세 개를 한 줄로.
  // 관리함이 폼의 기본 제출(엔터)이다 — 예전과 같다.
  return (
    <>
      <div className="tkw-qa__btns">
        <button className="tkw-btn is-gray" disabled={disabled} type="submit">
          {copy.viewInbox}
        </button>
        <button className="tkw-btn is-pri" disabled={disabled} formAction={quickCreateTodayTask} type="submit">
          {copy.quickAddToday}
        </button>
        <button className="tkw-btn is-soft" disabled={disabled} formAction={quickCreateTomorrowTask} type="submit">
          {copy.quickAddTomorrow}
        </button>
      </div>
      <div className="tkw-qa__foot">
        <span>{copy.mobileWhite.addKeepOpen}</span>
        {/* Full organized create — carries any typed title across so the capture isn't lost. */}
        <Link href="/mobile/tasks/new" onClick={onDetailClick}>
          {copy.quickAddDetailed} ›
        </Link>
      </div>
    </>
  );
}

export function TasksWorkspace({
  buildingLabels,
  completions,
  fieldActivities,
  copy,
  currentUserId,
  initialView,
  locale,
  moveError,
  occurrenceOrders,
  occurrenceStates,
  projectCompletedTasks,
  projects,
  shareableUsers,
  tasks: allTasks,
  today: initialToday,
}: {
  buildingLabels: Record<string, string>;
  /** 완료 로그(task_updates net). 완료·기록 탭과 그 배지의 유일한 기준 — @/lib/tasks 주석 참고. */
  completions: TaskCompletionRecord[];
  fieldActivities: FieldActivityRecord[];
  copy: Copy;
  currentUserId: string;
  initialView: View;
  locale: Locale;
  /** 이동이 거절된 이유(반복 회차 중복). 서버 액션이 쿼리로 돌려보낸다. */
  moveError?: string;
  /** 반복 회차의 날짜별 수동 순서(task_occurrence_order). 일회성은 tasks.sort_order 를 쓴다. */
  occurrenceOrders: OccurrenceOrderRecord[];
  occurrenceStates: OccurrenceStateRecord[];
  // Completed project tasks, supplied separately so the Completed tab's project filter can show
  // them. `tasks` itself excludes project tasks (they live only in the Projects tab).
  projectCompletedTasks: TaskRecord[];
  projects: ProjectSummary[];
  shareableUsers: ShareableUser[];
  tasks: TaskRecord[];
  /**
   * 서버 렌더 시점의 Tokyo 운영일. **이 값을 그대로 쓰지 않는다** — 아래에서 상태의 초기값으로만
   * 쓰고, 이후에는 클라이언트가 직접 계산한 값이 정본이다(자정 넘김 대응).
   */
  today: string;
}) {
  /**
   * Tokyo 운영일 — **서버 prop 을 초기값으로만 쓰고 이후에는 클라이언트가 갱신한다.**
   *
   * PWA 를 켠 채 두면 이 컴포넌트가 언마운트되지 않으므로, 서버 렌더 시점의 날짜가 그대로 남는다.
   * JST 자정을 넘기면 「오늘」 탭이 어제를 보여 주고 지연 판정도 하루 밀린다(2026-09-08 수정).
   *
   * 초기값은 반드시 **서버가 준 값**이어야 한다 — 첫 렌더에서 클라이언트가 스스로 계산하면 서버
   * 마크업과 어긋나 하이드레이션 불일치가 난다. 갱신은 마운트 후에만 일어난다.
   * 관리자 콘솔(`admin-tasks-console.tsx`)이 같은 방식을 쓴다.
   */
  const [today, setToday] = useState(initialToday);
  useEffect(() => {
    const check = () => setToday((prev) => (tokyoToday() !== prev ? tokyoToday() : prev));
    check(); // 마운트 시 한 번 — 서버 렌더와 지금 사이에 자정을 넘겼을 수 있다
    const id = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const [view, setView] = useState<View>(initialView);
  // 고른 보기 탭이 가로 띠 밖에 있으면(캘린더 · 완료) 띠만 옆으로 밀어 보이게 한다 — 화면은 세로로 움직이지 않게.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = tabsRef.current;
    const on = strip?.querySelector<HTMLElement>(".tkw-tab.is-on");
    if (!strip || !on) return;
    const left = on.offsetLeft - strip.offsetLeft;
    const right = left + on.offsetWidth;
    if (left < strip.scrollLeft + 8) strip.scrollTo({ left: Math.max(0, left - 20), behavior: "smooth" });
    else if (right > strip.scrollLeft + strip.clientWidth - 8)
      strip.scrollTo({ left: right - strip.clientWidth + 20, behavior: "smooth" });
  }, [view]);
  /** 지시 탭 안의 받은/보낸 세그먼트. */
  const [instrTab, setInstrTab] = useState<"recv" | "sent">("recv");
  /**
   * 완료 토글의 낙관적 반영 — **일회성과 반복이 같은 방식을 쓴다.**
   *
   * 완료를 누르면 서버가 끝나기 전에 목록에서 사라져야 한다. 그러지 않으면 «세션 조회 → 상태
   * 기록 → 로그 insert → revalidatePath 3개 → 페이지 전체 RSC 재렌더» 왕복이 끝날 때까지 아무
   * 반응이 없다. 2026-08-07 실측에서 **반복 회차만 그 대기를 그대로 겪고 있었다** — 일회성은
   * 수동으로 행을 숨기고 있었지만 반복에는 그 처리가 없었다(관리함 9건 중 7건이 반복이라 사실상
   * 대부분의 완료가 느리게 느껴졌다).
   *
   * 두 경로 모두 `useOptimistic` 으로 통일한다. 직접 만든 «숨김 집합 + try/finally 원복» 은
   * 되돌리기를 손으로 관리해야 하는데, `useOptimistic` 은 트랜지션이 끝나 새 props 가 도착하면
   * 스스로 버려진다 — 실패해도 행이 저절로 제자리로 돌아온다.
   */
  const [visibleTasks, applyTaskOptimistic] = useOptimistic(
    allTasks,
    (
      tasks: TaskRecord[],
      action: { type: "hide"; ids: readonly string[] } | { type: "complete"; id: string },
    ) => {
      if (action.type === "hide") {
        const gone = new Set(action.ids);
        return tasks.filter((t) => !gone.has(t.id));
      }
      // 완료 — 목록에서 지우지 않고 **완료 상태로 바꾼다**(2026-10-15 화이트 리디자인). 그래야 같은 순간
      // 오늘 탭 아래 「완료」 묶음으로 내려앉는다(아래 `optimisticCompletions` 와 짝).
      return tasks.map((t) =>
        t.id === action.id
          ? { ...t, status: "completed" as const, completedAt: new Date().toISOString() }
          : t,
      );
    },
  );
  const hideTasksOptimistically = useCallback(
    (ids: readonly string[]) => applyTaskOptimistic({ type: "hide", ids }),
    [applyTaskOptimistic],
  );
  /** 완료 로그의 낙관적 반영 — 오늘 「완료」 묶음 · 진행 링 · 완료·기록이 누른 즉시 바뀐다. */
  const [visibleCompletions, addCompletionOptimistically] = useOptimistic(
    completions,
    (list: TaskCompletionRecord[], added: TaskCompletionRecord) => [...list, added],
  );
  /**
   * 반복은 행이 아니라 **회차**가 완료된다. 완료된 회차는 상태 행이 생기는 순간 목록에서 빠지므로
   * (`openOccursOn`), 낙관적으로 상태를 하나 얹으면 일회성과 똑같이 즉시 사라진다.
   */
  const [visibleOccurrenceStates, resolveOccurrenceOptimistically] = useOptimistic(
    occurrenceStates,
    (states: OccurrenceStateRecord[], done: { taskId: string; occurrenceDate: string }) => [
      ...states,
      {
        taskId: done.taskId,
        occurrenceDate: done.occurrenceDate,
        state: "completed" as const,
        completedByUserId: currentUserId,
        movedToDate: null,
      },
    ],
  );
  // 오늘/내일/관리함/캘린더/기록은 **내 일정**이다. 내가 보낸 지시는 대상자의 일정이므로 빼고,
  // "지시 › 보낸 지시"에서만 진행 상황을 본다(관리 콘솔 `myOwn` 과 같은 규칙 — @/lib/task-directives).
  // 받은 지시는 내 일정이므로 그대로 남는다.
  // useMemo 필수: 이 배열은 아래 회차 헬퍼들의 수동 메모이제이션 의존성으로 흘러가, 매 렌더 새
  // 배열이면 React Compiler 가 그 메모이제이션을 보존하지 못하고 컴포넌트 전체를 포기한다.
  const tasks = useMemo(
    () => visibleTasks.filter((t) => myOwn(t, currentUserId)),
    [visibleTasks, currentUserId],
  );
  // 빠른 추가 시트 — 공용 `BottomSheet`(2026-10-15 화이트 리디자인에서 손으로 짠 시트를 걷어냄).
  const [quickOpen, setQuickOpen] = useState(false);
  /**
   * 빠른 추가 제목은 **비제어 입력**이다 — 값은 이 참조가 들고 화면은 DOM 이 맡는다.
   *
   * 제어 입력으로 두면 한 글자마다 이 컴포넌트(2500줄)가 통째로 다시 그려진다. 폼 제출은 이미
   * `name="title"` 로 **DOM 에서 직접** 값을 읽으므로(서버 액션의 `formData.get("title")`),
   * 상태로 들고 있을 이유가 애초에 없었다. 화면이 알아야 하는 것은 「비었는가」 하나뿐이다.
   * 관리자 콘솔 인라인 추가와 같은 판단(2026-09-04).
   *
   * 시트를 닫았다 열면 입력이 유지되던 기존 동작은 그대로다 — **닫을 때 한 번** 값을 `quickSeed` 에
   * 담아 두고 다음에 열릴 때 `defaultValue` 로 되살린다. 타자마다가 아니라 닫을 때 한 번이라 비용이
   * 없고, 렌더 중에 참조를 읽지 않으므로 `react-hooks/refs` 규칙도 지킨다.
   */
  const quickInputEl = useRef<HTMLInputElement | null>(null);
  const [hasQuickTitle, setHasQuickTitle] = useState(false);
  const [quickSeed, setQuickSeed] = useState("");
  const openQuick = useCallback(() => {
    haptic("light");
    setQuickOpen(true);
  }, []);
  // 시트가 닫히는 애니메이션이 끝난 뒤(`BottomSheet` onClose) — 언마운트 전에 입력값을 담아 둔다.
  const onQuickClosed = useCallback(() => {
    setQuickSeed(quickInputEl.current?.value ?? "");
    setQuickOpen(false);
  }, []);
  // Body portals (FAB + sheet) are client-only; gate on hydration so server and the
  // first client render agree (avoids a hydration mismatch). false on server, true after mount.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // 캘린더에서 고른 날 — 기본은 오늘. 그날 목록이 달력 아래(태블릿은 옆)에 바로 보인다(예전의 하루 시트 대신).
  const [calDay, setCalDay] = useState<string>(initialToday);
  const [calMonth, setCalMonth] = useState(() => {
    const [ty, tm] = today.split("-").map(Number);
    return { y: ty, m: tm };
  });
  // 캘린더에서 고정 반복(표준 반복) 회차 숨김 — 세션 상태(새로고침 시 초기화), 기본 표시.
  const [hideRecurring, setHideRecurring] = useState(false);

  // --- Long-press context menu + multi-select (edit/delete convenience).
  const router = useRouter();
  const [pressTask, setPressTask] = useState<TaskRecord | null>(null);
  // 이동 거절 안내 — 쿼리로 들어온 값을 한 번만 띄우고 URL 을 정리한다(새로고침 시 재노출 방지).
  const [moveNotice, setMoveNotice] = useState<string | null>(moveError ?? null);
  useEffect(() => {
    if (!moveNotice) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search.replace(/[?&]moveError=[^&]*/, "").replace(/^&/, "?"));
    const t = setTimeout(() => setMoveNotice(null), 4000);
    return () => clearTimeout(t);
  }, [moveNotice]);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [deleting, startDelete] = useTransition();

  // 이 카드가 렌더된 회차 날짜(반복 작업일 때만). 삭제 시 "그 날짜만 건너뛰기"를 제안하려면 필요하다.
  const [pressOcc, setPressOcc] = useState<string | null>(null);
  const openPressMenu = useCallback(
    (task: TaskRecord, occurrence?: { date: string; done: boolean }) => {
      setPressTask(task);
      setPressOcc(occurrence?.date ?? null);
    },
    [],
  );
  const toggleSelect = useCallback((task: TaskRecord) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }, []);
  const enterSelect = useCallback((task?: TaskRecord) => {
    setSelectMode(true);
    setSelectedIds(new Set(task ? [task.id] : []));
  }, []);
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);
  // 삭제 되돌리기 상태. **`performDelete` 보다 위에 선언해야 한다** — 아래에 두면 React Compiler 가
  // "Cannot access variable before it is declared" 로 막는다.
  const [deletedUndoIds, setDeletedUndoIds] = useState<string[] | null>(null);
  const deleteUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDeleteUndo = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    if (deleteUndoTimer.current) clearTimeout(deleteUndoTimer.current);
    setDeletedUndoIds(ids);
    deleteUndoTimer.current = setTimeout(() => setDeletedUndoIds(null), 6000);
  }, []);

  // Commit a delete (single from the menu, or the multi-select batch). Optimistically hide the
  // rows, then run the server batch delete; only author-owned tasks are actually removed.
  const performDelete = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      startDelete(async () => {
        // 완료와 같은 낙관적 경로를 쓴다. 남의 작업을 같이 골랐다면 서버가 그것만 남겨서 돌려주고,
        // 새 props 가 도착하면서 낙관적 값이 버려져 그 행은 제자리로 돌아온다.
        hideTasksOptimistically(ids);
        const { deletedIds } = await deleteTasksInList(ids);
        // 실제로 지워진 것만 되돌릴 수 있다 — 남의 작업을 같이 골랐어도 그건 안 지워진다.
        showDeleteUndo(deletedIds);
      });
      setConfirmIds(null);
      setSelectMode(false);
      setSelectedIds(new Set());
    },
    [hideTasksOptimistically, showDeleteUndo],
  );

  /**
   * 반복 회차 건너뛰기 (2026-07-30).
   *
   * 목록의 삭제는 `tasks` 행을 지워 **모든 날짜**에서 사라지게 한다. 반복 작업에는 "오늘만 못 한다"가
   * 흔하므로, 반복 카드를 회차로 보고 있을 때는 삭제 대신 무엇을 지울지 먼저 묻는다(`recurDelete` 시트).
   * 건너뛴 회차는 `task_occurrence_state` 에 `skipped` 로 남고 반복 자체는 예정대로 계속된다.
   *
   * 여기서는 낙관적 반영을 하지 않는다. 완료(`runStatus`)와 달리 **무엇이 지워질지 시트에서
   * 고른 뒤에야 정해지고**(이 회차만 / 전체), 「전체 삭제」는 되돌리기 토스트가 따로 붙는다.
   * 서버 응답을 보고 그리는 편이 맞다.
   */
  const [recurDelete, setRecurDelete] = useState<{ task: TaskRecord; date: string } | null>(null);
  /** YYYY-MM-DD → "7/30 (목)". UTC 로 고정해 Tokyo 날짜 문자열이 하루 밀리지 않게 한다. */
  const shortDateLabel = useCallback(
    (ymd: string) =>
      new Intl.DateTimeFormat(locale, {
        month: "numeric",
        day: "numeric",
        weekday: "short",
        timeZone: "UTC",
      }).format(new Date(`${ymd}T00:00:00Z`)),
    [locale],
  );
  const [, startSkip] = useTransition();
  const [skipUndo, setSkipUndo] = useState<{ taskId: string; date: string } | null>(null);
  const skipUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSkipOccurrence = useCallback(
    (taskId: string, date: string) => {
      setRecurDelete(null);
      startSkip(async () => {
        await skipOccurrenceOn(taskId, date);
      });
      if (skipUndoTimer.current) clearTimeout(skipUndoTimer.current);
      setSkipUndo({ taskId, date });
      skipUndoTimer.current = setTimeout(() => setSkipUndo(null), 6000);
    },
    [],
  );
  const undoSkipOccurrence = useCallback(() => {
    setSkipUndo((cur) => {
      if (cur)
        startSkip(async () => {
          await unskipOccurrenceOn(cur.taskId, cur.date);
        });
      return null;
    });
  }, []);

  // --- Overdue prompt (Today tab): reschedule / clear past unfinished.
  const [overduePending, startOverdue] = useTransition();
  const [overdueConfirm, setOverdueConfirm] = useState(false);
  /** 지연 묶음 「⋯」 시트 — 지우기처럼 무거운 동작은 머리 줄에 두지 않고 여기로(HIG 다듬기 06). */
  const [overdueMenuOpen, setOverdueMenuOpen] = useState(false);
  const [overdueRescheduleOpen, setOverdueRescheduleOpen] = useState(false);
  const [overdueSelection, setOverdueSelection] = useState<Set<string>>(new Set());
  /**
   * 지연 섹션의 일괄 선택 모드 (2026-07-31). 꺼져 있으면 지연 카드는 평범한 카드다 — 탭하면 상세가
   * 열리고 롱프레스로 메뉴가 뜬다. 예전엔 이 섹션이 항상 선택 모드로 렌더돼 카드가 통째로 죽어 있었다.
   */
  const [overdueSelectMode, setOverdueSelectMode] = useState(false);

  // --- Quick complete (status circle tap on any card) + undo toast.
  const [, startComplete] = useTransition();
  const [undoTask, setUndoTask] = useState<TaskRecord | null>(null);
  const [undoOcc, setUndoOcc] = useState<string | null>(null); // 반복 완료 undo 시 회차 날짜
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 마지막 완료 요청 — 실행 취소는 서버가 **실제로 기록한** 회차로 되돌린다. 회차가 아닌 날 완료하면
  // 가장 오래된 밀린 회차로 정산되므로, 누른 날짜로 되돌리면 아무것도 풀리지 않는다.
  const lastCompletion = useRef<Promise<string | undefined> | null>(null);
  /**
   * 완료/되돌리기 실행. 완료는 **누른 즉시** 목록에서 빠지고, 서버 왕복은 그 뒤에 따라온다.
   *
   * 낙관적 갱신은 트랜지션 **안에서 먼저** 부른다 — 그래야 React 가 새 props 가 도착할 때까지
   * 그 값을 유지하고, 실패하면 자동으로 되돌린다. 되돌리기(reopen)에는 낙관적 처리를 하지 않는다:
   * 행이 다시 나타나야 하는데 그건 서버 데이터가 와야 알 수 있고, 실행 취소는 이미 토스트라는
   * 즉각적인 피드백을 갖고 있다.
   */
  const runStatus = useCallback(
    (task: TaskRecord, complete: boolean, occurrenceDate?: string) => {
      startComplete(async () => {
        if (complete) {
          if (occurrenceDate) resolveOccurrenceOptimistically({ taskId: task.id, occurrenceDate });
          else applyTaskOptimistic({ type: "complete", id: task.id });
          addCompletionOptimistically({
            taskId: task.id,
            day: tokyoToday(),
            byUserId: currentUserId,
            at: new Date().toISOString(),
          });
          const pending = completeTask(task.id, occurrenceDate);
          lastCompletion.current = pending;
          await pending;
        } else {
          await reopenTask(task.id, occurrenceDate);
        }
      });
    },
    [applyTaskOptimistic, addCompletionOptimistically, currentUserId, resolveOccurrenceOptimistically],
  );
  const handleCompleteToggle = useCallback(
    (task: TaskRecord, occurrence?: { date: string; done: boolean }) => {
      const complete = occurrence ? !occurrence.done : task.status !== "completed";
      runStatus(task, complete, occurrence?.date);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (complete) {
        setUndoTask(task);
        setUndoOcc(occurrence?.date ?? null);
        undoTimer.current = setTimeout(() => setUndoTask(null), 6000);
      } else {
        setUndoTask(null);
        setUndoOcc(null);
      }
    },
    [runStatus],
  );
  const handleUndo = useCallback(() => {
    haptic("light");
    if (undoTask) {
      const task = undoTask;
      const pending = undoOcc ? lastCompletion.current : null;
      if (pending) {
        startComplete(async () => {
          const recorded = await pending.catch(() => undefined);
          await reopenTask(task.id, recorded ?? undoOcc ?? undefined);
        });
      } else {
        runStatus(task, false, undoOcc ?? undefined);
      }
    }
    setUndoTask(null);
    setUndoOcc(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, [runStatus, undoTask, undoOcc]);

  // Delete undo: deleteTask soft-deletes then redirects to ?deleted=<id>. Show a "삭제했습니다 · 실행
  // 취소" toast that calls restoreTask. Guarded by a ref so it fires once per id (no re-show on refresh).
  const searchParams = useSearchParams();
  // 상세에서 지우면 `?deleted=<id>` 로 돌아오고, 목록에서 일괄로 지우면 서버가 실제 지운 id 들을
  // 돌려준다. 두 경로가 같은 토스트를 쓰도록 **배열 하나로** 일반화했다(2026-07-31) — 예전에는
  // 상세 경로에만 실행 취소가 있어 목록에서 지우면 되돌릴 방법이 없었다.
  const processedDelete = useRef<string | null>(null);
  const processedSkip = useRef<string | null>(null);
  useEffect(() => {
    const taskId = searchParams.get("skippedTask");
    const date = searchParams.get("skippedDate");
    if (!taskId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const key = `${taskId}|${date}`;
    if (processedSkip.current === key) return;
    processedSkip.current = key;
    const raf = requestAnimationFrame(() => {
      if (skipUndoTimer.current) clearTimeout(skipUndoTimer.current);
      setSkipUndo({ taskId, date });
      skipUndoTimer.current = setTimeout(() => setSkipUndo(null), 6000);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("skippedTask");
      next.delete("skippedDate");
      const query = next.toString();
      router.replace(`/mobile/tasks${query ? `?${query}` : ""}`, { scroll: false });
    });
    return () => cancelAnimationFrame(raf);
  }, [router, searchParams]);
  /**
   * 빠른 추가 성공(`?created=1`) 처리 — **입력을 비우고 시트를 열어 둔다.**
   *
   * 서버 액션이 `redirect("/mobile/tasks?view=…&created=1")` 로 끝나는데, 같은 라우트라 소프트
   * 내비게이션이 일어나고 `TasksWorkspace` 는 언마운트되지 않는다. 그래서 **시트도 입력도 그대로
   * 남아 있었다** — 방금 등록한 제목이 칸에 남아 그대로 한 번 더 누르면 같은 작업이 또 만들어진다.
   * `created` 파라미터는 타입 선언에만 있고 **아무도 소비하지 않았다**(2026-09-04 발견).
   *
   * 비우되 **닫지는 않는다** — 한 건 넣고 곧바로 다음 건을 치는 흐름을 관리자 콘솔 인라인 추가와
   * 맞춘다. 닫으려면 스크림 탭 · 아래로 드래그 · Esc(기존 경로 그대로).
   */
  const processedCreated = useRef<string | null>(null);
  useEffect(() => {
    if (searchParams.get("created") !== "1") return;
    const key = searchParams.toString();
    if (processedCreated.current === key) return;
    processedCreated.current = key;
    const raf = requestAnimationFrame(() => {
      if (quickInputEl.current) quickInputEl.current.value = "";
      setQuickSeed("");
      setHasQuickTitle(false);
      if (quickOpen) quickInputEl.current?.focus();
      const next = new URLSearchParams(searchParams.toString());
      next.delete("created");
      const query = next.toString();
      router.replace(`/mobile/tasks${query ? `?${query}` : ""}`, { scroll: false });
    });
    return () => cancelAnimationFrame(raf);
  }, [router, searchParams, quickOpen]);
  useEffect(() => {
    const id = searchParams.get("deleted");
    if (!id || processedDelete.current === id) return;
    processedDelete.current = id;
    const raf = requestAnimationFrame(() => setDeletedUndoIds([id]));
    const t = setTimeout(() => setDeletedUndoIds((cur) => (cur?.[0] === id ? null : cur)), 6000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [searchParams]);
  const handleRestore = useCallback(() => {
    haptic("light");
    setDeletedUndoIds((ids) => {
      if (ids?.length)
        startComplete(async () => {
          await restoreTasksInList(ids); // 액션이 revalidatePath 한다 — refresh 중복 금지
        });
      return null;
    });
  }, []);

  // 완료/기록 tab: daily-report sheet target date (the day-group whose 보고서 button was tapped).
  const [reportDate, setReportDate] = useState<string | null>(null);
  // 완료/기록 tab: regular vs. project completions filter. Project tasks don't exist yet
  // (data layer deferred), so "project" currently resolves to an empty set.
  const [completedFilter, setCompletedFilter] = useState<"all" | "regular" | "project">("all");

  // Tokyo "tomorrow" (today + 1), used by the Tomorrow tab + its swipe defer action.
  // Memoized: as a plain render const it flows into occurrence helpers in a way the React Compiler
  // couldn't reconcile with their manual memoization (bailed the whole component).
  const tomorrowDate = useMemo(() => ymdShift(today, 1), [today]);
  // 떠 있는 토스트가 하나라도 있는가 — 아래 FAB 를 잠시 물러나게 하는 데 쓴다.
  const toastVisible = !!(
    moveNotice || skipUndo || undoTask || deletedUndoIds?.length
  );
  // 반복 회차 상태(2026-07-30): taskId → (date → state). 완료/지연 판정에 사용.
  const occByTask = useMemo(() => {
    const m = new Map<string, Map<string, OccurrenceState>>();
    for (const s of visibleOccurrenceStates) {
      const inner = m.get(s.taskId) ?? new Map<string, OccurrenceState>();
      inner.set(s.occurrenceDate, s.state);
      m.set(s.taskId, inner);
    }
    return m;
  }, [visibleOccurrenceStates]);
  const occStateOf = useCallback(
    (taskId: string, date: string): OccurrenceState | undefined => occByTask.get(taskId)?.get(date),
    [occByTask],
  );
  // 날짜별 반복 회차 순서: `${taskId}|${date}` → sort_order.
  const occOrderMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of occurrenceOrders) m.set(`${o.taskId}|${o.occurrenceDate}`, o.sortOrder);
    return m;
  }, [occurrenceOrders]);
  /**
   * 한 날짜 목록의 정렬 키 — 일회성은 `tasks.sort_order`, 반복은 그 날짜의 회차 순서.
   * 저장처가 둘이라 읽을 때 다시 합친다(2026-07-30 B안). 수동 위치가 없으면 null 로 두고
   * 호출부가 우선순위 폴백을 태운다.
   */
  const dateOrderOf = useCallback(
    (t: TaskRecord, date: string): number | null =>
      isStandardRecurrence(t.recurrenceRule)
        ? occOrderMap.get(`${t.id}|${date}`) ?? null
        : t.sortOrder,
    [occOrderMap],
  );
  const resolvedDatesFor = useCallback(
    (taskId: string): Set<string> => new Set(occByTask.get(taskId)?.keys() ?? []),
    [occByTask],
  );
  // 날짜·회차 술어는 전부 `@/lib/task-predicates` 가 정본이다. 예전에는 이 자리에 인라인으로
  // 재구현돼 있었고 콘솔(`admin/tasks/helpers.ts`)에도 같은 것이 따로 있었다 — 그 쌍둥이가 갈리면서
  // 실제 사고를 냈다(결정 로그 2026-07-30 · 2026-08-25). 여기서는 `today` 를 묶은 얇은 래퍼만 둔다.
  const anchor = anchorDateOf;
  const openOccursOn = (t: TaskRecord, ymd: string) => isOpenOccurrenceOn(t, ymd, occStateOf);
  const overdueOccDates = (t: TaskRecord) =>
    overdueOccurrenceDatesOf(t, today, resolvedDatesFor(t.id));
  const isOverdue = (t: TaskRecord) => isOverdueOneOff(t, today);
  const isToday = (t: TaskRecord) => isTodayOneOff(t, today);
  const isTomorrow = (t: TaskRecord) => isTomorrowOneOff(t, today);
  /** 하루 안의 정렬 — 시간이 있는 항목이 먼저(빠른 시각 순), 없으면 우선순위. 콘솔 `tasksOn` 과 동일. */
  const timeThenPrio = (a: TaskRecord, b: TaskRecord) =>
    (a.timeLabel ?? "99").localeCompare(b.timeLabel ?? "99") || prioSort(a, b);
  // Today-view ordering: a manual drag-reorder (sort_order) wins; unranked tasks (sort_order null)
  // fall back to priority, preserving the original behaviour until the user drags. Ranked tasks
  // always sort before unranked ones.
  /**
   * 한 날짜의 일회성 + 반복 회차를 하나의 배열로 합쳐 정렬한다.
   * 수동 위치가 있는 항목이 먼저(작은 인덱스 순), 없는 항목은 뒤에서 우선순위 폴백.
   */
  const mergeByDateOrder = useCallback(
    (oneOff: TaskRecord[], recurring: TaskRecord[], date: string): TaskRecord[] =>
      [...oneOff, ...recurring].sort((a, b) => {
        const ao = dateOrderOf(a, date);
        const bo = dateOrderOf(b, date);
        if (ao != null && bo != null) return ao !== bo ? ao - bo : prioSort(a, b);
        if (ao != null) return -1;
        if (bo != null) return 1;
        return prioSort(a, b);
      }),
    [dateOrderOf],
  );
  const orderSort = (a: TaskRecord, b: TaskRecord) => {
    const ao = a.sortOrder;
    const bo = b.sortOrder;
    if (ao != null && bo != null) return ao !== bo ? ao - bo : byPriorityThenOldest(a, b);
    if (ao != null) return -1;
    if (bo != null) return 1;
    return byPriorityThenOldest(a, b);
  };
  // 수동 순서가 없으면 **만든 순서(오래된 것 먼저)** — 새 작업이 목록 아래에 붙는다(2026-09-09).
  // 예전에는 「새 작업이 위로」였는데, 목록 데이터가 `created_at desc` 로 오는 것을 그대로 둔
  // 결과였다. 정작 추가하는 자리는 아래(빠른 추가 시트·인라인 추가)라 방금 만든 것이 시야 밖으로
  // 튀었다. 관리자 콘솔도 같은 규칙을 쓴다.
  const inboxOrderSort = (a: TaskRecord, b: TaskRecord) => {
    const ao = a.sortOrder;
    const bo = b.sortOrder;
    if (ao != null && bo != null) return ao !== bo ? ao - bo : oldestFirst(a, b);
    if (ao != null) return -1;
    if (bo != null) return 1;
    return oldestFirst(a, b);
  };

  // --- First-slice search / filter: title + author text, and anchor-date single/range.
  // One shared lightweight state across the list views; the date filter reuses the same
  // `anchor()` (due wins over scheduled, Tokyo) used for grouping/listing/calendar.
  const [search, setSearch] = useState("");
  // 검색 칸(머리의 돋보기로 연다) · 그 안의 날짜 달력.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [dateMode, setDateMode] = useState<"single" | "range">("single");
  const [activeDatePicker, setActiveDatePicker] = useState<"single" | "from" | "to">("single");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  /**
   * 목록 필터에는 **지연된** 검색어를 쓴다 — 어드민 콘솔(`admin-tasks-console`)과 같은 이유다.
   * 이 컴포넌트도 큰 트리 하나라 검색어가 바뀌면 목록 전체가 다시 그려진다. `useDeferredValue`
   * 를 끼우면 입력창은 즉시 반응하고 무거운 목록만 낮은 우선순위로 따라온다. 로직은 그대로고
   * 스케줄링만 달라진다.
   */
  const q = useDeferredValue(search).trim().toLowerCase();
  const hasSearch = q.length > 0;
  const hasDate = dateMode === "single" ? !!dateFrom : !!dateFrom || !!dateTo;
  const filterActive = hasSearch || hasDate;

  const matchesFilter = (t: TaskRecord) => {
    if (hasSearch) {
      // case-insensitive partial match across title + author name + tags. 태그는 콘솔
      // (`helpers.ts` matchQuery)이 이미 검색 대상이라, 빠져 있으면 "#체크아웃" 으로 찾던 작업이
      // 모바일에서만 안 나온다. 필드를 이어붙이지 않고 각각 확인해 경계를 넘는 오탐을 막는다.
      if (
        !t.title.toLowerCase().includes(q) &&
        !t.authorName.toLowerCase().includes(q) &&
        !t.tags.some((g) => g.toLowerCase().includes(q))
      )
        return false;
    }
    if (hasDate) {
      const a = anchor(t);
      if (!a) return false; // dateless tasks never match an active date filter
      if (dateMode === "single") {
        if (a !== dateFrom) return false;
      } else {
        if (dateFrom && a < dateFrom) return false;
        if (dateTo && a > dateTo) return false;
      }
    }
    return true;
  };
  // 항상 **새 배열**을 돌려준다. 호출부가 곧바로 `.sort()` 로 제자리 정렬을 하는데, 필터가 꺼져
  // 있을 때 원본을 그대로 넘기면 뷰 밖에서 공유하는 base 목록(`todayBase` 등)을 뒤섞게 된다.
  const applyFilter = (list: TaskRecord[]) =>
    filterActive ? list.filter(matchesFilter) : list.slice();
  const clearFilters = () => {
    setSearch("");
    setDateMode("single");
    setActiveDatePicker("single");
    setDateFrom("");
    setDateTo("");
    setFilterOpen(false);
  };
  const chipDate = (ymd: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "Asia/Tokyo",
    }).format(new Date(`${ymd}T00:00:00+09:00`));
  const dateLabel = !hasDate
    ? ""
    : dateMode === "single"
      ? chipDate(dateFrom)
      : `${dateFrom ? chipDate(dateFrom) : "…"} – ${dateTo ? chipDate(dateTo) : "…"}`;
  const activeDateValue =
    dateMode === "range" && activeDatePicker === "to" ? dateTo : dateFrom;
  const setActiveDateValue = (nextValue: string) => {
    if (dateMode === "range" && activeDatePicker === "to") {
      setDateTo(nextValue);
    } else {
      setDateFrom(nextValue);
    }
  };

  const tabs: { key: View; label: string }[] = [
    { key: "today", label: copy.viewToday },
    { key: "tomorrow", label: copy.viewTomorrow },
    { key: "inbox", label: copy.viewInbox },
    { key: "projects", label: copy.viewProjects },
    { key: "instr", label: copy.viewInstr },
    { key: "completed", label: copy.viewCompleted },
    { key: "calendar", label: copy.viewCalendar },
  ];

  // Swipe defer/pull action per view: Today → push to tomorrow; everywhere else → pull to today
  // (in the Tomorrow tab this means "do it today"). Sent/Calendar render with swipe disabled.
  const swipeActionForView: "today" | "tomorrow" = view === "today" ? "tomorrow" : "today";

  const cardProps = {
    buildingLabels,
    copy,
    locale,
    currentUserId,
    today,
    selectMode,
    selectedIds,
    onToggleSelect: toggleSelect,
    onLongPress: openPressMenu,
    swipeAction: swipeActionForView,
    // After the move the server action returns here; keep the user on the tab they swiped from.
    swipeReturnView: view,
    detailReturnView: view,
    // Status-circle tap completes (active) / reopens (completed) with an undo toast.
    onCompleteToggle: handleCompleteToggle,
  };

  // 지시 목록 — `tasks` 는 보낸 지시를 이미 뺐으므로 원본(`visibleTasks`)에서 뽑는다.
  const recvInstrTasks = visibleTasks.filter((t) => recvInstr(t, currentUserId));
  const sentInstrTasks = visibleTasks.filter((t) => sentInstr(t, currentUserId));
  /** 아직 손대지 않은 받은 지시 = 탭 배지. 탭을 열지 않아도 밀린 지시가 보인다. */
  const recvUnconfirmed = recvInstrTasks.filter((t) => t.status === "open").length;

  // ── 뷰별 base 목록 ────────────────────────────────────────────────────────────────
  // 뷰 본문(`viewBody`)·탭 배지·"전체 선택"이 **같은 배열**을 보도록 뷰 밖에서 한 번만 계산한다.
  // 예전에는 셋이 각자 필터를 다시 써서, 오늘 탭에 3건이 보이는데 배지는 다른 수를 쓰고 삭제 확인창은
  // 관리함까지 포함한 83건을 말하는 상태였다(2026-07-31 수정).
  const todayOverdueBase = tasks.filter(isOverdue);
  const todayBase = tasks.filter(isToday);
  // 반복 회차: **오늘 회차이거나 밀린 회차가 있으면** 오늘 목록에 뜬다(2026-09-08).
  // 밀린 것을 지연 섹션에 따로 세우지 않고 여기 한 줄로 모으고, 「N일 밀림」은 카드 배지가 된다.
  const todayRecBase = tasks.filter((t) =>
    showsOnTodayList(t, today, occStateOf, resolvedDatesFor(t.id)),
  );
  /** taskId → 밀린 회차 수. 오늘 카드의 배지에 쓴다(0이면 배지 없음). */
  const behindByTask = new Map<string, number>(
    todayRecBase
      .map((t) => [t.id, overdueOccDates(t).length] as [string, number])
      .filter(([, n]) => n > 0),
  );
  const tomorrowBase = tasks.filter(isTomorrow);
  const tomorrowRecBase = tasks.filter((t) => openOccursOn(t, tomorrowDate));
  const inboxBase = tasks.filter((t) => isActive(t));
  // 지연 일괄 처리는 작성자 본인 것만 서버가 받아준다 — 남의 작업을 대상에 넣으면 버튼의 건수와
  // 실제 처리 건수가 갈린다. 일정 변경 핸들러도 같은 목록을 봐야 해서 뷰 밖에 둔다.
  const ownedOverdueIds = todayOverdueBase
    .filter((t) => t.createdByUserId === currentUserId)
    .map((t) => t.id);

  // Overdue bulk reschedule handler — applies the chosen date to every targeted overdue task.
  // The date is picked in the shared TaskSchedulePicker (date variant) rendered at the top-level
  // return. 선택 모드가 아니면 내 지연 전체가 대상(오늘 뷰의 `overdueTargets` 와 같은 규칙).
  const rescheduleOverdue = (targetDate: string) =>
    startOverdue(async () => {
      await rescheduleOverdueTo(
        targetDate,
        overdueSelectMode ? [...overdueSelection] : ownedOverdueIds,
      );
      setOverdueRescheduleOpen(false);
      setOverdueSelectMode(false);
      setOverdueSelection(new Set());
    });

  // 완료·기록 — 완료 **로그**(task_updates net) 기준. 2026-07-30 롤포워드 폐지 이후 반복 완료는
  // 행의 status 를 건드리지 않고 `task_occurrence_state` + 로그에만 남으므로, status=completed 만
  // 보면 반복 완료가 목록에서 통째로 사라진다. 같은 화면의 업무일지 버튼은 이미 같은 로그를 읽고
  // 있어서, 목록엔 없는 작업이 보고서엔 찍히고 그날 완료가 반복뿐이면 날짜 그룹조차 안 생겼다.
  // 콘솔 `completedView` 와 같은 소스를 쓴다.
  const completedTaskById = new Map<string, TaskRecord>();
  for (const t of tasks) completedTaskById.set(t.id, t);
  for (const t of projectCompletedTasks) completedTaskById.set(t.id, t);
  const completionRows = visibleCompletions
    .map((c) => ({ completion: c, task: completedTaskById.get(c.taskId) }))
    .filter((r): r is { completion: TaskCompletionRecord; task: TaskRecord } => !!r.task)
    // 내가 **보낸** 지시를 대상자가 완료한 것은 내 기록이 아니다(2026-09-09) — 나는 지시자이고
    // 작업자는 그 사람이다. 진행 상황은 「지시 › 보낸 지시」에서 본다. 다른 목록은 이미 `myOwn` 으로
    // 보낸 지시를 빼고 있었는데 완료·기록만 빠져 있었다. 내가 직접 완료한 건은 남긴다.
    .filter(
      (r) => !(sentInstr(r.task, currentUserId) && r.completion.byUserId !== currentUserId),
    );

  // 업무일지 예약 상태(2026-10-20) — 「완료 · 기록」 날짜 줄의 「19:00 예약」 · 「19:00 보냄」. 그 탭을 볼 때와 시트를 닫은 뒤에 다시 읽는다.
  const reportDaysKey = Array.from(new Set([...completionRows.map((r) => r.completion.day), ...fieldActivities.map((a) => a.day)]))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 62)
    .join(",");
  const [reportSchedules, setReportSchedules] = useState<Record<string, ReportScheduleView>>({});
  useEffect(() => {
    if (view !== "completed" || reportDate !== null || !reportDaysKey) return;
    let alive = true;
    void listReportSchedules(reportDaysKey.split(",")).then((map) => {
      if (alive) setReportSchedules(map);
    });
    return () => {
      alive = false;
    };
  }, [view, reportDate, reportDaysKey]);
  const reportTag = (day: string) => {
    const sched = reportSchedules[day];
    if (!sched) return null;
    const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(
      new Date(sched.status === "sent" ? sched.sentAt ?? sched.sendAt : sched.sendAt),
    );
    if (sched.status === "scheduled" || sched.status === "sending")
      return <span className="tkw-rtag is-on">{copy.reportListScheduled.replace("{time}", hhmm)}</span>;
    if (sched.status === "sent") return <span className="tkw-rtag">{copy.reportListSent.replace("{time}", hhmm)}</span>;
    if (sched.status === "failed") return <span className="tkw-rtag is-bad">{copy.reportListFailed}</span>;
    return null;
  };

  // Per-tab counts (same base lists as each view).
  const tabCounts: Record<View, number> = {
    // 목록의 **줄 수**와 맞춘다. 2026-09-08 부터 반복은 (오늘 회차든 밀린 것이든) 한 줄이므로
    // `todayRecBase` 가 곧 줄 수다 — 예전의 «두 줄» 보정은 더 이상 필요 없다.
    today:
      todayOverdueBase.length +
      todayBase.length +
      todayRecBase.length,
    tomorrow: tomorrowBase.length + tomorrowRecBase.length,
    // Archive = every active todo in one management list.
    inbox: inboxBase.length,
    // Projects badge stays 0 until the Projects data layer lands (deferred).
    projects: 0,
    instr: recvUnconfirmed,
    // Completed badge = today's (Tokyo) completions, from the same completion log the list uses.
    completed:
      completionRows.filter((r) => r.completion.day === today).length +
      fieldActivities.filter((a) => a.day === today).length,
    calendar: 0,
  };

  // 캘린더 — 보고 있는 달의 회차 목록. 그리드 마커·선택된 날짜·월 아젠다·"전체 선택"이 모두 이
  // 배열 하나를 본다(예전엔 `renderCalendar` 안에서만 계산해 바깥에서 다시 쓸 수 없었다).
  const calMonthPrefix = `${calMonth.y}-${String(calMonth.m).padStart(2, "0")}`;
  const calDaysIn = new Date(Date.UTC(calMonth.y, calMonth.m, 0)).getUTCDate();
  const calMonthStart = `${calMonthPrefix}-01`;
  const calMonthEnd = `${calMonthPrefix}-${String(calDaysIn).padStart(2, "0")}`;
  // Todoist-style virtual previews: a recurring task is a single row, but the calendar shows it
  // on every occurrence within the visible month (computed from its rule — no extra rows). Each
  // virtual occurrence points back to the same real task (tap/edit affects the series).
  const calOccurrences: { iso: string; task: TaskRecord }[] = [];
  for (const t of tasks) {
    if (!isActive(t)) continue;
    const a = anchor(t);
    if (!a) continue;
    if (isStandardRecurrence(t.recurrenceRule)) {
      if (hideRecurring) continue; // "반복 숨기기" 토글: 고정 반복 회차 제외.
      for (const iso of recurringOccurrencesInRange(t.recurrenceRule, a, calMonthStart, calMonthEnd))
        calOccurrences.push({ iso, task: t });
    } else if (a >= calMonthStart && a <= calMonthEnd) {
      calOccurrences.push({ iso: a, task: t });
    }
  }
  // 하루 안 정렬은 시각 → 우선순위(콘솔 `tasksOn` 과 동일 규칙). 정렬을 빼면 서버가 준
  // created_at desc 가 그대로 남아, 같은 날의 09:00 과 18:00 이 뒤죽박죽으로 읽힌다.
  const calByDay = new Map<string, TaskRecord[]>();
  for (const o of calOccurrences) calByDay.set(o.iso, [...(calByDay.get(o.iso) ?? []), o.task]);
  for (const list of calByDay.values()) list.sort(timeThenPrio);


  // ── 화이트 리디자인(2026-10-15) 공용 조각 ─────────────────────────────────────────
  const w = copy.mobileWhite;
  const fmt = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone: "Asia/Tokyo" }).format(new Date(`${ymd}T00:00:00+09:00`));
  const yesterdayDate = ymdShift(today, -1);
  /** 완료 시각(도쿄) "HH:MM". */
  const clockOf = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" }).format(
      new Date(iso),
    );

  // 오늘 「완료」 묶음 — 오늘(도쿄) 완료 로그 중 일반 작업(프로젝트 작업은 오늘 목록에 없으므로 뺀다). 최신 먼저.
  const todayDoneRows = completionRows
    .filter((r) => r.completion.day === today && !r.task.projectId)
    .sort((a, b) => b.completion.at.localeCompare(a.completion.at));
  const ringDone = todayDoneRows.length;
  const ringTotal = ringDone + tabCounts.today;
  /** 이번 주(월요일 시작, 도쿄) 완료 수 — 완료·기록 머리. */
  const weekStart = (() => {
    const [y, m, d] = today.split("-").map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 월=0
    return ymdShift(today, -dow);
  })();
  const weekDoneCount = completionRows.filter((r) => r.completion.day >= weekStart && r.completion.day <= today).length;

  // 지연 일괄 처리 대상 — 선택 모드면 고른 것, 아니면 내 지연 전체(서버도 작성자 것만 받는다).
  const overdueTargets = overdueSelectMode ? [...overdueSelection] : ownedOverdueIds;
  const clearOverdue = () =>
    startOverdue(async () => {
      await dismissOverdueTasks(overdueTargets);
      setOverdueConfirm(false);
      setOverdueSelectMode(false);
      setOverdueSelection(new Set());
    });

  const sectionHead = (label: string, n: number, tone?: "over" | "muted", extra?: React.ReactNode) => (
    <div className="tkw-sec__h">
      <b className={tone === "over" ? "is-late" : tone === "muted" ? "is-muted" : undefined}>{label}</b>
      <span className="tkw-sec__n">{w.count.replace("{n}", String(n))}</span>
      {extra}
    </div>
  );

  const emptyState = (Icon: typeof Sun, title: string, sub?: string) => (
    <div className="tkw-empty">
      <Icon aria-hidden="true" />
      <b>{title}</b>
      {sub ? <span>{sub}</span> : null}
    </div>
  );

  // Shown when a view has tasks but the active search/filter matches none of them —
  // distinct from a genuinely empty view, and offers a one-tap reset.
  const noMatchState = () => (
    <div className="tkw-empty">
      <SearchX aria-hidden="true" />
      <b>{copy.filterNoResultTitle}</b>
      <span>{copy.filterNoResultSub}</span>
      <button onClick={clearFilters} type="button">
        {copy.filterClear}
      </button>
    </div>
  );

  const addRow = (
    <button className="tkw-add" onClick={openQuick} type="button">
      <Plus aria-hidden="true" />
      {w.addTask}
    </button>
  );

  /** 검색 · 필터 아이콘(머리 오른쪽 44px). 필터가 걸려 있으면 보라 점. */
  const searchButton = (
    <button
      aria-expanded={searchOpen}
      aria-label={w.searchFilter}
      className={cn("tkw-icon", (searchOpen || filterActive) && "is-on")}
      onClick={() => setSearchOpen((v) => !v)}
      type="button"
    >
      <Search aria-hidden="true" />
      {filterActive && !searchOpen ? <span className="tkw-icon__dot" /> : null}
    </button>
  );

  const head = (title: string, sub: string | null, opts?: { ring?: boolean; search?: boolean }) => (
    <div className="tkw-head">
      {opts?.ring ? (
        <div
          aria-label={w.progress.replace("{total}", String(ringTotal)).replace("{done}", String(ringDone))}
          className="tkw-ring"
          role="img"
        >
          <svg aria-hidden="true" viewBox="0 0 56 56">
            <circle className="tkw-ring__track" cx="28" cy="28" r="24" />
            <circle
              className="tkw-ring__fill"
              cx="28"
              cy="28"
              r="24"
              style={{ strokeDashoffset: 150.8 * (1 - (ringTotal > 0 ? ringDone / ringTotal : 0)) }}
            />
          </svg>
          <span className="tkw-ring__n">
            {ringDone}/{ringTotal}
          </span>
        </div>
      ) : null}
      <div className="tkw-head__b">
        <h1>{title}</h1>
        {sub ? <span className="tkw-head__s">{sub}</span> : null}
      </div>
      {opts?.search ? searchButton : null}
    </div>
  );

  // 검색 · 날짜 필터 — 머리의 돋보기로 연다. 필터가 걸린 채 닫으면 요약 한 줄만 남는다.
  const searchPanel =
    view === "calendar" || view === "projects" || selectMode ? null : searchOpen ? (
      <div className="tkw-search">
        <div className="tkw-search__row">
          <label className="tkw-search__in">
            <Search aria-hidden="true" />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              enterKeyHint="search"
              onChange={(e) => setSearch(e.target.value)}
              placeholder={copy.searchPlaceholder}
              type="search"
              value={search}
            />
            {hasSearch ? (
              <button aria-label={copy.filterClear} className="tkw-search__clr" onClick={() => setSearch("")} type="button">
                <X aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <button
            aria-expanded={filterOpen}
            aria-label={copy.filterDate}
            className={cn("tkw-search__date", (filterOpen || hasDate) && "is-on")}
            onClick={() => setFilterOpen((v) => !v)}
            type="button"
          >
            <CalendarDays aria-hidden="true" />
          </button>
        </div>
        {filterOpen ? (
          <div className="tkw-search__cal">
            <div className="tkw-search__modes">
              {(["single", "range"] as const).map((m) => (
                <button
                  className={cn(dateMode === m && "is-on")}
                  key={m}
                  onClick={() => {
                    setDateMode(m);
                    setActiveDatePicker(m === "single" ? "single" : "from");
                  }}
                  type="button"
                >
                  {m === "single" ? copy.filterDateSingle : copy.filterDateRange}
                </button>
              ))}
            </div>
            {dateMode === "range" ? (
              <div className="tkw-search__ends">
                <button
                  aria-label={copy.filterDateFrom}
                  className={cn(activeDatePicker === "from" && "is-on")}
                  onClick={() => setActiveDatePicker("from")}
                  type="button"
                >
                  {dateFrom ? chipDate(dateFrom) : copy.filterDateFrom}
                </button>
                –
                <button
                  aria-label={copy.filterDateTo}
                  className={cn(activeDatePicker === "to" && "is-on")}
                  onClick={() => setActiveDatePicker("to")}
                  type="button"
                >
                  {dateTo ? chipDate(dateTo) : copy.filterDateTo}
                </button>
              </div>
            ) : null}
            <MiniCalendar
              copy={copy}
              locale={locale}
              onClear={() => setActiveDateValue("")}
              onSelect={setActiveDateValue}
              value={activeDateValue}
            />
          </div>
        ) : null}
        {filterActive ? (
          <div className="tkw-search__active">
            {copy.filterActive}
            {hasSearch ? <b>“{search.trim()}”</b> : null}
            {hasDate ? <b>{dateLabel}</b> : null}
            <button onClick={clearFilters} type="button">
              {copy.filterClear}
            </button>
          </div>
        ) : null}
      </div>
    ) : filterActive ? (
      <div className="tkw-search" style={{ marginTop: -10 }}>
        <div className="tkw-search__active">
          {copy.filterActive}
          {hasSearch ? <b>“{search.trim()}”</b> : null}
          {hasDate ? <b>{dateLabel}</b> : null}
          <button onClick={clearFilters} type="button">
            {copy.filterClear}
          </button>
        </div>
      </div>
    ) : null;

  const viewBody = (() => {
    // Projects tab — separate workspace (own list / create sheet / FAB).
    if (view === "projects") {
      return <ProjectsBoard copy={copy} projects={projects} shareableUsers={shareableUsers} />;
    }

    if (view === "today") {
      const doneRows = todayDoneRows.filter(({ task }) => !filterActive || matchesFilter(task));
      const header = head(
        copy.viewToday,
        `${fmt(today, { month: "long", day: "numeric", weekday: "long" })} · ${w.progress
          .replace("{total}", String(ringTotal))
          .replace("{done}", String(ringDone))}`,
        { ring: true, search: true },
      );
      if (!todayOverdueBase.length && !todayBase.length && !todayRecBase.length && !todayDoneRows.length)
        return (
          <>
            {header}
            {searchPanel}
            {emptyState(Sun, copy.todayEmptyTitle, copy.todayEmptySub)}
            {addRow}
          </>
        );
      const over = applyFilter(todayOverdueBase).sort(orderSort);
      const todays = applyFilter(todayBase).sort(orderSort);
      const recToday = applyFilter(todayRecBase).sort(orderSort);
      const nothing = !over.length && !todays.length && !recToday.length && !doneRows.length;
      // Drag-reorder is offered only on the plain Today list — disabled while a search/date filter
      // is active (the list is a subset) or in multi-select mode (the row body owns the tap).
      const reorderDisabled = filterActive || selectMode;
      // Overdue actions: only the caller's own overdue tasks are actionable (the bulk actions are
      // author-scoped server-side). Recurring tasks keep their next occurrence; one-offs move/delete.
      const ownedOverdue = ownedOverdueIds.length;
      const selectedCount = overdueSelectMode ? overdueSelection.size : 0;
      const toggleOverdueTask = (task: TaskRecord) => {
        // Only the caller's own overdue tasks are actionable, so non-owned rows must not enter the
        // selection — otherwise the action count would include items the server silently ignores.
        if (task.createdByUserId !== currentUserId) return;
        const next = new Set(overdueSelection);
        if (next.has(task.id)) next.delete(task.id);
        else next.add(task.id);
        setOverdueSelection(next);
      };
      const showOverdueActs = ownedOverdue > 0 && !filterActive && !selectMode;
      const countSuffix = selectedCount > 0 ? ` ${selectedCount}` : "";
      return (
        <>
          {header}
          {searchPanel}
          {nothing ? noMatchState() : null}
          {over.length > 0 ? (
            <section className="tkw-sec">
              {sectionHead(
                copy.secOverdue,
                over.length,
                "over",
                <>
                  {/* 지연 묶음 동작 — 검색/날짜 필터 중에는 목록이 부분집합이라 숨긴다. 자주 쓰는 「날짜 다시 정하기」만
                      머리 줄에 두고, 선택 · 지난 미완료 삭제는 「⋯」 시트로(HIG 다듬기 05 · 06 — 누르는 영역 44px, 지우기를 옆에 붙이지 않는다). */}
                  {showOverdueActs ? (
                    <span className="tkw-sec__acts">
                      <button
                        className="tkw-tl"
                        disabled={overduePending || overdueTargets.length === 0}
                        onClick={() => setOverdueRescheduleOpen(true)}
                        type="button"
                      >
                        {w.reschedule}
                        {countSuffix}
                      </button>
                      <button
                        aria-label={w.overdueMore}
                        className="tkw-more"
                        disabled={overduePending}
                        onClick={() => setOverdueMenuOpen(true)}
                        type="button"
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </button>
                    </span>
                  ) : null}
                </>,
              )}
              {/* 일괄 선택 모드에서만 선택 고리가 된다. 그 밖에는 평범한 줄 — 탭하면 상세, 길게 누르면 메뉴. */}
              <ReorderableTaskList
                cardProps={
                  overdueSelectMode && !selectMode
                    ? {
                        ...cardProps,
                        selectMode: true,
                        selectedIds: overdueSelection,
                        onToggleSelect: toggleOverdueTask,
                        swipe: false,
                      }
                    : { ...cardProps, swipe: false }
                }
                disabled={true}
                items={over}
                onPersist={reorderTasks}
              />
            </section>
          ) : null}
          {todays.length > 0 || recToday.length > 0 ? (
            <section className="tkw-sec">
              {sectionHead(copy.secToday, todays.length + recToday.length)}
              {/* 일회성과 반복 회차를 **하나의 순서 공간**으로 합쳐 렌더한다(2026-07-30 B안). */}
              <ReorderableTaskList
                behindByTask={behindByTask}
                cardProps={{ ...cardProps, showDate: false }}
                disabled={reorderDisabled}
                items={mergeByDateOrder(todays, recToday, today)}
                occurrenceDate={today}
                onPersistDate={reorderDateTasks}
              />
            </section>
          ) : null}
          {doneRows.length > 0 ? (
            <section className="tkw-sec">
              {sectionHead(w.secDone, doneRows.length, "muted")}
              <div className="tkw-list">
                {doneRows.map(({ task, completion }) =>
                  renderDoneRow(task, completion, { trailing: false }),
                )}
              </div>
            </section>
          ) : null}
          {addRow}
        </>
      );
    }

    // Tomorrow (내일): same shape/features as Today (drag-reorder), filtered to tasks anchored
    // tomorrow. Swipe here pulls a task back to today (see swipeActionForView).
    if (view === "tomorrow") {
      const total = tomorrowBase.length + tomorrowRecBase.length;
      const header = head(
        copy.viewTomorrow,
        `${fmt(tomorrowDate, { month: "long", day: "numeric", weekday: "long" })} · ${w.taskCount.replace("{n}", String(total))}`,
        { search: true },
      );
      if (total === 0)
        return (
          <>
            {header}
            {searchPanel}
            {emptyState(Sunrise, copy.tomorrowEmptyTitle, copy.tomorrowEmptySub)}
            {addRow}
          </>
        );
      const list = applyFilter(tomorrowBase).sort(orderSort);
      const recList = applyFilter(tomorrowRecBase).sort(orderSort);
      const reorderDisabled = filterActive || selectMode;
      return (
        <>
          {header}
          {searchPanel}
          {list.length === 0 && recList.length === 0 ? (
            noMatchState()
          ) : (
            <section className="tkw-sec">
              <ReorderableTaskList
                cardProps={{ ...cardProps, showDate: false }}
                disabled={reorderDisabled}
                items={mergeByDateOrder(list, recList, tomorrowDate)}
                occurrenceDate={tomorrowDate}
                onPersistDate={reorderDateTasks}
              />
            </section>
          )}
          {addRow}
        </>
      );
    }

    // 관리함: every active todo, managed in one place. 수동 드래그 순서 허용(2026-07-30).
    if (view === "inbox") {
      const base = inboxBase;
      const list = applyFilter(base).sort(inboxOrderSort);
      const reorderDisabled = filterActive || selectMode;
      return (
        <>
          {head(copy.viewInbox, `${copy.inboxHint} · ${w.taskCount.replace("{n}", String(base.length))}`, {
            search: true,
          })}
          {searchPanel}
          {base.length === 0 ? (
            emptyState(Archive, copy.inboxEmptyTitle, copy.inboxEmptySub)
          ) : list.length === 0 ? (
            noMatchState()
          ) : (
            <section className="tkw-sec">
              <ReorderableTaskList cardProps={cardProps} disabled={reorderDisabled} items={list} onPersist={reorderTasks} />
            </section>
          )}
          {addRow}
        </>
      );
    }

    // 지시 — 받은/보낸 세그먼트. 상태 그룹은 관리 콘솔 `recvView`/`sentView` 와 같은 순서를 쓴다
    // (지연 → 미확인 → 진행 중 → 완료). 사무실과 현장이 같은 분류를 보게 하는 것이 이 화면의 핵심.
    if (view === "instr") {
      const recv = instrTab === "recv";
      const base = recv ? recvInstrTasks : sentInstrTasks;
      const sentOpen = sentInstrTasks.filter((t) => t.status !== "completed").length;
      const top = (
        <>
          {head(copy.viewInstr, recv ? copy.instrRecvNote : copy.instrSentNote, { search: true })}
          <div className="tkw-instr__seg">
            <div aria-label={copy.viewInstr} className="tkw-seg" role="tablist">
              {(
                [
                  ["recv", copy.instrRecv, recvUnconfirmed],
                  ["sent", copy.instrSent, sentOpen],
                ] as const
              ).map(([key, label, n]) => (
                <button
                  aria-selected={instrTab === key}
                  className={cn(instrTab === key && "is-on")}
                  key={key}
                  onClick={() => setInstrTab(key)}
                  role="tab"
                  type="button"
                >
                  {label}
                  {n > 0 ? <b>{n}</b> : null}
                </button>
              ))}
            </div>
          </div>
          {searchPanel}
        </>
      );
      // 보낸 지시 화면에서 바로 지시를 만들 수 있어야 한다 — 상세 생성 폼을 지시 모드로 연다
      // (`?directive=1` → 폼의 "지시로 보내기" 토글이 켜진 채 시작).
      const sendCta = recv ? null : (
        <Link className="tkw-add" href="/mobile/tasks/new?directive=1">
          <Plus aria-hidden="true" />
          {copy.sendAsDirective}
        </Link>
      );
      if (!base.length)
        return (
          <>
            {top}
            {recv
              ? emptyState(Bell, copy.instrEmptyRecvTitle, copy.instrEmptyRecvSub)
              : emptyState(Megaphone, copy.instrEmptySentTitle, copy.instrEmptySentSub)}
            {sendCta}
          </>
        );
      const list = applyFilter(base);
      if (!list.length)
        return (
          <>
            {top}
            {noMatchState()}
          </>
        );
      // 받은 지시만 "지연"을 따로 뽑는다. 보낸 지시의 지연은 대상자가 처리할 몫이라 상태로 족하다.
      const byDateThenPrio = (a: TaskRecord, b: TaskRecord) =>
        (dueDateOf(a) ?? "9999").localeCompare(dueDateOf(b) ?? "9999") || prioSort(a, b);
      const overdueList = recv ? list.filter((t) => isOverdue(t)) : [];
      const rest = list.filter((t) => !overdueList.includes(t));
      const groups: { label: string; items: TaskRecord[]; tone?: "over" | "muted" }[] = [
        { label: copy.instrSecOverdue, items: overdueList.sort(byDateThenPrio), tone: "over" },
        {
          label: recv ? copy.instrSecTodo : copy.instrSecUnconfirmed,
          items: rest.filter((t) => t.status === "open").sort(byDateThenPrio),
        },
        {
          label: copy.instrSecInProgress,
          items: rest.filter((t) => t.status === "in_progress").sort(byDateThenPrio),
        },
        {
          label: copy.instrSecCompleted,
          items: rest
            .filter((t) => t.status === "completed")
            .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
        },
      ];
      return (
        <>
          {top}
          {groups.map(({ label, items, tone }) =>
            items.length ? (
              <section className="tkw-sec" key={label}>
                {sectionHead(label, items.length, tone)}
                <div className="tkw-list">
                  {items.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      instrMode={recv ? "recv" : "sent"}
                      swipe={false}
                      {...cardProps}
                      // 보낸 지시는 대상자의 일정이다 — 지시자가 대신 완료 처리하지 않으므로 고리를
                      // 정적 표시로 둔다(TaskCard 는 onCompleteToggle 이 없으면 누를 수 없는 고리).
                      onCompleteToggle={recv ? cardProps.onCompleteToggle : undefined}
                      trailing={
                        t.status === "completed" && t.completedAt
                          ? fmt(tokyoDateOf(t.completedAt) ?? today, { month: "numeric", day: "numeric" })
                          : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null,
          )}
          {sendCta}
        </>
      );
    }

    // 완료·기록: every completion, grouped by the day it was logged (Tokyo), newest day first. Each
    // day header carries an 업무일지 link that opens the daily-report sheet for that date.
    if (view === "completed") {
      const top = (
        <>
          {head(w.doneTitle, w.doneWeek.replace("{n}", String(weekDoneCount)), { search: true })}
          {searchPanel}
          <div className="tkw-ftabs" role="tablist">
            {(["all", "regular", "project"] as const).map((f) => (
              <button
                aria-selected={completedFilter === f}
                className={cn(completedFilter === f && "is-on")}
                key={f}
                onClick={() => setCompletedFilter(f)}
                role="tab"
                type="button"
              >
                {f === "all" ? copy.projects.filterAll : f === "regular" ? copy.projects.filterRegular : copy.projects.filterProject}
              </button>
            ))}
          </div>
        </>
      );
      // 출처는 완료 로그(`completionRows`) — 행 status 가 아니다. 이유는 위 `completionRows` 주석 참고.
      if (completionRows.length === 0 && fieldActivities.length === 0)
        return (
          <>
            {top}
            {emptyState(CheckCircle2, copy.completedEmptyTitle, copy.completedEmptySub)}
          </>
        );
      const scoped = completionRows.filter(({ task }) =>
        completedFilter === "project" ? !!task.projectId : completedFilter === "regular" ? !task.projectId : true,
      );
      const list = scoped.filter(({ task }) => !filterActive || matchesFilter(task));
      const byDay = new Map<string, typeof list>();
      for (const row of list) {
        byDay.set(row.completion.day, [...(byDay.get(row.completion.day) ?? []), row]);
      }
      // 현장 활동(청소·유지보수·린넨·주문에서 본인이 완료 처리한 것). 투두가 아니므로 일반/프로젝트
      // 필터나 검색·태그 필터가 걸리면 감춘다 — 그 필터들은 작업의 속성으로 거르는데 현장 활동에는
      // 그런 속성이 없어서, 남겨 두면 필터가 안 먹는 것처럼 보인다.
      const fieldVisible = completedFilter === "all" && !filterActive ? fieldActivities : [];
      const fieldByDay = new Map<string, FieldActivityRecord[]>();
      for (const activity of fieldVisible) {
        fieldByDay.set(activity.day, [...(fieldByDay.get(activity.day) ?? []), activity]);
      }
      // 날짜 묶음은 두 소스의 합집합 — 그날 투두 완료가 없고 청소만 했어도 묶음이 생겨야 한다.
      const dayKeys = Array.from(new Set([...byDay.keys(), ...fieldByDay.keys()])).sort((a, b) => b.localeCompare(a));
      if (list.length === 0 && fieldVisible.length === 0)
        return (
          <>
            {top}
            {noMatchState()}
          </>
        );
      return (
        <>
          {top}
          {dayKeys.map((k) => {
            const md = fmt(k, { month: "long", day: "numeric" });
            const dayLabel =
              k === today
                ? `${copy.todayLabel} · ${md}`
                : k === yesterdayDate
                  ? `${w.yesterday} · ${md}`
                  : fmt(k, { month: "long", day: "numeric", weekday: "short" });
            // 로그 시각 기준 최신순. 반복 완료는 `completedAt`(행)이 비어 있으므로 완료 로그의 타임스탬프를 쓴다.
            const items = (byDay.get(k) ?? []).slice().sort((a, b) => b.completion.at.localeCompare(a.completion.at));
            const fieldItems = fieldByDay.get(k) ?? [];
            return (
              <section className="tkw-sec" key={k}>
                {sectionHead(
                  dayLabel,
                  items.length + fieldItems.length,
                  undefined,
                  <span className="tkw-sec__acts">
                    {reportTag(k)}
                    <button className="tkw-tl" onClick={() => setReportDate(k)} type="button">
                      {w.report}
                    </button>
                  </span>,
                )}
                <div className="tkw-list">
                  {items.map(({ task, completion }) => renderDoneRow(task, completion, { trailing: true }))}
                  {/* 현장 활동 — 읽기 전용 한 줄. 되돌리기·완료 토글·길게 누름을 붙이지 않는다: 원본은 청소·
                      유지보수 화면에 있고, 여기서 되돌릴 수 있게 하면 어느 쪽이 진짜인지 두 화면이 다투게 된다. */}
                  {fieldItems.length > 0 ? (
                    <div className="tkw-field">
                      <span aria-hidden="true" className="tkw-field__ic">
                        {w.fieldMark}
                      </span>
                      <span className="tkw-field__b">
                        <span className="tkw-field__t">
                          {w.fieldTitle} · {fieldItems.map((a) => a.label).join(" · ")}
                        </span>
                        <span className="tkw-field__s">{w.fieldSub}</span>
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </>
      );
    }

    // calendar
    return renderCalendar();
  })();

  /**
   * 완료 줄 — 오늘의 「완료」 묶음과 완료·기록이 같이 쓴다.
   * 반복 완료는 행이 계속 `open` 이라 status 로는 완료로 그려지지 않는다. 그 날짜의 회차로 넘겨 완료 표시(취소선 +
   * 채운 고리)를 살린다. 다만 되돌리기는 붙이지 않는다 — 로그의 날짜가 회차 날짜와 다를 수 있어(지난 회차를 오늘 처리)
   * 엉뚱한 회차를 되살릴 위험이 있다. 방금 한 완료는 토스트의 「실행 취소」로 되돌린다.
   */
  function renderDoneRow(task: TaskRecord, completion: TaskCompletionRecord, opts: { trailing: boolean }) {
    const recurringDone = isStandardRecurrence(task.recurrenceRule);
    return (
      <TaskCard
        key={`${task.id}|${completion.day}`}
        task={task}
        showDate={false}
        swipe={false}
        {...cardProps}
        trailing={opts.trailing ? clockOf(completion.at) : undefined}
        {...(recurringDone
          ? {
              occurrence: { date: completion.day, done: true },
              onCompleteToggle: undefined,
              // 회차를 넘기면 길게 누름 메뉴가 "그 날짜만 건너뛰기"를 제안하는데, 이미 완료된 날짜에는
              // 의미가 없다 — 시리즈 메뉴로만 연다.
              onLongPress: (t: TaskRecord) => openPressMenu(t),
            }
          : null)}
      />
    );
  }

  /** 하루의 작업 — 그리드 · 날짜 목록과 같은 규칙(반복은 그날 회차가 있으면, 정렬은 시각 → 우선순위). */
  function dayList(iso: string): TaskRecord[] {
    return tasks
      .filter((t) => {
        if (!isActive(t)) return false;
        const a = anchor(t);
        if (!a) return false;
        if (isStandardRecurrence(t.recurrenceRule)) {
          if (hideRecurring) return false; // "반복 숨기기" 토글과 그리드를 일치시킴.
          return recurringOccurrencesInRange(t.recurrenceRule, a, iso, iso).length > 0;
        }
        return a === iso;
      })
      .sort(timeThenPrio);
  }

  function renderCalendar() {
    const { y, m } = calMonth;
    const monthPrefix = calMonthPrefix;
    // 월요일 시작(시안 TodoCal-Phone) — 토 파랑 · 일 빨강.
    const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const daysIn = calDaysIn;
    const onDay = (iso: string) => calByDay.get(iso) ?? [];
    const shiftMonth = (delta: number) =>
      setCalMonth(({ y: cy, m: cm }) => {
        const idx = cy * 12 + (cm - 1) + delta;
        return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
      });
    const goToday = () => {
      const [ty, tm] = today.split("-").map(Number);
      setCalMonth({ y: ty, m: tm });
      setCalDay(today);
    };
    /** 점 색 — 긴급이나 지난 날짜의 일회성(지연)은 빨강, 공유는 보라, 나머지(개인)는 주황. */
    const dotTone = (t: TaskRecord, iso: string) =>
      t.priority === "urgent" || (iso < today && !isStandardRecurrence(t.recurrenceRule))
        ? "is-r"
        : t.isShared
          ? "is-s"
          : undefined;

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < first; i++) cells.push(<span key={`pad-${i}`} />);
    for (let d = 1; d <= daysIn; d++) {
      const iso = `${monthPrefix}-${String(d).padStart(2, "0")}`;
      const list = onDay(iso);
      const isT = iso === today;
      const isSel = iso === calDay;
      cells.push(
        <button
          aria-label={`${fmt(iso, { month: "long", day: "numeric", weekday: "short" })} · ${w.count.replace("{n}", String(list.length))}`}
          aria-pressed={isSel}
          className={cn("tkw-cal__d", isT && "is-today", isSel && "is-sel")}
          key={iso}
          onClick={() => {
            haptic("light");
            setCalDay(iso);
          }}
          type="button"
        >
          {d}
          <span aria-hidden="true" className="tkw-cal__dots">
            {list.slice(0, 3).map((t, i) => (
              <i className={dotTone(t, iso)} key={i} />
            ))}
          </span>
        </button>,
      );
    }

    const monthLabel = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      timeZone: "Asia/Tokyo",
    }).format(new Date(Date.UTC(y, m - 1, 15)));
    const isCurrentMonth = monthPrefix === today.slice(0, 7);
    const selectedList = dayList(calDay);
    const selectedLabel = `${fmt(calDay, { month: "long", day: "numeric", weekday: "short" })}${calDay === today ? ` · ${copy.todayLabel}` : ""}`;
    const weekdays = Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2025, 0, 6 + i))),
    );

    return (
      <div className="tkw-cal">
        <div className="tkw-cal__grid-wrap">
          <div className="tkw-cal__top">
            <button aria-label={copy.calPrevMonth} className="tkw-cal__nav" onClick={() => shiftMonth(-1)} type="button">
              <ChevronLeft aria-hidden="true" />
            </button>
            <span className="tkw-cal__m">{monthLabel}</span>
            <button aria-label={copy.calNextMonth} className="tkw-cal__nav" onClick={() => shiftMonth(1)} type="button">
              <ChevronRight aria-hidden="true" />
            </button>
            {!isCurrentMonth ? (
              <button className="tkw-cal__today" onClick={goToday} type="button">
                {copy.todayLabel}
              </button>
            ) : null}
            <button
              aria-checked={hideRecurring}
              className="tkw-sw"
              onClick={() => setHideRecurring((v) => !v)}
              role="switch"
              type="button"
            >
              {copy.calHideRepeat}
              <span aria-hidden="true" className="tkw-sw__t" />
            </button>
          </div>
          <div className="tkw-cal__legend">
            <span>
              <i />
              {copy.calLegendPersonal}
            </span>
            <span>
              <i className="is-s" />
              {copy.calLegendShared}
            </span>
            <span>
              <i className="is-r" />
              {w.legendAlert}
            </span>
          </div>
          <div aria-hidden="true" className="tkw-cal__wk">
            {weekdays.map((label, i) => (
              <span className={cn(i === 5 && "is-sat", i === 6 && "is-sun")} key={i}>
                {label}
              </span>
            ))}
          </div>
          <div className="tkw-cal__grid">{cells}</div>
        </div>

        {/* 고른 날의 작업. 미래 날짜는 **미리보기**(점 마커) — 미리 눌리면 그날이 왔을 때 목록에서 사라져, 아무도 안
            했는데 기록만 「완료」로 남는다(2026-09-09). 그날 오늘 탭에서 처리한다. */}
        <section className="tkw-sec tkw-cal__day">
          <div className="tkw-cal__dh">
            <b>{selectedLabel}</b>
            <span className="tkw-sec__n">{w.count.replace("{n}", String(selectedList.length))}</span>
          </div>
          {selectedList.length === 0 ? (
            <p className="tkw-hint" style={{ padding: "10px 0 4px" }}>
              {copy.calNoTask}
            </p>
          ) : (
            <div className="tkw-list" key={calDay}>
              {selectedList.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  swipe={false}
                  {...cardProps}
                  showDate={false}
                  preview={calDay > today}
                  {...(isStandardRecurrence(t.recurrenceRule) && !occStateOf(t.id, calDay)
                    ? { occurrence: { date: calDay, done: false } }
                    : null)}
                />
              ))}
            </div>
          )}
          <Link className="tkw-add" href={`/mobile/tasks/new?date=${calDay}`}>
            <Plus aria-hidden="true" />
            {copy.calAddOnDate}
          </Link>
        </section>
      </div>
    );
  }

  /**
   * "전체 선택" 대상 = **지금 이 탭에 그려진 줄**뿐이다 (2026-07-31).
   *
   * 예전엔 `tasks` 전체(내 모든 활성 작업)를 선택해서, 오늘 탭에 3건만 보이는데 관리함의 80건까지
   * 딸려 들어가고 삭제 확인창이 "83건"으로 떴다 — 보이지 않는 작업을 지우는 데이터 손실 경로였다.
   * 각 뷰가 쓰는 base 목록을 뷰 밖으로 뽑아 **여기와 뷰 본문이 같은 배열**을 보게 했다.
   * 캘린더는 2026-10-15 부터 고른 날의 목록만 그리므로 그 목록이 대상이다.
   */
  const visibleSelectable: TaskRecord[] =
    view === "today"
      ? applyFilter([
          ...todayOverdueBase,
          ...todayBase,
          ...todayRecBase,
          ...todayDoneRows.map((r) => r.task),
        ])
      : view === "tomorrow"
        ? applyFilter([...tomorrowBase, ...tomorrowRecBase])
        : view === "inbox"
          ? applyFilter(inboxBase)
          : view === "instr"
            ? applyFilter(instrTab === "recv" ? recvInstrTasks : sentInstrTasks)
            : view === "completed"
              ? completionRows
                  .filter(
                    ({ task }) =>
                      (completedFilter === "project"
                        ? !!task.projectId
                        : completedFilter === "regular"
                          ? !task.projectId
                          : true) &&
                      (!filterActive || matchesFilter(task)),
                  )
                  .map((r) => r.task)
              : view === "calendar"
                ? dayList(calDay)
                : [];
  // 같은 작업이 여러 줄로 렌더될 수 있다(반복 회차·완료 기록의 여러 날짜) — 선택은 작업 단위라 중복 제거.
  const selectableIds = Array.from(new Set(visibleSelectable.map((t) => t.id)));
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const wide = view === "completed" || view === "instr" || view === "projects" || view === "calendar";

  return (
    <div className="tkw relative min-h-[60vh] pb-24" data-view={view} data-wide={wide ? view : undefined}>
      {/* 선택 모드에서는 보기 탭 자리를 선택 줄이 대신한다. */}
      {selectMode ? (
        <div className="tkw-selbar">
          <button aria-label={copy.cancel} className="tkw-selbar__x" onClick={exitSelect} type="button">
            <X aria-hidden="true" />
          </button>
          <span className="tkw-selbar__n">{copy.selectedCountLabel.replace("{count}", String(selectedIds.size))}</span>
          <button
            className="tkw-tl"
            onClick={() => setSelectedIds(allSelected ? new Set() : new Set(selectableIds))}
            style={{ fontSize: 14 }}
            type="button"
          >
            {allSelected ? copy.selectClear : copy.selectAllLabel}
          </button>
        </div>
      ) : (
        <div aria-label={w.views} className="tkw-tabs" ref={tabsRef} role="tablist">
          {tabs.map((t) => {
            // 시안처럼 숫자는 오늘 · 내일 · 지시에만(관리함 · 완료는 숫자 없이).
            const n = t.key === "today" || t.key === "tomorrow" || t.key === "instr" ? tabCounts[t.key] : 0;
            return (
              <button
                aria-selected={view === t.key}
                className={cn("tkw-tab", view === t.key && "is-on")}
                key={t.key}
                onClick={() => setView(t.key)}
                role="tab"
                type="button"
              >
                {t.label}
                {n > 0 ? <b>{n}</b> : null}
              </button>
            );
          })}
        </div>
      )}

      {viewBody}

      {/* 지연 일괄 날짜 다시 정하기 — 공용 일정 피커(날짜만): 빠른 선택(오늘/내일/다음 주/다음 주말) + 달력,
          완료 버튼에서만 확정. 고른 지연(선택 모드가 아니면 내 지연 전체)에 같은 날짜를 적용한다. */}
      {overdueRescheduleOpen && (
        <TaskSchedulePicker
          confirmLabel={copy.overdueRescheduleApply}
          copy={copy}
          hadCustom={false}
          initialDate=""
          initialDuration={0}
          initialRepeat=""
          initialTime=""
          locale={locale}
          onApply={(v) => {
            if (v.date) rescheduleOverdue(v.date);
            else setOverdueRescheduleOpen(false);
          }}
          onCancel={() => setOverdueRescheduleOpen(false)}
          title={copy.overdueRescheduleTitle}
          variant="date"
        />
      )}

      {/* 지연 묶음 「⋯」 시트 — 일정변경 · 선택 · (맨 아래 빨간 줄) 지난 미완료 삭제 → 확인 시트. */}
      {overdueMenuOpen && hydrated ? (
        <BottomSheet ariaLabel={w.overdueMore} onClose={() => setOverdueMenuOpen(false)}>
          {({ close }) => (
            <div className="tkw-sheet">
              <h2>{copy.overduePromptTitle.replace("{count}", String(overdueTargets.length))}</h2>
              <p className="tkw-sheet__sub">{copy.overduePromptBody}</p>
              <div className="tkw-act">
                <button
                  disabled={overdueTargets.length === 0}
                  onClick={() => {
                    close();
                    setOverdueRescheduleOpen(true);
                  }}
                  type="button"
                >
                  <CalendarDays aria-hidden="true" />
                  {w.reschedule}
                </button>
                <button
                  onClick={() => {
                    close();
                    // 머리 줄의 선택 전환과 같다 — 들어갈 때 내 지연을 전부 골라 둔다.
                    if (overdueSelectMode) {
                      setOverdueSelectMode(false);
                      setOverdueSelection(new Set());
                    } else {
                      setOverdueSelectMode(true);
                      setOverdueSelection(new Set(ownedOverdueIds));
                    }
                  }}
                  type="button"
                >
                  <ListChecks aria-hidden="true" />
                  {overdueSelectMode ? w.overdueSelectDone : w.overdueSelect}
                </button>
                <button
                  className="is-red"
                  disabled={overdueTargets.length === 0}
                  onClick={() => {
                    close();
                    setOverdueConfirm(true);
                  }}
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                  {copy.overduePromptDismiss}
                  {overdueSelectMode && overdueSelection.size > 0 ? ` ${overdueSelection.size}` : ""}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {/* 지난 미완료 삭제 확인 — 되돌릴 수 없는 일괄 정리라 확인을 받는다(반복은 다음 일정이 남는다). */}
      {overdueConfirm && hydrated ? (
        <BottomSheet ariaLabel={copy.overduePromptDismiss} onClose={() => setOverdueConfirm(false)}>
          {({ close }) => (
            <div className="tkw-sheet">
              <h2>{copy.overduePromptTitle.replace("{count}", String(overdueTargets.length))}</h2>
              <p className="tkw-sheet__sub">{copy.overduePromptConfirm}</p>
              <div className="tkw-btns2">
                <button className="tkw-btn is-gray" onClick={close} type="button">
                  {copy.overduePromptCancel}
                </button>
                <button
                  className="tkw-btn is-red"
                  disabled={overduePending || overdueTargets.length === 0}
                  onClick={() => {
                    haptic("warning");
                    clearOverdue();
                  }}
                  type="button"
                >
                  {copy.overduePromptConfirmYes}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {/* 빠른 추가 버튼 — body 로 띄워 화면에 고정(스크롤 컨테이너의 transform 이 `fixed` 를 가두지 않게).
          선택 모드(아래 삭제 줄이 바닥을 쥔다) · 프로젝트 탭(프로젝트 만들기 버튼을 따로 띄운다)에서는 숨긴다. */}
      {hydrated && !selectMode && view !== "projects"
        ? createPortal(
            <button
              aria-hidden={toastVisible}
              aria-label={w.addTask}
              className={cn("tkw-fab", toastVisible && "is-away")}
              onClick={openQuick}
              type="button"
            >
              <Plus aria-hidden="true" strokeWidth={2.2} />
            </button>,
            document.body,
          )
        : null}

      {/* 빠른 추가 시트(시안 TodoAdd-Phone) — 추가해도 열려 있다(`?created=1` 처리 참고). */}
      {quickOpen && hydrated ? (
        <BottomSheet ariaLabel={w.addTask} onClose={onQuickClosed}>
          <div className="tkw-sheet">
            <h2>{w.addTask}</h2>
            <form action={quickCreateTask} onSubmit={() => haptic("success")}>
              <input
                aria-label={w.addTask}
                autoFocus
                className="tkw-qa__in"
                defaultValue={quickSeed}
                enterKeyHint="done"
                name="title"
                onChange={(e) => {
                  // 「비었다↔찼다」가 뒤집힐 때만 상태를 건드린다 — 버튼 활성화에만 쓰인다.
                  const filled = e.target.value.trim().length > 0;
                  if (filled !== hasQuickTitle) setHasQuickTitle(filled);
                }}
                placeholder={copy.quickAddPlaceholder}
                ref={quickInputEl}
                required
              />
              <QuickAddSubmitButtons
                copy={copy}
                hasTitle={hasQuickTitle}
                onDetailClick={(e) => {
                  const typed = (quickInputEl.current?.value ?? "").trim();
                  if (!typed) return; // 빈 입력이면 기본 href 그대로
                  e.preventDefault();
                  router.push(`/mobile/tasks/new?title=${encodeURIComponent(typed)}`);
                }}
              />
            </form>
          </div>
        </BottomSheet>
      ) : null}

      {/* 길게 누름 메뉴 — 편집 / 선택 / 삭제. */}
      {pressTask && hydrated ? (
        <BottomSheet ariaLabel={pressTask.title} onClose={() => setPressTask(null)}>
          {({ close }) => (
            <div className="tkw-sheet">
              <p className="tkw-sheet__t">{pressTask.title}</p>
              <div className="tkw-act">
                {pressTask.createdByUserId === currentUserId ? (
                  <button
                    onClick={() => {
                      const id = pressTask.id;
                      close();
                      router.push(`/mobile/tasks/${id}/edit`);
                    }}
                    type="button"
                  >
                    <Pencil aria-hidden="true" />
                    {copy.actionEdit}
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    const t = pressTask;
                    close();
                    enterSelect(t);
                  }}
                  type="button"
                >
                  <ListChecks aria-hidden="true" />
                  {copy.actionSelect}
                </button>
                {pressTask.createdByUserId === currentUserId ? (
                  <button
                    className="is-red"
                    onClick={() => {
                      const t = pressTask;
                      const occ = pressOcc;
                      close();
                      // 반복 작업을 **회차로** 보고 있으면 무엇을 지울지 먼저 묻는다. 관리함처럼 회차가 아닌
                      // 목록에서는 행 자체가 시리즈를 뜻하므로 기존 확인 그대로.
                      if (occ && isStandardRecurrence(t.recurrenceRule)) setRecurDelete({ task: t, date: occ });
                      else setConfirmIds([t.id]);
                    }}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                    {copy.deleteAction}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {/* 선택 모드 아래 고정 줄 — 일괄 삭제(탭 바를 덮는다). */}
      {selectMode && hydrated
        ? createPortal(
            <div className="tkw-selact">
              <button
                className="tkw-btn is-red"
                disabled={selectedIds.size === 0}
                onClick={() => setConfirmIds(Array.from(selectedIds))}
                type="button"
              >
                <Trash2 aria-hidden="true" className="size-[18px]" />
                {copy.deleteAction}
                {selectedIds.size > 0 ? ` ${selectedIds.size}` : ""}
              </button>
            </div>,
            document.body,
          )
        : null}

      {/* 삭제 확인(메뉴에서 한 건, 또는 선택 모드 일괄). */}
      {confirmIds && hydrated ? (
        <BottomSheet ariaLabel={copy.bulkDeleteConfirmTitle} onClose={() => setConfirmIds(null)}>
          {({ close }) => (
            <div className="tkw-sheet">
              <h2>{copy.bulkDeleteConfirmTitle}</h2>
              <p className="tkw-sheet__sub">{copy.bulkDeleteConfirmBody.replace("{count}", String(confirmIds.length))}</p>
              <div className="tkw-btns2">
                <button className="tkw-btn is-gray" onClick={close} type="button">
                  {copy.cancel}
                </button>
                <button
                  className="tkw-btn is-red"
                  disabled={deleting}
                  onClick={() => {
                    haptic("warning");
                    performDelete(confirmIds);
                  }}
                  type="button"
                >
                  {copy.deleteAction}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {/* 이동 거절 안내 — 반복 작업을 옮기려 했을 때. 서버가 돌려주는 에러 코드별로 문구가 다르다:
          `recurring_series` = 표준 반복은 애초에 스와이프를 못 연다(줄이 이미 막지만, 다른 경로 대비),
          `duplicate_occurrence` = 그 날짜에 이미 회차가 있는 레거시 케이스. 모르는 값은 duplicate 문구로 폴백. */}
      {moveNotice && hydrated ? (
        <TaskToast
          icon={moveNotice === "save_failed" ? AlertTriangle : Repeat}
          message={
            moveNotice === "save_failed"
              ? copy.moveSaveFailed
              : moveNotice === "recurring_series"
                ? copy.moveRejectedRecurringSeries
                : copy.moveDuplicateOccurrence
          }
          tone={moveNotice === "save_failed" ? "danger" : "neutral"}
        />
      ) : null}

      {/* 반복 삭제 선택 — "이 날짜만 건너뛰기" vs "반복 전체 삭제". 같은 크기의 줄로 놓아 「고르는 화면」으로
          읽히게 하고, 되돌릴 수 없는 쪽만 빨강. 머리에 반복 주기를 보여 「전체」가 무엇인지 누르기 전에 알 수 있게. */}
      {recurDelete && hydrated ? (
        <BottomSheet ariaLabel={copy.recurDeleteTitle} onClose={() => setRecurDelete(null)}>
          <div className="tkw-sheet">
            <p className="tkw-sheet__t">↻ {repeatLabel(recurDelete.task.recurrenceRule ?? "", copy, locale)}</p>
            <h2>{recurDelete.task.title}</h2>
            <div className="tkw-act">
              <button onClick={() => runSkipOccurrence(recurDelete.task.id, recurDelete.date)} type="button">
                <SkipForward aria-hidden="true" />
                <span>
                  {copy.recurSkipOne.replace("{date}", shortDateLabel(recurDelete.date))}
                  <span className="tkw-act__s">{copy.recurSkipOneSub}</span>
                </span>
              </button>
              <button
                className="is-red"
                onClick={() => {
                  const id = recurDelete.task.id;
                  setRecurDelete(null);
                  performDelete([id]);
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" />
                <span>
                  {copy.recurDeleteAll}
                  <span className="tkw-act__s">{copy.recurDeleteAllSub}</span>
                </span>
              </button>
            </div>
          </div>
        </BottomSheet>
      ) : null}

      {/* 회차 건너뛰기 되돌리기 토스트 — skipped 는 영구 상태라 실행 취소 경로가 반드시 필요하다. */}
      {skipUndo && hydrated ? (
        <TaskToast
          action={{ label: copy.undo, onAction: undoSkipOccurrence }}
          icon={SkipForward}
          message={copy.recurSkippedToastMobile}
          tone="danger"
        />
      ) : null}

      {/* 되돌리기 토스트 — 완료(고리) 또는 삭제 뒤 6초. */}
      {(undoTask || deletedUndoIds?.length) && hydrated ? (
        <TaskToast
          action={{ label: copy.undo, onAction: undoTask ? handleUndo : handleRestore }}
          icon={undoTask ? CheckCircle2 : Trash2}
          message={undoTask ? copy.completedToast : copy.deletedToast}
          tone={undoTask ? "neutral" : "danger"}
        />
      ) : null}

      {/* 업무일지 시트(완료·기록). 권한은 서버가 막고, 권한이 없으면 시트 안에 「권한 없음」이 뜬다. */}
      {reportDate && hydrated ? (
        <ReportSheet copy={copy} date={reportDate} locale={locale} onClose={() => setReportDate(null)} />
      ) : null}
    </div>
  );
}
