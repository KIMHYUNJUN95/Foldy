// Admin Todoist 콘솔 — 클라이언트 안전 헬퍼(포맷/아바타/라벨).
//
// **날짜 유틸과 날짜·회차 술어는 여기서 정의하지 않는다.** 예전에는 «@/lib/tasks 가 server-only라»는
// 이유로 이 파일이 독립 구현을 갖고 있었고, 모바일 워크스페이스도 같은 것을 인라인으로 또 갖고
// 있었다 — 그 쌍둥이가 갈리면서 실제 사고를 냈다(결정 로그 2026-07-30 · 2026-08-25).
// 이제 순수 모듈 `@/lib/tokyo-date` 와 `@/lib/task-predicates` 가 정본이고, 여기서는 콘솔이 쓰던
// 이름으로 얇게 별칭만 준다(호출부 4900줄을 건드리지 않으려고 이름을 유지한다).
// 라벨은 전부 getAdminTasksDictionary(locale) 를 통해 다국어로만 렌더한다(하드코딩 금지).
import type { Locale } from "@/lib/i18n";
import type { TaskRecord } from "@/lib/tasks";
import {
  formatCustomWeekdays,
  formatWeekday,
  parseCustomWeekdays,
  WEEKDAY_ORDER,
} from "@/lib/tasks-recurrence";
import type { AdminTasksDictionary } from "@/lib/admin-tasks-i18n";
import { partsOf } from "@/lib/task-directives";
import {
  anchorDateOf,
  dueDateOf as sharedDueDateOf,
  isActiveTask,
  isOverdueOneOff,
  isTodayOneOff,
  isTomorrowOneOff,
  occursOn as sharedOccursOn,
  overdueOccurrenceDatesOf,
  showsOnTodayList as sharedShowsOnTodayList,
  prioSort as sharedPrioSort,
} from "@/lib/task-predicates";
import { tokyoDateOf as sharedTokyoDateOf, tokyoToday as sharedTokyoToday, ymdShift } from "@/lib/tokyo-date";

// ── Tokyo 운영 날짜 — `@/lib/tokyo-date` 재수출 ────────────────────────────────
export const tokyoToday = sharedTokyoToday;
export const tokyoDateOf = sharedTokyoDateOf;
export const addDays = ymdShift;
function parseYmdUTC(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function weekdayIndex(ymd: string): number {
  return parseYmdUTC(ymd).getUTCDay();
}

// ── 날짜 포맷(로케일) ──────────────────────────────────────────────────────────
function localeTag(locale: Locale): string {
  return locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
}
export function fmtShort(ymd: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseYmdUTC(ymd));
}
export function fmtWeekday(ymd: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: "short", timeZone: "UTC" }).format(
    parseYmdUTC(ymd),
  );
}
export function fmtLong(ymd: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(parseYmdUTC(ymd));
}
function weekdayForRepeat(ymd: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    weekday: locale === "en" ? "long" : "short",
    timeZone: "UTC",
  }).format(parseYmdUTC(ymd));
}

// ── 템플릿 치환 ({n}/{name}/{wd}/{d}/{m}/{date}) ────────────────────────────────
export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

// ── 술어(meId 기준) ────────────────────────────────────────────────────────────
// 지시 관련 술어는 모바일(`tasks-workspace.tsx`)도 같은 규칙을 써야 하므로 `@/lib/task-directives`
// 한 곳에 두고 여기서는 재수출만 한다. 여기에 다시 정의하면 두 화면의 지시 판정이 갈라진다.
export {
  isMine,
  isSharedTask,
  myOwn,
  plainShared,
  recvInstr,
  sentInstr,
} from "@/lib/task-directives";
export { partsOf };
// `cancelled` 는 DB CHECK 에 있는 정식 상태다(`202606100003_todo_tasks.sql`). 여기서만 빠져 있어
// 취소된 작업이 콘솔의 관리함·오늘·캘린더에 계속 떠 있었다 — 서버 정본과 모바일에 맞춘다.
export const isActive = isActiveTask;
export const dueDateOf = sharedDueDateOf;
/** 마감(due) 우선, 없으면 예정일 — 공유 `anchorDateOf` 의 콘솔 이름. */
export const dateOf = anchorDateOf;
// 날짜 버킷 술어(오늘/내일/지연)는 **일회성 전용**이다. 반복(표준)은 완료해도 롤포워드하지 않고
// 각 회차가 독립적이므로(2026-07-30), 회차 기준으로 occursOn/회차 상태로 따로 처리한다.
export const isOverdue = isOverdueOneOff;
export const isTodayTask = isTodayOneOff;
export const isTomorrowTask = isTomorrowOneOff;

