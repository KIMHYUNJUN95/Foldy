import { cache } from "react";

import { tokyoDateOf, tokyoToday, ymdShift } from "@/lib/tokyo-date";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";
import type { AppSession } from "@/lib/session";
import { isOwnerOrPlatformDeveloper } from "@/config/roles";
// The custom-weekday rule format has exactly one parser, and it lives in the client-safe twin so
// the two recurrence tables can't drift apart on it (see that file's header warning).
import {
  buildCustomRecurrenceRule,
  isCustomWeekdayRecurrence,
  type OccurrenceState,
  parseCustomWeekdays,
} from "@/lib/tasks-recurrence";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type ParticipantRow = Database["public"]["Tables"]["task_participants"]["Row"];
type UpdateRow = Database["public"]["Tables"]["task_updates"]["Row"];

/**
 * 조회할 컬럼 목록. **문자열 리터럴이어야 한다** — 배열을 `.join()` 하면 타입 수준에서 파싱할 수
 * 없어 `.select()` 결과가 `GenericStringError` 로 떨어지고, 호출부가 캐스트로 때우게 된다.
 * 리터럴로 두면 PostgREST 타입 파서가 행 모양을 직접 만들어 준다.
 */
const TASK_SELECT = "id, organization_id, created_by_user_id, title, description, scheduled_date, due_at, all_day, time_label, duration_minutes, priority, sort_order, status, project_id, section_id, is_inbox, is_directive, recurrence_rule, recurrence_series_id, recurrence_instance_date, tags, image_urls, completed_at, completed_by_user_id, created_at, updated_at, property_id, room_id, reservation_id, guest_name" as const;

export type TaskParticipant = {
  userId: string;
  name: string;
  role: string;
  isFirstRecipient: boolean;
};

/** Resolved display data for a task's linked context (property, room, reservation). */
export type LinkedTaskContext = {
  /** Raw saved UUIDs — passed back to the edit form so a link round-trips without re-picking. */
  propertyId: string | null;
  roomId: string | null;
  propertyName: string | null;
  roomLabel: string | null;
  guestName: string | null;
  channel: "airbnb" | "booking" | "direct" | null;
  checkinDate: string | null;
  checkoutDate: string | null;
  nightsCount: number | null;
  reservationId: string | null;
};

export type TaskUpdateEntry = {
  id: string;
  type: string;
  body: string | null;
  imageUrls: string[];
  createdAt: string;
  byUserId: string | null;
  byName: string;
};

export type TaskRecord = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  authorName: string;
  title: string;
  description: string | null;
  scheduledDate: string | null;
  dueAt: string | null;
  allDay: boolean;
  timeLabel: string | null;
  durationMinutes: number | null;
  priority: string;
  sortOrder: number | null;
  status: string;
  projectId: string | null;
  sectionId: string | null;
  isInbox: boolean;
  isShared: boolean;
  isDirective: boolean;
  recurrenceRule: string | null;
  recurrenceSeriesId: string | null;
  recurrenceInstanceDate: string | null;
  tags: string[];
  imageUrls: string[];
  completedAt: string | null;
  completedByUserId: string | null;
  completedByName: string;
  createdAt: string;
  updatedAt: string;
  participants: TaskParticipant[];
  resolvedContext: LinkedTaskContext | null;
};

export type TaskDetail = TaskRecord & { updates: TaskUpdateEntry[] };

export type ShareableUser = { id: string; name: string; role: string };

function isMissingTable(message: string): boolean {
  return message.includes("does not exist") || message.includes("schema cache");
}

type ProfileName = { id: string; name: string };

/**
 * Tokyo 날짜 유틸은 `@/lib/tokyo-date`(순수 모듈)가 정본이다 — 서버·클라이언트가 같은 구현을 본다.
 * 서버 쪽 호출부를 그대로 두려고 여기서 재수출한다.
 *
 * 예전에는 `tokyoToday()` 가 `getCleaningOperatingDateKey()` 를 거쳤다. 결과는 지금도 동일하지만
 * (둘 다 컷오버 없는 도쿄 달력 날짜), 청소 모듈에 운영일 컷오버가 생기면 투두가 조용히 따라가게
 * 되는 우연한 결합이었다. 명시적으로 끊는다.
 */
export { tokyoDateOf, tokyoToday, ymdShift };

/** The single date a task is anchored to for list/calendar grouping (due wins over scheduled). */
export function taskAnchorDate(task: TaskRecord): string | null {
  return tokyoDateOf(task.dueAt) ?? task.scheduledDate ?? null;
}

export type NormalizedTaskDateTime = {
  scheduledDate: string | null;
  dueAt: string | null;
  allDay: boolean;
  timeLabel: string | null;
};

