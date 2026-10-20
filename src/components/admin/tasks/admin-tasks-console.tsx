"use client";

// 어드민 Todoist 콘솔(데스크톱). 모바일 코어 패리티 + 매니저 "업무 지시".
// 셸(사이드바/탑바)은 AdminShell 이 소유하고, 여기서는 3단(왼쪽 보기 목록 · 가운데 목록 · 오른쪽 상세)
// + 팝오버/모달을 렌더한다. 화이트 리디자인(2026-10-15, 시안 Todo-PC · TodoDone/Cal/Dir/Proj-PC):
// 상자·세로 구분선 없음, 선택은 옅은 보라 바탕만. CSS: admin-tasks-white.css(`atw-`, 레이아웃·목록·상세)
// + admin-tasks-console.css(팝오버·모달·업로더 — 예전 그대로 쓰는 부분).
// 서버 액션(@/app/admin/tasks/actions)이 모든 쓰기를 처리하고, revalidatePath 로 갱신한다(성공 뒤 router.refresh() 를 더 부르지 않는다 — 이중 렌더).
// See docs/product/28-admin-todoist-console.md.
import Image from "next/image";
import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  CalendarX2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudOff,
  FileText,
  Flag,
  GripVertical,
  Hash,
  Inbox,
  Loader2,
  Lock,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat,
  RefreshCw,
  SkipForward,
  RotateCcw,
  Search,
  Send,
  Share2,
  Smartphone,
  Sun,
  Sunrise,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  SquareCheck,
  X,
} from "lucide-react";
import {
  addConsoleNote,
  addConsoleProjectSection,
  bulkDeleteConsoleTasks,
  createConsoleProject,
  createConsoleTask,
  deleteConsoleProject,
  deleteConsoleProjectSection,
  deleteConsoleTask,
  dismissConsoleOverdue,
  rescheduleConsoleOverdue,
  skipConsoleOccurrence,
  unskipConsoleOccurrence,
  generateConsoleReport,
  sendConsoleReportToSlack,
  getConsoleProjectDetail,
  getConsoleTaskDetail,
  inviteConsoleProjectMembers,
  leaveConsoleTask,
  moveConsoleToInbox,
  moveConsoleToToday,
  moveConsoleToTomorrow,
  removeConsoleProjectMember,
  renameConsoleProjectSection,
  reorderConsoleDateTasks,
  reorderConsoleTasks,
  rescheduleConsoleTask,
  restoreConsoleTask,
  restoreConsoleTasks,
  setConsoleTaskStatus,
  shareConsoleTask,
  toggleConsoleComplete,
  updateConsoleTaskCore,
  type TaskActionResult,
} from "@/app/admin/tasks/actions";
import {
  CUSTOM_RECURRENCE_PREFIX,
  isStandardRecurrence,
  type OccurrenceState,
  parseCustomWeekdays,
  recurringOccurrencesInRange,
} from "@/lib/tasks-recurrence";
import type { AdminTasksData } from "@/lib/admin-tasks";
import { getAdminTasksDictionary } from "@/lib/admin-tasks-i18n";
import {
  cancelDailyReportSchedule,
  getReportSchedule,
  listReportSchedules,
  scheduleDailyReport,
  type ReportScheduleView,
} from "@/app/mobile/tasks/report-schedule-actions";
import {
  durationLabel,
  earliestMinute,
  fromMinutes,
  slotOpen,
  toMinutes,
  tokyoHHMM,
  tokyoNowMinutes,
  tokyoTodayIso,
} from "@/lib/report-schedule-time";
import { ReportTimeCombo } from "@/components/tasks/report-time-combo";
import type { FieldActivityRecord } from "@/lib/field-activity";
import {
  buildDailyReportText,
  type DailyReportItem,
  type DailyReportTemplate,
} from "@/lib/daily-report";
import type { Locale } from "@/lib/i18n";
import type { ProjectDetailData } from "@/lib/projects";
import type { OccurrenceStateRecord, TaskDetail, TaskRecord } from "@/lib/tasks";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { haptic } from "@/lib/haptics";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import { ProgressRing, TaskRing, ViewNav, type NavItem } from "./atw-parts";
import { ImageLightbox } from "@/components/shell/image-lightbox";
import {
  addDays,
  completedDateOf,
  ctxItems,
  dateOf,
  DURATION_OPTIONS,
  dueDateOf,
  fill,
  fmtLong,
  fmtShort,
  fmtWeekday,
  initial,
  isActive,
  isMine,
  isOverdue,
  isSharedTask,
  isTodayTask,
  isTomorrowTask,
  matchDate,
  matchPrio,
  matchQuery,
  myOwn,
  overdueOccurrenceDates,
  plainShared,
  showsOnTodayList,
  partsOf,
  prioSort,
  dateSort,
  recvInstr,
  REPEAT_RULES,
  customWeekdayNames,
  repeatLabel,
  repeatShort,
  weekdayShortName,
  WEEKDAY_ORDER,
  sentInstr,
  systemLogLabel,
  timeRange,
  tokyoToday,
  weekdayIndex,
  type DateFilterKey,
} from "./helpers";
import {
  TaskPhotoUploader,
  uploadPendingTaskPhotos,
  uploadPendingTaskUpdatePhotos,
  type PhotoUploaderCopy,
} from "@/components/admin/tasks/task-photo-uploader";
import type { PreviewItem } from "@/components/announcements/announcement-image-uploader";
import {
  ContextPickerPopover,
  type ContextPickerCopy,
  type TaskContextValue,
} from "@/components/admin/tasks/context-picker-popover";
import "./admin-tasks-console.css";
import "./admin-tasks-white.css";

type View = "today" | "tomorrow" | "inbox" | "shared" | "instr" | "completed" | "calendar";

type AddDraft = {
  /** "instr" = 지시 탭에서 바로 보내기. 대상이 반드시 있어야 저장된다(아래 `saveInlineAdd`). */
  ctx: "today" | "tomorrow" | "inbox" | "project" | "day" | "instr";
  sectionId: string | null;
  onDate: string; // for "day"/day-anchored adds
  // 제목·설명·태그 입력 버퍼는 **여기 없다.** 비제어 입력이라 `addTextRef` 가 들고 있다
  // (한 글자마다 이 4900줄 컴포넌트를 다시 그리지 않기 위해 — 2026-09-04).
  date: string;
  time: string;
  dur: number | null;
  repeat: string;
  prio: string;
  targets: string[];
  tags: string[];
  /** 연결된 건물/객실/예약/게스트. 미연결이면 undefined. */
  context?: TaskContextValue;
};

/** 낙관적 목록 조작 — 완료/삭제로 **빼거나**, 새로 만든 작업을 **끼워 넣거나**. */
type TaskOptimisticAction =
  | { kind: "remove"; ids: readonly string[] }
  | { kind: "add"; task: TaskRecord };

type Anchor = { x: number; y: number; aTop: number };
type SchedulePop = {
  kind: "schedule";
  src: "add" | "task" | "overdue";
  taskId: string | null;
  draft: { date: string; time: string; dur: number | null; repeat: string };
  calMonth: string;
  expand: "time" | "repeat" | null;
} & Anchor;
type PrioPop = { kind: "prio"; src: "add" | "task"; taskId: string | null; cur: string } & Anchor;
type SharePop = {
  kind: "share";
  /** "project" = 프로젝트 멤버 관리(초대 + 제거). taskId 대신 projectId 를 쓴다. */
  src: "add" | "task" | "project";
  taskId: string | null;
  projectId?: string;
  mode: "target" | "share";
  sel: string[];
  q: string;
} & Anchor;
/** 컨텍스트(건물·객실·예약) 연결 팝오버. `src` 는 인라인 추가 드래프트인지 기존 작업인지. */
type ContextPop = { kind: "context"; src: "add" | "task"; taskId: string | null } & Anchor;
/** `occ` = 이 행이 렌더된 회차 날짜(반복 작업일 때만). 삭제가 시리즈 전체인지 그 날짜만인지 가른다. */
type RowMenuPop = { kind: "rowmenu"; taskId: string; occ?: string; fromDetail?: boolean } & Anchor;
type DateFilterPop = { kind: "datefilter" } & Anchor;
type PrioFilterPop = { kind: "priofilter" } & Anchor;
type Pop =
  | SchedulePop
  | PrioPop
  | SharePop
  | ContextPop
  | RowMenuPop
  | DateFilterPop
  | PrioFilterPop
  | null;

function anchorFrom(e: ReactMouseEvent): Anchor {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left, y: r.bottom + 6, aTop: r.top };
}

/** 연결 없음 상태. 컴포넌트 밖에 두는 이유: `PopoverLayer()` 가 컴포넌트 본문 중간에서 호출되므로
 *  본문 안의 `const` 는 그 시점에 아직 TDZ 라 `ReferenceError` 가 난다(2026-07-29 실제 발생). */
const EMPTY_TASK_CONTEXT: TaskContextValue = {
  propertyId: null,
  roomId: null,
  reservationId: null,
  guestName: null,
  propertyName: null,
  roomLabel: null,
};

// useLayoutEffect on the client (positions before paint → no flicker), useEffect on the server
// (avoids the SSR warning; the popover never renders during SSR anyway).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Detail-panel status segments, in display order. The CSS thumb assumes exactly these three, in
// this order (it translates by whole segment widths) — adding a fourth means updating
// `.atw-status__thumb` width/offsets in admin-tasks-white.css too.
const STATUS_SEGMENTS = [
  { status: "open", labelKey: "stOpen" },
  { status: "in_progress", labelKey: "stInProgress" },
  { status: "completed", labelKey: "stCompleted" },
] as const satisfies readonly {
  status: "open" | "in_progress" | "completed";
  labelKey: "stOpen" | "stInProgress" | "stCompleted";
}[];

/** 만든 순서(오래된 것 먼저). 새 작업이 목록 **아래**, 추가 입력창 바로 위에 붙게 한다(2026-09-09). */
const oldestFirst = (a: TaskRecord, b: TaskRecord) => a.createdAt.localeCompare(b.createdAt);
/** 우선순위 먼저, 같으면 만든 순서. 날짜 목록의 기본 정렬. */
const byPriorityThenOldest = (a: TaskRecord, b: TaskRecord) => prioSort(a, b) || oldestFirst(a, b);