// ── 반복 회차(occurrence) 헬퍼 (2026-07-30) ──────────────────────────────────────
/** 표준 반복의 앵커(마감/예정, 고정). 회차 계산의 시작점. */
export const recurrenceAnchor = anchorDateOf;
/** 이 작업이 `ymd`에 걸리는가 — 반복은 규칙으로, 비반복은 앵커 하루. */
export const occursOn = sharedOccursOn;
/** 미해결 지연 회차 날짜들(과거 · 상태 없음). `resolved`는 해당 작업의 회차상태 보유 날짜 집합. */
export const overdueOccurrenceDates = overdueOccurrenceDatesOf;
/** 반복이 오늘 목록에 떠야 하는가 — 오늘 회차이거나 밀린 회차가 있으면(2026-09-08). */
export const showsOnTodayList = sharedShowsOnTodayList;
export function completedDateOf(t: TaskRecord): string | null {
  return tokyoDateOf(t.completedAt);
}

// ── 정렬 ────────────────────────────────────────────────────────────────────────
// 우선순위 사다리(2026-07-30, Todoist P1~P4): urgent(1) > important(2) > medium(3) > normal(4=기본).
export const prioSort = sharedPrioSort;
export function dateSort(a: TaskRecord, b: TaskRecord): number {
  return (dateOf(a) ?? "9999-99-99").localeCompare(dateOf(b) ?? "9999-99-99");
}

// ── 라벨(다국어) ────────────────────────────────────────────────────────────────
export function prioLabel(prio: string, d: AdminTasksDictionary): string {
  return prio === "urgent"
    ? d.prioUrgent
    : prio === "important"
      ? d.prioImportant
      : prio === "medium"
        ? d.prioMedium
        : d.prioNormal;
}
/**
 * 시스템 로그(노트가 아닌 `task_updates`) 한 줄 라벨.
 *
 * 모바일 `task-detail-view.tsx` 의 `systemLabel` 과 **같은 update_type 집합**을 덮되, 콘솔 로그의
 * 기존 관례("{name} 님이 작업 생성")에 맞춰 행위자를 문장 안에 넣는다. `status_changed` 의 목적
 * 상태는 `body` 에 실려 온다(모바일과 동일).
 */
export function systemLogLabel(
  type: string,
  body: string | null,
  name: string,
  d: AdminTasksDictionary,
): string {
  const tpl =
    type === "system_shared"
      ? d.logShared
      : type === "system_edited"
        ? d.logEdited
        : type === "completed"
          ? d.logCompleted
          : type === "reopened"
            ? d.logReopened
            : type === "status_changed"
              ? body === "in_progress"
                ? d.logInProgress
                : d.logOpen
              : d.logUpdated;
  return fill(tpl, { name });
}

export function statusLabel(status: string, d: AdminTasksDictionary): string {
  return status === "completed"
    ? d.stCompleted
    : status === "in_progress"
      ? d.stInProgress
      : d.stOpen;
}

// 사용자가 고를 수 있는 반복 규칙. 요일 없는 bare `custom` 은 round-trip 전용이라 여기 없고,
// 사용자 지정 요일 반복(`custom:1,3,5`)은 별도 빌더로 만든다.
//
// `yearly` 는 예전 주석이 "백엔드 미지원" 이라 적어 뒀지만 **엔진은 처음부터 지원**한다
// (`src/lib/tasks.ts` / `tasks-recurrence.ts` 양쪽에 케이스 존재, 아래 `repeatLabel` 도 처리).
// 모바일에서는 만들 수 있는데 콘솔에서만 못 만드는 비대칭이라 목록에 넣는다(2026-07-31).
export const REPEAT_RULES = [
  "none",
  "daily",
  "weekly",
  "weekdays",
  "weekends",
  "monthly",
  "yearly",
] as const;
export type RepeatRule = (typeof REPEAT_RULES)[number];

// 요일 순서/이름은 모바일과 공유(@/lib/tasks-recurrence) — 두 화면이 어긋나지 않게 한 곳에서만 정의.
export { WEEKDAY_ORDER };

/** 요일 숫자 → 로케일 짧은 이름("월"/"月"/"Mon"). */
export function weekdayShortName(weekday: number, locale: Locale): string {
  return formatWeekday(weekday, localeTag(locale));
}

/** `custom:1,3,5` → "월·수·금". Thin wrapper so admin and mobile render the format identically. */
export function customWeekdayNames(rule: string | null, locale: Locale): string {
  return formatCustomWeekdays(rule, localeTag(locale));
}