/**
 * Single source of truth for how task date/time form inputs persist — shared by
 * `createTask` and `updateTaskCore` so the two never drift.
 *
 * Rule:
 * - `time_label` is the task's optional time-of-day ("HH:MM"); `all_day = no time-of-day`.
 * - a time is only kept when the task is anchored to a date (scheduled or due); with no
 *   date at all the time is dropped and the task stays all-day (no floating time).
 * - `due_at` carries the time only when a due date exists (Tokyo, +09:00); an all-day due
 *   date is stored at 00:00 local — the existing intentional pattern, since `anchor()`
 *   reads only the Tokyo calendar date. With no due date, `due_at` is null even if a time
 *   shows on the scheduled date (time_label drives display, not due_at).
 * - invalid/partial date or time strings are treated as unset.
 */
/** Recurrence rules a user may newly assign in this slice (lightweight, display-only). */
export const STANDARD_RECURRENCE_RULES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "weekdays",
  "weekends",
] as const;
type StandardRecurrenceRule = (typeof STANDARD_RECURRENCE_RULES)[number];

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function ymdDiffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / (1000 * 60 * 60 * 24));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonthlyYmd(ymd: string, months: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
  return formatYmd(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

function shiftYearlyYmd(ymd: string, years: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const targetYear = year + years;
  return formatYmd(targetYear, month, Math.min(day, daysInMonth(targetYear, month)));
}

export function taskAnchorDateInput(input: {
  scheduledDate: string | null;
  dueAt: string | null;
}): string | null {
  return tokyoDateOf(input.dueAt) ?? input.scheduledDate ?? null;
}

export function taskNeedsRecurrenceDate(
  recurrenceRule: string | null,
  anchorDate: string | null,
): boolean {
  return !!recurrenceRule && !anchorDate;
}

/** The six literal rules only — use `hasRecurrenceMath` for the "is this recurring?" gate. */
function isStandardRecurrenceRule(value: string | null): value is StandardRecurrenceRule {
  return !!value && (STANDARD_RECURRENCE_RULES as readonly string[]).includes(value);
}

/**
 * True when the rule rolls forward — the six standard rules plus a custom weekday rule.
 * MUST stay in lockstep with `isStandardRecurrence` in `@/lib/tasks-recurrence`.
 */
function hasRecurrenceMath(value: string | null): value is string {
  return isStandardRecurrenceRule(value) || isCustomWeekdayRecurrence(value);
}

/** Next date strictly after `fromDate` whose weekday is in the set. */
function stepToWeekday(weekdays: readonly number[], fromDate: string, step: 1 | -1): string {
  let cursor = ymdShift(fromDate, step);
  for (let guard = 0; guard < 7; guard++) {
    const [year, month, day] = cursor.split("-").map(Number);
    if (weekdays.includes(new Date(Date.UTC(year, month - 1, day)).getUTCDay())) return cursor;
    cursor = ymdShift(cursor, step);
  }
  return cursor;
}

function nextOccurrenceDate(rule: string, fromDate: string): string {
  const customDays = parseCustomWeekdays(rule);
  if (customDays) return stepToWeekday(customDays, fromDate, 1);
  if (rule === "daily") return ymdShift(fromDate, 1);
  if (rule === "weekly") return ymdShift(fromDate, 7);
  if (rule === "monthly") return shiftMonthlyYmd(fromDate, 1);
  if (rule === "yearly") return shiftYearlyYmd(fromDate, 1);

  let cursor = ymdShift(fromDate, 1);
  while (true) {
    const [year, month, day] = cursor.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const matches =
      rule === "weekdays"
        ? weekday >= 1 && weekday <= 5
        : weekday === 0 || weekday === 6;
    if (matches) return cursor;
    cursor = ymdShift(cursor, 1);
  }
}

function previousOccurrenceDate(rule: string, fromDate: string): string {
  const customDays = parseCustomWeekdays(rule);
  if (customDays) return stepToWeekday(customDays, fromDate, -1);
  if (rule === "daily") return ymdShift(fromDate, -1);
  if (rule === "weekly") return ymdShift(fromDate, -7);
  if (rule === "monthly") return shiftMonthlyYmd(fromDate, -1);
  if (rule === "yearly") return shiftYearlyYmd(fromDate, -1);

  let cursor = ymdShift(fromDate, -1);
  while (true) {
    const [year, month, day] = cursor.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const matches =
      rule === "weekdays" ? weekday >= 1 && weekday <= 5 : weekday === 0 || weekday === 6;
    if (matches) return cursor;
    cursor = ymdShift(cursor, -1);
  }
}

// ── Todoist-style recurrence (single live task, no pre-materialized instances) ────────────────
// A recurring task is ONE row carrying a `recurrence_rule` + its current occurrence date.
// Completing it rolls the same row forward to the next occurrence; the calendar expands future
// occurrences virtually (display-only). The pure, client-safe date math (isStandardRecurrence /
// recurringOccurrencesInRange) lives in `@/lib/tasks-recurrence`; the TaskRecord-bound helpers
// below are used by the server actions.

/** The task's current occurrence date (recurrence anchor), or null if not dated. */
function currentInstanceOf(task: TaskRecord): string | null {
  return task.recurrenceInstanceDate ?? taskAnchorDate(task);
}

/**
 * Next occurrence date for a recurring task, or null if it is not a standard recurring task.
 *
 * If the task was completed late (its current occurrence is already in the past), the next
 * occurrence is advanced past today so it lands in the future — Todoist's "don't pile up overdue"
 * behavior, rather than grinding through every missed day one completion at a time. The rule's
 * weekday / day-of-month anchor is preserved (we iterate the rule, never jump to a raw `today`).
 */
export function nextRecurringInstance(task: TaskRecord): string | null {
  if (!hasRecurrenceMath(task.recurrenceRule)) return null;
  const current = currentInstanceOf(task);
  if (!current) return null;
  const today = tokyoToday();
  let next = nextOccurrenceDate(task.recurrenceRule, current);
  let guard = 0;
  while (next <= today && guard++ < 1000) next = nextOccurrenceDate(task.recurrenceRule, next);
  return next;
}

/** Previous occurrence date (used to undo a roll-forward), or null if not standard recurring. */
export function previousRecurringInstance(task: TaskRecord): string | null {
  if (!hasRecurrenceMath(task.recurrenceRule)) return null;
  const current = currentInstanceOf(task);
  return current ? previousOccurrenceDate(task.recurrenceRule, current) : null;
}

/**
 * Date fields for moving a recurring task to `targetInstance`, preserving the scheduled/due offsets
 * and time-of-day. Returns null if the task has no current occurrence date.
 */
export function shiftRecurringTaskDates(
  task: TaskRecord,
  targetInstance: string,
): { scheduledDate: string | null; dueAt: string | null; recurrenceInstanceDate: string } | null {
  const current = currentInstanceOf(task);
  if (!current) return null;
  const delta = ymdDiffDays(current, targetInstance);
  const scheduledDate = task.scheduledDate ? ymdShift(task.scheduledDate, delta) : null;
  const dueDate = tokyoDateOf(task.dueAt);
  const dueAt = dueDate
    ? new Date(`${ymdShift(dueDate, delta)}T${task.timeLabel || "00:00"}:00+09:00`).toISOString()
    : null;
  return { scheduledDate, dueAt, recurrenceInstanceDate: targetInstance };
}

/**
 * Resolve a submitted recurrence rule to its stored value — the server-side contract that
 * matches the documented product rule (not a UI-only restriction):
 * - a standard rule passes through;
 * - a **custom weekday rule** (`custom:1,3,5`) is re-parsed and re-serialized, so a crafted
 *   request can't store a malformed, duplicated, or unsorted set (added 2026-07-29);
 * - empty / unrecognized fails closed to `null` (non-recurring);
 * - bare `custom` (no weekday set) stays **round-trip only**: kept solely when the task already
 *   had it (`previousRule === "custom"`), never newly assignable. It predates the weekday builder
 *   and carries no schedule, so it must not become newly creatable.
 */
export function resolveRecurrenceRule(
  submitted: string,
  previousRule: string | null,
): string | null {
  if ((STANDARD_RECURRENCE_RULES as readonly string[]).includes(submitted)) return submitted;
  // Normalize rather than pass through: `custom:5,1,1` is stored as `custom:1,5`.
  const customDays = parseCustomWeekdays(submitted);
  if (customDays) return buildCustomRecurrenceRule(customDays);
  if (submitted === "custom" && previousRule === "custom") return "custom";
  return null;
}

/**
 * True when a specific time was entered but there is no date anchor (neither scheduled
 * nor due). Such a submission is rejected — `normalizeTaskDateTime` would otherwise drop
 * the time silently, which reads as data loss to the user. Enforced in the form and in
 * both server actions (create + edit).
 */
export function taskTimeWithoutDate(input: {
  scheduledDate: string;
  dueDate: string;
  time: string;
}): boolean {
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isTime = (v: string) => /^\d{2}:\d{2}$/.test(v);
  return isTime(input.time) && !isDate(input.scheduledDate) && !isDate(input.dueDate);
}

export function normalizeTaskDateTime(input: {
  scheduledDate: string;
  dueDate: string;
  time: string;
}): NormalizedTaskDateTime {
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isTime = (v: string) => /^\d{2}:\d{2}$/.test(v);
  const scheduledDate = isDate(input.scheduledDate) ? input.scheduledDate : null;
  const dueDate = isDate(input.dueDate) ? input.dueDate : null;
  const time = isTime(input.time) ? input.time : "";
  const timeOfDay = scheduledDate || dueDate ? time : "";
  const dueAt = dueDate
    ? new Date(`${dueDate}T${timeOfDay || "00:00"}:00+09:00`).toISOString()
    : null;
  return {
    scheduledDate,
    dueAt,
    allDay: !timeOfDay,
    timeLabel: timeOfDay || null,
  };
}

export function isTaskActive(task: TaskRecord): boolean {
  return task.status !== "completed" && task.status !== "cancelled";
}

export function isTaskOverdue(task: TaskRecord): boolean {
  const due = tokyoDateOf(task.dueAt);
  return isTaskActive(task) && !!due && due < tokyoToday();
}

export function isTaskToday(task: TaskRecord): boolean {
  if (!isTaskActive(task) || isTaskOverdue(task)) return false;
  const today = tokyoToday();
  return task.scheduledDate === today || tokyoDateOf(task.dueAt) === today;
}

/**
 * 작업 본문 · 일정 · 삭제 · 참여자 빼기 같은 「작성자만」 동작의 게이트. 플랫폼 개발자는 예외로 통과한다
 * (2026-10-23 「개발자는 전부 가능」). 개발자가 열 수 있는 작업(getTaskScope 범위) 안에서만 쓰인다.
 */
export function canEditTaskCore(
  session: Pick<AppSession, "user">,
  task: Pick<TaskRecord, "createdByUserId">,
): boolean {
  return isOwnerOrPlatformDeveloper(session.user, task.createdByUserId);
}

type ResContextRow = {
  id: string;
  property_name: string;
  room_label: string;
  source: string;
  check_in_date: string;
  check_out_date: string;
  guest_name: string;
};
type PropContextRow = { id: string; name: string };
type RoomContextRow = { id: string; room_label: string };

function detectChannel(source: string): "airbnb" | "booking" | "direct" {
  const s = (source ?? "").toLowerCase();
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("booking")) return "booking";
  return "direct";
}

function buildLinkedContext(
  r: TaskRow,
  reservationMap: Map<string, ResContextRow>,
  propertyNameMap: Map<string, string>,
  roomLabelMap: Map<string, string>,
): LinkedTaskContext | null {
  const hasAny = r.reservation_id || r.property_id || r.room_id || r.guest_name;
  if (!hasAny) return null;

  if (r.reservation_id) {
    const res = reservationMap.get(r.reservation_id);
    if (res) {
      const msPerDay = 1000 * 60 * 60 * 24;
      const nightsCount = Math.round(
        (new Date(res.check_out_date).getTime() - new Date(res.check_in_date).getTime()) / msPerDay,
      );
      // Normalize to canonical property + merged display room label so chips/detail read the
      // same as the calendar and picker (e.g. "荒木町A" / "201_2" → "아라키초A" / "201").
      const canonProp = getCanonicalPropertyName(res.property_name);
      const displayRoom = getDisplayRoomLabel(
        canonProp,
        getCanonicalRoomLabel(canonProp, res.room_label),
      );
      return {
        propertyId: r.property_id,
        roomId: r.room_id,
        propertyName: canonProp,
        roomLabel: displayRoom,
        guestName: r.guest_name ?? res.guest_name,
        channel: detectChannel(res.source),
        checkinDate: res.check_in_date,
        checkoutDate: res.check_out_date,
        nightsCount,
        reservationId: r.reservation_id,
      };
    }
  }

  // Room-only / property-only link: resolve raw names from the joined property/room rows, then
  // normalize to canonical property + merged display room label (matches the reservation branch).
  const rawPropertyName = r.property_id ? (propertyNameMap.get(r.property_id) ?? null) : null;
  const rawRoomLabel = r.room_id ? (roomLabelMap.get(r.room_id) ?? null) : null;
  const canonProp = rawPropertyName ? getCanonicalPropertyName(rawPropertyName) : null;
  const displayRoom =
    canonProp && rawRoomLabel
      ? getDisplayRoomLabel(canonProp, getCanonicalRoomLabel(canonProp, rawRoomLabel))
      : rawRoomLabel;

  return {
    propertyId: r.property_id,
    roomId: r.room_id,
    propertyName: canonProp ?? rawPropertyName,
    roomLabel: displayRoom,
    guestName: r.guest_name ?? null,
    channel: null,
    checkinDate: null,
    checkoutDate: null,
    nightsCount: null,
    reservationId: null,
  };
}

async function hydrate(rows: TaskRow[]): Promise<TaskRecord[]> {
  if (rows.length === 0) return [];
  const supabase = await getSupabaseServerClient();
  const taskIds = rows.map((r) => r.id);

  const { data: partData } = await supabase
    .from("task_participants")
    .select("task_id, user_id, role, is_first_recipient")
    .in("task_id", taskIds);
  const parts = (partData ?? []) as Array<
    Pick<ParticipantRow, "task_id" | "user_id" | "role" | "is_first_recipient">
  >;

  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(r.created_by_user_id);
    if (r.completed_by_user_id) userIds.add(r.completed_by_user_id);
  }
  for (const p of parts) userIds.add(p.user_id);

  // Context resolution — collect IDs for batch joins
  const reservationIds = rows.map((r) => r.reservation_id).filter((v): v is string => !!v);
  const propertyIdsNoRes = [
    ...new Set(
      rows
        .filter((r) => !r.reservation_id && r.property_id)
        .map((r) => r.property_id)
        .filter((v): v is string => !!v),
    ),
  ];
  const roomIdsNoRes = [
    ...new Set(
      rows
        .filter((r) => !r.reservation_id && r.room_id)
        .map((r) => r.room_id)
        .filter((v): v is string => !!v),
    ),
  ];

  const [profiles, resRows, propRows, roomRows] = await Promise.all([
    userIds.size > 0
      ? supabase.from("profiles").select("id, name").in("id", Array.from(userIds)).then((r) => (r.data ?? []) as ProfileName[])
      : Promise.resolve([] as ProfileName[]),
    reservationIds.length > 0
      ? supabase
          .from("reservations")
          .select("id, property_name, room_label, source, check_in_date, check_out_date, guest_name")
          .in("id", reservationIds)
          .then((r) => (r.data ?? []) as ResContextRow[])
      : Promise.resolve([] as ResContextRow[]),
    propertyIdsNoRes.length > 0
      ? supabase.from("properties").select("id, name").in("id", propertyIdsNoRes).then((r) => (r.data ?? []) as PropContextRow[])
      : Promise.resolve([] as PropContextRow[]),
    roomIdsNoRes.length > 0
      ? supabase.from("rooms").select("id, room_label").in("id", roomIdsNoRes).then((r) => (r.data ?? []) as RoomContextRow[])
      : Promise.resolve([] as RoomContextRow[]),
  ]);

  const names = new Map<string, string>();
  for (const p of profiles) names.set(p.id, p.name);

  const reservationMap = new Map(resRows.map((r) => [r.id, r]));
  const propertyNameMap = new Map(propRows.map((p) => [p.id, p.name]));
  const roomLabelMap = new Map(roomRows.map((r) => [r.id, r.room_label]));

  const partsByTask = new Map<string, TaskParticipant[]>();
  for (const p of parts) {
    const list = partsByTask.get(p.task_id) ?? [];
    list.push({
      userId: p.user_id,
      name: names.get(p.user_id) ?? "",
      role: p.role,
      isFirstRecipient: p.is_first_recipient,
    });
    partsByTask.set(p.task_id, list);
  }

  return rows.map((r) => {
    const participants = partsByTask.get(r.id) ?? [];
    const sharedCount = participants.filter((p) => p.role !== "author").length;
    return {
      id: r.id,
      organizationId: r.organization_id,
      createdByUserId: r.created_by_user_id,
      authorName: names.get(r.created_by_user_id) ?? "",
      title: r.title,
      description: r.description,
      scheduledDate: r.scheduled_date,
      dueAt: r.due_at,
      allDay: r.all_day,
      timeLabel: r.time_label,
      durationMinutes: r.duration_minutes ?? null,
      priority: r.priority,
      sortOrder: r.sort_order ?? null,
      status: r.status,
      projectId: r.project_id ?? null,
      sectionId: r.section_id ?? null,
      isInbox: r.is_inbox,
      isShared: sharedCount > 0,
      isDirective: r.is_directive ?? false,
      recurrenceRule: r.recurrence_rule,
      recurrenceSeriesId: r.recurrence_series_id ?? null,
      recurrenceInstanceDate: r.recurrence_instance_date ?? null,
      tags: r.tags ?? [],
      imageUrls: r.image_urls ?? [],
      completedAt: r.completed_at,
      completedByUserId: r.completed_by_user_id,
      completedByName: r.completed_by_user_id ? names.get(r.completed_by_user_id) ?? "" : "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      participants,
      resolvedContext: buildLinkedContext(r, reservationMap, propertyNameMap, roomLabelMap),
    };
  });
}