export function AdminTasksConsole({
  locale,
  data,
  organizationId,
}: {
  locale: Locale;
  data: AdminTasksData;
  /** Needed for the photo Storage path (`${organizationId}/task-images/...`). */
  organizationId: string;
}) {
  const dict = getAdminTasksDictionary(locale);
  // 업로더는 i18n 모듈을 모르고 이미 번역된 문자열만 받는다(재사용 가능한 프리젠테이션 컴포넌트).
  const photoCopy: PhotoUploaderCopy = {
    add: dict.phAdd,
    addCompact: dict.phAddCompact,
    dropHint: dict.phDropHint,
    count: dict.phCount,
    remove: dict.phRemove,
    tooMany: dict.phTooMany,
    invalidType: dict.phInvalidType,
    tooLarge: dict.phTooLarge,
    uploading: dict.phUploading,
  };
  const contextCopy: ContextPickerCopy = {
    title: dict.cpTitle, hintBuilding: dict.cpHintBuilding, hintRoom: dict.cpHintRoom,
    buildings: dict.cpBuildings, rooms: dict.cpRooms, reservations: dict.cpReservations,
    search: dict.cpSearch, searchClear: dict.cpSearchClear,
    searchEmpty: dict.cpSearchEmpty, searchEmptySub: dict.cpSearchEmptySub,
    noBuilding: dict.cpNoBuilding, noRooms: dict.cpNoRooms, noReservation: dict.cpNoReservation,
    guest: dict.cpGuest, loading: dict.cpLoading, back: dict.cpBack, clear: dict.cpClear,
    apply: dict.cpApply, cancel: dict.cpCancel, occupied: dict.cpOccupied, vacant: dict.cpVacant, blocked: dict.cpBlocked,
    nightsUnit: dict.cpNightsUnit, channelDirect: dict.cpChannelDirect, live: dict.cpLive, roomsUnit: dict.cpRoomsUnit,
    todayGuests: dict.cpTodayGuests, roomSuffix: dict.cpRoomSuffix, bookingId: dict.cpBookingId,
  };
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, showToast, dismiss } = useAdminToast();

  const meId = data.me.id;
  // Tokyo operating date. Kept live so a console left open across Tokyo midnight rolls today/내일/
  // overdue over without a manual refresh (checked each minute + on focus/visibility change).
  const [today, setToday] = useState(() => tokyoToday());

  const [view, setView] = useState<View>("today");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectDetail, setProjectDetail] = useState<ProjectDetailData | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  /** 상세를 연 줄의 회차 날짜 — 반복 작업의 상태 · 완료는 이 회차가 대상이다(없으면 완료를 막는다). */
  const [selOcc, setSelOcc] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  // Optimistic status for the detail panel's 대기/진행 중/완료 segmented control. `setConsoleTaskStatus`
  // + `router.refresh()` is a full server round-trip, so without this the segment sits frozen on the
  // old value until fresh data lands and then jumps. Lives here (not in DetailPanel) because
  // DetailPanel is a conditionally-called plain function — hooks inside it would break hook order.
  //
  // `from` is what makes this self-expiring without a clean-up effect: the draft only applies while
  // the task still reads as `from`. The moment the server (or the separately-refetched `detail`)
  // catches up, the guard fails and the real status takes over on its own.
  const [statusDraft, setStatusDraft] = useState<{
    id: string;
    from: string;
    status: "open" | "in_progress" | "completed";
  } | null>(null);
  // 상세 패널 제목·본문·태그 인라인 편집. Lives here (not in DetailPanel) for the same reason
  // `statusDraft` does — DetailPanel is a conditionally-called plain function, so hooks inside it
  // would break hook order.
  const [coreEdit, setCoreEdit] = useState<{
    id: string;
    title: string;
    desc: string;
    tags: string[];
    tagInput: string;
  } | null>(null);
  // 사진: `pending` 은 아직 업로드 안 된 로컬 선택본. 세 자리(인라인 추가 · 상세 코어 편집 · 노트)가
  // 각자 드래프트를 들고, 저장 시점에 uploadPending…() 로 Storage 에 올린 뒤 URL 만 액션에 넘긴다.
  const [addPhotos, setAddPhotos] = useState<PreviewItem[]>([]);
  const [editPhotos, setEditPhotos] = useState<{ value: string[]; pending: PreviewItem[] }>({
    value: [],
    pending: [],
  });
  const [notePhotos, setNotePhotos] = useState<PreviewItem[]>([]);
  // 오른쪽 상세 칸(2026-10-15 화이트 리디자인) — 예전의 미끄러져 나오는 패널을 대신한다.
  // `sel` = 사용자가 고른 작업. 고른 게 없으면 목록 보기(오늘·내일·관리함·공유함)는 **첫 작업**을
  // 보여 준다(아래 `activeId`). ✕ 로 닫으면 `detailClosed` 가 켜져 기본 선택도 쉰다 — 안 그러면
  // 닫자마자 첫 작업이 다시 열린다.
  const [detailClosed, setDetailClosed] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  /** 완료 체크가 그려지는 중인 줄(`${taskId}|${회차}`). 고리가 차고 체크가 그려진 뒤에 실제로 처리한다. */
  const [completing, setCompleting] = useState<ReadonlySet<string>>(() => new Set());
  /** 상세 칸 「사진 추가」 업로드 중인 작업 id. */
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  /**
   * 지연 줄 일괄 처리 모드 — 「날짜 다시 정하기」/「지난 미완료 삭제」를 누르면 내 지연 작업이 전부
   * 담긴 채로 고르기가 켜지고, 빼고 싶은 줄만 풀어서 처리한다(12건 중 3건만 옮기기 — 2026-07-31 계약).
   */
  const [odMode, setOdMode] = useState<"reschedule" | "delete" | null>(null);
  /** 상세 칸에서 긴 설명을 펼친 작업. */
  const [descOpen, setDescOpen] = useState<string | null>(null);
  const [add, setAdd] = useState<AddDraft | null>(null);
  // 인라인 추가 저장의 동기 재진입 가드 — `saveInlineAdd` 참고.
  /**
   * 인라인 추가의 **텍스트 입력은 비제어(uncontrolled)** 다 — 값은 이 참조가 들고 화면은 DOM 이 맡는다.
   *
   * 제어 입력으로 두면 한 글자마다 `setAdd` 가 돌고, `add` 는 이 컴포넌트(4900줄)의 state 라
   * **매 타자에 콘솔 전체가 다시 그려진다** — 작업 목록·캘린더·사이드바·팝오버까지 전부. 저장 후에도
   * 폼이 열린 채 남게 되면서(연속 추가) 그 비용이 «타자가 밀린다» 로 드러났다(2026-09-04 제보).
   *
   * 참조에 쓰면 렌더가 아예 일어나지 않는다. 화면이 실제로 알아야 하는 것은 「제목이 비었는가」
   * 하나뿐이라 그것만 상태로 두고, **비었다↔찼다가 뒤집힐 때만** 갱신한다(타자마다가 아니라 한 번).
   *
   * React Compiler 도 이건 못 줄인다 — 상태가 바뀌면 그 상태를 읽는 트리는 다시 그려야 하고,
   * 이 콘솔은 목록을 `Section({…})` / `renderRow(t)` 처럼 **함수 호출**로 그려서 그 사이에
   * 메모이제이션 경계가 생기지 않는다. 애초에 상태를 건드리지 않는 것이 유일한 해법이다.
   */
  const addTextRef = useRef({ title: "", desc: "", tagInput: "" });
  const addTitleEl = useRef<HTMLInputElement | null>(null);
  const addDescEl = useRef<HTMLTextAreaElement | null>(null);
  const addTagEl = useRef<HTMLInputElement | null>(null);
  const [addHasTitle, setAddHasTitle] = useState(false);
  /** 비제어 입력을 비우고 커서를 제목으로 돌린다(연속 추가 / 폼 열기). */
  const resetAddText = useCallback((focus: boolean) => {
    addTextRef.current = { title: "", desc: "", tagInput: "" };
    if (addTitleEl.current) addTitleEl.current.value = "";
    if (addDescEl.current) addDescEl.current.value = "";
    if (addTagEl.current) addTagEl.current.value = "";
    setAddHasTitle(false);
    if (focus) requestAnimationFrame(() => addTitleEl.current?.focus());
  }, []);
  const [pop, setPop] = useState<Pop>(null);
  const popAnchorRef = useRef<HTMLDivElement>(null);
  const [instrTab, setInstrTab] = useState<"recv" | "sent">("recv");
  const [calMonth, setCalMonth] = useState<string>(() => today.slice(0, 7));
  // 캘린더에서 고정 반복(표준 반복) 회차를 숨김 — 세션 상태(새로고침 시 초기화), 기본 표시.
  const [hideRecurring, setHideRecurring] = useState(false);
  const [q, setQ] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilterKey | null>(null);
  const [prioFilter, setPrioFilter] = useState("");
  // 캘린더 오른쪽 칸에 펼친 날짜(예전 「날짜 시트」 모달을 대신한다). 기본은 오늘.
  const [calDay, setCalDay] = useState<string>(() => today);
  const [report, setReport] = useState<{ date: string; text: string; loading: boolean; sending: boolean; error: string | null } | null>(
    null,
  );
  const [reportEdited, setReportEdited] = useState("");
  // 일지에 포함할 항목 고르기 — 모바일 ReportSheet 와 같은 계약(`src/lib/daily-report.ts`).
  const [reportItems, setReportItems] = useState<DailyReportItem[]>([]);
  const [reportTemplate, setReportTemplate] = useState<DailyReportTemplate | null>(null);
  const [reportPicked, setReportPicked] = useState<boolean[]>([]);
  // 마지막으로 자동 조립한 본문. 사용자가 직접 손댔는지 판정하는 기준(모바일 `builtText` 와 동일).
  const [reportBuilt, setReportBuilt] = useState("");
  // 예약 보내기(2026-10-20, 시안 「업무일지 예약 보내기 · 대시보드 시안」) — 모바일 ReportSheet 와 같은 계약 · 같은 서버 액션.
  // 이 날짜의 최근 예약 · 예약해 둔 본문(바뀌었는지 보려고) · 고른 시각(null = 지금 바로) · 작은 창(칩 위) 열림.
  const [rptSched, setRptSched] = useState<ReportScheduleView | null>(null);
  const [rptSchedText, setRptSchedText] = useState<string | null>(null);
  const [rptWhen, setRptWhen] = useState<string | null>(null);
  const [rptWhenOpen, setRptWhenOpen] = useState(false);
  const [rptSchedBusy, setRptSchedBusy] = useState(false);
  const [rptMsg, setRptMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [rptNowMin, setRptNowMin] = useState(0);
  const rptChipRef = useRef<HTMLButtonElement>(null);
  // 취소 「되돌리기」가 나중에 눌릴 때 창이 아직 그 날짜인지 본다.
  const reportDateRef = useRef<string | null>(null);
  // 「완료 · 기록」 날짜 줄의 「19:00 예약」 · 「19:00 보냄」 · 「보내지 못함」.
  const [reportSchedules, setReportSchedules] = useState<Record<string, ReportScheduleView>>({});
  const [newProj, setNewProj] = useState<{ name: string; members: string[]; q: string } | null>(null);
  // 프로젝트 섹션 편집 — 이름 변경 인라인 드래프트 / 새 섹션 이름 버퍼.
  const [sectionEdit, setSectionEdit] = useState<{ id: string; title: string } | null>(null);
  const [newSection, setNewSection] = useState("");
  const [secAdding, setSecAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  /**
   * 반복 삭제 선택 모달 — "이 날짜만 건너뛰기" vs "반복 전체 삭제" (2026-07-30).
   * 반복 작업을 회차로 보고 있을 때만 뜬다. 모바일 `recurDelete` 시트와 같은 규칙.
   */
  const [recurDel, setRecurDel] = useState<{ task: TaskRecord; date: string } | null>(null);
  // ── selection mode (bulk delete) ──
  // `picked` holds ids across every section of the current view.
  const [selMode, setSelMode] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * 지연 배너의 처리 대상 선택(2026-07-31) — 전역 선택모드(`picked`)와 **별개의 집합**이다.
   * 전에는 "일정 변경"/"지난 미완료 삭제"가 지연 목록 전체를 무조건 처리해서, 12건 중 3건만
   * 오늘로 당길 수 없었다. 모바일 지연 카드의 체크박스 + 전체 선택 토글과 같은 모델.
   * 담을 수 있는 건 **내가 만든 일회성 지연**뿐이다 — 서버(`rescheduleConsoleOverdue` /
   * `dismissConsoleOverdue`)가 그 조건으로 다시 걸러내므로, 아닌 걸 담으면 개수만 거짓이 된다.
   */
  const [odPicked, setOdPicked] = useState<ReadonlySet<string>>(() => new Set());
  /** 사진 확대(작업 사진 · 노트 사진) — 공용 `ImageLightbox` 에 넘길 묶음과 시작 인덱스. */
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  // Undo toast (Todoist-style): dark bottom-left toast with a "실행 취소" action, ~6s.
  const [undo, setUndo] = useState<{ id: number; message: string; sub?: string; onUndo: () => void } | null>(null);

  // ── name map ──────────────────────────────────────────────────────────
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of data.users) m.set(u.id, u.name);
    m.set(data.me.id, data.me.name);
    for (const t of data.tasks) {
      m.set(t.createdByUserId, t.authorName);
      if (t.completedByUserId) m.set(t.completedByUserId, t.completedByName);
      for (const p of t.participants) m.set(p.userId, p.name);
    }
    return m;
  }, [data]);
  const nameOf = useCallback((id: string) => nameMap.get(id) ?? "", [nameMap]);

  /**
   * 완료 토글의 낙관적 반영 — 모바일 `tasks-workspace.tsx`(2026-08-11 결정)와 같은 모델을 콘솔에
   * 이식한다. 체크박스를 누르면 `toggleConsoleComplete` → `revalidatePath` → 페이지 재렌더 왕복이
   * 끝나기 전에 목록에서 먼저 빠져야 한다. 되돌리기(reopen)는 낙관적으로 다루지 않는다 — 행이
   * 다시 나타나려면 서버 데이터가 와야 하고, 실행 취소 토스트가 이미 즉각 피드백을 준다.
   */
  const [visibleTasks, applyTaskOptimistic] = useOptimistic(
    data.tasks,
    (list: TaskRecord[], action: TaskOptimisticAction) => {
      if (action.kind === "remove") {
        const gone = new Set(action.ids);
        return list.filter((t) => !gone.has(t.id));
      }
      return [action.task, ...list];
    },
  );
  // 반복은 행이 아니라 **회차**가 완료된다 — 상태 행을 하나 얹으면 `openOccursOn` 이 즉시 걸러 준다.
  const [visibleOccurrenceStates, resolveOccurrenceOptimistically] = useOptimistic(
    data.occurrenceStates,
    (states: OccurrenceStateRecord[], done: { taskId: string; occurrenceDate: string }) => [
      ...states,
      {
        taskId: done.taskId,
        occurrenceDate: done.occurrenceDate,
        state: "completed" as const,
        completedByUserId: meId,
        movedToDate: null,
      },
    ],
  );
  const tasks = visibleTasks;
  // 관리함/오늘/내일/공유함/지시/캘린더 등 메인 뷰는 **프로젝트에 속하지 않은** 작업만 다룬다
  // (Todoist 모델: 관리함 = 프로젝트 밖 모든 활성 작업, 오늘/내일은 그 필터). 프로젝트 작업은
  // 프로젝트 뷰에만. `tasks`(전체)는 완료·기록/프로젝트/상세 조회에만 쓴다. 모바일 page.tsx 와 동일 분리.
  const personalTasks = useMemo(() => tasks.filter((t) => !t.projectId), [tasks]);
  const projById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);

  // 반복 회차 상태(2026-07-30) — taskId → (occurrenceDate → state). 회차 완료 여부/지연 판정에 사용.
  const occByTask = useMemo(() => {
    const m = new Map<string, Map<string, OccurrenceState>>();
    for (const s of visibleOccurrenceStates) {
      let inner = m.get(s.taskId);
      if (!inner) {
        inner = new Map();
        m.set(s.taskId, inner);
      }
      inner.set(s.occurrenceDate, s.state);
    }
    return m;
  }, [visibleOccurrenceStates]);
  // 반복 회차의 날짜별 수동 순서: `${taskId}|${date}` → sort_order (2026-07-30 B안).
  const occOrderMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of data.occurrenceOrders) m.set(`${o.taskId}|${o.occurrenceDate}`, o.sortOrder);
    return m;
  }, [data.occurrenceOrders]);
  /** 일회성은 `tasks.sort_order`, 반복은 그 날짜의 회차 순서 — 저장처가 둘이라 읽을 때 합친다. */
  const dateOrderOf = useCallback(
    (t: TaskRecord, date: string): number | null =>
      isStandardRecurrence(t.recurrenceRule) ? occOrderMap.get(`${t.id}|${date}`) ?? null : t.sortOrder,
    [occOrderMap],
  );
  /** 수동 위치가 있는 항목이 먼저, 없으면 우선순위 폴백. */
  const sortByDateOrder = useCallback(
    (arr: TaskRecord[], date: string): TaskRecord[] =>
      [...arr].sort((a, b) => {
        const ao = dateOrderOf(a, date);
        const bo = dateOrderOf(b, date);
        // 수동 순서가 없는 항목은 **만든 순서대로(오래된 것 먼저)** — 새로 추가한 작업이 목록
        // **아래**, 즉 추가 입력창 바로 위에 붙는다(2026-09-09). 예전에는 목록 데이터가
        // `created_at desc` 로 와서 새 작업이 맨 위로 튀었는데, 정작 추가 입력창은 아래에 있어
        // 「방금 만든 게 어디 갔지」가 됐다. 우선순위는 그대로 먼저 본다.
        if (ao != null && bo != null) return ao !== bo ? ao - bo : byPriorityThenOldest(a, b);
        if (ao != null) return -1;
        if (bo != null) return 1;
        return byPriorityThenOldest(a, b);
      }),
    [dateOrderOf],
  );
  const occState = useCallback(
    (taskId: string, date: string): OccurrenceState | undefined => occByTask.get(taskId)?.get(date),
    [occByTask],
  );
  const resolvedDatesFor = useCallback(
    (taskId: string): Set<string> => new Set(occByTask.get(taskId)?.keys() ?? []),
    [occByTask],
  );
  // 관리함(Inbox) 드래그 재정렬(2026-07-30). dragId=집는 행, overId=놓을 위치, inboxOrder=낙관적 순서.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [inboxOrder, setInboxOrder] = useState<string[] | null>(null);
  // 날짜 목록(오늘/내일)의 낙관적 순서 — `${date}` → taskId[]. 서버 갱신되면 초기화된다.
  const [dateOrder, setDateOrder] = useState<{ date: string; ids: string[] } | null>(null);
  // 서버 새로고침(revalidate)되면 낙관적 순서 초기화 — sort_order가 이미 반영돼 있으므로.
  // rAF로 감싸 effect 내 동기 setState 경고를 피한다(이 파일의 기존 패턴).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setInboxOrder(null);
      setDateOrder(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [data.tasks]);
  // 특정 토쿄일에 이 작업이 걸리는가 — 반복은 규칙으로 회차 계산(Todoist 가상 미리보기), 비반복은 앵커 하루.
  const occursOn = useCallback((t: TaskRecord, ymd: string) => {
    const a = dateOf(t);
    if (!a) return false;
    if (isStandardRecurrence(t.recurrenceRule))
      return recurringOccurrencesInRange(t.recurrenceRule, a, ymd, ymd).length > 0;
    return a === ymd;
  }, []);
  // 반복 회차가 오늘/특정일에 미완료로 떠야 하는가(완료·스킵·이동된 회차 제외).
  const openOccursOn = useCallback(
    (t: TaskRecord, ymd: string) =>
      // 상태 행이 있으면 그 회차는 해결된 것이다(completed · skipped · moved). 주석은 처음부터 셋 다
      // 제외한다고 적혀 있었지만 코드는 completed 만 걸렀다 — 모바일에서 건너뛴 회차가 콘솔에는
      // 그대로 떠 두 화면이 어긋났다(2026-07-30).
      // `isActive` 가드(2026-07-31): 캘린더는 이미 isActive 를 걸러서, 완료/취소된 반복 행이
      // 오늘 목록에는 뜨고 캘린더에는 안 뜨는 내부 모순이 있었다. 모바일 openOccursOn 과 동일.
      isActive(t) && isStandardRecurrence(t.recurrenceRule) && occursOn(t, ymd) && !occState(t.id, ymd),
    [occursOn, occState],
  );

  // ── action runner ──────────────────────────────────────────────────────────────
  // 서버 액션이 돌려주는 모든 코드를 실제 문구로 매핑한다. 예전에는 auth/forbidden/save_failed 외
  // 전부가 errGeneric("처리하지 못했습니다")으로 뭉개져, 제목 누락인지 날짜 누락인지 화면에서
  // 구분할 수 없었다(2026-07-30 수정).
  const errMsg = useCallback(
    (code: string) => {
      const map: Record<string, string> = {
        auth: dict.errAuth,
        forbidden: dict.errForbidden,
        save_failed: dict.errSave,
        delete_failed: dict.errSave,
        missing_title: dict.errMissingTitle,
        time_needs_date: dict.errTimeNeedsDate,
        repeat_needs_date: dict.errRepeatNeedsDate,
        not_found: dict.errNotFound,
        invalid_date: dict.errInvalidDate,
        invalid_project: dict.errNotFound,
        empty: dict.errEmpty,
        duplicate_occurrence: dict.errDuplicateOccurrence,
        recurring_series: dict.errRecurringSeries,
      };
      return map[code] ?? dict.errGeneric;
    },
    [dict],
  );
  const run = useCallback(
    (
      fn: () => Promise<TaskActionResult>,
      opts?: {
        toast?: string;
        /** 성공 결과를 받는다 — 「오늘로 가져오기」처럼 결과에 따라 문구가 갈리는 경우가 있다. */
        after?: (res: Extract<TaskActionResult, { ok: true }>) => void;
        onError?: () => void;
        optimistic?: () => void;
      },
    ) => {
      startTransition(async () => {
        // 낙관적 반영은 서버 호출 **전에** — 실패하면 새 props 도착과 함께 자동으로 원복된다
        // (모바일 tasks-workspace.tsx 와 같은 useOptimistic 규칙).
        opts?.optimistic?.();
        const res = await fn();
        if (res.ok) {
          if (opts?.toast) showToast(opts.toast);
          opts?.after?.(res);
          // revalidatePath(CONSOLE_PATH) 를 모든 액션이 성공 경로에서 호출하므로(actions.ts 전수
          // 확인, 2026-08-25) router.refresh() 는 같은 갱신을 한 번 더 도는 중복 왕복이었다.
        } else {
          opts?.onError?.();
          haptic("error");
          showToast(errMsg(res.error));
        }
      });
    },
    [errMsg, showToast],
  );


  // Auto-dismiss the undo toast (~6s). Clicking undo or a new toast replaces it.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);
  const showUndo = useCallback(
    (message: string, onUndo: () => void, sub?: string) =>
      setUndo({ id: Date.now(), message, onUndo, sub }),
    [],
  );

  // 상세 불러오기(업데이트 로그 + 연결 정보)는 아래 `activeId` 를 계산한 뒤에 건다 — 기본 선택
  // (보기의 첫 작업)이 목록 계산에 기대기 때문이다. `detail` 은 잠깐 이전 작업 것을 들고 있을 수
  // 있어서 읽는 쪽이 `detail.id === activeId` 로 거른다.

  const openTask = useCallback((id: string, occurrenceDate?: string) => {
    // 상세를 열면 떠 있는 팝오버는 닫는다(스크림이 상세 칸을 덮지 않게).
    setPop(null);
    setNoteDraft("");
    setStatusDraft(null); // never carry a pending segment click into another task
    setSel(id);
    setSelOcc(occurrenceDate ?? null);
    setDetailClosed(false);
  }, []);
  const closePanel = useCallback(() => {
    setSel(null);
    setDetailClosed(true);
  }, []);
  const goView = useCallback((v: View) => {
    setProjectId(null);
    setView(v);
    setAdd(null);
    setSel(null);
    setDetailClosed(false);
    setOdMode(null);
    setOdPicked(new Set());
    // Selection is scoped to the list you can see — leaving the view drops it rather than carrying
    // invisible picks into a bulk delete.
    setSelMode(false);
    setPicked(new Set());
    // 캘린더는 필터바가 없어 활성 필터를 해제할 UI가 없으므로, 진입 시 검색/우선순위/날짜 필터를 초기화한다.
    if (v === "calendar") {
      setQ("");
      setPrioFilter("");
      setDateFilter(null);
    }
  }, []);
  // "다음: {date}" for a recurring task (its next occurrence after today), else undefined.
  const recurringNextLabel = useCallback(
    (t: TaskRecord): string | undefined => {
      if (!isStandardRecurrence(t.recurrenceRule)) return undefined;
      const anchor = dueDateOf(t) ?? t.scheduledDate;
      if (!anchor) return undefined;
      const next = recurringOccurrencesInRange(t.recurrenceRule, anchor, addDays(today, 1), addDays(today, 366))[0];
      if (!next) return undefined;
      const label =
        next === addDays(today, 1) ? dict.tomorrow : `${fmtShort(next, locale)} (${fmtWeekday(next, locale)})`;
      return fill(dict.undoNext, { date: label });
    },
    [today, dict, locale],
  );
  // Toggle complete; on completing show a "완료 · 실행 취소" undo toast (reopen). Reopen is itself the
  // correction → plain toast, no undo.
  // ── 상세 패널 코어 편집(제목·본문·태그) ────────────────────────────────────────────
  const startCoreEdit = useCallback((t: TaskRecord) => {
    setCoreEdit({ id: t.id, title: t.title, desc: t.description ?? "", tags: [...t.tags], tagInput: "" });
    setEditPhotos({ value: [...t.imageUrls], pending: [] });
  }, []);
  const cancelCoreEdit = useCallback(() => {
    setCoreEdit(null);
    setEditPhotos({ value: [], pending: [] });
  }, []);
  const addCoreTag = useCallback(() => {
    setCoreEdit((prev) => {
      if (!prev) return prev;
      const tag = prev.tagInput.trim().replace(/^#/, "");
      // Server slices to 10; stop at the same cap here so the UI never shows a tag that won't persist.
      if (!tag || prev.tags.includes(tag) || prev.tags.length >= 10) return { ...prev, tagInput: "" };
      return { ...prev, tags: [...prev.tags, tag], tagInput: "" };
    });
  }, []);
  const saveCoreEdit = useCallback(
    (t: TaskRecord, draft: NonNullable<typeof coreEdit>) => {
      if (!draft.title.trim()) return;
      // Date/time/repeat/priority are not edited here, but the action rewrites all of them — pass the
      // task's current values back or this edit would silently clear its schedule.
      const photos = editPhotos;
      run(
        async () => {
          const uploaded = photos.pending.length
            ? await uploadPendingTaskPhotos({
                pending: photos.pending,
                organizationId,
                taskId: t.id,
              })
            : [];
          return updateConsoleTaskCore({
            taskId: t.id,
            title: draft.title,
            desc: draft.desc,
            tags: draft.tags,
            date: dueDateOf(t) ?? t.scheduledDate ?? "",
            time: t.timeLabel ?? "",
            durationMinutes: t.durationMinutes,
            repeat: t.recurrenceRule ?? "none",
            priority: t.priority,
            // Kept photos + newly uploaded ones. The action treats this as the full replacement
            // set and hard-deletes whatever the user removed.
            imageUrls: [...photos.value, ...uploaded],
          });
        },
        {
          toast: dict.tUpdated,
          after: () => {
            setCoreEdit(null);
            setEditPhotos({ value: [], pending: [] });
          },
        },
      );
    },
    [dict, editPhotos, organizationId, run],
  );

  const toggleComplete = useCallback(
    (t: TaskRecord, occ?: { date: string; done: boolean }) => {
      // The checkbox can move status behind the segmented control's back; drop any pending segment
      // click so it can't re-apply if the status happens to land back on its `from` value.
      setStatusDraft(null);
      // Recurring: completion is per-occurrence (occ.date) and the done state comes from the
      // occurrence, not the row's status (which stays open). One-off: row status.
      const occDate = occ?.date;
      const isDone = occ ? occ.done : t.status === "completed";
      if (isDone) {
        // Reopen: no optimistic update — the row must wait for fresh server data to reappear, and
        // the undo toast already gives instant feedback (same call as mobile).
        run(() => toggleConsoleComplete(t.id, false, occDate), { toast: dict.tReopened });
        return;
      }
      const sub = occ ? undefined : recurringNextLabel(t);
      run(() => toggleConsoleComplete(t.id, true, occDate), {
        optimistic: () =>
          occDate
            ? resolveOccurrenceOptimistically({ taskId: t.id, occurrenceDate: occDate })
            : applyTaskOptimistic({ kind: "remove", ids: [t.id] }),
        // 실행 취소는 서버가 **실제로 기록한** 회차로 — 회차가 아닌 날 완료하면 가장 오래된 밀린 회차로
        // 정산되므로, 누른 날짜로 되돌리면 아무것도 풀리지 않는다.
        after: (res) =>
          showUndo(
            dict.tCompleted,
            () =>
              run(() => toggleConsoleComplete(t.id, false, res.occurrenceDate ?? occDate), {
                after: () => setUndo(null),
              }),
            sub,
          ),
      });
    },
    [run, dict, recurringNextLabel, showUndo, applyTaskOptimistic, resolveOccurrenceOptimistically],
  );
  /**
   * 체크박스를 눌렀을 때의 움직임(2026-10-15) — 고리가 차고 체크가 그려지는 걸 **본 다음에** 줄이
   * 빠진다. 바로 `toggleComplete` 를 부르면 낙관적 제거로 줄이 그 프레임에 사라져 체크가 보이지
   * 않는다. 되돌리기(완료 → 미완료)와 「움직임 줄이기」 설정은 기다리지 않는다.
   */
  const completeWithMotion = useCallback(
    (t: TaskRecord, occ?: { date: string; done: boolean }) => {
      const isDone = occ ? occ.done : t.status === "completed";
      const reduce =
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (isDone || reduce) {
        haptic(isDone ? "light" : "success");
        toggleComplete(t, occ);
        return;
      }
      const key = `${t.id}|${occ?.date ?? ""}`;
      haptic("success");
      setCompleting((prev) => new Set(prev).add(key));
      window.setTimeout(() => {
        setCompleting((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        toggleComplete(t, occ);
      }, 420);
    },
    [toggleComplete],
  );
  // Immediate (soft) delete + undo toast — replaces the confirm modal for single-task delete.
  const deleteWithUndo = useCallback(
    (t: TaskRecord) => {
      run(() => deleteConsoleTask(t.id), {
        after: () => {
          // 지운 작업을 보고 있었다면 선택만 푼다 — 상세 칸은 보기의 다음 첫 작업으로 넘어간다.
          setSel((cur) => (cur === t.id ? null : cur));
          showUndo(dict.tDeletedUndoable, () =>
            run(() => restoreConsoleTask(t.id), { after: () => setUndo(null) }),
          );
        },
      });
    },
    [run, dict, showUndo],
  );
  /**
   * 회차 하나만 건너뛰기 + 실행 취소. `skipped` 는 영구 상태라 되돌릴 경로가 반드시 있어야 한다
   * (그래서 확인 모달 대신 실행 취소 토스트를 쓴다 — 이 콘솔의 단건 삭제와 같은 판단).
   */
  const skipOccurrenceWithUndo = useCallback(
    (t: TaskRecord, date: string) => {
      setRecurDel(null);
      run(() => skipConsoleOccurrence(t.id, date), {
        after: () =>
          showUndo(fill(dict.recurSkippedToast, { date: fmtShort(date, locale) }), () =>
            run(() => unskipConsoleOccurrence(t.id, date), { after: () => setUndo(null) }),
          ),
      });
    },
    [run, dict, locale, showUndo],
  );
  // ── project detail loading ───────────────────────────────────────────────────────
  // Load project sections+tasks for the project view. Gated on `projectDetail.id === projectId`.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    getConsoleProjectDetail(projectId).then((res) => {
      if (alive && res.ok) setProjectDetail(res.project);
    });
    return () => {
      alive = false;
    };
  }, [projectId, data]);

  // ── global close on outside click / Esc ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirm) setConfirm(null);
      else if (pop) setPop(null);
      else if (rptWhenOpen) {
        // 시각 고르는 작은 창이 먼저 닫힌다 — 그다음 Esc 가 업무일지 창을 닫는다.
        setRptWhenOpen(false);
        rptChipRef.current?.focus();
      } else if (report) setReport(null);
      else if (newProj) setNewProj(null);
      else if (recurDel) setRecurDel(null);
      else if (add) setAdd(null);
      else if (odMode) {
        setOdMode(null);
        setOdPicked(new Set());
      } else if (sel) closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, pop, rptWhenOpen, report, newProj, recurDel, sel, add, odMode, closePanel]);

  // ── keep the Tokyo operating date live (roll over at Tokyo midnight without a refresh) ──────
  useEffect(() => {
    const check = () => setToday((prev) => (tokyoToday() !== prev ? tokyoToday() : prev));
    const id = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // ── popover placement: put the whole popover on screen (no scroll on normal viewports) ──────
  // Measured before paint (useLayoutEffect): fit below the trigger, else above, else clamp.
  // Positioned imperatively via the DOM (no setState) so there's no re-render/flicker/jump.
  useIsoLayoutEffect(() => {
    const el = popAnchorRef.current;
    if (!el || !pop) return;
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      const left = Math.max(8, Math.min(pop.x, vw - w - 8));
      let top = pop.y; // below the trigger
      if (top + h > vh - 8) {
        const above = pop.aTop - 6 - h; // flip above the trigger
        top = above >= 8 ? above : Math.max(8, vh - 8 - h);
      }
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    place();
    // Popovers that load their content async (컨텍스트 피커) or expand a section (일정 피커) grow
    // AFTER this effect measured them, and a one-shot placement leaves the grown part off-screen.
    // Re-clamping on resize keeps the footer reachable without special-casing any one popover.
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pop]);

  // ── derived task groups (프로젝트 제외 personalTasks 기준, 내 뷰는 myOwn) ─────────────────
  const overdueList = personalTasks.filter((t) => isOverdue(t, today) && myOwn(t, meId));
  // 관리함 = 프로젝트 밖 모든 활성 작업(날짜 무관).
  const inboxCount = personalTasks.filter((t) => isActive(t) && myOwn(t, meId)).length;
  // 반복은 **오늘 목록에 한 줄**이다(2026-09-08) — 오늘 회차든 밀린 것이든. 그러므로 탭 카운트도
  // 목록과 같은 술어(`showsOnTodayList`)로 한 번만 센다. 예전에는 「오늘 회차」와 「지연 backlog」를
  // 따로 세어 더했는데, 둘 다 가진 작업이 **2로 계상**됐다(지금 규칙에서는 한 줄인데도).
  const recTodayCount = personalTasks.filter(
    (t) => myOwn(t, meId) && showsOnTodayList(t, today, occState, resolvedDatesFor(t.id)),
  ).length;
  const recTomorrowCount = personalTasks.filter(
    (t) => myOwn(t, meId) && openOccursOn(t, addDays(today, 1)),
  ).length;
  const todayCount =
    personalTasks.filter((t) => isTodayTask(t, today) && myOwn(t, meId)).length +
    overdueList.length +
    recTodayCount;
  const tomorrowCount =
    personalTasks.filter((t) => isTomorrowTask(t, today) && myOwn(t, meId)).length + recTomorrowCount;
  const sharedCount = personalTasks.filter(
    (t) => isActive(t) && plainShared(t, meId),
  ).length;
  const recvOpen = personalTasks.filter((t) => recvInstr(t, meId) && isActive(t)).length;
  const sentOpen = personalTasks.filter((t) => sentInstr(t, meId) && isActive(t)).length;

  /**
   * 목록 필터에는 **지연된** 검색어를 쓴다.
   *
   * 이 컴포넌트는 4,500줄짜리 트리 하나이고 `useState` 가 44개인데 `useMemo` 는 6개뿐이라,
   * `q` 가 바뀌면 사실상 화면 전체가 다시 그려진다 — 한 글자 칠 때마다 전 작업 행·캘린더·팝오버가
   * 재렌더된다. `useDeferredValue` 를 끼우면 **입력창은 즉시** 반응하고 무거운 목록만 한 박자
   * 뒤에 낮은 우선순위로 따라온다.
   *
   * 로직은 하나도 바뀌지 않는다 — 스케줄링만 달라진다. 입력값(`q`)은 입력창과 «필터 켜짐» 표시에
   * 그대로 쓰고, 필터 계산만 `deferredQuery` 를 본다.
   */
  const deferredQuery = useDeferredValue(q);
  const matches = useCallback(
    (t: TaskRecord) =>
      matchQuery(t, deferredQuery, nameOf) &&
      matchPrio(t, prioFilter) &&
      matchDate(t, dateFilter, today),
    [deferredQuery, nameOf, prioFilter, dateFilter, today],
  );
  const filtered = useCallback(
    (arr: TaskRecord[]) => arr.filter(matches),
    [matches],
  );
  const hasActiveFilter = !!(q || prioFilter || dateFilter);

  // ── small building blocks ─────────────────────────────────────────────────────────
  // 아바타는 한 가지 옅은 보라 톤(화이트 리디자인) — 사람마다 다른 색을 칠하지 않는다.
  const Avatar = ({ id, cls }: { id: string; cls?: string }) => (
    <span className={cls ? `av ${cls}` : "av"}>{initial(nameOf(id))}</span>
  );
  const Avatars = ({ ids }: { ids: string[] }) => (
    <>
      {ids.slice(0, 4).map((id) => (
        <Avatar key={id} id={id} />
      ))}
    </>
  );

  /** 우선순위를 낱말로(긴급 · 중요 · 보통 · 없음). 목록 메타와 상세 칸이 같이 쓴다. */
  const prioWord = (p: string) =>
    p === "urgent"
      ? dict.w.prioUrgent
      : p === "important"
        ? dict.w.prioImportant
        : p === "medium"
          ? dict.w.prioMedium
          : dict.w.prioNone;
  /** 나를 뺀 함께하는 사람(작성자 포함). 「공유 n명」과 상세 「함께」가 같은 기준을 쓴다. */
  const othersOf = (t: TaskRecord): string[] =>
    [t.createdByUserId, ...partsOf(t)].filter((id, i, a) => a.indexOf(id) === i && id !== meId);
  /** 짧은 날짜 「10/7」 — 메타 줄에서 쓴다(시안 표기). */
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  /** 날짜 한 칸 — 오늘 · 내일 · 10/14 (화). */
  const dayLabel = (d: string) =>
    d === today ? dict.today : d === addDays(today, 1) ? dict.tomorrow : `${md(d)} (${fmtWeekday(d, locale)})`;

  // ── TASK ROW ──────────────────────────────────────────────────────────────────────
  // 한 줄 = 우선순위 고리 · 제목 · 회색 메타 한 줄(지연이면 빨강). 칩·깃발·배지를 늘어놓지 않고
  // 「긴급 · 15:00 · 가부키초 K302 · #태그 · 진행 중 · 공유 2명」처럼 낱말로 잇는다(시안 Todo-PC).
  const renderRow = (
    t: TaskRecord,
    opts?: {
      hideDate?: boolean;
      extraByLabel?: string;
      forceDone?: boolean;
      // 반복 회차 행: 이 날짜 회차의 완료 여부로 체크박스/완료 처리(행 status가 아니라).
      occurrence?: { date: string; done: boolean };
      // 드래그 재정렬: 왼쪽에 그립 핸들 표시(호버 시).
      reorder?: boolean;
      // 지연 일괄 처리 대상 선택. 전역 선택모드와 같은 네모 상자를 쓰되 집합만 다르다.
      pick?: { on: boolean; toggle: () => void };
      /** 반복 작업이 밀린 회차 수. 0/undefined 면 표시하지 않는다(2026-09-08). */
      behindDays?: number;
      /**
       * 완료 토글을 막는다 — **미리보기 목록**(미래 날짜)에서 쓴다(2026-09-09).
       * 미래 회차는 아직 할 수 없는 일이다. 눌리면 그날이 왔을 때 목록에서 사라져, 아무도 안 했는데
       * 기록만 「완료」로 남는다.
       */
      previewOnly?: boolean;
      /** 메타 줄을 통째로 바꾼다(지시 보기의 「김현준 → 나 · 오늘까지」). */
      meta?: ReactNode[];
      /** 오른쪽 끝 숫자(완료 시각 등). */
      right?: ReactNode;
      /** 고리를 누를 수 없게(보낸 지시 — 내가 완료할 일이 아니다). */
      staticRing?: boolean;
    },
  ) => {
    const occ = opts?.occurrence;
    const realDone = occ ? occ.done : t.status === "completed";
    const motionKey = `${t.id}|${occ?.date ?? ""}`;
    const completingNow = completing.has(motionKey);
    // forceDone: 완료·기록 탭의 반복 완료 이력(행은 open 으로 롤포워드됨)을 완료 상태로 표시.
    const done = realDone || !!opts?.forceDone || completingNow;
    const overdue = !done && isOverdue(t, today);
    const selected = activeId === t.id;
    const mine = isMine(t, meId);
    const d = dateOf(t);
    const pcls = t.priority !== "normal" ? `p-${t.priority}` : "";

    // 전역 선택모드가 켜져 있으면 그쪽이 이긴다 — 두 선택 UI 가 한 행에 겹치지 않게.
    const odPick = selMode ? undefined : opts?.pick;
    const picking = selMode || !!odPick;
    const isPicked = odPick ? odPick.on : picked.has(t.id);
    const togglePick = odPick ? odPick.toggle : () => togglePicked(t.id);

    const seg: ReactNode[] = [];
    if (opts?.meta) {
      seg.push(...opts.meta);
    } else {
      if (!done && (t.priority === "urgent" || t.priority === "important")) seg.push(prioWord(t.priority));
      if (!opts?.hideDate && d) {
        const text = overdue ? md(d) : dayLabel(d);
        // 날짜를 눌러 여는 일정 팝오버도 결국 `rescheduleConsoleTask` 라 **작성자 전용**이다. 남의
        // 작업에서는 눌리지 않는 글자로 둔다 — 열어 준 뒤 저장에서 「권한이 없습니다」를 띄우지 않도록.
        seg.push(
          mine && !done && !picking ? (
            <button
              type="button"
              className="atw-meta-btn"
              onClick={(e) => {
                e.stopPropagation();
                openSchedulePop(e, t);
              }}
            >
              {text}
            </button>
          ) : (
            text
          ),
        );
      }
      const trng = timeRange(t.timeLabel, t.durationMinutes);
      if (trng) seg.push(trng);
      if (t.recurrenceRule) seg.push(`↻ ${repeatShort(t.recurrenceRule, dict, locale)}`);
      if (opts?.behindDays)
        seg.push(<span className="is-red">{fill(dict.odDaysBehind, { n: String(opts.behindDays) })}</span>);
      const c = t.resolvedContext;
      if (c) {
        const place = [c.propertyName, c.roomLabel].filter(Boolean).join(" ");
        if (place) seg.push(place);
        if (c.guestName) seg.push(c.guestName);
      }
      if (t.tags.length) seg.push(t.tags.slice(0, 2).map((g) => `#${g}`).join(" "));
      if (!done && t.status === "in_progress") seg.push(dict.stInProgress);
      if (t.isDirective && !mine) seg.push(fill(dict.w.directiveFrom, { name: t.authorName || nameOf(t.createdByUserId) }));
      else if (!mine) seg.push(fill(dict.w.sharedFrom, { name: nameOf(t.createdByUserId) }));
      const others = othersOf(t);
      if (isSharedTask(t) && others.length > 0) seg.push(fill(dict.w.shareN, { n: others.length }));
      if (t.imageUrls.length) seg.push(fill(dict.w.photoN, { n: t.imageUrls.length }));
      if (opts?.extraByLabel) seg.push(opts.extraByLabel);
    }

    // 반복 완료 이력(이미 다음 회차로 넘어간 것)은 되돌릴 대상이 아니다 → 고리를 누를 수 없게.
    const ringLocked = !!opts?.staticRing || (!!opts?.forceDone && !realDone);

    return (
      <div
        key={t.id}
        data-task-id={t.id} /* read by 전체 선택 (selectAllVisible) */
        className={`atw-row ${done ? "is-done" : ""} ${completingNow ? "is-completing" : ""} ${
          selected && !picking ? "on" : ""
        } ${picking ? "is-picking" : ""} ${isPicked ? "is-picked" : ""}`}
        onClick={() => (picking ? togglePick() : openTask(t.id, occ?.date))}
      >
        {opts?.reorder && !picking ? (
          <span className="atw-grip" aria-hidden="true">
            <GripVertical size={15} />
          </span>
        ) : null}
        {picking ? (
          <button
            type="button"
            className={`atw-pick ${isPicked ? "on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              togglePick();
            }}
            role="checkbox"
            aria-checked={isPicked}
            aria-label={t.title}
          >
            <Check size={13} strokeWidth={3} />
          </button>
        ) : opts?.previewOnly && !done ? (
          // 미리보기 행(미래 날짜)은 **점 마커**로 그린다(2026-09-09). 못 누르는 체크박스를 남겨 두면
          // 고장난 버튼으로 보인다. 자리(22px)는 그대로 지켜 다른 줄과 정렬이 어긋나지 않게 한다.
          <span className={`atw-dot ${pcls}`} title={dict.previewOnlyHint} aria-hidden="true" />
        ) : (
          <TaskRing
            prio={t.priority}
            done={done}
            label={t.title}
            onToggle={ringLocked || completingNow ? undefined : () => completeWithMotion(t, occ)}
          />
        )}
        <div className="atw-row__b">
          <span className="atw-row__t">{t.title}</span>
          {seg.length > 0 && (
            <span className={`atw-row__m ${overdue ? "is-red" : ""}`}>
              {seg.map((x, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="atw-sep"> · </span>}
                  {x}
                </Fragment>
              ))}
            </span>
          )}
        </div>
        {opts?.right ? <span className="atw-row__r num">{opts.right}</span> : null}
        <button
          type="button"
          className="atw-row__more"
          onClick={(e) => {
            e.stopPropagation();
            openRowMenu(e, t.id, occ?.date);
          }}
          aria-label={dict.w.more}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    );
  };

  const Section = ({
    title,
    n,
    mod,
    actions,
    children,
  }: {
    title: string;
    n: number;
    mod?: string;
    actions?: ReactNode;
    children: ReactNode;
  }) => (
    <section className={`atw-sec ${mod ? `is-${mod}` : ""}`}>
      <div className="atw-sec__h">
        <b>{title}</b>
        <span className="num">{n}</span>
        {actions ? <span className="atw-sec__acts">{actions}</span> : null}
      </div>
      <div className="atw-rows">{children}</div>
    </section>
  );

  const EmptyState = ({
    icon,
    t,
    s,
    ctx,
  }: {
    icon: ReactNode;
    t: string;
    s: string;
    ctx?: AddDraft["ctx"];
  }) => (
    <div className="atw-empty">
      <span className="atw-empty__ic">{icon}</span>
      <b>{t}</b>
      <span>{s}</span>
      {ctx && (
        <button type="button" className="atw-link" onClick={() => openInlineAdd(ctx)}>
          <Plus size={14} />
          {dict.addTask}
        </button>
      )}
    </div>
  );

  // ── INLINE ADD ──────────────────────────────────────────────────────────────────────
  const openInlineAdd = (ctx: AddDraft["ctx"], onDate = "", sectionId: string | null = null) => {
    // 지시는 날짜 없이 보내면 대상자의 관리함에 묻히기 쉬워 오늘로 잡아 둔다(스케줄 칩에서 변경 가능).
    const date =
      ctx === "today" || ctx === "instr"
        ? today
        : ctx === "tomorrow"
          ? addDays(today, 1)
          : ctx === "day"
            ? onDate
            : "";
    setAdd({
      ctx,
      sectionId,
      onDate,
      date,
      time: "",
      dur: null,
      repeat: "none",
      prio: "normal",
      targets: [],
      tags: [],
      context: undefined,
    });
    setAddPhotos([]);
    resetAddText(false); // 취소로 닫았을 때 참조에 남은 이전 입력을 버린다(DOM 은 새로 마운트된다)
  };
  const saveInlineAdd = () => {
    if (!add || !addTextRef.current.title.trim()) return;
    const draft = add;
    const text = { ...addTextRef.current }; // 비제어 입력의 현재 값(제출 시점 스냅샷)
    const photos = addPhotos;
    // The task id is minted here so the photos can be uploaded to their final
    // `${organizationId}/task-images/${id}/` path BEFORE the row exists — the same order the mobile
    // form uses. If the insert then fails the objects are orphaned, which is the accepted trade
    // (an orphan file beats a row referencing an upload that never happened).
    const newTaskId = crypto.randomUUID();

    // ── 입력을 **즉시** 비운다 ──────────────────────────────────────────────────
    // 서버 왕복(삽입 → `revalidatePath` → 페이지 데이터 7종 재조회 → RSC 재렌더)을 기다렸다가
    // 비우면, 연속 추가에서 다음 제목을 바로 칠 수 없다. 실패하면 `onError` 에서 되돌린다.
    //
    // **이것이 이제 중복 제출 가드다.** 예전에는 `addSavingRef` 로 재진입을 막았는데(2026-08-25,
    // 한 번 탭에 두 건이 만들어지던 문제), 입력을 **동기적으로** 비우면 같은 틱의 두 번째 호출은
    // 맨 위 `!title.trim()` 에서 걸린다 — 더 강한 보장이면서 연속 추가를 막지 않는다.
    resetAddText(true);
    setAddPhotos([]);
    setAdd((prev) =>
      prev
        ? {
            ...prev,
            time: "",
            dur: null,
            repeat: "none",
            prio: "normal",
            tags: [],
            context: undefined,
            targets: prev.ctx === "instr" ? prev.targets : [],
          }
        : prev,
    );

    // 낙관적으로 목록에 얹을 행. 서버가 만들 값과 같은 규칙으로 조립한다(단일 날짜 모델: `due_at`).
    const nowIso = new Date().toISOString();
    const optimisticTask: TaskRecord = {
      id: newTaskId,
      organizationId,
      createdByUserId: meId,
      authorName: data.me.name,
      title: text.title.trim(),
      description: text.desc || null,
      scheduledDate: null,
      dueAt: draft.date
        ? new Date(`${draft.date}T${draft.time || "00:00"}:00+09:00`).toISOString()
        : null,
      allDay: !draft.time,
      timeLabel: draft.time || null,
      durationMinutes: draft.time ? draft.dur : null,
      priority: draft.prio,
      sortOrder: null,
      status: "open",
      projectId: draft.ctx === "project" ? projectId : null,
      sectionId: draft.ctx === "project" ? draft.sectionId : null,
      isInbox: draft.ctx === "inbox",
      isShared: draft.targets.length > 0,
      isDirective: draft.targets.length > 0,
      recurrenceRule: draft.repeat === "none" ? null : draft.repeat,
      recurrenceSeriesId: null,
      recurrenceInstanceDate: null,
      tags: [...draft.tags, text.tagInput.trim().replace(/^#/, "")].filter(Boolean).slice(0, 10),
      imageUrls: [],
      completedAt: null,
      completedByUserId: null,
      completedByName: "",
      createdAt: nowIso,
      updatedAt: nowIso,
      participants: [],
      resolvedContext: null,
    };

    run(
      async () => {
        const imageUrls = photos.length
          ? await uploadPendingTaskPhotos({ pending: photos, organizationId, taskId: newTaskId })
          : [];
        return createConsoleTask({
          title: text.title,
          desc: text.desc,
          date: draft.date,
          time: draft.time,
          durationMinutes: draft.dur,
          repeat: draft.repeat,
          priority: draft.prio,
          // 커밋 안 된 입력 버퍼도 마지막 태그로 인정한다(Enter 없이 바로 저장하는 흐름).
          tags: [...draft.tags, text.tagInput.trim().replace(/^#/, "")].filter(Boolean).slice(0, 10),
          projectId: draft.ctx === "project" ? projectId : null,
          sectionId: draft.ctx === "project" ? draft.sectionId : null,
          targetUserIds: draft.targets,
          isDirective: draft.targets.length > 0,
          context: draft.context,
          imageUrls,
        });
      },
      {
        // 목록에도 즉시 얹는다 — 서버 응답이 오면 새 props 가 이 값을 대체한다(실패 시 자동 원복).
        optimistic: () => applyTaskOptimistic({ kind: "add", task: optimisticTask }),
        toast: draft.targets.length > 0 ? dict.tInstructed : dict.tCreated,
        onError: () => {
          // 저장에 실패했으면 사용자가 친 글을 돌려준다 — 가장 아까운 것은 본문이다.
          // 칩(시간·반복·우선순위·태그)까지 되살리지는 않는다. 드문 경로이고, 되살리면 어느 시점
          // 값인지 모호해진다.
          addTextRef.current = text;
          if (addTitleEl.current) addTitleEl.current.value = text.title;
          if (addDescEl.current) addDescEl.current.value = text.desc;
          if (addTagEl.current) addTagEl.current.value = text.tagInput;
          setAddHasTitle(text.title.trim().length > 0);
          setAddPhotos(photos);
        },
      },
    );
  };

  const InlineAdd = () => {
    if (!add) return null;
    const schLabel = add.date
      ? `${fmtShort(add.date, locale)}(${fmtWeekday(add.date, locale)})${add.time ? ` ${add.time}` : ""}`
      : dict.iaSchedule;
    const prLabel = add.prio === "normal" ? dict.iaPriority : prioWord(add.prio);
    const tgLabel =
      add.targets.length === 0
        ? dict.iaTarget
        : add.targets.length === 1
          ? nameOf(add.targets[0])
          : fill(dict.andMore, { name: nameOf(add.targets[0]), n: add.targets.length - 1 });
    const projName = add.ctx === "project" && projectId ? projById.get(projectId)?.title ?? "" : "";
    const footLabel = projName
      ? projName
      : add.targets.length > 0
        ? dict.iaSendInstr
        : dict.iaInbox;
    return (
      <div className="atw-iadd" onClick={(e) => e.stopPropagation()}>
        <input
          className="atw-iadd__title"
          autoFocus
          ref={addTitleEl}
          defaultValue=""
          placeholder={dict.iaTitle}
          onChange={(e) => {
            addTextRef.current.title = e.target.value;
            // 「비었다↔찼다」가 뒤집힐 때만 상태를 건드린다 — 저장 버튼 활성화에만 쓰인다.
            const filled = e.target.value.trim().length > 0;
            if (filled !== addHasTitle) setAddHasTitle(filled);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveInlineAdd();
          }}
        />
        <textarea
          className="atw-iadd__desc"
          placeholder={dict.iaDesc}
          rows={1}
          ref={addDescEl}
          defaultValue=""
          onChange={(e) => {
            addTextRef.current.desc = e.target.value;
          }}
        />
        <div className="atw-iadd__chips">
          <button
            type="button"
            className={`atw-achip ${add.date ? (isOverduePlain(add.date) ? "set is-red" : "set") : ""}`}
            onClick={(e) => openSchedulePop(e, null)}
          >
            <CalendarDays size={14} />
            {schLabel}
          </button>
          <button
            type="button"
            className={`atw-achip ${add.prio === "urgent" ? "set is-red" : add.prio === "important" ? "set is-amber" : add.prio === "medium" ? "set is-blue" : ""}`}
            onClick={(e) => openPrioPop(e, null)}
          >
            <Flag size={14} />
            {prLabel}
          </button>
          {add.ctx !== "project" && (
            <button
              type="button"
              className={`atw-achip ${add.targets.length ? "set" : ""}`}
              onClick={(e) => openSharePop(e, null, "target")}
            >
              <UserPlus size={14} />
              {tgLabel}
            </button>
          )}
          <button
            type="button"
            className={`atw-achip ${addContextSet(add.context) ? "set" : ""}`}
            onClick={(e) => openContextPop(e, null)}
          >
            <Building2 size={14} />
            {addContextLabel(add.context) || dict.cpTitle}
          </button>
          {/* 칩 줄의 마지막 칩. `display: contents` 라 드롭존과 썸네일이 이 flex 줄의 직접 자식이
              되어, 사진이 없으면 칩 하나, 있으면 아래 줄로 자연스럽게 감긴다. */}
          <TaskPhotoUploader
            compact
            value={[]}
            pending={addPhotos}
            maxImages={add.ctx === "project" ? 20 : 5}
            copy={photoCopy}
            onChange={(next) => setAddPhotos(next.pending)}
          />
          {/* 태그는 칩 순서상 마지막(사진 바로 오른쪽). 사진 썸네일은 `order: 99` 라 아래 줄로
              빠지므로 그 사이를 끊지 않는다. 10개 상한은 서버(slice 10)와 동일. */}
          <span className="atw-iadd__tags">
            {add.tags.map((g) => (
              <span key={g} className="atw-tag">
                #{g}
                <button
                  type="button"
                  aria-label={`${g} ${dict.iaCancel}`}
                  onClick={() => setAdd({ ...add, tags: add.tags.filter((x) => x !== g) })}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {add.tags.length < 10 && (
              <input
                className="atw-iadd__tag"
                ref={addTagEl}
                defaultValue=""
                placeholder={dict.dpTagAdd}
                onChange={(e) => {
                  addTextRef.current.tagInput = e.target.value;
                }}
                onKeyDown={(e) => {
                  const buf = addTextRef.current.tagInput;
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    const tag = buf.trim().replace(/^#/, "");
                    addTextRef.current.tagInput = "";
                    if (addTagEl.current) addTagEl.current.value = "";
                    if (!tag || add.tags.includes(tag)) return;
                    setAdd({ ...add, tags: [...add.tags, tag] });
                  } else if (e.key === "Backspace" && !buf && add.tags.length) {
                    setAdd({ ...add, tags: add.tags.slice(0, -1) });
                  }
                }}
              />
            )}
          </span>
        </div>
        <div className="atw-iadd__foot">
          <span className="atw-iadd__where">
            <Hash size={12} />
            {footLabel}
          </span>
          <button type="button" className="atw-btn is-ghost" onClick={() => setAdd(null)}>
            {dict.iaCancel}
          </button>
          {/* 지시 탭에서 시작한 추가는 대상이 없으면 지시가 아니라 내 개인 작업이 되어, 저장 직후
              이 목록에서 사라진다. 그래서 대상을 필수로 건다. */}
          <button
            type="button"
            className="atw-btn is-pri"
            // `pending` 으로 막지 않는다 — 저장은 이미 배경에서 돌고 입력은 비워졌으므로, 다음 건을
            // 바로 칠 수 있어야 한다. 중복 제출은 「비워진 입력 + 빈 제목 가드」가 막는다.
            disabled={!addHasTitle || (add.ctx === "instr" && add.targets.length === 0)}
            onClick={saveInlineAdd}
          >
            {add.ctx === "instr" ? dict.iaSendInstrCta : dict.iaSave}
          </button>
        </div>
      </div>
    );
  };
  const isOverduePlain = (ymd: string) => ymd < today;

  const InlineAddSlot = ({ ctx, sectionId, label }: { ctx: AddDraft["ctx"]; sectionId?: string | null; label?: string }) => {
    if (add && add.ctx === ctx && (ctx !== "project" || add.sectionId === (sectionId ?? null)))
      return InlineAdd();
    return (
      <button
        type="button"
        className="atw-addrow"
        onClick={() => openInlineAdd(ctx, ctx === "day" ? calDay : "", sectionId ?? null)}
      >
        <Plus size={16} strokeWidth={2.2} />
        {label ?? dict.addTask}
      </button>
    );
  };

  // ── POPOVER OPENERS ─────────────────────────────────────────────────────────────────
  const openSchedulePop = (e: ReactMouseEvent, t: TaskRecord | null) => {
    e.stopPropagation();
    const a = anchorFrom(e);
    if (t) {
      const d = dueDateOf(t) ?? t.scheduledDate ?? "";
      setPop({
        kind: "schedule",
        src: "task",
        taskId: t.id,
        draft: { date: d, time: t.timeLabel ?? "", dur: t.durationMinutes, repeat: t.recurrenceRule ?? "none" },
        calMonth: (d || today).slice(0, 7),
        expand: null,
        ...a,
      });
    } else if (add) {
      setPop({
        kind: "schedule",
        src: "add",
        taskId: null,
        draft: { date: add.date, time: add.time, dur: add.dur, repeat: add.repeat },
        calMonth: (add.date || today).slice(0, 7),
        expand: null,
        ...a,
      });
    }
  };
  const openPrioPop = (e: ReactMouseEvent, t: TaskRecord | null) => {
    e.stopPropagation();
    const a = anchorFrom(e);
    setPop({ kind: "prio", src: t ? "task" : "add", taskId: t?.id ?? null, cur: t ? t.priority : add?.prio ?? "normal", ...a });
  };
  const openSharePop = (e: ReactMouseEvent, t: TaskRecord | null, mode: "target" | "share") => {
    e.stopPropagation();
    const a = anchorFrom(e);
    const sel0 = t ? partsOf(t) : add?.targets ?? [];
    setPop({ kind: "share", src: t ? "task" : "add", taskId: t?.id ?? null, mode, sel: sel0, q: "", ...a });
  };
  const openProjectMembersPop = (e: ReactMouseEvent, pid: string, current: string[]) => {
    e.stopPropagation();
    setPop({
      kind: "share",
      src: "project",
      taskId: null,
      projectId: pid,
      mode: "share",
      sel: current,
      q: "",
      ...anchorFrom(e),
    });
  };
  const openContextPop = (e: ReactMouseEvent, t: TaskRecord | null) => {
    e.stopPropagation();
    setPop({ kind: "context", src: t ? "task" : "add", taskId: t?.id ?? null, ...anchorFrom(e) });
  };
  const openRowMenu = (e: ReactMouseEvent, taskId: string, occ?: string, fromDetail?: boolean) => {
    e.stopPropagation();
    setPop({ kind: "rowmenu", taskId, occ, fromDetail, ...anchorFrom(e) });
  };

  // ── SCHEDULE / PRIO / SHARE APPLY ─────────────────────────────────────────────────────
  const applySchedule = (p: SchedulePop) => {
    if (p.src === "add") {
      if (add) setAdd({ ...add, date: p.draft.date, time: p.draft.time, dur: p.draft.dur, repeat: p.draft.repeat });
      setPop(null);
      return;
    }
    if (p.src === "overdue") {
      // 대상은 사용자가 고른 지연 작업들(`odPicked`). 각 작업의 시각은 서버가 보존하므로 피커의
      // 시간·반복 값은 여기서 의미가 없다 — 날짜만 넘긴다.
      // 전에는 클라이언트의 `overdueList` 를 그대로 돌며 작업마다 `rescheduleConsoleTask` 를 불렀다.
      // 이제는 서버가 "내가 만든 · 일회성 · 진짜 지연"인지 다시 계산한다(`rescheduleConsoleOverdue`).
      const date = p.draft.date;
      const ids = [...odPicked];
      setPop(null);
      // 피커의 "날짜 없음"은 일괄 처리에서는 뜻이 없다(지연 12건을 통째로 관리함에 쏟는 조작).
      // 서버도 invalid_date 로 막으므로 여기서 조용히 접는다.
      if (ids.length === 0 || !date) return;
      run(() => rescheduleConsoleOverdue(date, ids), {
        toast: dict.tRescheduled,
        after: () => setOdPicked(new Set()),
      });
      return;
    }
    if (!p.taskId) {
      setPop(null);
      return;
    }
    // Empty date is allowed here: rescheduleConsoleTask clears the schedule → task moves to Inbox.
    const id = p.taskId;
    const d = p.draft;
    run(() => rescheduleConsoleTask(id, { date: d.date, time: d.time, durationMinutes: d.dur, repeat: d.repeat }), {
      toast: dict.tRescheduled,
      after: () => setPop(null),
    });
  };
  const applyPrio = (p: PrioPop, prio: string) => {
    if (p.src === "add") {
      if (add) setAdd({ ...add, prio });
      setPop(null);
      return;
    }
    const t = tasks.find((x) => x.id === p.taskId);
    if (!t) {
      setPop(null);
      return;
    }
    run(
      () =>
        updateConsoleTaskCore({
          taskId: t.id,
          title: t.title,
          desc: t.description ?? "",
          date: dueDateOf(t) ?? t.scheduledDate ?? "",
          time: t.timeLabel ?? "",
          durationMinutes: t.durationMinutes,
          repeat: t.recurrenceRule ?? "none",
          priority: prio,
          tags: t.tags,
        }),
      { toast: dict.tUpdated, after: () => setPop(null) },
    );
  };
  const applyShare = (p: SharePop) => {
    if (p.src === "project" && p.projectId) {
      const pid = p.projectId;
      const detail = projectDetail && projectDetail.id === pid ? projectDetail : null;
      // 소유자는 목록에서 빼고 비교한다 — 서버도 생성자 제거를 거부하므로 diff 에 넣을 이유가 없다.
      const ownerId = detail?.createdByUserId;
      const before = (detail?.members ?? [])
        .map((mem) => mem.userId)
        .filter((uid) => uid !== ownerId);
      const after = p.sel.filter((uid) => uid !== ownerId);
      const added = after.filter((uid) => !before.includes(uid));
      const removed = before.filter((uid) => !after.includes(uid));
      if (added.length === 0 && removed.length === 0) {
        setPop(null);
        return;
      }
      run(
        async () => {
          for (const uid of removed) {
            const res = await removeConsoleProjectMember(pid, uid);
            if (!res.ok) return res;
          }
          return added.length
            ? await inviteConsoleProjectMembers(pid, added)
            : ({ ok: true } as TaskActionResult);
        },
        { toast: dict.tShared, after: () => setPop(null) },
      );
      return;
    }
    if (p.src === "add") {
      if (add) setAdd({ ...add, targets: p.sel });
      setPop(null);
      return;
    }
    if (!p.taskId) {
      setPop(null);
      return;
    }
    const id = p.taskId;
    const t = tasks.find((x) => x.id === id);
    const asDirective = p.mode === "target" || (t?.isDirective ?? false);
    run(() => shareConsoleTask(id, p.sel, asDirective), {
      toast: asDirective ? dict.tInstructed : dict.tShared,
      after: () => setPop(null),
    });
  };

  // ── 프로젝트 섹션 ────────────────────────────────────────────────────────────────────
  const addSection = (projectId: string) => {
    const title = newSection.trim();
    if (!title) return;
    run(() => addConsoleProjectSection(projectId, title), {
      toast: dict.tCreated,
      after: () => {
        setNewSection("");
        setSecAdding(false);
      },
    });
  };
  const saveSectionRename = (projectId: string, draft: { id: string; title: string }) => {
    const title = draft.title.trim();
    // 빈 이름은 취소로 처리 — blur 로도 호출되므로 여기서 막지 않으면 실패 토스트가 뜬다.
    if (!title) {
      setSectionEdit(null);
      return;
    }
    run(() => renameConsoleProjectSection(projectId, draft.id, title), {
      toast: dict.tUpdated,
      after: () => setSectionEdit(null),
    });
  };

  // ── SELECTION MODE + BULK DELETE ────────────────────────────────────────────────────
  const clearSel = useCallback(() => setPicked(new Set()), []);
  const exitSelMode = useCallback(() => {
    setSelMode(false);
    setPicked(new Set());
  }, []);
  const togglePicked = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  /** "전체 선택" = every row currently on screen, read from the rendered list at click time.
   *  Each view builds its own list inline (today = 지난 + 오늘, 공유함 = 받음 + 보냄, …) with the
   *  search/date/priority filters already applied, so reading the DOM is what actually matches what
   *  the user sees — recomputing those seven filter expressions here would be a second source of
   *  truth that silently drifts. This only ever runs from a click, never during render. */
  const selectAllVisible = useCallback(() => {
    const ids = Array.from(document.querySelectorAll<HTMLElement>(".atw-main .atw-row[data-task-id]"))
      .map((el) => el.dataset.taskId)
      .filter((id): id is string => Boolean(id));
    setPicked(new Set(ids));
  }, []);

  /** Delete every id in one round trip. Only rows the user authored come back as `deletedIds`, so
   *  the undo toast is offered for those alone — a "leave" can't be reversed by clearing deleted_at. */
  const runBulkDelete = useCallback(
    (ids: string[], onDone?: () => void) => {
      if (!ids.length) return;
      startTransition(async () => {
        const res = await bulkDeleteConsoleTasks(ids);
        if (!res.ok) {
          showToast(errMsg(res.error));
          return;
        }
        const removed = res.deletedIds.length + res.leftIds.length;
        if (res.failedIds.length) {
          showToast(fill(dict.tBulkPartial, { n: removed, f: res.failedIds.length }));
        } else if (res.deletedIds.length) {
          showUndo(fill(dict.tBulkDeleted, { n: removed }), () =>
            run(() => restoreConsoleTasks(res.deletedIds), { after: () => setUndo(null) }),
          );
        } else {
          showToast(fill(dict.tBulkDeleted, { n: removed }));
        }
        onDone?.();
      });
    },
    [dict, errMsg, run, showToast, showUndo],
  );

  const askBulkDelete = () => {
    const ids = [...picked];
    if (!ids.length) return;
    const hasShared = ids.some((id) => {
      const t = tasks.find((x) => x.id === id);
      return t ? !isMine(t, meId) : false;
    });
    setConfirm({
      message: `${fill(dict.confirmBulkMsg, { n: ids.length })}${
        hasShared ? `\n${dict.confirmBulkSharedNote}` : ""
      }`,
      confirmLabel: dict.confirmDeleteBtn,
      onConfirm: () => runBulkDelete(ids, exitSelMode),
    });
  };

  // ── OVERDUE BULK ────────────────────────────────────────────────────────────────────
  // 대상은 사용자가 고른 `odPicked` 뿐이고, 서버가 다시 "내가 만든 · 일회성 · 진짜 지연"만 남긴다
  // (`dismissConsoleOverdue`). 전부 내 작업이므로 실행 취소(복원)를 그대로 제공할 수 있다.
  const clearOverdue = () => {
    const ids = [...odPicked];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await dismissConsoleOverdue(ids);
      if (!res.ok) {
        showToast(errMsg(res.error));
        return;
      }
      setOdPicked(new Set());
      if (res.deletedIds.length > 0) {
        const restoreIds = res.deletedIds;
        showUndo(fill(dict.tBulkDeleted, { n: restoreIds.length }), () =>
          run(() => restoreConsoleTasks(restoreIds), { after: () => setUndo(null) }),
        );
      } else {
        showToast(dict.tDeleted);
      }
    });
  };

  // ── VIEWS ────────────────────────────────────────────────────────────────────────────
  // 목록 데이터는 화면과 상세 칸의 기본 선택(보기의 첫 작업)이 **같은 순서**를 보도록 함수로 뺀다.

  /**
   * 오늘/내일 목록 순서 — 일회성과 반복 회차가 **하나의 순서 공간**을 공유한다(2026-07-30 B안).
   * 드래그 직후에는 낙관적 순서(`dateOrder`)가 먼저다.
   */
  const orderDateItems = (arr: TaskRecord[], date: string): TaskRecord[] => {
    const ranked = sortByDateOrder(arr, date);
    const pendingIds = dateOrder && dateOrder.date === date ? dateOrder.ids : null;
    return pendingIds
      ? pendingIds
          .map((id) => ranked.find((t) => t.id === id))
          .filter((t): t is TaskRecord => !!t)
          .concat(ranked.filter((t) => !pendingIds.includes(t.id)))
      : ranked;
  };

  /** 오늘 완료한 내 작업 — 「완료」 묶음과 진행 고리가 같이 쓴다. 반복은 완료 로그에서만 보인다. */
  const doneTodayRows = (applyFilter: boolean) => {
    const ok = (t: TaskRecord) =>
      !applyFilter || (matchQuery(t, deferredQuery, nameOf) && matchPrio(t, prioFilter));
    const seen = new Set<string>();
    const rows: { t: TaskRecord; recurring: boolean }[] = [];
    for (const t of personalTasks) {
      if (!myOwn(t, meId) || t.status !== "completed" || completedDateOf(t) !== today) continue;
      if (isStandardRecurrence(t.recurrenceRule) || !ok(t)) continue;
      seen.add(t.id);
      rows.push({ t, recurring: false });
    }
    for (const r of data.completions) {
      if (r.day !== today || seen.has(r.taskId)) continue;
      const t = personalTasks.find((x) => x.id === r.taskId);
      if (!t || !myOwn(t, meId) || !isStandardRecurrence(t.recurrenceRule) || !ok(t)) continue;
      seen.add(t.id);
      rows.push({ t, recurring: true });
    }
    return rows;
  };

  const todayData = () => {
    const odOne = filtered(overdueList).sort((a, b) => dateSort(a, b) || prioSort(a, b));
    // 반복은 지연 섹션에 세우지 않는다(2026-09-08) — `recBehind` 로 오늘 줄의 「N일 밀림」이 된다.
    // 필터는 네 갈래(지연/오늘 일회성, 지연/오늘 반복) 모두 `filtered()` 로 통일한다(2026-07-31).
    const recBehind = new Map<string, number>(
      personalTasks
        .filter((t) => myOwn(t, meId) && isStandardRecurrence(t.recurrenceRule))
        .map((t) => [t.id, overdueOccurrenceDates(t, today, resolvedDatesFor(t.id)).length])
        .filter(([, days]) => (days as number) > 0) as [string, number][],
    );
    // 오늘 회차 — 일회성(today) + 반복. 반복은 **오늘 회차이거나 밀린 회차가 있으면** 뜬다(2026-09-08).
    const tdRec = filtered(
      personalTasks.filter(
        (t) => myOwn(t, meId) && showsOnTodayList(t, today, occState, resolvedDatesFor(t.id)),
      ),
    );
    const td = orderDateItems(
      [...filtered(personalTasks.filter((t) => isTodayTask(t, today) && myOwn(t, meId))), ...tdRec],
      today,
    );
    return { odOne, td, recBehind, doneRows: doneTodayRows(true) };
  };

  // 내일 — 일회성(내일 기준일) + 반복(내일 회차, 미완료). 반복은 occurrence 행으로 렌더.
  const tomorrowItems = () => {
    const tm = addDays(today, 1);
    // 오늘 뷰와 같은 이유로 반복 회차도 `filtered()`(검색·우선순위·**날짜**)를 통과시킨다.
    const rec = filtered(personalTasks.filter((t) => myOwn(t, meId) && openOccursOn(t, tm)));
    return orderDateItems(
      [...filtered(personalTasks.filter((t) => isTomorrowTask(t, today) && myOwn(t, meId))), ...rec],
      tm,
    );
  };

  const inboxItems = () => {
    // 관리함 = 프로젝트 밖 모든 활성 작업(날짜 무관). 수동 드래그 순서 허용(2026-07-30):
    // 랭크된(sort_order) 작업이 위, 미랭크는 만든 순서. 드래그 직후엔 낙관적 순서.
    const base = filtered(personalTasks.filter((t) => isActive(t) && myOwn(t, meId)));
    const ranked = base.slice().sort((a, b) => {
      const ao = a.sortOrder;
      const bo = b.sortOrder;
      // 날짜 목록과 같은 규칙 — 새 작업은 아래(추가 입력창 바로 위)에 붙는다(2026-09-09).
      if (ao != null && bo != null) return ao !== bo ? ao - bo : oldestFirst(a, b);
      if (ao != null) return -1;
      if (bo != null) return 1;
      return oldestFirst(a, b);
    });
    return inboxOrder
      ? inboxOrder
          .map((id) => ranked.find((t) => t.id === id))
          .filter((t): t is TaskRecord => !!t)
          .concat(ranked.filter((t) => !inboxOrder.includes(t.id)))
      : ranked;
  };

  const sharedLists = () => {
    const all = filtered(personalTasks.filter((t) => isActive(t) && plainShared(t, meId)));
    return {
      received: all.filter((t) => !isMine(t, meId)).sort((a, b) => prioSort(a, b) || dateSort(a, b)),
      sent: all.filter((t) => isMine(t, meId)).sort((a, b) => prioSort(a, b) || dateSort(a, b)),
    };
  };

  /** 드래그 재정렬 래퍼 — 관리함과 오늘/내일이 같은 HTML5 draggable 을 쓴다(조작 감각 통일). */
  const dragWrap = (t: TaskRecord, canDrag: boolean, onDropOn: (targetId: string) => void, row: ReactNode) => (
    <div
      key={t.id}
      className={`atw-drag ${dragId === t.id ? "is-drag" : ""} ${
        overId === t.id && dragId && dragId !== t.id ? "is-over" : ""
      }`}
      draggable={canDrag}
      onDragStart={canDrag ? () => setDragId(t.id) : undefined}
      onDragOver={
        canDrag
          ? (e) => {
              e.preventDefault();
              if (overId !== t.id) setOverId(t.id);
            }
          : undefined
      }
      onDrop={canDrag ? () => onDropOn(t.id) : undefined}
      onDragEnd={
        canDrag
          ? () => {
              setDragId(null);
              setOverId(null);
            }
          : undefined
      }
    >
      {row}
    </div>
  );

  /**
   * 오늘/내일 목록 렌더. 저장은 `reorderConsoleDateTasks` 가 일회성/반복으로 나눠 쓴다.
   * `items` 는 이미 `orderDateItems` 로 정렬돼 있다.
   */
  const renderDateList = (items: TaskRecord[], date: string, behind?: Map<string, number>) => {
    // 검색/필터 중엔 부분집합이라 재정렬 비활성(순서가 의미 없음) — 관리함과 같은 규칙.
    const canDrag = !hasActiveFilter && !selMode;
    const onRowDrop = (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null);
        setOverId(null);
        return;
      }
      const ids = items.map((t) => t.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      setDragId(null);
      setOverId(null);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      setDateOrder({ date, ids });
      run(() =>
        reorderConsoleDateTasks(
          date,
          ids.map((id) => ({
            taskId: id,
            recurring: isStandardRecurrence(items.find((t) => t.id === id)?.recurrenceRule ?? null),
          })),
        ),
      );
    };
    return items.map((t) =>
      dragWrap(
        t,
        canDrag,
        onRowDrop,
        isStandardRecurrence(t.recurrenceRule)
          ? renderRow(t, {
              hideDate: true,
              occurrence: { date, done: false },
              reorder: canDrag,
              behindDays: behind?.get(t.id),
            })
          : renderRow(t, { hideDate: true, reorder: canDrag }),
      ),
    );
  };

  const tokyoTime = (iso: string | null) => {
    if (!iso) return null;
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return null;
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(dt);
  };

  const todayView = () => {
    const { odOne, td, recBehind, doneRows } = todayData();
    /* 지연 일괄 처리 대상 — 서버가 "내가 만든 · 일회성 · 진짜 지연"만 처리하므로, 남의 공유
       작업은 애초에 담을 수 없게 한다(담아 봐야 서버가 조용히 버려 개수만 거짓이 된다). */
    const odOwnIds = odOne.filter((t) => isMine(t, meId)).map((t) => t.id);
    const odPicking = !selMode && odMode !== null;
    const odSelCount = odOwnIds.filter((id) => odPicked.has(id)).length;
    const odAllSel = odSelCount > 0 && odSelCount === odOwnIds.length;
    const toggleOd = (id: string) => {
      const next = new Set(odPicked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setOdPicked(next);
    };
    const startOd = (mode: "reschedule" | "delete") => {
      setOdMode(mode);
      setOdPicked(new Set(odOwnIds));
    };
    const cancelOd = () => {
      setOdMode(null);
      setOdPicked(new Set());
    };
    if (odOne.length === 0 && td.length === 0 && doneRows.length === 0 && !add)
      return hasActiveFilter ? (
        <EmptyState icon={<Search size={22} />} t={dict.emFilter} s={dict.emFilterS} />
      ) : (
        <EmptyState icon={<Sun size={22} />} t={dict.emToday} s={dict.emTodayS} ctx="today" />
      );
    const odActions =
      odOwnIds.length === 0 || selMode ? null : !odPicking ? (
        <>
          <button type="button" className="atw-tl" onClick={() => startOd("reschedule")}>
            {dict.w.reschedule}
          </button>
          <span className="atw-dotsep" aria-hidden="true">
            ·
          </span>
          <button type="button" className="atw-tl is-red" onClick={() => startOd("delete")}>
            {dict.overdueClear}
          </button>
        </>
      ) : (
        <>
          <span className="atw-sec__note num">{fill(dict.selSelected, { n: odSelCount })}</span>
          <button type="button" className="atw-tl is-muted" onClick={() => setOdPicked(odAllSel ? new Set() : new Set(odOwnIds))}>
            {odAllSel ? dict.selClear : dict.selAll}
          </button>
          <button type="button" className="atw-tl is-muted" onClick={cancelOd}>
            {dict.iaCancel}
          </button>
          {odMode === "reschedule" ? (
            <button
              type="button"
              className="atw-pillbtn"
              disabled={odSelCount === 0}
              onClick={(e) => {
                e.stopPropagation();
                setPop({
                  kind: "schedule",
                  src: "overdue",
                  taskId: null,
                  draft: { date: today, time: "", dur: null, repeat: "none" },
                  calMonth: today.slice(0, 7),
                  expand: null,
                  ...anchorFrom(e),
                });
              }}
            >
              {dict.w.odPickDate}
            </button>
          ) : (
            <button
              type="button"
              className="atw-pillbtn is-red"
              disabled={odSelCount === 0}
              onClick={() =>
                setConfirm({
                  message: fill(dict.confirmBulkMsg, { n: odSelCount }),
                  confirmLabel: dict.confirmDeleteBtn,
                  onConfirm: clearOverdue,
                })
              }
            >
              {dict.selDelete}
            </button>
          )}
        </>
      );
    return (
      <>
        {odOne.length > 0 &&
          Section({
            title: dict.secOverdue,
            n: odOne.length,
            mod: "over",
            actions: odActions,
            children: odOne.map((t) =>
              renderRow(
                t,
                odPicking && isMine(t, meId)
                  ? { pick: { on: odPicked.has(t.id), toggle: () => toggleOd(t.id) } }
                  : undefined,
              ),
            ),
          })}
        {Section({
          title: dict.secToday,
          n: td.length,
          children: (
            <>
              {renderDateList(td, today, recBehind)}
              {InlineAddSlot({ ctx: "today" })}
            </>
          ),
        })}
        {doneRows.length > 0 &&
          Section({
            title: dict.w.secDone,
            n: doneRows.length,
            mod: "done",
            children: doneRows.map(({ t, recurring }) =>
              renderRow(
                t,
                recurring
                  ? { hideDate: true, forceDone: true }
                  : { hideDate: true, right: tokyoTime(t.completedAt) },
              ),
            ),
          })}
      </>
    );
  };

  const tomorrowView = () => {
    const tm = addDays(today, 1);
    const items = tomorrowItems();
    if (items.length === 0 && !add)
      return hasActiveFilter ? (
        <EmptyState icon={<Search size={22} />} t={dict.emFilter} s={dict.emFilterS} />
      ) : (
        <EmptyState icon={<Sunrise size={22} />} t={dict.emTomorrow} s={dict.emTomorrowS} ctx="tomorrow" />
      );
    return (
      <div className="atw-rows">
        {renderDateList(items, tm)}
        {InlineAddSlot({ ctx: "tomorrow" })}
      </div>
    );
  };

  const inboxView = () => {
    const items = inboxItems();
    // 검색/필터 중엔 부분집합이라 재정렬 비활성(순서가 의미 없음).
    const canDrag = !hasActiveFilter && !selMode;
    const onRowDrop = (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null);
        setOverId(null);
        return;
      }
      const ids = items.map((t) => t.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      setDragId(null);
      setOverId(null);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      setInboxOrder(ids);
      run(() => reorderConsoleTasks(ids));
    };
    if (items.length === 0 && !add)
      return hasActiveFilter ? (
        <EmptyState icon={<Search size={22} />} t={dict.emFilter} s={dict.emFilterS} />
      ) : (
        <EmptyState icon={<Inbox size={22} />} t={dict.emInbox} s={dict.emInboxS} ctx="inbox" />
      );
    return (
      <div className="atw-rows">
        {items.map((t) => dragWrap(t, canDrag, onRowDrop, renderRow(t, { reorder: canDrag })))}
        {InlineAddSlot({ ctx: "inbox" })}
      </div>
    );
  };

  const sharedView = () => {
    const { received, sent } = sharedLists();
    if (received.length === 0 && sent.length === 0)
      return hasActiveFilter ? (
        <EmptyState icon={<Search size={22} />} t={dict.emFilter} s={dict.emFilterS} />
      ) : (
        <EmptyState icon={<Share2 size={22} />} t={dict.emShared} s={dict.emSharedS} />
      );
    return (
      <>
        {received.length > 0 &&
          Section({ title: dict.sharedRecvSec, n: received.length, children: received.map((t) => renderRow(t)) })}
        {sent.length > 0 &&
          Section({ title: dict.sharedSentSec, n: sent.length, children: sent.map((t) => renderRow(t)) })}
      </>
    );
  };

  // ── INSTR (지시) ─────────────────────────────────────────────────────────────────────
  /** 지시 줄의 메타 — 「김현준 → 나 · 오늘까지」(받은) / 「나 → 박서영 · 10/10까지 · 미확인」(보낸). */
  const dirMeta = (t: TaskRecord, side: "recv" | "sent"): ReactNode[] => {
    const out: ReactNode[] = [];
    const done = t.status === "completed";
    if (!done && (t.priority === "urgent" || t.priority === "important")) out.push(prioWord(t.priority));
    const to =
      side === "recv"
        ? dict.dpMe
        : partsOf(t)
            .map((id) => nameOf(id))
            .join(", ");
    out.push(fill(dict.w.fromTo, { from: side === "recv" ? nameOf(t.createdByUserId) : dict.dpMe, to }));
    const d = dateOf(t);
    if (!done) out.push(d ? fill(dict.w.dueBy, { date: d === today ? dict.today : md(d) }) : dict.noDate);
    const trng = timeRange(t.timeLabel, t.durationMinutes);
    if (trng && !done) out.push(trng);
    if (side === "sent" && t.status === "open") out.push(dict.instrUnconfirmed);
    if (side === "recv") {
      const others = partsOf(t).filter((id) => id !== meId);
      if (others.length > 0) out.push(fill(dict.instrCommon, { n: others.length + 1 }));
    }
    if (t.imageUrls.length) out.push(fill(dict.w.photoN, { n: t.imageUrls.length }));
    return out;
  };
  const doneDay = (t: TaskRecord) => {
    const cd = completedDateOf(t);
    return cd ? md(cd) : null;
  };

  const sentView = () => {
    const all = filtered(personalTasks.filter((t) => sentInstr(t, meId)));
    if (all.length === 0)
      return (
        <>
          {hasActiveFilter ? (
            <EmptyState icon={<Search size={22} />} t={dict.emFilter} s={dict.emFilterS} />
          ) : (
            <EmptyState icon={<Megaphone size={22} />} t={dict.instrEmptySentT} s={dict.instrEmptySentS} />
          )}
          {!hasActiveFilter && InlineAddSlot({ ctx: "instr", label: dict.iaSendInstrCta })}
        </>
      );
    const openT = all.filter((t) => t.status === "open").sort((a, b) => dateSort(a, b) || prioSort(a, b));
    const progT = all.filter((t) => t.status === "in_progress").sort((a, b) => dateSort(a, b) || prioSort(a, b));
    const doneT = all
      .filter((t) => t.status === "completed")
      .sort((a, b) => (completedDateOf(b) ?? "").localeCompare(completedDateOf(a) ?? ""));
    // 보낸 지시는 대상자의 일이다 — 고리는 상태 표시일 뿐 내가 누르지 않는다(예전 콘솔과 같은 경계).
    const row = (t: TaskRecord) =>
      renderRow(t, { meta: dirMeta(t, "sent"), staticRing: true, right: t.status === "completed" ? doneDay(t) : undefined });
    const sec = (title: string, list: TaskRecord[]) =>
      list.length > 0 ? Section({ title, n: list.length, children: list.map(row) }) : null;
    return (
      <>
        {sec(dict.instrSecUnconfirmed, openT)}
        {sec(dict.instrSecInProgress, progT)}
        {sec(dict.instrSecCompleted, doneT)}
        {InlineAddSlot({ ctx: "instr", label: dict.iaSendInstrCta })}
      </>
    );
  };

  const recvView = () => {
    const all = filtered(personalTasks.filter((t) => recvInstr(t, meId)));
    if (all.length === 0)
      return hasActiveFilter ? (
        <EmptyState icon={<Search size={22} />} t={dict.emFilter} s={dict.emFilterS} />
      ) : (
        <EmptyState icon={<Bell size={22} />} t={dict.instrEmptyRecvT} s={dict.instrEmptyRecvS} />
      );
    const od = all.filter((t) => isOverdue(t, today));
    const openT = all
      .filter((t) => t.status === "open" && !isOverdue(t, today))
      .sort((a, b) => dateSort(a, b) || prioSort(a, b));
    const progT = all
      .filter((t) => t.status === "in_progress" && !isOverdue(t, today))
      .sort((a, b) => dateSort(a, b) || prioSort(a, b));
    const doneT = all
      .filter((t) => t.status === "completed")
      .sort((a, b) => (completedDateOf(b) ?? "").localeCompare(completedDateOf(a) ?? ""));
    const row = (t: TaskRecord) =>
      renderRow(t, { meta: dirMeta(t, "recv"), right: t.status === "completed" ? doneDay(t) : undefined });
    const sec = (title: string, list: TaskRecord[], mod?: string) =>
      list.length > 0 ? Section({ title, n: list.length, mod, children: list.map(row) }) : null;
    return (
      <>
        {sec(dict.stOverdue, od, "over")}
        {sec(dict.instrSecTodo, openT)}
        {sec(dict.instrSecInProgress, progT)}
        {sec(dict.instrSecCompleted, doneT, "done")}
      </>
    );
  };

  const instrView = () => (
    <>
      <div className="atw-seg" role="tablist" aria-label={dict.vInstr}>
        <button
          type="button"
          role="tab"
          aria-selected={instrTab === "recv"}
          className={instrTab === "recv" ? "on" : ""}
          onClick={() => setInstrTab("recv")}
        >
          {dict.instrRecv}
          <b className="num">{recvOpen}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={instrTab === "sent"}
          className={instrTab === "sent" ? "on" : ""}
          onClick={() => setInstrTab("sent")}
        >
          {dict.instrSent}
          <b className="num">{sentOpen}</b>
        </button>
      </div>
      <div className="atw-fade" key={instrTab}>
        {instrTab === "sent" ? sentView() : recvView()}
      </div>
    </>
  );

  // ── COMPLETED ────────────────────────────────────────────────────────────────────────
  /** 완료·기록 = task_updates 완료 로그(net) 기준 — 보고서(같은 소스)와 목록이 일치한다. */
  const completedRows = () => {
    type CmpRow = { task: TaskRecord; day: string; byUserId: string | null };
    const rows: CmpRow[] = [];
    for (const r of data.completions) {
      const task = tasks.find((t) => t.id === r.taskId);
      if (!task) continue;
      // 내가 **보낸** 지시를 대상자가 완료한 것은 내 기록이 아니다(2026-09-09) — 진행 상황은 「지시 ›
      // 보낸 지시」에서 본다. 내가 직접 완료한 경우는 남긴다 — 그건 내가 한 일이다.
      if (sentInstr(task, meId) && r.byUserId !== meId) continue;
      if (!(matchQuery(task, deferredQuery, nameOf) && matchPrio(task, prioFilter))) continue;
      rows.push({ task, day: r.day, byUserId: r.byUserId });
    }
    return rows;
  };
  const completedView = () => {
    // 검색/우선순위 필터만 적용(날짜는 완료일 그룹 자체가 담당).
    const rows = completedRows();
    // 현장 활동(청소·유지보수·린넨·주문에서 본인이 완료 처리한 것). 투두가 아니라 작업 속성이
    // 없으므로 검색·우선순위 필터가 걸려 있으면 감춘다 — 남겨 두면 필터가 안 먹는 것처럼 보인다.
    const fieldVisible = deferredQuery.trim() || prioFilter ? [] : data.fieldActivities;
    if (rows.length === 0 && fieldVisible.length === 0)
      return <EmptyState icon={<CheckCircle2 size={22} />} t={dict.emCompleted} s={dict.emCompletedS} />;
    const byDay = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!byDay.has(row.day)) byDay.set(row.day, []);
      byDay.get(row.day)!.push(row);
    }
    const fieldByDay = new Map<string, FieldActivityRecord[]>();
    for (const activity of fieldVisible) {
      if (!fieldByDay.has(activity.day)) fieldByDay.set(activity.day, []);
      fieldByDay.get(activity.day)!.push(activity);
    }
    // 날짜 그룹은 두 소스의 합집합 — 그날 투두 완료가 없고 청소만 했어도 그룹이 생겨야 한다.
    const days = Array.from(new Set([...byDay.keys(), ...fieldByDay.keys()])).sort((a, b) =>
      b.localeCompare(a),
    );
    return (
      <>
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const fieldList = fieldByDay.get(day) ?? [];
          const dlabel =
            day === today
              ? `${dict.cmpToday} · ${fmtLong(day, locale)}`
              : day === addDays(today, -1)
                ? `${dict.cmpYesterday} · ${fmtLong(day, locale)}`
                : fmtLong(day, locale);
          return (
            <section key={day} className="atw-sec">
              <div className="atw-sec__h">
                <b>{dlabel}</b>
                <span className="num">{fill(dict.w.dayCount, { n: list.length + fieldList.length })}</span>
                <span className="atw-sec__acts">
                  {reportTag(day)}
                  <button type="button" className="atw-tl" onClick={() => openReport(day)}>
                    {dict.w.report}
                  </button>
                </span>
              </div>
              <div className="atw-rows">
                {list.map(({ task, byUserId }) =>
                  renderRow(task, {
                    hideDate: true,
                    forceDone: true,
                    extraByLabel:
                      byUserId && byUserId !== meId ? fill(dict.cmpBy, { name: nameOf(byUserId) }) : undefined,
                    right: completedDateOf(task) === day ? tokyoTime(task.completedAt) : undefined,
                  }),
                )}
                {/* 현장 활동 — 읽기 전용. 되돌리기·완료 토글을 붙이지 않는다: 원본은 청소·유지보수
                    화면에 있고, 여기서 되돌릴 수 있게 하면 어느 쪽이 진짜인지 두 화면이 다툰다. */}
                {fieldList.map((activity, i) => (
                  <div className="atw-field" key={`${day}|${activity.kind}|${i}`}>
                    <span className="atw-field__ic" aria-hidden="true">
                      {dict.w.fieldBadge}
                    </span>
                    <span className="atw-row__b">
                      <span className="atw-row__t">{activity.label}</span>
                      <span className="atw-row__m">{dict.w.fieldSub}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </>
    );
  };

  // ── CALENDAR ─────────────────────────────────────────────────────────────────────────
  // 월요일 시작(시안 TodoCal-PC). 칸은 남은 높이를 다 채운다(5~6줄).
  const calendarView = () => {
    const [y, m] = calMonth.split("-").map(Number);
    const pad = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const iso = (dd: number) => `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const monthStart = iso(1);
    const monthEnd = iso(days);
    // Todoist 가상 미리보기: 반복 작업은 단일 행이지만 규칙으로 이달의 모든 회차를 계산해 각 날짜 칸에
    // 표시(추가 행 없음). 비반복은 앵커 하루만. 앵커=dateOf(마감 or 예정) — 모바일 캘린더와 동일 정의.
    const occ = new Map<string, TaskRecord[]>();
    for (const t of personalTasks) {
      if (!(isActive(t) && myOwn(t, meId))) continue;
      const a = dateOf(t);
      if (!a) continue;
      if (isStandardRecurrence(t.recurrenceRule)) {
        if (hideRecurring) continue; // "반복 숨기기": 고정 반복 회차 제외.
        for (const dstr of recurringOccurrencesInRange(t.recurrenceRule, a, monthStart, monthEnd)) {
          if (!occ.has(dstr)) occ.set(dstr, []);
          occ.get(dstr)!.push(t);
        }
      } else if (a >= monthStart && a <= monthEnd) {
        if (!occ.has(a)) occ.set(a, []);
        occ.get(a)!.push(t);
      }
    }
    const tasksOn = (dstr: string) =>
      (occ.get(dstr) ?? [])
        .slice()
        .sort((a, b) => {
          const byTime = (a.timeLabel ?? "99").localeCompare(b.timeLabel ?? "99");
          return byTime !== 0 ? byTime : prioSort(a, b);
        });
    const tag = locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
    // 2024-01-08 은 월요일 — 월~일 머리글.
    const wdHead = Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 8 + i))),
    );
    const rows = Math.ceil((pad + days) / 7);
    const cells: ReactNode[] = [];
    for (let i = 0; i < pad; i++) cells.push(<div key={`p${i}`} className={`atw-cc is-pad ${i >= 5 ? "is-wkend" : ""}`} />);
    for (let dd = 1; dd <= days; dd++) {
      const dstr = iso(dd);
      const wd = weekdayIndex(dstr);
      const ev = tasksOn(dstr);
      cells.push(
        <div
          key={dstr}
          role="button"
          tabIndex={0}
          aria-pressed={calDay === dstr}
          className={`atw-cc ${wd === 0 || wd === 6 ? "is-wkend" : ""} ${dstr === today ? "is-today" : ""} ${
            calDay === dstr ? "is-sel" : ""
          }`}
          onClick={() => {
            setCalDay(dstr);
            setSel(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCalDay(dstr);
              setSel(null);
            }
          }}
        >
          <span className={`atw-cc__d num ${wd === 0 ? "is-sun" : wd === 6 ? "is-sat" : ""}`}>{dd}</span>
          {ev.slice(0, 3).map((t) => {
            const tone =
              isOverdue(t, today) || t.priority === "urgent" ? "is-red" : isSharedTask(t) ? "is-shared" : "";
            return (
              <span
                key={t.id}
                className={`atw-cev ${tone}`}
                title={t.title}
                onClick={(e) => {
                  e.stopPropagation();
                  setCalDay(dstr);
                  openTask(t.id, dstr <= today ? dstr : undefined);
                }}
              >
                {t.title}
              </span>
            );
          })}
          {ev.length > 3 && <span className="atw-cc__more num">{fill(dict.w.calMore, { n: ev.length - 3 })}</span>}
        </div>,
      );
    }
    const tail = rows * 7 - pad - days;
    for (let i = 0; i < tail; i++) {
      const col = (pad + days + i) % 7;
      cells.push(<div key={`t${i}`} className={`atw-cc is-pad ${col >= 5 ? "is-wkend" : ""}`} />);
    }
    const shiftMonth = (delta: number) => setCalMonth(shiftMonthKey(calMonth, delta));
    return (
      <div className="atw-cal">
        <div className="atw-cal__top">
          <button type="button" className="atw-icon is-sm" onClick={() => shiftMonth(-1)} aria-label={dict.calPreviousMonth}>
            <ChevronLeft size={17} />
          </button>
          <b className="atw-cal__m num">{fmtMonthTitle(y, m, locale)}</b>
          <button type="button" className="atw-icon is-sm" onClick={() => shiftMonth(1)} aria-label={dict.calNextMonth}>
            <ChevronRight size={17} />
          </button>
          {calMonth !== today.slice(0, 7) && (
            <button
              type="button"
              className="atw-tl"
              onClick={() => {
                setCalMonth(today.slice(0, 7));
                setCalDay(today);
              }}
            >
              {dict.calThisMonth}
            </button>
          )}
          <span className="atw-cal__lg">
            <span>
              <i className="is-amber" />
              {dict.calLegendPersonal}
            </span>
            <span>
              <i className="is-violet" />
              {dict.calLegendShared}
            </span>
            <span>
              <i className="is-red" />
              {dict.calLegendUrgent}
            </span>
          </span>
          <span className="atw-swrow">
            {dict.calHideRepeat}
            <button
              type="button"
              role="switch"
              aria-checked={hideRecurring}
              aria-label={dict.calHideRepeat}
              className={`atw-sw ${hideRecurring ? "on" : ""}`}
              onClick={() => setHideRecurring((v) => !v)}
            >
              <i />
            </button>
          </span>
        </div>
        <div className="atw-cal__grid" style={{ "--rows": String(rows) } as React.CSSProperties}>
          {wdHead.map((w, i) => (
            <span key={i} className={`atw-cal__wd ${i >= 5 ? "is-wkend" : ""} ${i === 5 ? "is-sat" : i === 6 ? "is-sun" : ""}`}>
              {w}
            </span>
          ))}
          {cells}
        </div>
      </div>
    );
  };

  /** 캘린더 오른쪽 칸 — 고른 날짜의 작업 + 「이 날짜에 작업 추가」(예전 날짜 시트 모달을 대신한다). */
  const calendarSide = () => {
    const iso = calDay;
    // 미래 날짜면 **미리보기**다 — 아직 할 수 없는 일을 완료 처리할 수 없게 한다(2026-09-09).
    const isFutureDay = iso > today;
    const list = personalTasks
      .filter(
        (t) =>
          isActive(t) &&
          myOwn(t, meId) &&
          occursOn(t, iso) &&
          !(hideRecurring && isStandardRecurrence(t.recurrenceRule)),
      )
      .sort(prioSort);
    return (
      <aside className="atw-side is-day" aria-label={fmtLong(iso, locale)} onClick={(e) => e.stopPropagation()}>
        <div className="atw-fade" key={iso}>
          <div className="atw-sec__h">
            <b>{iso === today ? fill(dict.w.dayToday, { date: fmtLong(iso, locale) }) : fmtLong(iso, locale)}</b>
            <span className="num">{fill(dict.w.dayCount, { n: list.length })}</span>
          </div>
          <div className="atw-rows">
            {list.map((t) =>
              renderRow(
                t,
                // 반복은 **그 날짜 회차**로 완료한다 — 회차 없이 부르면 서버가 시리즈 앵커로 폴백한다.
                isStandardRecurrence(t.recurrenceRule) && !isFutureDay
                  ? { hideDate: true, occurrence: { date: iso, done: !!occState(t.id, iso) } }
                  : { hideDate: true, previewOnly: isFutureDay },
              ),
            )}
            {list.length === 0 && <p className="atw-soft atw-side__none">{dict.calDayEmpty}</p>}
            {InlineAddSlot({ ctx: "day", label: dict.calAddOnDay })}
          </div>
        </div>
      </aside>
    );
  };

  // ── PROJECT ───────────────────────────────────────────────────────────────────────────
  const projectInfo = () => {
    const summary = projectId ? projById.get(projectId) : null;
    if (!summary) return null;
    // summary.members 는 owner(=createdByUserId) 행을 이미 포함한다 — Set 으로 합쳐 dedup(멤버 4명 버그).
    const memberIds = Array.from(new Set([summary.createdByUserId, ...summary.members.map((mem) => mem.userId)]));
    const canManage = summary.viewerRole === "owner" || summary.createdByUserId === meId;
    const pd = projectDetail && projectDetail.id === projectId ? projectDetail : null;
    const sections =
      pd?.sections && pd.sections.length > 0 ? pd.sections : [{ id: "__default", title: dict.dpTask, sortOrder: 0 }];
    const projTasks = filtered(tasks.filter((t) => t.projectId === projectId && isActive(t)));
    return { summary, memberIds, canManage, sections, projTasks, hasRealSections: !!pd?.sections?.length };
  };

  const projectView = () => {
    const info = projectInfo();
    if (!info) return null;
    const { summary, canManage, sections, projTasks } = info;
    if (projTasks.length === 0 && !hasActiveFilter && !(add && add.ctx === "project") && !info.hasRealSections) {
      return <EmptyState icon={<Hash size={22} />} t={dict.pjEmptyT} s={dict.pjEmptyS} ctx="project" />;
    }
    return (
      <>
        {sections.map((sec) => {
          const list = projTasks.filter((t) => (t.sectionId ?? "__default") === sec.id).sort(prioSort);
          return (
            <section key={sec.id} className="atw-sec">
              <div className="atw-sec__h">
                {sectionEdit?.id === sec.id ? (
                  <input
                    className="atw-sec__input"
                    value={sectionEdit.title}
                    autoFocus
                    onChange={(e) => setSectionEdit({ ...sectionEdit, title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveSectionRename(summary.id, sectionEdit);
                      else if (e.key === "Escape") setSectionEdit(null);
                    }}
                    onBlur={() => saveSectionRename(summary.id, sectionEdit)}
                  />
                ) : (
                  <b>{sec.title}</b>
                )}
                <span className="num">{list.length}</span>
                {/* `__default` 는 섹션이 없는 프로젝트의 가상 그룹이라 실제 행이 없다 — 이름 변경·
                    삭제 대상이 될 수 없다. */}
                {canManage && sec.id !== "__default" && !sectionEdit && (
                  <span className="atw-sec__acts is-hover">
                    <button
                      type="button"
                      className="atw-icon is-xs"
                      title={dict.pjSectionRename}
                      aria-label={dict.pjSectionRename}
                      onClick={() => setSectionEdit({ id: sec.id, title: sec.title })}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="atw-icon is-xs is-red"
                      title={dict.pjSectionDelete}
                      aria-label={dict.pjSectionDelete}
                      onClick={() =>
                        setConfirm({
                          message: fill(dict.pjSectionDeleteMsg, { title: sec.title }),
                          confirmLabel: dict.confirmDeleteBtn,
                          onConfirm: () =>
                            run(() => deleteConsoleProjectSection(summary.id, sec.id), {
                              toast: dict.tDeleted,
                            }),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                )}
              </div>
              <div className="atw-rows">
                {list.map((t) => renderRow(t))}
                {InlineAddSlot({ ctx: "project", sectionId: sec.id })}
              </div>
            </section>
          );
        })}
        {canManage &&
          (secAdding ? (
            <div className="atw-secadd">
              <input
                className="atw-sec__input"
                placeholder={dict.pjSectionNamePh}
                value={newSection}
                autoFocus
                onChange={(e) => setNewSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addSection(summary.id);
                  else if (e.key === "Escape") setSecAdding(false);
                }}
              />
              <button type="button" className="atw-btn is-ghost" onClick={() => setSecAdding(false)}>
                {dict.iaCancel}
              </button>
              <button
                type="button"
                className="atw-btn is-pri"
                disabled={!newSection.trim() || pending}
                onClick={() => addSection(summary.id)}
              >
                {dict.w.sectionAdd}
              </button>
            </div>
          ) : (
            <button type="button" className="atw-addrow is-sec" onClick={() => setSecAdding(true)}>
              <Plus size={16} strokeWidth={2.2} />
              {dict.w.sectionAdd}
            </button>
          ))}
      </>
    );
  };

  // ── report ────────────────────────────────────────────────────────────────────────────────
  const openReport = (date: string) => {
    setReport({ date, text: "", loading: true, sending: false, error: null });
    setReportEdited("");
    setReportItems([]);
    setReportTemplate(null);
    setReportPicked([]);
    setReportBuilt("");
    setRptSched(null);
    setRptSchedText(null);
    setRptWhen(null);
    setRptWhenOpen(false);
    setRptMsg(null);
    setRptNowMin(tokyoNowMinutes());
    Promise.all([generateConsoleReport(date), getReportSchedule(date)]).then(([res, sched]) => {
      setRptSched(sched);
      // 예약해 둔 것이 있으면 그 본문 · 시각을 보여 준다 — 그게 그 시각에 나간다(모바일과 같음).
      const scheduled = sched?.status === "scheduled" ? sched : null;
      setRptSchedText(scheduled?.body ?? null);
      setRptWhen(scheduled ? tokyoHHMM(scheduled.sendAt) : null);
      if (res.ok) {
        setReport({ date, text: res.text, loading: false, sending: false, error: null });
        setReportEdited(scheduled?.body ?? res.text);
        setReportBuilt(res.text);
        setReportItems(res.items);
        setReportTemplate(res.template);
        setReportPicked(res.items.map(() => true)); // 기본은 전체 포함 — 빼는 쪽이 예외다.
      } else {
        setReport({ date, text: "", loading: false, sending: false, error: res.reason });
      }
    });
  };

  /** 체크된 항목만으로 본문을 다시 조립한다(번호·합계도 다시 매겨진다). */
  const applyReportPick = (next: boolean[]) => {
    const chosen = reportItems.filter((_, i) => next[i]);
    const nextText =
      reportTemplate && chosen.length ? buildDailyReportText(reportTemplate, chosen) : "";
    setReportPicked(next);
    setReportEdited(nextText);
    setReportBuilt(nextText);
  };
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportEdited);
      showToast(dict.rptCopied);
    } catch {
      showToast(dict.errGeneric);
    }
  };
  const sendReportToSlack = () => {
    if (!report || report.loading || report.error || report.sending) return;
    const { date } = report;
    setReport({ ...report, sending: true });
    sendConsoleReportToSlack(date, reportEdited).then((res) => {
      setReport((current) => (current && current.date === date ? { ...current, sending: false } : current));
      if (res.ok) {
        showToast(dict.rptSlackSent);
      } else if (res.reason === "not_configured") {
        showToast(dict.rptSlackNotConfigured);
      } else if (res.reason === "too_long") {
        showToast(dict.rptSlackTooLong);
      } else {
        showToast(dict.rptSlackError);
      }
    });
  };

  // 「완료 · 기록」을 볼 때(업무일지 창을 닫은 뒤에도) 날짜 줄 예약 상태를 다시 읽는다.
  const reportDaysKey = Array.from(new Set([...data.completions.map((r) => r.day), ...data.fieldActivities.map((a) => a.day)]))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 62)
    .join(",");
  const reportOpen = report !== null;
  useEffect(() => {
    if (view !== "completed" || reportOpen || !reportDaysKey) return;
    let alive = true;
    void listReportSchedules(reportDaysKey.split(",")).then((map) => {
      if (alive) setReportSchedules(map);
    });
    return () => {
      alive = false;
    };
  }, [view, reportOpen, reportDaysKey]);
  const reportTag = (day: string) => {
    const sched = reportSchedules[day];
    if (!sched) return null;
    const time = tokyoHHMM(sched.status === "sent" ? sched.sentAt ?? sched.sendAt : sched.sendAt);
    if (sched.status === "scheduled" || sched.status === "sending")
      return <span className="atw-rtag is-on">{fill(dict.rptListScheduled, { time })}</span>;
    if (sched.status === "sent") return <span className="atw-rtag">{fill(dict.rptListSent, { time })}</span>;
    if (sched.status === "failed") return <span className="atw-rtag is-bad">{dict.rptListFailed}</span>;
    return null;
  };

  // ── report: 예약 보내기 ────────────────────────────────────────────────────────────────
  const rptActive = rptSched?.status === "scheduled";
  const rptActiveTime = rptActive && rptSched ? tokyoHHMM(rptSched.sendAt) : null;
  const rptChanged = rptActive && (reportEdited !== rptSchedText || rptWhen !== rptActiveTime);
  const rptInvalid = rptWhen !== null && !slotOpen(rptWhen, rptNowMin);
  const rptDur = (minutes: number) => durationLabel(minutes, { hm: dict.rptDurHM, h: dict.rptDurH, m: dict.rptDurM });
  const rptPickTime = (next: string | null) => {
    setRptWhen(next);
    setRptMsg(null);
  };
  const rptFailText = (reason: string) =>
    reason === "past" || reason === "too_far"
      ? dict.rptSchedulePast
      : reason === "busy"
        ? dict.rptScheduleBusy
        : reason === "forbidden"
          ? dict.errForbidden
          : reason === "empty"
            ? dict.emCompleted
            : reason === "too_long"
              ? dict.rptSlackTooLong
              : reason === "not_configured"
                ? dict.rptSlackNotConfigured
                : dict.rptSlackError;
  /** `at` — 시각 칸에서 Enter 로 확정한 값(상태가 아직 안 바뀐 순간이라 직접 받는다). */
  const scheduleReport = async (at?: string) => {
    const time = at ?? rptWhen;
    if (!report || !time) return;
    const { date } = report;
    const now = tokyoNowMinutes();
    setRptNowMin(now);
    if (!slotOpen(time, now)) {
      setRptWhenOpen(true); // 칸 아래 이유 줄을 보여 준다.
      return;
    }
    setRptSchedBusy(true);
    setRptMsg(null);
    const res = await scheduleDailyReport(date, reportEdited, tokyoTodayIso(time));
    setRptSchedBusy(false);
    if (res.ok) {
      haptic("success");
      setRptSched(res.schedule);
      setRptSchedText(reportEdited);
      setRptWhen(time);
      setRptWhenOpen(false);
      setReportSchedules((m) => ({ ...m, [date]: res.schedule }));
      showToast(fill(dict.rptScheduledToast, { time }));
      return;
    }
    haptic("error");
    setRptMsg({ tone: "bad", text: rptFailText(res.reason) });
  };
  /**
   * 예약 취소 — 확인 창 없이 바로, 대신 토스트 「되돌리기」가 같은 본문 · 시각으로 다시 예약한다(2026-10-20 2차 시안 ⑦,
   * 「꾹 확정은 드문 결정만」 규칙). 그 사이 시각이 지났으면 서버가 막고 창 안 한 줄로 이유를 보여 준다.
   */
  const cancelReportSchedule = async () => {
    if (!report) return;
    const { date } = report;
    const undoTime = rptActiveTime;
    const undoBody = rptSchedText;
    setRptSchedBusy(true);
    const res = await cancelDailyReportSchedule(date);
    setRptSchedBusy(false);
    if (!res.ok) {
      setRptMsg({ tone: "bad", text: dict.rptSlackError });
      return;
    }
    setRptSched(null);
    setRptSchedText(null);
    setRptWhen(null);
    setRptWhenOpen(false);
    setRptMsg(null);
    setReportSchedules((m) => {
      const next = { ...m };
      delete next[date];
      return next;
    });
    if (!undoTime || !undoBody) {
      showToast(dict.rptScheduleCancelled);
      return;
    }
    showUndo(fill(dict.rptScheduleCancelledAt, { time: undoTime }), () => {
      void scheduleDailyReport(date, undoBody, tokyoTodayIso(undoTime)).then((again) => {
        if (!again.ok) {
          showToast(rptFailText(again.reason));
          return;
        }
        setReportSchedules((m) => ({ ...m, [date]: again.schedule }));
        // 창이 아직 그 날짜로 열려 있으면 예약됨 상태로 되돌린다.
        if (reportDateRef.current === date) {
          setRptSched(again.schedule);
          setRptSchedText(undoBody);
          setRptWhen(undoTime);
          setReportEdited(undoBody);
        }
      });
    });
  };
  /** 큰 버튼 하나가 고른 시각을 따른다 — 지금 바로면 지금 보내기(예약이 있었으면 취소하고), 시각이면 예약. */
  const reportPrimary = async () => {
    if (rptWhen) {
      await scheduleReport();
      return;
    }
    if (rptActive && report) {
      const cancelled = await cancelDailyReportSchedule(report.date);
      if (!cancelled.ok) {
        setRptMsg({ tone: "bad", text: dict.rptSlackError });
        return;
      }
      setRptSched(null);
      setRptSchedText(null);
      setReportSchedules((m) => {
        const next = { ...m };
        delete next[report.date];
        return next;
      });
    }
    sendReportToSlack();
  };
  useEffect(() => {
    reportDateRef.current = report?.date ?? null;
  }, [report?.date]);
  // 고르는 동안 · 예약해 둔 동안 「지금」이 흘러간다 — 지난 시각 판정 · 30분 뒤 · 남은 시간이 맞게 30초마다 다시 잰다.
  useEffect(() => {
    if (!report || (!rptWhenOpen && rptSched?.status !== "scheduled")) return;
    const id = setInterval(() => setRptNowMin(tokyoNowMinutes()), 30_000);
    return () => clearInterval(id);
  }, [report, rptWhenOpen, rptSched?.status]);

  // ── note send ────────────────────────────────────────────────────────────────────────────
  const sendNote = () => {
    // 사진만 있고 본문이 비어도 보낼 수 있다(서버도 같은 규칙).
    if (!activeId || (!noteDraft.trim() && notePhotos.length === 0)) return;
    const id = activeId;
    const body = noteDraft;
    const photos = notePhotos;
    run(
      async () => {
        // 노트 사진은 `task-update-images/` 경로 — 작업 레벨 사진과 폴더를 나눠 서로의 정리
        // 로직에 걸리지 않게 한다(모바일과 동일).
        const imageUrls = photos.length
          ? await uploadPendingTaskUpdatePhotos({ pending: photos, organizationId, taskId: id })
          : [];
        return addConsoleNote(id, body, imageUrls);
      },
      {
        toast: dict.tNoteAdded,
        after: () => {
          setNoteDraft("");
          setNotePhotos([]);
          getConsoleTaskDetail(id).then((res) => {
            if (res.ok) setDetail(res.task);
          });
        },
      },
    );
  };

  /**
   * 상세 칸 「사진 추가」(2026-10-15) — 편집 모드를 거치지 않고 바로 붙인다. 업로드 계약은 편집 저장과
   * 같다: 클라이언트 압축 → `task-images/` 업로드 → `updateConsoleTaskCore` 에 **전체 집합**을 넘긴다
   * (기존 사진 + 새 사진이라 지워지는 건 없다). 작성자 전용이고 상한(5 / 프로젝트 20)은 서버도 다시 건다.
   */
  const addDetailPhotos = (t: TaskRecord, files: File[]) => {
    if (files.length === 0 || photoBusy) return;
    const max = t.projectId ? 20 : 5;
    const allowed = ["image/gif", "image/jpeg", "image/png", "image/webp"];
    if (files.some((f) => !allowed.includes(f.type))) return showToast(dict.phInvalidType);
    if (files.some((f) => f.size > 8 * 1024 * 1024)) return showToast(fill(dict.phTooLarge, { max: 8 }));
    if (t.imageUrls.length + files.length > max) return showToast(fill(dict.phTooMany, { max }));
    setPhotoBusy(t.id);
    // try 안에 조건식(??)을 두면 React Compiler 가 콘솔 전체를 건너뛴다 — 본문은 밖에서 만든다.
    const core = {
      taskId: t.id,
      title: t.title,
      desc: t.description ?? "",
      tags: t.tags,
      date: dueDateOf(t) ?? t.scheduledDate ?? "",
      time: t.timeLabel ?? "",
      durationMinutes: t.durationMinutes,
      repeat: t.recurrenceRule ?? "none",
      priority: t.priority,
    };
    run(
      async () => {
        try {
          const pendingItems: PreviewItem[] = await Promise.all(
            files.map(async (file) => ({
              id: `${Date.now()}-${Math.random()}`,
              file: await compressImageFile(file),
              previewUrl: "",
            })),
          );
          const uploaded = await uploadPendingTaskPhotos({ pending: pendingItems, organizationId, taskId: t.id });
          return updateConsoleTaskCore({ ...core, imageUrls: [...t.imageUrls, ...uploaded] });
        } catch {
          return { ok: false, error: "save_failed" } as TaskActionResult;
        }
      },
      { toast: dict.tUpdated, after: () => setPhotoBusy(null), onError: () => setPhotoBusy(null) },
    );
  };

  // ── 상세 칸: 무엇을 보여 줄지 ─────────────────────────────────────────────────────────────
  // 목록 보기(오늘·내일·관리함·공유함)는 고른 게 없으면 **보기의 첫 작업**을 보여 준다(시안 Todo-PC).
  // 완료·기록 · 지시 · 프로젝트는 줄을 눌렀을 때만 칸이 열리고, 캘린더는 그날 목록이 그 자리를 쓴다.
  const listView =
    !projectId && (view === "today" || view === "tomorrow" || view === "inbox" || view === "shared");
  const firstIdOfView = (): string | null => {
    if (view === "today") {
      const { odOne, td } = todayData();
      return odOne[0]?.id ?? td[0]?.id ?? null;
    }
    if (view === "tomorrow") return tomorrowItems()[0]?.id ?? null;
    if (view === "inbox") return inboxItems()[0]?.id ?? null;
    const { received, sent } = sharedLists();
    return received[0]?.id ?? sent[0]?.id ?? null;
  };
  const defaultId = listView && !detailClosed && !selMode ? firstIdOfView() : null;
  const activeId = sel ?? defaultId;
  // 기본 선택(오늘 · 내일의 첫 줄)은 그 목록의 날짜가 회차다 — 줄을 눌러 연 것과 같게.
  const activeOcc = sel
    ? selOcc
    : view === "today"
      ? today
      : view === "tomorrow"
        ? addDays(today, 1)
        : null;

  // 상세(업데이트 로그 + 연결 정보) 불러오기. 서버 갱신(`data`)마다 다시 읽는다.
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    getConsoleTaskDetail(activeId).then((res) => {
      if (alive && res.ok) setDetail(res.task);
    });
    return () => {
      alive = false;
    };
  }, [activeId, data]);

  // ── 왼쪽 「+ 작업 추가」 — 지금 보기에 맞는 자리에 입력창을 연다 ──────────────────────────
  const navAdd = () => {
    if (projectId) {
      const info = projectInfo();
      openInlineAdd("project", "", info?.sections[0]?.id ?? "__default");
      return;
    }
    if (view === "today" || view === "tomorrow" || view === "inbox") openInlineAdd(view);
    else if (view === "instr") {
      setInstrTab("sent");
      openInlineAdd("instr");
    } else if (view === "calendar") {
      setSel(null);
      openInlineAdd("day", calDay);
    } else {
      goView("today");
      openInlineAdd("today");
    }
  };
  const goProject = (id: string) => {
    setProjectId(id);
    setAdd(null);
    setSel(null);
    setDetailClosed(false);
    setOdMode(null);
    setSecAdding(false);
    setSelMode(false);
    setPicked(new Set());
  };

  // ── 가운데 머리(제목 · 한 줄 요약) ───────────────────────────────────────────────────────
  const headBlock = (title: string, sub?: ReactNode, right?: ReactNode, lead?: ReactNode) => (
    <div className="atw-head">
      {lead}
      <div className="atw-head__t">
        <h1>{title}</h1>
        {sub ? <span>{sub}</span> : null}
      </div>
      {right ? <div className="atw-head__r">{right}</div> : null}
    </div>
  );
  const header = () => {
    if (projectId) {
      const info = projectInfo();
      if (!info) return null;
      const { summary, memberIds, canManage, sections, projTasks } = info;
      const askDeleteProject = () =>
        setConfirm({
          message: fill(dict.pjDeleteMsg, { title: summary.title }),
          confirmLabel: dict.confirmDeleteBtn,
          onConfirm: () =>
            run(() => deleteConsoleProject(summary.id), {
              toast: dict.pjDeleted,
              after: () => goView("today"), // 삭제된 프로젝트 뷰에서 빠져나옴
            }),
        });
      return headBlock(
        `# ${summary.title}`,
        fill(dict.w.projSub, { s: info.hasRealSections ? sections.length : 0, n: projTasks.length }),
        <>
          <button
            type="button"
            className="atw-members"
            disabled={!canManage}
            title={canManage ? dict.pjMembersManage : undefined}
            onClick={canManage ? (e) => openProjectMembersPop(e, summary.id, memberIds) : undefined}
          >
            <span className="atw-avs">
              <Avatars ids={memberIds} />
            </span>
            {fill(dict.w.membersN, { n: memberIds.length })}
          </button>
          {canManage && (
            <button type="button" className="atw-tl is-red" onClick={askDeleteProject}>
              {dict.pjDelete}
            </button>
          )}
        </>,
      );
    }
    if (view === "today") {
      const total = todayCount + doneTodayRows(false).length;
      const done = total - todayCount;
      return headBlock(
        dict.vToday,
        fill(dict.w.todaySub, { date: fmtLong(today, locale), total, done }),
        undefined,
        <ProgressRing done={done} total={total} label={fill(dict.w.progressAria, { total, done })} />,
      );
    }
    if (view === "tomorrow")
      return headBlock(
        dict.vTomorrow,
        `${fmtLong(addDays(today, 1), locale)} · ${fill(dict.w.dayCount, { n: tomorrowCount })}`,
      );
    if (view === "inbox") return headBlock(dict.vInbox, dict.inboxNote);
    if (view === "shared") return headBlock(dict.vShared, fill(dict.w.dayCount, { n: sharedCount }));
    if (view === "instr") return headBlock(dict.vInstr, dict.w.instrHint);
    if (view === "completed") {
      // 이번 주 = 월요일부터(도쿄). 투두 완료만 센다 — 현장 활동은 날짜 묶음 안에서만 보인다.
      const weekStart = addDays(today, -((weekdayIndex(today) + 6) % 7));
      const n = completedRows().filter((r) => r.day >= weekStart).length;
      return headBlock(dict.vCompleted, fill(dict.w.weekDone, { n }));
    }
    return null; // 캘린더는 달 머리가 그 자리를 쓴다.
  };

  // ── 도구 줄(검색 · 날짜 ▾ · 우선순위 ▾ · 선택) ────────────────────────────────────────────
  const dateFilterLabel = dateFilter
    ? dateFilter === "today"
      ? dict.today
      : dateFilter === "week"
        ? dict.filterDate
        : dateFilter === "overdue"
          ? dict.stOverdue
          : dict.noDate
    : dict.filterDate;
  const toolbar = () => (
    <div className="atw-tools">
      <label className="atw-search">
        <Search size={15} />
        <input placeholder={dict.filterSearch} aria-label={dict.filterSearch} value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button type="button" aria-label={dict.selClear} onClick={() => setQ("")}>
            <X size={13} />
          </button>
        )}
      </label>
      <button
        type="button"
        className={`atw-dd ${dateFilter ? "on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setPop({ kind: "datefilter", ...anchorFrom(e) });
        }}
      >
        {dateFilterLabel}
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className={`atw-dd ${prioFilter ? "on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setPop({ kind: "priofilter", ...anchorFrom(e) });
        }}
      >
        {prioFilter ? prioWord(prioFilter) : dict.filterPrio}
        <ChevronDown size={14} />
      </button>
      {(dateFilter || prioFilter) && (
        <button
          type="button"
          className="atw-icon is-xs"
          aria-label={dict.selClear}
          onClick={() => {
            setDateFilter(null);
            setPrioFilter("");
          }}
        >
          <X size={14} />
        </button>
      )}
      <button
        type="button"
        className={`atw-dd is-sel ${selMode ? "on" : ""}`}
        aria-pressed={selMode}
        onClick={() => (selMode ? exitSelMode() : setSelMode(true))}
      >
        {dict.selMode}
      </button>
    </div>
  );

  // ── 선택 모드 줄(일괄 삭제) ───────────────────────────────────────────────────────────────
  const selectionBar = () => {
    if (!selMode || !filterableView) return null;
    const n = picked.size;
    return (
      <div className="atw-selbar">
        <b className="num">{n > 0 ? fill(dict.selSelected, { n }) : dict.selEmptyHint}</b>
        <span className="atw-selbar__s">{dict.selHint}</span>
        <span className="atw-selbar__acts">
          <button type="button" className="atw-tl" onClick={selectAllVisible}>
            {dict.selAll}
          </button>
          <button type="button" className="atw-tl is-muted" onClick={clearSel} disabled={n === 0}>
            {dict.selClear}
          </button>
          <button type="button" className="atw-pillbtn is-red" onClick={askBulkDelete} disabled={n === 0 || pending}>
            <Trash2 size={14} />
            {dict.selDelete}
          </button>
          <button type="button" className="atw-icon is-xs" onClick={exitSelMode} aria-label={dict.iaCancel}>
            <X size={16} />
          </button>
        </span>
      </div>
    );
  };

  // ── loadError ────────────────────────────────────────────────────────────────────────────
  if (data.loadError) {
    return (
      <div className="admtasks atw is-error">
        <div className="atw-empty">
          <span className="atw-empty__ic">
            <CloudOff size={22} />
          </span>
          <b>{dict.errT}</b>
          <span>{dict.errS}</span>
          <button type="button" className="atw-link" onClick={() => router.refresh()}>
            <RotateCcw size={14} />
            {dict.retry}
          </button>
        </div>
      </div>
    );
  }

  const filterableView = view !== "calendar" || !!projectId;
  const isCal = !projectId && view === "calendar";

  // ── body routing ───────────────────────────────────────────────────────────────────────
  const body = projectId
    ? projectView()
    : view === "today"
      ? todayView()
      : view === "tomorrow"
        ? tomorrowView()
        : view === "inbox"
          ? inboxView()
          : view === "shared"
            ? sharedView()
            : view === "instr"
              ? instrView()
              : view === "completed"
                ? completedView()
                : calendarView();

  // 오른쪽 칸 — 상세 / 캘린더 날짜 목록 / (목록 보기에서 아무것도 없을 때) 안내.
  const sideNode =
    isCal && !sel
      ? calendarSide()
      : (activeId && DetailPanel()) ||
        (listView || isCal ? (
          <aside className="atw-side is-empty" aria-live="polite">
            <div className="atw-side__empty">
              <b>{dict.w.detailEmpty}</b>
              <span>{dict.w.detailEmptySub}</span>
            </div>
          </aside>
        ) : null);

  const navItems: NavItem[] = (
    [
      // 「주의」 색은 **지연 섹션에 뭔가 있을 때**만 — 그 섹션은 일회성 전용이다(2026-09-08).
      ["today", dict.vToday, <Clock key="i" size={17} />, todayCount, overdueList.length > 0],
      ["tomorrow", dict.vTomorrow, <ArrowRight key="i" size={17} />, tomorrowCount, false],
      ["inbox", dict.vInbox, <Inbox key="i" size={17} />, inboxCount, false],
      ["instr", dict.vInstr, <Megaphone key="i" size={17} />, recvOpen, recvOpen > 0],
      ["shared", dict.vShared, <Users key="i" size={17} />, sharedCount, false],
      ["completed", dict.vCompleted, <SquareCheck key="i" size={17} />, 0, false],
      ["calendar", dict.vCalendar, <CalendarDays key="i" size={17} />, 0, false],
    ] as [View, string, ReactNode, number, boolean][]
  ).map(([v, label, icon, count, alert]) => ({
    key: v,
    label,
    icon,
    count,
    alert,
    on: !projectId && view === v,
    onClick: () => goView(v),
  }));
  const navProjects: NavItem[] = data.projects.map((p) => ({
    key: p.id,
    label: p.title,
    icon: <Hash size={15} />,
    count: p.totalTasks - p.completedTasks,
    on: projectId === p.id,
    onClick: () => goProject(p.id),
  }));

  // 아래 보조 함수들은 return 앞에 선언한다 — return 뒤 선언은 React Compiler 가 「도달 불가 코드의 호이스팅 선언」으로 거부해 이 콘솔 전체가 컴파일에서 빠진다.

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // DETAIL COLUMN — 오른쪽 칸(화이트 리디자인). 예전 슬라이드 패널(.dp)의 로직을 그대로 쓴다.
  // 작성자 전용 규칙(일정·우선순위·연결·편집·삭제)은 서버와 같은 경계로 화면에서도 가른다.
  // ────────────────────────────────────────────────────────────────────────────────────────────
  function DetailPanel() {
    const loaded = detail && detail.id === activeId ? detail : null;
    const t = loaded ?? tasks.find((x) => x.id === activeId) ?? null;
    if (!t) return null;
    // 반복은 행 status 가 늘 open 이라 완료 여부는 **연 회차**의 기록을 본다(모바일 상세와 같은 규칙).
    // 회차를 모르고 열린 반복(관리함 · 프로젝트 등)은 완료할 날짜를 알 수 없어 완료를 막는다 —
    // 예전엔 서버가 시리즈 앵커(첫 회차)로 폴백해 엉뚱한 과거 회차가 완료됐다.
    const recurring = isStandardRecurrence(t.recurrenceRule);
    const occ = recurring ? activeOcc : null;
    const canComplete = !recurring || !!occ;
    const occDone = !!occ && occState(t.id, occ) === "completed";
    const motionKey = `${t.id}|${occ ?? ""}`;
    const realStatus: "open" | "in_progress" | "completed" = recurring
      ? occDone
        ? "completed"
        : t.status === "in_progress"
          ? "in_progress"
          : "open"
      : (t.status as "open" | "in_progress" | "completed");
    const done = realStatus === "completed" || completing.has(motionKey);
    // 코어 편집 드래프트가 이 작업의 것일 때만 편집 모드로 렌더한다.
    const editing = coreEdit && coreEdit.id === t.id ? coreEdit : null;
    // What the segmented control shows: the pending click while the data still reads as it did when
    // the click happened, else server truth.
    const shownStatus =
      statusDraft && statusDraft.id === t.id && realStatus === statusDraft.from
        ? statusDraft.status
        : realStatus;
    const mine = isMine(t, meId);
    const proj = t.projectId ? projById.get(t.projectId) : null;
    const d = dueDateOf(t) ?? t.scheduledDate ?? null;
    const trng = timeRange(t.timeLabel, t.durationMinutes);
    const cx = ctxItems(t);
    const ticket = cx.find((c) => c.k === "ticket");
    const rc = t.resolvedContext;
    const linkText = contextLinkText(rc, ticket?.v);
    const shared = isSharedTask(t);
    const withIds = [t.createdByUserId, ...partsOf(t)].filter((v, i, a) => a.indexOf(v) === i);
    const maxPhotos = t.projectId ? 20 : 5;
    const busy = photoBusy === t.id;
    const askLeave = () =>
      setConfirm({
        message: dict.confirmLeaveMsg,
        confirmLabel: dict.dpLeave,
        onConfirm: () =>
          run(() => leaveConsoleTask(t.id), {
            toast: dict.tDeleted,
            after: () => setSel((cur) => (cur === t.id ? null : cur)),
          }),
      });
    const schedText: ReactNode = d ? (
      <>
        {dayLabel(d)}
        {trng ? ` ${trng}` : ""}
        {t.durationMinutes && durText(t.durationMinutes) ? ` · ${durText(t.durationMinutes)}` : ""}
        {isOverdue(t, today) && <span className="is-red"> · {dict.stOverdue}</span>}
      </>
    ) : (
      <span className="is-soft">{dict.dpNoDate}</span>
    );

    return (
      <aside className="atw-side" aria-label={t.title} onClick={(e) => e.stopPropagation()}>
        <div className="atw-d" key={t.id}>
          <div className="atw-d__bar">
            <button
              type="button"
              className="atw-icon"
              onClick={(e) => openRowMenu(e, t.id, undefined, true)}
              aria-label={dict.w.more}
              title={dict.w.more}
            >
              <MoreHorizontal size={19} />
            </button>
            {mine && (
              <button
                type="button"
                className={`atw-icon ${editing ? "on" : ""}`}
                onClick={() => (editing ? cancelCoreEdit() : startCoreEdit(t))}
                aria-pressed={!!editing}
                aria-label={dict.w.edit}
                title={dict.w.edit}
              >
                <Pencil size={18} />
              </button>
            )}
            <button
              type="button"
              className="atw-icon is-red"
              onClick={() => (mine ? deleteWithUndo(t) : askLeave())}
              aria-label={mine ? (shared ? dict.dpUnshareDelete : dict.dpDelete) : dict.dpLeave}
              title={mine ? (shared ? dict.dpUnshareDelete : dict.dpDelete) : dict.dpLeave}
            >
              <Trash2 size={19} />
            </button>
            <button type="button" className="atw-icon is-x" onClick={closePanel} aria-label={dict.w.close}>
              <X size={22} />
            </button>
          </div>

          {editing ? (
            <div className="atw-edit">
              <input
                className="atw-edit__title"
                value={editing.title}
                placeholder={dict.iaTitle}
                aria-label={dict.iaTitle}
                autoFocus
                onChange={(e) => setCoreEdit({ ...editing, title: e.target.value })}
              />
              <textarea
                className="atw-edit__desc"
                value={editing.desc}
                placeholder={dict.iaDesc}
                aria-label={dict.iaDesc}
                rows={3}
                onChange={(e) => setCoreEdit({ ...editing, desc: e.target.value })}
              />
              <div className="atw-edit__tags">
                {editing.tags.map((g) => (
                  <span key={g} className="atw-tag">
                    #{g}
                    <button
                      type="button"
                      aria-label={`${g} ${dict.iaCancel}`}
                      onClick={() => setCoreEdit({ ...editing, tags: editing.tags.filter((x) => x !== g) })}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {editing.tags.length < 10 && (
                  <input
                    className="atw-iadd__tag"
                    value={editing.tagInput}
                    placeholder={dict.dpTagAdd}
                    onChange={(e) => setCoreEdit({ ...editing, tagInput: e.target.value })}
                    onKeyDown={(e) => {
                      // Enter/comma commit; Backspace on an empty input pops the last chip.
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addCoreTag();
                      } else if (e.key === "Backspace" && !editing.tagInput && editing.tags.length) {
                        setCoreEdit({ ...editing, tags: editing.tags.slice(0, -1) });
                      }
                    }}
                    onBlur={addCoreTag}
                  />
                )}
              </div>
              <TaskPhotoUploader
                value={editPhotos.value}
                pending={editPhotos.pending}
                maxImages={maxPhotos}
                copy={photoCopy}
                onChange={setEditPhotos}
              />
              <div className="atw-edit__acts">
                <button type="button" className="atw-btn is-ghost" onClick={cancelCoreEdit}>
                  {dict.iaCancel}
                </button>
                <button
                  type="button"
                  className="atw-btn is-pri"
                  disabled={!editing.title.trim() || pending}
                  onClick={() => saveCoreEdit(t, editing)}
                >
                  {dict.dpSave}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="atw-d__head">
                <TaskRing
                  size="lg"
                  prio={t.priority}
                  done={done}
                  label={dict.stCompleted}
                  onToggle={
                    !canComplete || completing.has(motionKey)
                      ? undefined
                      : () => completeWithMotion(t, occ ? { date: occ, done: occDone } : undefined)
                  }
                />
                <h2 className={done ? "is-done" : ""}>{t.title}</h2>
              </div>
              {t.description && (
                <>
                  {/* 긴 설명은 6줄까지만 — 상태·일정이 칸 아래로 밀려나지 않게. 펼치면 전부 보인다. */}
                  <p className={`atw-d__desc ${descOpen === t.id ? "" : "is-clamp"}`}>{t.description}</p>
                  {(t.description.length > 220 || t.description.split("\n").length > 6) && (
                    <button
                      type="button"
                      className="atw-a atw-d__more"
                      onClick={() => setDescOpen(descOpen === t.id ? null : t.id)}
                    >
                      {descOpen === t.id ? dict.w.descLess : dict.w.descMore}
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* 대기 / 진행 중 / 완료. `shownStatus` 가 낙관적 값이라 누르는 즉시 손잡이가 움직인다. */}
          <div className="atw-status" data-active={shownStatus} role="group" aria-label={dict.dpStatus}>
            <span className="atw-status__thumb" aria-hidden="true" />
            {STATUS_SEGMENTS.map((seg) => (
              <button
                key={seg.status}
                type="button"
                className={shownStatus === seg.status ? "on" : ""}
                aria-pressed={shownStatus === seg.status}
                disabled={seg.status === "completed" && !canComplete}
                onClick={() => {
                  if (shownStatus === seg.status) return;
                  if (seg.status === "completed" && !canComplete) return;
                  setStatusDraft({ id: t.id, from: realStatus, status: seg.status });
                  if (seg.status === "completed") haptic("success");
                  const occArg = occ ?? undefined;
                  // 완료된 반복 회차를 「진행 중」으로: 그 회차를 먼저 되살린다(모바일 상세와 같은 순서).
                  const reopenFirst = recurring && occDone && seg.status === "in_progress";
                  run(
                    async () => {
                      if (reopenFirst) {
                        const r = await setConsoleTaskStatus(t.id, "open", occArg);
                        if (!r.ok) return r;
                      }
                      return setConsoleTaskStatus(t.id, seg.status, occArg);
                    },
                    {
                      toast: seg.status === "completed" ? dict.tCompleted : undefined,
                      onError: () => setStatusDraft(null),
                    },
                  );
                }}
              >
                {dict[seg.labelKey]}
              </button>
            ))}
          </div>
          {!canComplete && <p className="atw-soft atw-d__lock">{dict.dpCompleteNeedsOccurrence}</p>}

          {!editing && (mine || t.imageUrls.length > 0) && (
            <div className="atw-d__photos">
              {t.imageUrls.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  className="atw-ph"
                  onClick={() => setLightbox({ urls: t.imageUrls, index: i })}
                >
                  <Image src={url} alt="" width={128} height={128} />
                </button>
              ))}
              {mine && t.imageUrls.length < maxPhotos && (
                <label className={`atw-ph is-add ${busy ? "is-busy" : ""}`} aria-label={dict.w.photoAdd} title={dict.w.photoAdd}>
                  <input
                    type="file"
                    accept="image/gif,image/jpeg,image/png,image/webp"
                    multiple
                    hidden
                    disabled={busy}
                    onChange={(e) => {
                      addDetailPhotos(t, Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                  {busy ? <Loader2 size={18} className="atw-spin" /> : <Plus size={18} />}
                </label>
              )}
              <span className="atw-d__phn num">
                {fill(dict.w.photosCount, { n: t.imageUrls.length, max: maxPhotos })}
              </span>
            </div>
          )}

          <dl className="atw-d__dl">
            <dt>{dict.w.dlSchedule}</dt>
            <dd>
              {/* 일정 변경은 **작성자 전용**이다(`rescheduleConsoleTask` 가 서버에서도 거절한다).
                  참여자는 ⋯ 메뉴의 오늘/내일로 이동만 쓸 수 있다 — 모바일과 같은 경계. */}
              {mine ? (
                <button type="button" className="atw-ddbtn" onClick={(e) => openSchedulePop(e, t)}>
                  {schedText}
                </button>
              ) : (
                schedText
              )}
              {t.recurrenceRule && (
                <span className="atw-d__sub">↻ {repeatLabel(t.recurrenceRule, d, today, locale, dict)}</span>
              )}
            </dd>
            <dt>{dict.w.dlPriority}</dt>
            <dd>
              {mine ? (
                <button type="button" className="atw-ddbtn" onClick={(e) => openPrioPop(e, t)}>
                  <span className={`atw-pdot p-${t.priority}`} aria-hidden="true" />
                  {prioWord(t.priority)}
                </button>
              ) : (
                <>
                  <span className={`atw-pdot p-${t.priority}`} aria-hidden="true" />
                  {prioWord(t.priority)}
                </>
              )}
            </dd>
            {(cx.length > 0 || mine) && (
              <>
                <dt>{dict.w.dlLinked}</dt>
                <dd>
                  {cx.length > 0 ? (
                    <>
                      {mine ? (
                        <button type="button" className="atw-ddbtn" onClick={(e) => openContextPop(e, t)}>
                          {linkText}
                        </button>
                      ) : (
                        linkText
                      )}
                      {ticket && (
                        <Link className="atw-a" href="/admin/calendar">
                          {dict.dpViewResv}
                        </Link>
                      )}
                    </>
                  ) : (
                    <button type="button" className="atw-a" onClick={(e) => openContextPop(e, t)}>
                      {dict.w.linkCta}
                    </button>
                  )}
                </dd>
              </>
            )}
            {t.tags.length > 0 && (
              <>
                <dt>{dict.w.dlTags}</dt>
                <dd className="is-soft">{t.tags.map((g) => `#${g}`).join(" ")}</dd>
              </>
            )}
            {t.isDirective && !mine && (
              <>
                <dt>{dict.vInstr}</dt>
                <dd>{fill(dict.instructedBy, { name: t.authorName || nameOf(t.createdByUserId) })}</dd>
              </>
            )}
            {(shared || (mine && !t.projectId)) && (
              <>
                <dt>{dict.w.dlWith}</dt>
                <dd>
                  {shared ? (
                    <>
                      <span className="atw-avs">
                        <Avatars ids={withIds} />
                      </span>
                      <span className="is-soft">{withIds.map((id) => nameOf(id)).join(" · ")}</span>
                      {/* 참여자도 사람을 부를 수 있다(Re-sharing) — 서버는 비작성자의 **추가만** 적용한다. */}
                      {!t.projectId && (
                        <button type="button" className="atw-a" onClick={(e) => openSharePop(e, t, "share")}>
                          {dict.w.shareManage}
                        </button>
                      )}
                    </>
                  ) : (
                    <button type="button" className="atw-a" onClick={(e) => openSharePop(e, t, "share")}>
                      {dict.dpShareCta}
                    </button>
                  )}
                </dd>
              </>
            )}
            {proj && (
              <>
                <dt>{dict.w.dlProject}</dt>
                <dd>
                  <button type="button" className="atw-ddbtn" onClick={() => goProject(proj.id)}>
                    # {proj.title}
                  </button>
                </dd>
              </>
            )}
          </dl>

          <section className="atw-d__log" aria-label={dict.w.updates}>
            <b className="atw-d__lt">{dict.w.updates}</b>
            <div className="atw-sys">{fill(dict.dpLogCreated, { name: nameOf(t.createdByUserId) })}</div>
            {/* 노트와 시스템 기록(완료·재개·상태변경·공유·수정)을 전부 그린다(2026-07-31) — 관리자 화면에서
                「누가 언제 완료했다가 다시 열었는지」를 볼 수 있어야 한다. 노트 사진도 여기서 보인다. */}
            {(loaded?.updates ?? []).map((u) =>
              u.type === "note" ? (
                <div key={u.id} className="atw-note">
                  <Avatar id={u.byUserId ?? ""} />
                  <div className="atw-note__b">
                    <span className="atw-note__h">
                      <b>{u.byName}</b>
                      <span className="num">{fmtLog(u.createdAt, locale)}</span>
                    </span>
                    {u.body && <p>{u.body}</p>}
                    {u.imageUrls.length > 0 && (
                      <span className="atw-note__photos">
                        {u.imageUrls.map((url, i) => (
                          <button
                            key={url}
                            type="button"
                            className="atw-ph is-sm"
                            onClick={() => setLightbox({ urls: u.imageUrls, index: i })}
                          >
                            <Image src={url} alt="" width={96} height={96} />
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div key={u.id} className="atw-sys">
                  {systemLogLabel(u.type, u.body, u.byName, dict)} · <span className="num">{fmtLog(u.createdAt, locale)}</span>
                </div>
              ),
            )}
            <div className="atw-d__input">
              <input
                placeholder={dict.w.updateInput}
                aria-label={dict.w.updateInput}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) sendNote();
                }}
              />
              <button
                type="button"
                className="atw-send"
                onClick={sendNote}
                aria-label={dict.w.send}
                disabled={!noteDraft.trim() && notePhotos.length === 0}
              >
                <Send size={15} />
              </button>
            </div>
            {/* `display: contents` 컴포넌트라 flex 줄을 하나 감싸 준다. */}
            <div className="atw-d__notephotos">
              <TaskPhotoUploader
                compact
                value={[]}
                pending={notePhotos}
                maxImages={5}
                copy={photoCopy}
                onChange={(next) => setNotePhotos(next.pending)}
              />
            </div>
          </section>

          {!mine && (
            <p className="atw-soft atw-d__lock">
              <Lock size={13} />
              {fill(dict.dpAuthorOnly, { name: nameOf(t.createdByUserId) })}
            </p>
          )}
        </div>
      </aside>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // POPOVER LAYER
  // ────────────────────────────────────────────────────────────────────────────────────────────
  function PopoverLayer() {
    if (!pop) return null;
    // Initial guess (below the trigger); the layout effect measures and repositions before paint.
    const style: CSSProperties = { left: pop.x, top: pop.y };
    return (
      <>
        <div className="tpop-scrim" onClick={() => setPop(null)} />
        <div ref={popAnchorRef} className="tpop-anchor" style={style} onClick={(e) => e.stopPropagation()}>
          {pop.kind === "schedule" && SchedulePopover({ p: pop })}
          {pop.kind === "prio" && PrioMenu({ p: pop })}
          {pop.kind === "share" && SharePopover({ p: pop })}
          {pop.kind === "context" && ContextPicker({ p: pop })}
          {pop.kind === "rowmenu" && RowMenu({ p: pop })}
          {pop.kind === "datefilter" && DateFilterMenu()}
          {pop.kind === "priofilter" && PrioFilterMenu()}
        </div>
      </>
    );
  }

  function SchedulePopover({ p }: { p: SchedulePop }) {
    const sel0 = p.draft.date;
    const dow = weekdayIndex(today);
    const nextMon = addDays(today, ((8 - dow) % 7) || 7);
    const nextSat = addDays(today, ((6 - dow + 7) % 7) || 7);
    const set = (patch: Partial<SchedulePop["draft"]>) => {
      const draft = { ...p.draft, ...patch };
      // 반복 또는 시간을 새로 켰는데 날짜가 없으면 오늘로 자동 앵커한다. 반복은 날짜 앵커가
      // 필수라, 그냥 두면 저장 시 서버가 repeat_needs_date 로 거부해 "처리하지 못했습니다"만 뜬다.
      const settingRepeat =
        "repeat" in patch &&
        !!patch.repeat &&
        patch.repeat !== "none" &&
        patch.repeat !== CUSTOM_RECURRENCE_PREFIX;
      const settingTime = "time" in patch && !!patch.time;
      if ((settingRepeat || settingTime) && !draft.date) draft.date = today;
      setPop({ ...p, draft });
    };
    const [cy, cmm] = p.calMonth.split("-").map(Number);
    const firstDow = new Date(Date.UTC(cy, cmm - 1, 1)).getUTCDay();
    const dim = new Date(Date.UTC(cy, cmm, 0)).getUTCDate();
    const qd = (iso: string) => `${fmtShort(iso, locale)} (${fmtWeekday(iso, locale)})`;
    const quick = (label: string, icon: ReactNode, iso: string, mod: string) => (
      <button
        className={`qopt qopt--${mod} ${(iso ? sel0 === iso : !sel0) ? "on" : ""}`}
        onClick={() => set({ date: iso })}
      >
        <span className="qopt__ic">{icon}</span>
        <span className="qopt__t">{label}</span>
        <span className="qopt__d">{iso ? qd(iso) : ""}</span>
      </button>
    );
    const shiftCal = (delta: number) => {
      const nm = new Date(Date.UTC(cy, cmm - 1 + delta, 1));
      setPop({ ...p, calMonth: `${nm.getUTCFullYear()}-${String(nm.getUTCMonth() + 1).padStart(2, "0")}` });
    };
    const wdHead = ["0", "1", "2", "3", "4", "5", "6"].map((_, i) =>
      new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR", {
        weekday: "narrow",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(2024, 0, 7 + i))),
    );
    const curRep = p.draft.repeat || "none";
    const anchorForRepeat = sel0 || today;
    // `customDays` is the picker's mode flag AND its value: an array (possibly empty) while the
    // 사용자 지정 row is on, null otherwise. `custom:` with an empty body parses to null, so the
    // in-progress "custom mode, nothing picked yet" state needs this explicit prefix check.
    const inCustomMode = curRep.startsWith(CUSTOM_RECURRENCE_PREFIX);
    const customDays = inCustomMode ? (parseCustomWeekdays(curRep) ?? []) : null;
    const repeatIncomplete = inCustomMode && customDays!.length === 0;
    return (
      <div className="pop sch">
        <div className="sch__label">
          <b>{sel0 ? fmtLong(sel0, locale) : dict.schQNoDate}</b>
          <span>
            {p.draft.time ? `${timeRange(p.draft.time, p.draft.dur)} · ` : ""}
            {curRep !== "none" ? repeatLabel(curRep, anchorForRepeat, today, locale, dict) : dict.schNoRepeat}
          </span>
        </div>
        <div className="sch__quick">
          {quick(dict.schQToday, <Sun size={14} />, today, "today")}
          {quick(dict.schQTomorrow, <Sunrise size={14} />, addDays(today, 1), "tmr")}
          {quick(dict.schQNextWeek, <ArrowRight size={14} />, nextMon, "week")}
          {quick(dict.schQNextWeekend, <CalendarDays size={14} />, nextSat, "wend")}
          {quick(dict.schQNoDate, <CalendarX2 size={14} />, "", "none")}
        </div>
        <div className="sch__cal">
          <div className="cal-head">
            <button className="cal-nav" onClick={() => shiftCal(-1)}>
              <ChevronLeft size={15} />
            </button>
            <b>{fmtMonthTitle(cy, cmm, locale)}</b>
            <button className="cal-nav" onClick={() => shiftCal(1)}>
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="cal-wd">
            {wdHead.map((w, i) => (
              <span key={i} className={i === 0 ? "sun" : i === 6 ? "sat" : ""}>
                {w}
              </span>
            ))}
          </div>
          <div className="cal-grid">
            {Array.from({ length: firstDow }).map((_, i) => (
              <button key={`pad${i}`} className="cal-c pad" />
            ))}
            {Array.from({ length: dim }).map((_, i) => {
              const dd = i + 1;
              const iso = `${cy}-${String(cmm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
              const wd = weekdayIndex(iso);
              return (
                <button
                  key={iso}
                  className={`cal-c ${wd === 0 ? "sun" : wd === 6 ? "sat" : ""} ${iso === today ? "today" : ""} ${iso === sel0 ? "sel" : ""}`}
                  onClick={() => set({ date: iso })}
                >
                  {dd}
                </button>
              );
            })}
          </div>
        </div>
        <div className="sch__exp">
          <div className={`exp-row ${p.expand === "time" ? "open" : ""}`}>
            <button className="exp-h" onClick={() => setPop({ ...p, expand: p.expand === "time" ? null : "time" })}>
              <Clock size={14} />
              {dict.schTime}
              <span className="val">
                {p.draft.time ? timeRange(p.draft.time, p.draft.dur) : dict.schTimeNone}
                <span className="ic chev">
                  <ChevronDown size={13} />
                </span>
              </span>
            </button>
            <div className="exp-body">
              <div className="time-in">
                <input type="time" value={p.draft.time} onChange={(e) => set({ time: e.target.value })} />
              </div>
              <div className="dur-lbl">{dict.schDuration}</div>
              <div className="opt-chips">
                {DURATION_OPTIONS.map((o) => (
                  <button
                    key={String(o.value)}
                    className={`ochip ${p.draft.dur === o.value ? "on" : ""}`}
                    onClick={() => set({ dur: o.value })}
                  >
                    {dict[o.key]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={`exp-row ${p.expand === "repeat" ? "open" : ""}`}>
            <button className="exp-h" onClick={() => setPop({ ...p, expand: p.expand === "repeat" ? null : "repeat" })}>
              <Repeat size={14} />
              {dict.schRepeat}
              <span className="val">
                {curRep !== "none" ? repeatLabel(curRep, anchorForRepeat, today, locale, dict) : dict.schNoRepeat}
                <span className="ic chev">
                  <ChevronDown size={13} />
                </span>
              </span>
            </button>
            <div className="exp-body">
              <div className="rep-list">
                {REPEAT_RULES.map((r) => (
                  <button
                    key={r}
                    className={`ritem ${curRep === r ? "on" : ""}`}
                    onClick={() => set({ repeat: r })}
                  >
                    {r === "none" ? <CalendarX2 size={14} /> : <Repeat size={14} />}
                    {repeatLabel(r === "none" ? null : r, anchorForRepeat, today, locale, dict)}
                    <span className="ic chk">
                      <Check size={13} />
                    </span>
                  </button>
                ))}
                {/* 사용자 지정 — 켜면 요일 칩이 펼쳐진다. 아무 요일도 안 고르면 `custom:` 뒤가
                    비어 저장할 수 없으므로 적용 버튼이 잠긴다(아래 sch__foot). */}
                <button
                  type="button"
                  className={`ritem ${customDays !== null ? "on" : ""}`}
                  onClick={() =>
                    set({ repeat: customDays !== null ? "none" : `${CUSTOM_RECURRENCE_PREFIX}` })
                  }
                  aria-expanded={customDays !== null}
                >
                  <CalendarDays size={14} />
                  {dict.repPickDays}
                  <span className="ic chk">
                    <Check size={13} />
                  </span>
                </button>
                {customDays !== null && (
                  <div className="wdpick">
                    <div className="wdpick__row">
                      {WEEKDAY_ORDER.map((wd) => {
                        const on = customDays.includes(wd);
                        return (
                          <button
                            key={wd}
                            type="button"
                            className={`wdchip ${on ? "on" : ""} ${wd === 0 ? "sun" : wd === 6 ? "sat" : ""}`}
                            aria-pressed={on}
                            onClick={() =>
                              set({
                                repeat: `${CUSTOM_RECURRENCE_PREFIX}${(on
                                  ? customDays.filter((d) => d !== wd)
                                  : [...customDays, wd].sort((a, b) => a - b)
                                ).join(",")}`,
                              })
                            }
                          >
                            {weekdayShortName(wd, locale)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="wdpick__hint">
                      {customDays.length
                        ? fill(dict.repCustomDays, { wd: customWeekdayNames(curRep, locale) })
                        : dict.repPickDaysHint}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="sch__foot">
          <button className="btn btn--ghost btn--sm" onClick={() => setPop(null)}>
            {dict.schCancel}
          </button>
          <button
            className="btn btn--pri btn--sm"
            onClick={() => applySchedule(p)}
            disabled={repeatIncomplete}
            title={repeatIncomplete ? dict.repPickDaysHint : undefined}
          >
            {dict.schApply}
          </button>
        </div>
      </div>
    );
  }

  function PrioMenu({ p }: { p: PrioPop }) {
    const it = (v: string) => (
      <button className="mitem" onClick={() => applyPrio(p, v)}>
        <span className={`atw-pdot p-${v}`} aria-hidden="true" />
        {prioWord(v)}
        {p.cur === v && (
          <span className="ic" style={{ marginLeft: "auto", color: "var(--adm-primary)" }}>
            <Check size={15} />
          </span>
        )}
      </button>
    );
    return (
      <div className="pop menu">
        {it("urgent")}
        {it("important")}
        {it("medium")}
        {it("normal")}
      </div>
    );
  }

  function SharePopover({ p }: { p: SharePop }) {
    const list = data.users.filter(
      (u) => u.id !== meId && (!p.q || u.name.includes(p.q) || u.role.includes(p.q)),
    );
    /**
     * 참여자(비작성자)는 **부를 수만** 있다 — 서버가 제거분을 버리므로, 화면에서도 기존 참여자의
     * 체크를 못 풀게 잠근다. 안 그러면 해제했다가 새로고침에 되살아나는 유령 조작이 된다.
     */
    const shareTask = p.src === "task" && p.taskId ? tasks.find((t) => t.id === p.taskId) : null;
    const lockedIds =
      shareTask && !isMine(shareTask, meId)
        ? new Set(shareTask.participants.filter((x) => x.role !== "author").map((x) => x.userId))
        : new Set<string>();
    const toggle = (uid: string) => {
      if (lockedIds.has(uid)) return;
      setPop({ ...p, sel: p.sel.includes(uid) ? p.sel.filter((x) => x !== uid) : [...p.sel, uid] });
    };
    const cta =
      p.mode === "target"
        ? p.sel.length
          ? p.sel.length === 1
            ? fill(dict.instructedBy, { name: nameOf(p.sel[0]) })
            : fill(dict.shTargetCta, { n: p.sel.length })
          : dict.shTargetTitle
        : p.sel.length
          ? fill(dict.shShareCta, { n: p.sel.length })
          : dict.shShareTitle;
    return (
      <div className="pop shp">
        <div className="shp__h">
          <b>{p.mode === "target" ? dict.shTargetTitle : dict.shShareTitle}</b>
          <span>{p.mode === "target" ? dict.shTargetSub : dict.shShareSub}</span>
        </div>
        {p.mode === "target" && (
          <div className="shp__hint">
            <Megaphone size={14} />
            {fill(dict.shTargetHint, { name: nameOf(meId) })}
          </div>
        )}
        <div className="shp__search">
          <span className="ic">
            <Search size={14} />
          </span>
          <input
            placeholder={dict.shSearch}
            value={p.q}
            onChange={(e) => setPop({ ...p, q: e.target.value })}
          />
        </div>
        <div className="shp__list">
          {list.length === 0 ? (
            <div className="tempty__s" style={{ padding: 16 }}>
              {dict.shNoResult}
            </div>
          ) : (
            list.map((u) => (
              <button
                key={u.id}
                className={`urow ${p.sel.includes(u.id) ? "on" : ""}`}
                disabled={lockedIds.has(u.id)}
                onClick={() => toggle(u.id)}
              >
                <Avatar id={u.id} />
                <div className="urow__b">
                  <div className="urow__n">{u.name}</div>
                  <div className="urow__r">{u.role}</div>
                </div>
                <span className="ucheck">
                  <Check size={14} />
                </span>
              </button>
            ))
          )}
        </div>
        <div className="shp__foot">
          <button
            className="btn btn--pri"
            /* 기존 작업 공유 관리(src=task)는 0명(전원 제거)도 적용 가능. 인라인 추가 대상 선택만 0에서 비활성. */
            disabled={p.src === "add" && p.sel.length === 0}
            onClick={() => applyShare(p)}
          >
            {cta}
          </button>
        </div>
      </div>
    );
  }

  // 인라인 추가는 로컬 드래프트만 갱신하고, 기존 작업은 곧바로 서버에 저장한다(다른 팝오버와 동일).
  function ContextPicker({ p }: { p: ContextPop }) {
    const t = p.taskId ? tasks.find((x) => x.id === p.taskId) : null;
    const current: TaskContextValue =
      p.src === "add"
        ? add?.context ?? EMPTY_TASK_CONTEXT
        : t?.resolvedContext
          ? {
              propertyId: t.resolvedContext.propertyId,
              roomId: t.resolvedContext.roomId,
              reservationId: t.resolvedContext.reservationId,
              guestName: t.resolvedContext.guestName,
              propertyName: t.resolvedContext.propertyName,
              roomLabel: t.resolvedContext.roomLabel,
            }
          : EMPTY_TASK_CONTEXT;
    return (
      <ContextPickerPopover
        value={current}
        copy={contextCopy}
        onClose={() => setPop(null)}
        onChange={(v) => {
          setPop(null);
          if (p.src === "add") {
            if (add) setAdd({ ...add, context: v });
            return;
          }
          if (!t) return;
          // 기존 작업은 코어 편집과 같은 액션을 쓴다 — 날짜/시간/반복/우선순위는 현재 값 그대로.
          run(
            () =>
              updateConsoleTaskCore({
                taskId: t.id,
                title: t.title,
                desc: t.description ?? "",
                tags: t.tags,
                date: dueDateOf(t) ?? t.scheduledDate ?? "",
                time: t.timeLabel ?? "",
                durationMinutes: t.durationMinutes,
                repeat: t.recurrenceRule ?? "none",
                priority: t.priority,
                context: v,
              }),
            { toast: dict.tUpdated },
          );
        }}
      />
    );
  }

  function RowMenu({ p }: { p: RowMenuPop }) {
    const t = tasks.find((x) => x.id === p.taskId);
    if (!t) return null;
    const mine = isMine(t, meId);
    const close = () => setPop(null);
    return (
      <div className="pop menu">
        {/* 일정 변경 = 마감·시간·반복 주기 수정이라 **작성자 전용**(서버도 forbidden). 참여자에게는
            아래 오늘/내일로 이동만 남는다 — 그쪽은 모바일에서도 참여자에게 열려 있다. */}
        {mine && (
          <button className="mitem" onClick={(e) => openSchedulePop(e, t)}>
            <CalendarDays size={15} />
            {dict.mScheduleChange}
          </button>
        )}
        {mine && (
          <button className="mitem" onClick={(e) => openPrioPop(e, t)}>
            <Flag size={15} />
            {dict.mPriority}
          </button>
        )}
        {/* 참여자도 사람을 부를 수 있다(Re-sharing). 다만 서버는 작성자가 아닐 때 **추가만**
            적용하고 제거·지시 전환은 무시한다(`shareConsoleTask`). */}
        {!t.projectId && (
          <button className="mitem" onClick={(e) => openSharePop(e, t, "share")}>
            <UserPlus size={15} />
            {dict.mShareInstr}
          </button>
        )}
        {mine && (
          <button className="mitem" onClick={(e) => openContextPop(e, t)}>
            <Building2 size={15} />
            {dict.cpTitle}
          </button>
        )}
        {/* 이동 대상은 탭이 아니라 **작업이 실제로 그 날짜에 걸리는지**로 정한다: 오늘 걸려 있으면
            내일로, 아니면 오늘로. 이 메뉴는 관리함·공유함·지시·캘린더·프로젝트에서도 같이 뜨므로
            탭 기준으로는 판단할 수 없다.
            앵커 날짜(`dateOf`) 비교로는 안 된다 — 반복 작업의 앵커는 규칙의 시작일이라 오늘과
            다를 수 있고(예: 평일 반복, 앵커 7/30, 오늘 8/3), 그때 이미 오늘 회차가 있는데도
            「오늘로 이동」이 떴다. 서버는 `canMoveRecurringTo` 로 막으므로 데이터는 안전했지만,
            눌러도 실패만 하는 메뉴였다(2026-08-03).
            오늘·내일 양쪽에 회차가 있는 반복(평일 등)은 옮길 곳이 없으므로 항목을 아예 감춘다.
            표준 반복은 애초에 이 메뉴를 띄우지 않는다(2026-08-25) — `moveConsoleToToday`/
            `moveConsoleToTomorrow` 는 `recurrence_instance_date` 를 다시 써서 시리즈 전체의 반복
            위상을 옮기고, 그 순간 밀린 회차 backlog 가 통째로 사라진다. 반복 업무는 고정 앵커여야
            한다(docs/planning/01-decision-log.md 2026-07-30 롤포워드 폐지). 일정을 바꾸려면
            편집(반복 규칙/날짜)이나 회차 건너뛰기를 쓴다. */}
        {!isStandardRecurrence(t.recurrenceRule) &&
          (!occursOn(t, today) ? (
            <button
              className="mitem"
              onClick={() => {
                close();
                run(() => moveConsoleToToday(t.id), { toast: dict.tMoved });
              }}
            >
              <Sun size={15} />
              {dict.mMoveToday}
            </button>
          ) : !occursOn(t, addDays(today, 1)) ? (
            <button
              className="mitem"
              onClick={() => {
                close();
                run(() => moveConsoleToTomorrow(t.id), { toast: dict.tMoved });
              }}
            >
              <Sunrise size={15} />
              {dict.mMoveTomorrow}
            </button>
          ) : null)}
        {/* 상세 칸의 ⋯ 에서만 — 같은 작업을 모바일 상세로 연다(예전 패널 머리의 휴대폰 단추). */}
        {p.fromDetail && (
          <Link className="mitem" href={`/mobile/tasks/${t.id}`} onClick={close}>
            <Smartphone size={15} />
            {dict.dpMobileDetail}
          </Link>
        )}
        {/* "관리함으로" = 프로젝트에서 빼기. 비프로젝트 작업은 이미 관리함이라 프로젝트 작업에만 노출. */}
        {t.projectId && (
          <button
            className="mitem"
            onClick={() => {
              close();
              run(() => moveConsoleToInbox(t.id), { toast: dict.tMoved });
            }}
          >
            <Inbox size={15} />
            {dict.mMoveInbox}
          </button>
        )}
        <div className="msep" />
        {mine ? (
          <button
            className="mitem mitem--warn"
            onClick={() => {
              close();
              // 반복 작업을 **회차로** 보고 있으면 무엇을 지울지 먼저 묻는다(모바일과 같은 규칙).
              // 관리함처럼 회차가 아닌 목록에서는 행이 곧 시리즈이므로 기존 즉시 삭제 + 실행 취소.
              if (p.occ && isStandardRecurrence(t.recurrenceRule)) setRecurDel({ task: t, date: p.occ });
              else deleteWithUndo(t);
            }}
          >
            <Trash2 size={15} />
            {dict.mDelete}
          </button>
        ) : (
          <button
            className="mitem mitem--warn"
            onClick={() => {
              close();
              setConfirm({
                message: dict.confirmLeaveMsg,
                confirmLabel: dict.dpLeave,
                onConfirm: () =>
                  run(() => leaveConsoleTask(t.id), {
                    toast: dict.tDeleted,
                    after: () => setSel((cur) => (cur === t.id ? null : cur)),
                  }),
              });
            }}
          >
            <Trash2 size={15} />
            {dict.mLeave}
          </button>
        )}
      </div>
    );
  }

  function DateFilterMenu() {
    const opt = (k: DateFilterKey, label: string) => (
      <button
        className="mitem"
        onClick={() => {
          setDateFilter(dateFilter === k ? null : k);
          setPop(null);
        }}
      >
        <CalendarDays size={15} />
        {label}
        {dateFilter === k && (
          <span className="ic" style={{ marginLeft: "auto", color: "var(--adm-primary)" }}>
            <Check size={15} />
          </span>
        )}
      </button>
    );
    return (
      <div className="pop menu">
        {opt("today", dict.today)}
        {opt("week", dict.filterDate)}
        {opt("overdue", dict.stOverdue)}
        {opt("nodate", dict.noDate)}
      </div>
    );
  }

  function PrioFilterMenu() {
    const opt = (k: string) => (
      <button
        className="mitem"
        onClick={() => {
          setPrioFilter(prioFilter === k ? "" : k);
          setPop(null);
        }}
      >
        <span className={`atw-pdot p-${k}`} aria-hidden="true" />
        {prioWord(k)}
        {prioFilter === k && (
          <span className="ic" style={{ marginLeft: "auto", color: "var(--adm-primary)" }}>
            <Check size={15} />
          </span>
        )}
      </button>
    );
    return (
      <div className="pop menu">
        {opt("urgent")}
        {opt("important")}
        {opt("medium")}
        {opt("normal")}
        <div className="msep" />
        <button
          className="mitem"
          onClick={() => {
            setPrioFilter("");
            setPop(null);
          }}
        >
          <X size={15} />
          {dict.filterPrio}
        </button>
      </div>
    );
  }

  // ── REPORT MODAL ─────────────────────────────────────────────────────────────────────────
  function ReportModal() {
    if (!report) return null;
    // 화이트 리디자인(2026-10-15, 시안 TodoReport-PC): 제목 + 「날짜 · 완료 n건 중 m건 포함」 → 포함할 항목 → 본문 → 안내 · 원본으로 → 닫기 / Slack / 전체 복사.
    // 건수는 보고서에 실제로 들어온 항목(reportItems) 기준 — 예전 힌트는 status=completed 만 세서 반복 완료를 놓치고 「완료 0건」이라 했다.
    const picked = reportPicked.filter(Boolean).length;
    const allOn = reportItems.length > 0 && picked === reportItems.length;
    const busy = !!report.error || report.loading;
    const earliest = earliestMinute(rptNowMin);
    return (
      <>
        <div className="day-scrim" onClick={() => setReport(null)} />
        <div className="day-wrap" onClick={() => setReport(null)}>
          <div
            className="atw-rpt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="atw-rpt-t"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              // 작은 창 밖을 누르면 닫는다(칩은 스스로 열고 닫는다).
              if (rptWhenOpen && !(e.target as Element).closest(".atw-rpt__pop, .atw-rpt__wchip")) setRptWhenOpen(false);
            }}
          >
            <div className="atw-rpt__h">
              <div className="atw-rpt__ht">
                <h2 id="atw-rpt-t">{dict.rptTitle}</h2>
                <span>
                  {report.loading || report.error
                    ? fmtLong(report.date, locale)
                    : fill(dict.rptSub, { date: fmtLong(report.date, locale), total: reportItems.length, selected: picked })}
                </span>
              </div>
              <button type="button" className="atw-rpt__x" aria-label={dict.rptClose} onClick={() => setReport(null)}>
                <X size={22} />
              </button>
            </div>
            {rptActive && rptActiveTime ? (
              <div className="atw-rpt__banner" role="status">
                <Clock size={17} aria-hidden="true" />
                <span className="atw-rpt__bannert">
                  <span>{fill(dict.rptScheduledBanner, { time: rptActiveTime })}</span>
                  <small>{fill(dict.rptScheduleLeft, { dur: rptDur(Math.max(1, toMinutes(rptActiveTime) - rptNowMin)) })}</small>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRptNowMin(tokyoNowMinutes());
                    setRptWhenOpen(true);
                  }}
                  disabled={rptSchedBusy}
                >
                  {dict.rptScheduleChangeTime}
                </button>
                <button type="button" onClick={() => void cancelReportSchedule()} disabled={rptSchedBusy}>
                  {dict.rptScheduleCancel}
                </button>
              </div>
            ) : null}
            {report.loading ? (
              <p className="atw-rpt__state">…</p>
            ) : report.error ? (
              <p className="atw-rpt__state">
                {report.error === "forbidden" ? dict.errForbidden : report.error === "empty" ? dict.emCompleted : dict.errGeneric}
              </p>
            ) : (
              <>
                {/* 포함할 항목 — 체크를 풀면 번호와 합계가 선택 기준으로 다시 매겨진다(모바일과 같음). */}
                {reportItems.length > 0 ? (
                  <div className="atw-rpt__pick">
                    <div className="atw-rpt__pickh">
                      <b>{dict.rptPickTitle}</b>
                      <span>{fill(dict.rptPickCount, { selected: picked, total: reportItems.length })}</span>
                      <button type="button" onClick={() => applyReportPick(reportItems.map(() => !allOn))}>
                        {allOn ? dict.rptPickNone : dict.rptPickAll}
                      </button>
                    </div>
                    <ul>
                      {reportItems.map((item, i) => (
                        <li key={`${item.text}-${i}`}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={reportPicked[i]}
                            className={`atw-rpt__row${reportPicked[i] ? " on" : ""}`}
                            onClick={() => applyReportPick(reportPicked.map((on, idx) => (idx === i ? !on : on)))}
                          >
                            <span className="atw-rpt__box" aria-hidden="true">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </span>
                            <span className="atw-rpt__label">{item.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <label className="atw-rpt__nf">
                  <span>{dict.rptBodyLabel}</span>
                  <textarea
                    placeholder={dict.rptPickEmpty}
                    spellCheck={false}
                    value={reportEdited}
                    onChange={(e) => setReportEdited(e.target.value)}
                  />
                </label>
                <div className="atw-rpt__hint">
                  <span role="status">
                    {reportItems.length > 0 && reportPicked.every((on) => !on)
                      ? dict.rptPickEmpty
                      : reportItems.length > 0 && reportEdited !== reportBuilt
                        ? dict.rptPickResetHint
                        : dict.rptHint}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      // 「원본으로」는 편집뿐 아니라 선택도 되돌린다 — 둘이 어긋나면 무엇이 나갈지 알 수 없다.
                      setReportEdited(report.text);
                      setReportBuilt(report.text);
                      setReportPicked(reportItems.map(() => true));
                    }}
                  >
                    <Repeat size={13} />
                    {dict.rptReset}
                  </button>
                </div>
              </>
            )}
            {/* 결과 한 줄 — 바뀐 내용 안내 · 예약 실패 · 예약이 보냄/못 보냄(지금 보내기 결과는 알림 토스트). */}
            {!busy && rptActive && rptChanged ? (
              <p className="atw-rpt__msg is-info" role="status">
                <TriangleAlert size={15} aria-hidden="true" />
                {dict.rptScheduleChanged}
              </p>
            ) : null}
            {!busy && rptInvalid ? (
              <p className="atw-rpt__msg is-bad" role="alert">
                <TriangleAlert size={15} aria-hidden="true" />
                {earliest === null ? dict.rptWhenNoSlots : fill(dict.rptWhenEarliest, { time: fromMinutes(earliest) })}
              </p>
            ) : null}
            {rptMsg ? (
              <p className={`atw-rpt__msg ${rptMsg.tone === "ok" ? "is-ok" : "is-bad"}`} role="status">
                {rptMsg.tone === "ok" ? <Check size={15} strokeWidth={3} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
                {rptMsg.text}
              </p>
            ) : rptSched?.status === "sent" ? (
              <p className="atw-rpt__msg is-ok" role="status">
                <Check size={15} strokeWidth={3} aria-hidden="true" />
                {fill(dict.rptScheduleSent, { time: tokyoHHMM(rptSched.sentAt ?? rptSched.sendAt) })}
              </p>
            ) : rptSched?.status === "failed" ? (
              <p className="atw-rpt__msg is-bad" role="status">
                <TriangleAlert size={15} aria-hidden="true" />
                {fill(dict.rptScheduleFailed, { time: tokyoHHMM(rptSched.sendAt) })} · {rptFailText(rptSched.error ?? "error")}
              </p>
            ) : null}
            {/* 아래 한 줄(2026-10-20 시안) — 왼쪽 「보낼 시각」 칩(누르면 위로 작은 창), 오른쪽 전체 복사 · 보내기. 닫기는 위 X · Esc. */}
            <div className="atw-rpt__f">
              {rptWhenOpen && !busy ? (
                <div className="atw-rpt__pop" role="dialog" aria-label={dict.rptWhen}>
                  {/* 칸 하나 + 목록(2026-10-20 3차 시안 P1) — 클릭 = 고르기, 아무렇게나 친 뒤 Enter = 그 시각으로 예약. */}
                  <ReportTimeCombo
                    value={rptWhen}
                    nowMin={rptNowMin}
                    whenIn={(minutes) => fill(dict.rptWhenIn, { dur: rptDur(Math.max(1, minutes)) })}
                    labels={{
                      input: dict.rptWhenInput,
                      list: dict.rptWhenAsk,
                      placeholder: dict.rptWhenPlaceholder,
                      now: dict.rptWhenNow,
                      earliest: dict.rptWhenEarliestItem,
                      past: dict.rptWhenPast,
                      noMatch: dict.rptWhenNoMatch,
                    }}
                    onPick={(next) => {
                      rptPickTime(next);
                      setRptWhenOpen(false);
                      rptChipRef.current?.focus();
                    }}
                    onSubmit={(at) => {
                      rptPickTime(at);
                      setRptWhenOpen(false);
                      rptChipRef.current?.focus();
                      if (!at) return;
                      if (rptActive && at === rptActiveTime && reportEdited === rptSchedText) return;
                      void scheduleReport(at);
                    }}
                  />
                </div>
              ) : null}
              <button
                type="button"
                ref={rptChipRef}
                className={`atw-rpt__wchip${rptWhen ? " on" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={rptWhenOpen}
                disabled={busy}
                onClick={() => {
                  if (!rptWhenOpen) setRptNowMin(tokyoNowMinutes());
                  setRptWhenOpen((open) => !open);
                }}
              >
                <Clock size={16} aria-hidden="true" />
                <span className="k">{dict.rptWhen}</span>
                <b className="num">{rptWhen ? fill(dict.rptWhenToday, { time: rptWhen }) : dict.rptWhenNow}</b>
                {rptWhenOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
              </button>
              <button type="button" className="atw-rpt__btn is-gray" onClick={copyReport} disabled={busy || !reportEdited.trim()}>
                <FileText size={15} />
                {dict.rptCopy}
              </button>
              <button
                type="button"
                className={`atw-rpt__btn ${rptActive && !rptChanged ? "is-soft" : "is-pri"}`}
                onClick={() => void reportPrimary()}
                disabled={busy || report.sending || rptSchedBusy || !reportEdited.trim() || (rptActive && !rptChanged) || rptInvalid}
                aria-busy={report.sending || rptSchedBusy}
              >
                {report.sending || rptSchedBusy ? (
                  <RefreshCw className="spin" size={15} />
                ) : rptActive && !rptChanged ? (
                  <Check size={15} strokeWidth={3} />
                ) : rptWhen ? (
                  <Clock size={15} />
                ) : (
                  <Send size={15} />
                )}
                {report.sending
                  ? dict.rptSlackSending
                  : rptSchedBusy
                    ? dict.rptScheduling
                    : rptActive && !rptChanged && rptActiveTime
                      ? fill(dict.rptScheduledBtn, { time: rptActiveTime })
                      : rptActive && rptChanged && rptWhen
                        ? dict.rptReschedule
                        : rptWhen
                          ? fill(dict.rptSendAt, { time: rptWhen })
                          : dict.rptSlackSend}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── NEW PROJECT MODAL ────────────────────────────────────────────────────────────────────
  function NewProjectModal() {
    if (!newProj) return null;
    const list = data.users.filter(
      (u) => u.id !== meId && (!newProj.q || u.name.includes(newProj.q) || u.role.includes(newProj.q)),
    );
    const toggle = (uid: string) =>
      setNewProj({
        ...newProj,
        members: newProj.members.includes(uid)
          ? newProj.members.filter((x) => x !== uid)
          : [...newProj.members, uid],
      });
    const save = () => {
      if (!newProj.name.trim()) return;
      const { name, members } = newProj;
      run(() => createConsoleProject(name, members), {
        toast: dict.tProjectCreated,
        after: () => setNewProj(null),
      });
    };
    return (
      <>
        <div className="day-scrim" onClick={() => setNewProj(null)} />
        <div className="day-wrap" onClick={() => setNewProj(null)}>
          <div className="pop npm" onClick={(e) => e.stopPropagation()}>
            <div className="dp__top">
              <span className="dp__crumb">
                <Hash size={14} />
                <b>{dict.npTitle}</b>
              </span>
              <span className="sp" />
              <button className="dp__tb" onClick={() => setNewProj(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="npm__body">
              <div className="npm__f">
                <label>{dict.npName}</label>
                <input
                  className="npm__in"
                  placeholder={dict.npNamePh}
                  value={newProj.name}
                  onChange={(e) => setNewProj({ ...newProj, name: e.target.value })}
                />
              </div>
              <div className="npm__f">
                <label>{fill(dict.npMembers, { n: newProj.members.length + 1 })}</label>
                <div className="npm__search">
                  <span className="ic">
                    <Search size={14} />
                  </span>
                  <input
                    placeholder={dict.npSearch}
                    value={newProj.q}
                    onChange={(e) => setNewProj({ ...newProj, q: e.target.value })}
                  />
                  {newProj.q && (
                    <button className="npm__clear" onClick={() => setNewProj({ ...newProj, q: "" })}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="npm__list">
                  {list.length === 0 ? (
                    <div className="railempty" style={{ padding: "14px 12px" }}>
                      {dict.shNoResult}
                    </div>
                  ) : (
                    list.map((u) => (
                      <button
                        key={u.id}
                        className={`urow ${newProj.members.includes(u.id) ? "on" : ""}`}
                        onClick={() => toggle(u.id)}
                      >
                        <Avatar id={u.id} />
                        <div className="urow__b">
                          <div className="urow__n">{u.name}</div>
                          <div className="urow__r">{u.role}</div>
                        </div>
                        <span className="ucheck">
                          <Check size={14} />
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="shp__hint" style={{ margin: 0 }}>
                <Share2 size={14} />
                {dict.npHint}
              </div>
            </div>
            <div className="sch__foot">
              <button className="btn btn--ghost btn--sm" onClick={() => setNewProj(null)}>
                {dict.npCancel}
              </button>
              <button className="btn btn--pri btn--sm" disabled={!newProj.name.trim()} onClick={save}>
                {dict.npCreate}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  function durText(mins: number): string {
    const opt = DURATION_OPTIONS.find((o) => o.value === mins);
    return opt ? dict[opt.key] : "";
  }

  // ── CONFIRM MODAL (destructive actions) ─────────────────────────────────────────────────────
  /**
   * 반복 삭제 선택 모달 — 회차 하나 vs 시리즈 전체.
   *
   * 파괴 정도가 다른 두 동작을 한 버튼에 묶지 않는다. 두 선택지는 같은 크기의 행으로 놓아 "고르는
   * 화면"으로 읽히게 하고, 되돌릴 수 없는 쪽(전체 삭제)만 danger 톤으로 구분한다. 헤더에 반복 주기를
   * 같이 보여줘 "전체"가 무엇을 뜻하는지 누르기 전에 알 수 있게 했다.
   */
  function RecurDeleteModal() {
    if (!recurDel) return null;
    const { task, date } = recurDel;
    const opt = (
      opts: { icon: ReactNode; title: string; sub: string; onClick: () => void; warn?: boolean },
    ) => (
      <button className={`rcopt${opts.warn ? " rcopt--warn" : ""}`} onClick={opts.onClick}>
        <span className="rcopt__ic">{opts.icon}</span>
        <span className="rcopt__t">
          <b>{opts.title}</b>
          <i>{opts.sub}</i>
        </span>
        <ChevronRight className="rcopt__go" size={15} />
      </button>
    );
    return (
      <>
        <div className="day-scrim" onClick={() => setRecurDel(null)} />
        <div className="day-wrap" onClick={() => setRecurDel(null)}>
          <div className="pop rcm" onClick={(e) => e.stopPropagation()}>
            <div className="dp__top">
              <span className="dp__crumb">
                <Repeat size={14} />
                <b>{repeatShort(task.recurrenceRule, dict, locale)}</b>
              </span>
              <span className="sp" />
              <button className="dp__tb" onClick={() => setRecurDel(null)}>
                <X size={16} />
              </button>
            </div>
            <p className="rcm__title">{task.title}</p>
            <div className="rcm__opts">
              {opt({
                icon: <SkipForward size={16} />,
                title: fill(dict.recurSkipOne, { date: fmtShort(date, locale) }),
                sub: dict.recurSkipOneSub,
                onClick: () => skipOccurrenceWithUndo(task, date),
              })}
              {opt({
                icon: <Trash2 size={16} />,
                title: dict.recurDeleteAll,
                sub: dict.recurDeleteAllSub,
                warn: true,
                onClick: () => {
                  setRecurDel(null);
                  deleteWithUndo(task);
                },
              })}
            </div>
          </div>
        </div>
      </>
    );
  }

  function ConfirmModal() {
    if (!confirm) return null;
    const c = confirm;
    return (
      <>
        <div className="day-scrim" onClick={() => setConfirm(null)} />
        <div className="day-wrap" onClick={() => setConfirm(null)}>
          <div className="pop" style={{ width: 380, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="dp__top">
              <span className="dp__crumb">
                <AlertTriangle size={14} />
                <b>{dict.confirmTitle}</b>
              </span>
              <span className="sp" />
              <button className="dp__tb" onClick={() => setConfirm(null)}>
                <X size={16} />
              </button>
            </div>
            {/* pre-line: the bulk-delete message appends a second line about shared tasks. */}
            <div
              style={{
                padding: "6px 20px 16px",
                fontSize: 14,
                color: "var(--ink-soft)",
                lineHeight: 1.5,
                whiteSpace: "pre-line",
              }}
            >
              {c.message}
            </div>
            <div className="sch__foot">
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(null)}>
                {dict.iaCancel}
              </button>
              <span style={{ flex: 1 }} />
              <button
                className="btn btn--warn btn--sm"
                onClick={() => {
                  setConfirm(null);
                  c.onConfirm();
                }}
              >
                <Trash2 size={15} />
                {c.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }
  return (
    <div
      className={`admtasks atw ${sideNode ? "has-side" : ""} ${isCal ? "is-cal" : ""}`}
      onClick={() => setPop(null)}
    >
      <ViewNav
        aria={dict.w.navAria}
        addLabel={dict.addTask}
        onAdd={navAdd}
        items={navItems}
        projectsLabel={dict.w.projects}
        projects={navProjects}
        newProjectLabel={dict.newProject}
        onNewProject={() => setNewProj({ name: "", members: [], q: "" })}
      />

      <main className="atw-main">
        <div className="atw-fade" key={projectId ?? view}>
          {header()}
          {filterableView && toolbar()}
          {selectionBar()}
          {body}
        </div>
      </main>

      {sideNode}

      {/* POPOVERS / SHEETS / MODALS */}
      {pop && PopoverLayer()}
      {report && ReportModal()}
      {newProj && NewProjectModal()}
      {confirm && ConfirmModal()}
      {recurDel && RecurDeleteModal()}

      {toast && <AdminToast message={toast.message} onDismiss={dismiss} />}
      {undo && (
        <div className="undobar" role="status" onClick={(e) => e.stopPropagation()}>
          <div className="undobar__txt">
            <span className="undobar__msg">{undo.message}</span>
            {undo.sub && <span className="undobar__sub">{undo.sub}</span>}
          </div>
          <button
            className="undobar__act"
            onClick={() => {
              undo.onUndo();
            }}
          >
            {dict.undoBtn}
          </button>
          <button className="undobar__x" onClick={() => setUndo(null)} aria-label={dict.iaCancel}>
            <X size={15} />
          </button>
        </div>
      )}
      {/* 사진 확대 — 근태(교통비 영수증)와 같은 공용 뷰어를 쓴다. 콘솔용 별도 라이트박스는 만들지 않는다. */}
      <ImageLightbox
        closeLabel={dict.rptClose}
        onClose={() => setLightbox(null)}
        openIndex={lightbox ? lightbox.index : null}
        urls={lightbox?.urls ?? []}
      />
      {pending && <span className="sr-only" aria-live="polite" />}
    </div>
  );
}

// ── tiny helpers (module scope) ───────────────────────────────────────────────────────────────
// 옵셔널 체이닝이 든 논리식을 JSX 안에 두면 React Compiler 가 이 콘솔 전체를 건너뛴다 — 함수로 뺀다.
function addContextSet(c: AddDraft["context"]): boolean {
  return Boolean(c && (c.propertyId || c.reservationId));
}
function addContextLabel(c: AddDraft["context"]): string {
  return c ? [c.propertyName, c.roomLabel].filter(Boolean).join(" · ") : "";
}

function contextLinkText(rc: TaskRecord["resolvedContext"], ticketValue: string | undefined): string {
  const joined = rc
    ? [[rc.propertyName, rc.roomLabel].filter(Boolean).join(" "), rc.guestName].filter(Boolean).join(" · ")
    : "";
  return joined || (ticketValue ?? "");
}

// ── (이어서) ───────────────────────────────────────────────────────────────
function fmtMonthTitle(y: number, m: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function fmtLog(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(d);
}