export function repeatLabel(
  rule: string | null,
  anchorYmd: string | null,
  today: string,
  locale: Locale,
  d: AdminTasksDictionary,
): string {
  const anchor = anchorYmd ?? today;
  const customNames = customWeekdayNames(rule, locale);
  if (customNames) return fill(d.repCustomDays, { wd: customNames });
  switch (rule) {
    case "daily":
      return d.repDaily;
    case "weekly":
      return fill(d.repWeekly, { wd: weekdayForRepeat(anchor, locale) });
    case "weekdays":
      return d.repWeekdays;
    case "weekends":
      return d.repShortWeekends;
    case "monthly":
      return fill(d.repMonthly, { d: Number(anchor.split("-")[2]) });
    // 콘솔에서 새로 지정할 수는 없지만(REPEAT_RULES 제외) 모바일이 만든 값은 반드시 제대로 읽어야
    // 한다 — 이 분기가 없으면 `default` 로 떨어져 "반복 없음"이라고 거짓 표시된다(2026-07-30 수정).
    case "yearly":
      return fill(d.repYearly, {
        m: Number(anchor.split("-")[1]),
        d: Number(anchor.split("-")[2]),
      });
    case "custom":
      return d.repCustom;
    default:
      return d.repNone;
  }
}
export function repeatShort(
  rule: string | null,
  d: AdminTasksDictionary,
  locale?: Locale,
): string {
  // 행 칩은 공간이 좁아 요일 이름만 노출한다("월·수·금"). locale 없이 불리면 공용 라벨로 폴백.
  if (parseCustomWeekdays(rule)) {
    return locale ? customWeekdayNames(rule, locale) : d.repCustom;
  }
  switch (rule) {
    case "daily":
      return d.repDaily;
    case "weekly":
      return d.repShortWeekly;
    case "weekdays":
      return d.repShortWeekdays;
    case "weekends":
      return d.repShortWeekends;
    case "monthly":
      return d.repShortMonthly;
    case "yearly":
      return d.repShortYearly;
    case "custom":
      return d.repCustom;
    default:
      return "";
  }
}

// 기간(분) — 백엔드는 1–1440 자유값이지만 UI 는 프리셋만 제공. 라벨은 프리셋만 매핑.
/** 문자열 문구 키만(`w` 같은 묶음 제외) — `d[key]` 가 늘 문자열이 되게. */
type StringKey = { [K in keyof AdminTasksDictionary]: AdminTasksDictionary[K] extends string ? K : never }[keyof AdminTasksDictionary];
export const DURATION_OPTIONS: { value: number | null; key: StringKey }[] = [
  { value: null, key: "durNone" },
  { value: 15, key: "dur15" },
  { value: 30, key: "dur30" },
  { value: 60, key: "dur60" },
  { value: 120, key: "dur120" },
];
export function durLabel(mins: number | null, d: AdminTasksDictionary): string {
  if (mins == null) return "";
  const opt = DURATION_OPTIONS.find((o) => o.value === mins);
  return opt ? d[opt.key] : "";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
export function timeRange(timeLabel: string | null, dur: number | null): string | null {
  if (!timeLabel) return null;
  if (!dur) return timeLabel;
  const [h, m] = timeLabel.split(":").map(Number);
  const total = h * 60 + m + dur;
  const end = `${pad2(Math.floor((total % 1440) / 60))}:${pad2(total % 60)}`;
  return `${timeLabel}–${end}`;
}

// ── 아바타(디자인 AV 팔레트) ────────────────────────────────────────────────────
const AV_ME = "#3a4c7a";
const AV_PALETTE = ["#8a5a2c", "#4b7a63", "#7a4b6a", "#9a6210", "#5a6a7a", "#6a4b8a", "#8a4b4b"];
export function avatarColor(id: string, meId: string): string {
  if (id === meId) return AV_ME;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}
export function initial(name: string): string {
  const t = (name || "").trim();
  return t ? Array.from(t)[0] : "?";
}

// ── 연결된 컨텍스트 → 칩 배열 ────────────────────────────────────────────────────
export type CtxItem = { k: "building" | "bed" | "ticket" | "guest"; v: string; reservationId: string | null };
export function ctxItems(t: TaskRecord): CtxItem[] {
  const c = t.resolvedContext;
  if (!c) return [];
  const out: CtxItem[] = [];
  if (c.propertyName) out.push({ k: "building", v: c.propertyName, reservationId: null });
  if (c.roomLabel) out.push({ k: "bed", v: c.roomLabel, reservationId: null });
  if (c.guestName) out.push({ k: "guest", v: c.guestName, reservationId: null });
  if (c.reservationId) {
    const range = [c.checkinDate, c.checkoutDate].filter(Boolean).join(" → ");
    out.push({ k: "ticket", v: range || c.channel || c.reservationId, reservationId: c.reservationId });
  }
  return out;
}

// ── 검색/우선순위/날짜 필터 ─────────────────────────────────────────────────────
export type DateFilterKey = "today" | "week" | "overdue" | "nodate";
export function matchQuery(t: TaskRecord, q: string, nameOf: (id: string) => string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (t.title.toLowerCase().includes(needle)) return true;
  if (nameOf(t.createdByUserId).toLowerCase().includes(needle)) return true;
  return t.tags.some((g) => g.toLowerCase().includes(needle));
}
export function matchPrio(t: TaskRecord, prio: string): boolean {
  return !prio || t.priority === prio;
}
export function matchDate(t: TaskRecord, key: DateFilterKey | null, today: string): boolean {
  if (!key) return true;
  const d = dateOf(t);
  if (key === "nodate") return !d;
  if (key === "overdue") return isOverdue(t, today);
  if (key === "today") return d === today;
  if (key === "week") {
    const end = addDays(today, 6);
    return !!d && d >= today && d <= end;
  }
  return true;
}