// ── 개인 투두 가시 범위 ───────────────────────────────────────────────────────

/** 뷰어가 볼 수 있는 작업 id / 프로젝트 id 집합. */
export type TaskScope = { taskIds: Set<string>; projectIds: Set<string> };

/**
 * **투두는 개인 공간이다(2026-09-09 확정).**
 *
 * 남의 작업이 내 화면에 들어오는 경로는 셋뿐이다 — 공유받은 작업, 받은 지시, 내가 속한 프로젝트의
 * 작업. 셋 다 결국 «참여자 행이 있는가»로 판정된다(`task_participants` / `project_participants`).
 *
 * 원래 이 판정은 **RLS 에만** 맡겨져 있었다. 그런데 `tasks` 의 select 정책은
 * `is_platform_admin()` 이면 참여자 조건을 통째로 건너뛴다(`202609030002_task_rls_org_scope.sql`).
 * 그래서 플랫폼 관리자 계정 하나가 조직 전원의 개인 투두를 자기 「오늘」 목록에서 보고 있었다 —
 * 남이 만든 작업이라 행 앞에 「작성자 →」 접두사까지 붙은 채로.
 *
 * 정책의 관리자 예외는 **그대로 둔다**(조직 간 운영·복구용). 대신 투두 화면이 쓰는 읽기 경로를
 * 여기서 다시 좁힌다 — 조직 격리와 같은 원칙(서버에서 강제, UI 필터에 의존하지 않음)이다.
 *
 * `cache()` 로 요청당 1회만 계산한다. 한 페이지 로드가 목록/회차/완료로그를 병렬로 읽으므로
 * 매번 다시 조회하면 같은 쿼리가 서너 번 나간다.
 */
const loadTaskScope = cache(
  async (userId: string, organizationId: string): Promise<TaskScope> => {
    const supabase = await getSupabaseServerClient();
    const [partRes, projRes] = await Promise.all([
      supabase.from("task_participants").select("task_id").eq("user_id", userId),
      supabase.from("project_participants").select("project_id").eq("user_id", userId),
    ]);
    const taskIds = new Set<string>();
    for (const r of (partRes.data ?? []) as Array<{ task_id: string }>) taskIds.add(r.task_id);
    const projectIds = new Set<string>();
    for (const r of (projRes.data ?? []) as Array<{ project_id: string }>) {
      projectIds.add(r.project_id);
    }
    // 프로젝트 작업은 작업별 참여자 없이 프로젝트 소속만으로 보인다 — 그 id 들도 범위에 넣어야
    // 회차/완료 로그 필터가 프로젝트 작업을 잘라내지 않는다.
    if (projectIds.size > 0) {
      const { data } = await supabase
        .from("tasks")
        .select("id")
        .eq("organization_id", organizationId)
        .in("project_id", Array.from(projectIds));
      for (const r of (data ?? []) as Array<{ id: string }>) taskIds.add(r.id);
    }
    return { taskIds, projectIds };
  },
);

/** 세션 뷰어의 투두 가시 범위(요청당 메모이즈). */
export function getTaskScope(session: AppSession): Promise<TaskScope> {
  return loadTaskScope(session.user.id, session.organization.id);
}

/** All tasks visible to the current user (RLS-scoped to participant membership). */
/**
 * 오래된 «끝난» 작업을 목록 로드에서 잘라내는 창(일). 완료 로그(`getTaskCompletions`, 120일)보다
 * 넉넉해야 한다 — 완료·기록 탭은 로그의 각 기록을 이 목록에서 찾아 행으로 그리므로, 창이 로그보다
 * 좁으면 기록은 있는데 행이 없는 상태가 된다.
 */
const FINISHED_TASK_WINDOW_DAYS = 180;

/**
 * 이 조직에서 사용자가 볼 수 있는 작업(RLS 스코프).
 *
 * **살아 있는 작업(open/in_progress)은 아무리 오래돼도 전부 가져온다** — 지연은 영구 유지가 계약이라
 * (2026-07-30) 여기서 자르면 밀린 일이 화면에서 증발한다. 창을 거는 대상은 «끝난» 작업뿐이다.
 *
 * 예전에는 조건이 하나도 없어 조직의 모든 미삭제 작업을 매 로드마다 실어 날랐다. 이 조직은 실측
 * 71건 중 62건(87%)이 완료 상태이고 완료 작업은 영원히 빠지지 않는다 — 하루 ~3건 생성 페이스라
 * 목록 무게가 사실상 완료 이력에 비례해 늘고 있었다. 모바일과 콘솔이 둘 다 이 함수를 쓴다.
 *
 * 안전장치로 `created_at` 도 함께 본다: `completed_at` 이 비어 있는 레거시 완료 행이 있어도 최근에
 * 만들어졌다면 남는다.
 */
export async function getVisibleTasks(session: AppSession): Promise<TaskRecord[]> {
  const supabase = await getSupabaseServerClient();
  const scope = await getTaskScope(session);
  const since = new Date(
    `${ymdShift(tokyoToday(), -FINISHED_TASK_WINDOW_DAYS)}T00:00:00+09:00`,
  ).toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("organization_id", session.organization.id)
    .is("deleted_at", null) // soft-delete: hide deleted tasks (undo restores them)
    .or(
      [
        "status.eq.open",
        "status.eq.in_progress",
        `completed_at.gte.${since}`,
        `created_at.gte.${since}`,
      ].join(","),
    )
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  // 참여 범위로 다시 좁힌다 — RLS 의 플랫폼 관리자 예외가 남의 개인 투두를 통과시키기 때문이다.
  return hydrate(((data ?? []) as TaskRow[]).filter((r) => scope.taskIds.has(r.id)));
}

/**
 * 여러 id 를 **한 번에** 읽는다(RLS 스코프) — 일괄 작업이 id 마다 `getTaskDetail` 을 부르지 않도록.
 *
 * `getTaskDetail` 은 한 건당 tasks + task_updates + 참여자 + 컨텍스트를 읽는다. 콘솔의 일괄 삭제는
 * 최대 200건을 그렇게 돌려서 한 번의 클릭이 수백 쿼리로 번졌다. `hydrate` 는 애초에 배치 조회라
 * 여기서는 건수와 무관하게 쿼리 수가 고정이다.
 *
 * 반환은 RLS 가 읽도록 허용한 것만 담긴다 — 결과에 없는 id 는 «권한 없음 또는 없음»이므로,
 * 호출부가 그걸 그대로 실패로 보고하면 된다. 조직 스코프도 함께 건다.
 */
export async function getTasksByIds(session: AppSession, ids: string[]): Promise<TaskRecord[]> {
  const unique = [...new Set(ids.map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const supabase = await getSupabaseServerClient();
  const scope = await getTaskScope(session);
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .in("id", unique)
    .eq("organization_id", session.organization.id)
    .is("deleted_at", null);
  if (error) {
    if (isMissingTable(error.message ?? "")) return [];
    // 잘못된 UUID 하나로 일괄 작업 전체가 500 나지 않게 한다(`getTaskDetail` 과 같은 판단).
    if (error.code === "22P02") return [];
    throw new Error(error.message);
  }
  return hydrate(((data ?? []) as TaskRow[]).filter((r) => scope.taskIds.has(r.id)));
}

/** One recurring occurrence's recorded state (completed/skipped/moved). See `task_occurrence_state`. */
export type OccurrenceStateRecord = {
  taskId: string;
  occurrenceDate: string;
  state: OccurrenceState;
  completedByUserId: string | null;
  movedToDate: string | null;
};

/**
 * Occurrence-level state rows for the org's recurring tasks (RLS-scoped to participant membership).
 * Powers per-date occurrence rendering (done state), overdue detection (absence = still open), and
 * skip/move resolution. Bounded to a recent window for size — resolved states older than the window
 * only matter for pathologically stale backlogs. Rolled-forward legacy anchors are recent so this
 * window comfortably covers active tasks.
 */
export async function getOccurrenceStates(session: AppSession): Promise<OccurrenceStateRecord[]> {
  const supabase = await getSupabaseServerClient();
  const scope = await getTaskScope(session);
  const since = ymdShift(tokyoToday(), -400);
  const { data, error } = await supabase
    .from("task_occurrence_state")
    .select("task_id, occurrence_date, state, completed_by_user_id, moved_to_date")
    .eq("organization_id", session.organization.id)
    .gte("occurrence_date", since);
  if (error) {
    if (isMissingTable(error.message ?? "")) return [];
    return [];
  }
  type Row = {
    task_id: string;
    occurrence_date: string;
    state: string;
    completed_by_user_id: string | null;
    moved_to_date: string | null;
  };
  return ((data ?? []) as Row[])
    .filter((r) => scope.taskIds.has(r.task_id))
    .map((r) => ({
      taskId: r.task_id,
      occurrenceDate: r.occurrence_date,
      state: r.state as OccurrenceState,
      completedByUserId: r.completed_by_user_id,
      movedToDate: r.moved_to_date,
    }));
}

/**
 * One net completion of a task on a Tokyo day, derived from the `completed`/`reopened` log.
 * `at` is the timestamp of the last `completed` event, used to order rows inside a day group.
 */
export type TaskCompletionRecord = {
  taskId: string;
  day: string;
  byUserId: string | null;
  at: string;
};

/**
 * Completion history from `task_updates` (NOT `tasks.status`).
 *
 * 2026-07-30 롤포워드 폐지 이후 **반복 완료는 행의 status 를 건드리지 않는다** — 완료는
 * `task_occurrence_state` 와 이 로그에만 남는다. 그래서 `status = "completed"` 만 보는 목록은
 * 반복 완료를 하나도 못 보여주고, 같은 로그를 읽는 업무일지(`report-actions.ts`)와 어긋난다.
 * 완료·기록 화면은 모바일·콘솔 모두 이 함수를 기준으로 그린다.
 *
 * (task, Tokyo 날짜)별 net = completed − reopened 라 같은 날의 실행 취소는 서로 상쇄된다.
 * `task_updates` 에는 organization_id 가 없어 org 필터를 걸 자리가 없다 — 대신 `getTaskScope` 의
 * 참여 범위로 좁힌다(RLS 의 플랫폼 관리자 예외가 남의 완료 이력까지 통과시키기 때문).
 * 최근 ~120일만 읽는다(그 이전 기록은 어느 화면도 렌더하지 않는다).
 */
export async function getTaskCompletions(session: AppSession): Promise<TaskCompletionRecord[]> {
  const supabase = await getSupabaseServerClient();
  const scope = await getTaskScope(session);
  const sinceIso = new Date(`${ymdShift(tokyoToday(), -120)}T00:00:00+09:00`).toISOString();
  const { data, error } = await supabase
    .from("task_updates")
    .select("task_id, update_type, created_at, created_by_user_id")
    .in("update_type", ["completed", "reopened"])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });
  if (error) return [];
  type Row = {
    task_id: string;
    update_type: string;
    created_at: string | null;
    created_by_user_id: string | null;
  };
  // key = `${taskId}|${day}`
  const net = new Map<string, { net: number; by: string | null; at: string }>();
  for (const r of (data ?? []) as Row[]) {
    if (!scope.taskIds.has(r.task_id)) continue;
    const day = tokyoDateOf(r.created_at);
    if (!day) continue;
    const key = `${r.task_id}|${day}`;
    const cur = net.get(key) ?? { net: 0, by: null, at: r.created_at ?? "" };
    if (r.update_type === "completed") {
      cur.net += 1;
      cur.by = r.created_by_user_id;
      cur.at = r.created_at ?? cur.at;
    } else {
      cur.net -= 1;
    }
    net.set(key, cur);
  }
  const out: TaskCompletionRecord[] = [];
  for (const [key, v] of net) {
    if (v.net <= 0) continue;
    const sep = key.lastIndexOf("|");
    out.push({ taskId: key.slice(0, sep), day: key.slice(sep + 1), byUserId: v.by, at: v.at });
  }
  return out;
}

/** One recurring occurrence's manual sort position. See `task_occurrence_order`. */
export type OccurrenceOrderRecord = {
  taskId: string;
  occurrenceDate: string;
  sortOrder: number;
};

/**
 * Manual per-date positions for recurring occurrences (RLS-scoped).
 *
 * Kept to a rolling window like `getOccurrenceStates` — positions for dates far in the past are
 * never rendered, so there is no reason to ship them to the client.
 */
export async function getOccurrenceOrders(session: AppSession): Promise<OccurrenceOrderRecord[]> {
  const supabase = await getSupabaseServerClient();
  const scope = await getTaskScope(session);
  const since = ymdShift(tokyoToday(), -400);
  const { data, error } = await supabase
    .from("task_occurrence_order")
    .select("task_id, occurrence_date, sort_order")
    .eq("organization_id", session.organization.id)
    .gte("occurrence_date", since);
  if (error) return [];
  type Row = { task_id: string; occurrence_date: string; sort_order: number };
  return ((data ?? []) as Row[])
    .filter((r) => scope.taskIds.has(r.task_id))
    .map((r) => ({
      taskId: r.task_id,
      occurrenceDate: r.occurrence_date,
      sortOrder: r.sort_order,
    }));
}

/** All tasks belonging to a project (RLS-scoped: viewer must be a project participant). */
export async function getProjectTasks(
  session: AppSession,
  projectId: string,
): Promise<TaskRecord[]> {
  const supabase = await getSupabaseServerClient();
  // 프로젝트 비참여자에게는 아무것도 주지 않는다(플랫폼 관리자 포함) — 투두는 개인 공간이다.
  const scope = await getTaskScope(session);
  if (!scope.projectIds.has(projectId)) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("organization_id", session.organization.id)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  return hydrate((data ?? []) as TaskRow[]);
}

/** One task with participants + full update log, scoped to the session org. */
export async function getTaskDetail(
  session: AppSession,
  id: string,
): Promise<TaskDetail | null> {
  const supabase = await getSupabaseServerClient();
  // 범위 밖 작업은 «없음»으로 답한다 — URL 로 남의 작업 id 를 찍어 넣어도 상세가 열리지 않는다.
  const scope = await getTaskScope(session);
  if (!scope.taskIds.has(id)) return null;
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message ?? "")) return null;
    // A malformed (non-UUID) id in the URL → treat as not-found, not a 500 crash.
    if (error.code === "22P02") return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const [record] = await hydrate([data as TaskRow]);
  if (!record) return null;

  const { data: updateData } = await supabase
    .from("task_updates")
    .select("id, task_id, created_by_user_id, update_type, body, image_urls, created_at")
    .eq("task_id", id)
    .order("created_at", { ascending: true });
  const updateRows = (updateData ?? []) as UpdateRow[];

  const updaterIds = Array.from(
    new Set(updateRows.map((u) => u.created_by_user_id).filter((v): v is string => !!v)),
  );
  const names = new Map<string, string>();
  if (updaterIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", updaterIds);
    for (const p of (profiles ?? []) as ProfileName[]) names.set(p.id, p.name);
  }

  const updates: TaskUpdateEntry[] = updateRows.map((u) => ({
    id: u.id,
    type: u.update_type,
    body: u.body,
    imageUrls: u.image_urls ?? [],
    createdAt: u.created_at,
    byUserId: u.created_by_user_id,
    byName: u.created_by_user_id ? names.get(u.created_by_user_id) ?? "" : "",
  }));

  return { ...record, updates };
}

/** Active org members (excluding self) selectable as share recipients. */
export async function getShareableUsers(session: AppSession): Promise<ShareableUser[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, status, profiles(name)")
    .eq("organization_id", session.organization.id)
    .eq("status", "active");
  if (error) {
    if (isMissingTable(error.message ?? "")) return [];
    return [];
  }
  const rows = (data ?? []) as Array<{
    user_id: string;
    role: string;
    profiles: { name: string } | { name: string }[] | null;
  }>;
  return rows
    .filter((r) => r.user_id !== session.user.id)
    .map((r) => {
      const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return { id: r.user_id, name: profile?.name ?? "", role: r.role };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
