import { cache } from "react";

import { tokyoDateOf, tokyoToday, ymdShift } from "@/lib/tokyo-date";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";
import type { AppSession } from "@/lib/session";
import { isOwnerOrPlatformDeveloper } from "@/config/roles";
// 커스텀 요일 규칙 형식의 파서는 정확히 하나이며 클라이언트 안전 쌍둥이에 있어서
// 두 반복 테이블이 서로 어긋날 수 없다(그 파일 헤더의 경고 참고).
import {
  buildCustomRecurrenceRule,
  OCCURRENCE_STATE_WINDOW_DAYS,
  type OccurrenceState,
  parseCustomWeekdays,
  STANDARD_RECURRENCE_RULES,
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

/** 업무에 연결된 컨텍스트(property, room, reservation)의 해석된 표시 데이터. */
export type LinkedTaskContext = {
  /** 저장된 원본 UUID — 수정 폼에 되돌려 줘서 다시 고르지 않고도 연결이 왕복된다. */
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
  /** 프로젝트 주인(project_participants 의 owner). 프로젝트 밖 작업이거나 멤버십을 읽을 수 없으면 null. */
  projectOwnerUserId: string | null;
  /** 작성자가 이 작업의 프로젝트에서 나갔거나 빠졌다(2026-10-28) — 「나감」 표시용. */
  authorLeftProject: boolean;
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

/** 목록/캘린더 묶음용으로 업무가 고정되는 단일 날짜(due 가 scheduled 보다 우선). */
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
 * `YYYY-MM-DD` 형식이면서 **달력에 실제로 있는 날짜**인가(2026-10-28).
 *
 * 형식만 보면 `2026-02-31` 이 통과해 `Date` 가 3/3 으로 굴려 저장했다. 폼 · URL 등 믿을 수 없는
 * 입력의 날짜 검사는 이것을 쓴다(액션들이 각자 갖고 있던 `isValidYmd` 대신).
 */
export function isValidYmd(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `HH:MM` 이면서 00:00 ~ 23:59 인가(2026-10-28). `25:99` 는 예전에 저장 단계에서 500 을 냈다. */
export function isValidHm(value: string | null | undefined): value is string {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour <= 23 && minute <= 59;
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

// ── 반복(고정 앵커 + 회차 상태, 2026-07-30) ─────────────────────────────────
// 반복 업무는 `recurrence_rule` + 고정 앵커를 가진 행 하나이고, 완료해도 행이 넘어가지 않는다.
// 회차별 완료 · 건너뜀 · 이동은 `task_occurrence_state` 에 남는다. 회차 날짜 계산은 클라이언트 안전한
// `@/lib/tasks-recurrence` **한 곳**에만 있다 — 예전 이 파일의 롤포워드용 쌍둥이 계산(다음/이전
// 인스턴스, 날짜 옮기기)은 쓰는 곳이 없어 2026-10-28 에 지웠다.

/**
 * 제출된 반복 규칙을 저장 값으로 해석한다 — 문서화된 제품 규칙과
 * 맞는 서버 측 계약이다(UI 전용 제한이 아님):
 * - 표준 규칙은 그대로 통과한다;
 * - **커스텀 요일 규칙**(`custom:1,3,5`)은 다시 파싱해 재직렬화하므로, 조작된
 *   요청이 잘못되었거나 중복되거나 정렬되지 않은 집합을 저장할 수 없다(2026-07-29 추가);
 * - 비었거나 인식할 수 없으면 실패 시 막아 `null`(비반복)로;
 * - 요일 집합 없는 맨 `custom` 은 **왕복 전용**으로 남는다: 업무가 이미 갖고 있을 때만
 *   유지하고(`previousRule === "custom"`) 새로 지정할 수는 없다. 요일 빌더보다 먼저 있었고
 *   일정을 담지 않으므로 새로 만들 수 있게 되어서는 안 된다.
 */
export function resolveRecurrenceRule(
  submitted: string,
  previousRule: string | null,
): string | null {
  if ((STANDARD_RECURRENCE_RULES as readonly string[]).includes(submitted)) return submitted;
  // 그대로 통과시키지 않고 정규화한다: `custom:5,1,1` 은 `custom:1,5` 로 저장된다.
  const customDays = parseCustomWeekdays(submitted);
  if (customDays) return buildCustomRecurrenceRule(customDays);
  if (submitted === "custom" && previousRule === "custom") return "custom";
  return null;
}

/**
 * 구체적인 시각을 입력했는데 날짜 기준점이 없는 경우(scheduled 도
 * due 도 없음) true. 이런 제출은 거절한다 — 그러지 않으면 `normalizeTaskDateTime` 이
 * 시각을 조용히 버리게 되고, 사용자에게는 데이터 유실로 보인다. 폼과
 * 서버 액션 둘 다(생성 + 수정)에서 강제한다.
 */
export function taskTimeWithoutDate(input: {
  scheduledDate: string;
  dueDate: string;
  time: string;
}): boolean {
  return isValidHm(input.time) && !isValidYmd(input.scheduledDate) && !isValidYmd(input.dueDate);
}

/**
 * 업무 날짜/시간 폼 입력이 어떻게 저장되는지의 단일 기준 — `createTask` 와 `updateTaskCore` 가
 * 어긋나지 않도록 함께 쓴다.
 *
 * 규칙:
 * - `time_label` 은 업무의 선택적 시각("HH:MM"); `all_day = 시각 없음`.
 * - 시각은 업무가 날짜(scheduled 또는 due)에 고정될 때만 유지된다; 날짜가 전혀
 *   없으면 시각은 버려지고 업무는 종일로 남는다(떠다니는 시각 없음).
 * - `due_at` 은 due 날짜가 있을 때만 시각을 담는다(도쿄, +09:00); 종일 due
 *   날짜는 현지 00:00 으로 저장한다 — 기존의 의도된 패턴이며 `anchor()` 가
 *   도쿄 달력 날짜만 읽기 때문이다.
 * - 형식이 잘못되었거나 **달력에 없는 날짜(2026-02-31) · 범위 밖 시각(25:99)** 은 미설정으로
 *   본다(2026-10-28). 예전에는 형식만 봐서 `25:99` 가 `toISOString()` RangeError → 500 을 냈고,
 *   `02-31` 은 3/3 으로 굴려 저장됐다. 사용자에게 오류로 알리려면 액션이 저장 전에
 *   `isValidYmd` · `isValidHm` 으로 먼저 거른다.
 */
export function normalizeTaskDateTime(input: {
  scheduledDate: string;
  dueDate: string;
  time: string;
}): NormalizedTaskDateTime {
  const scheduledDate = isValidYmd(input.scheduledDate) ? input.scheduledDate : null;
  const dueDate = isValidYmd(input.dueDate) ? input.dueDate : null;
  const time = isValidHm(input.time) ? input.time : "";
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

/**
 * 작성자 · 플랫폼 개발자(2026-10-23) · **그 작업 프로젝트의 주인**(2026-10-28)이면 true.
 * 프로젝트 주인은 나간 멤버가 쓴 할 일까지 고치고 · 완료하고 · 지운다 — 주인 없는 할 일이 남지 않게.
 */
export function canEditTaskAsOwnerOrAuthor(
  user: { id: string; role: string | null | undefined },
  createdByUserId: string,
  projectOwnerUserId: string | null,
): boolean {
  if (isOwnerOrPlatformDeveloper(user, createdByUserId)) return true;
  return projectOwnerUserId !== null && projectOwnerUserId === user.id;
}

/**
 * 작업 본문 · 일정 · 삭제 · 참여자 빼기 같은 「작성자만」 동작의 게이트. 플랫폼 개발자와 프로젝트 주인도
 * 통과한다(`canEditTaskAsOwnerOrAuthor`). 열 수 있는 작업(getTaskScope 범위) 안에서만 쓰인다.
 */
export function canEditTaskCore(
  session: Pick<AppSession, "user">,
  task: Pick<TaskRecord, "createdByUserId" | "projectOwnerUserId">,
): boolean {
  return canEditTaskAsOwnerOrAuthor(session.user, task.createdByUserId, task.projectOwnerUserId);
}

/** 프로젝트별 주인 · 멤버 id. 행을 하나도 읽지 못한 프로젝트(RLS 로 가려짐)는 맵에 없다. */
export type ProjectMembershipMap = Map<string, { ownerUserId: string | null; memberIds: Set<string> }>;

export function buildProjectMembershipMap(
  rows: Array<{ project_id: string; user_id: string; role: string }>,
): ProjectMembershipMap {
  const map: ProjectMembershipMap = new Map();
  for (const r of rows) {
    const entry = map.get(r.project_id) ?? { ownerUserId: null, memberIds: new Set<string>() };
    entry.memberIds.add(r.user_id);
    if (r.role === "owner") entry.ownerUserId = r.user_id;
    map.set(r.project_id, entry);
  }
  return map;
}

/**
 * 작성자가 프로젝트를 떠났는가. 멤버십을 읽을 수 없는 프로젝트(직접 초대로만 보는 작업)는 모르므로 false —
 * 「나감」 을 잘못 붙이지 않는 쪽을 고른다.
 */
export function authorLeftProjectOf(
  projectId: string | null,
  createdByUserId: string,
  membership: ProjectMembershipMap,
): boolean {
  if (!projectId) return false;
  const entry = membership.get(projectId);
  if (!entry) return false;
  return !entry.memberIds.has(createdByUserId);
}

/** RLS 범위로 프로젝트 멤버십을 읽는다(주인은 언제나 자기 프로젝트 행을 읽을 수 있다). */
export async function getProjectMembership(projectIds: string[]): Promise<ProjectMembershipMap> {
  const unique = [...new Set(projectIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("project_participants")
    .select("project_id, user_id, role")
    .in("project_id", unique);
  return buildProjectMembershipMap(
    (data ?? []) as Array<{ project_id: string; user_id: string; role: string }>,
  );
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
      // 정규 property + 합쳐진 표시 방 라벨로 정규화해서 칩/상세가 읽히는 방식을
      // 캘린더 · 선택기와 같게 한다(예: "荒木町A" / "201_2" → "아라키초A" / "201").
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

  // 방만 / property 만 있는 링크: 조인된 property/room 행에서 원시 이름을 해석한 뒤
  // 정규 property + 합쳐진 표시 방 라벨로 정규화한다(예약 분기와 같음).
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

  // 컨텍스트 해석 — 배치 조인을 위해 ID 를 모은다
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

  const projectIds = rows.map((r) => r.project_id).filter((v): v is string => !!v);

  const [profiles, resRows, propRows, roomRows, membership] = await Promise.all([
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
    getProjectMembership(projectIds),
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
      projectOwnerUserId: r.project_id
        ? (membership.get(r.project_id)?.ownerUserId ?? null)
        : null,
      authorLeftProject: authorLeftProjectOf(r.project_id, r.created_by_user_id, membership),
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
/**
 * 범위 계산의 순수 규칙(2026-10-28 「프로젝트를 나가면 그 프로젝트 할 일은 안 보인다」).
 *
 * - 내가 멤버인 프로젝트의 작업은 전부 보인다(`projectTaskIds`).
 * - 참여자 행은 범위에 넣되, **내가 멤버가 아닌 프로젝트의 작업에 걸린 `author` 행은 버린다** — 작성자는
 *   언제나 author 행을 갖고 있어서, 이걸 그대로 두면 나간 사람이 자기가 쓴 프로젝트 할 일을 계속 본다.
 *   직접 초대(author 가 아닌 행)로 받은 작업은 프로젝트를 나가도 남는다.
 */
export function buildTaskScope(input: {
  participantRows: Array<{ taskId: string; role: string; projectId: string | null }>;
  memberProjectIds: Iterable<string>;
  projectTaskIds: Iterable<string>;
}): TaskScope {
  const projectIds = new Set(input.memberProjectIds);
  const taskIds = new Set<string>(input.projectTaskIds);
  for (const r of input.participantRows) {
    if (r.role === "author" && r.projectId && !projectIds.has(r.projectId)) continue;
    taskIds.add(r.taskId);
  }
  return { taskIds, projectIds };
}

const loadTaskScope = cache(
  async (userId: string, organizationId: string): Promise<TaskScope> => {
    const supabase = await getSupabaseServerClient();
    const [partRes, projRes] = await Promise.all([
      supabase.from("task_participants").select("task_id, role, tasks(project_id)").eq("user_id", userId),
      supabase.from("project_participants").select("project_id").eq("user_id", userId),
    ]);
    const memberProjectIds = ((projRes.data ?? []) as Array<{ project_id: string }>).map(
      (r) => r.project_id,
    );
    // 프로젝트 작업은 작업별 참여자 없이 프로젝트 소속만으로 보인다 — 그 id 들도 범위에 넣어야
    // 회차/완료 로그 필터가 프로젝트 작업을 잘라내지 않는다.
    let projectTaskIds: string[] = [];
    if (memberProjectIds.length > 0) {
      const { data } = await supabase
        .from("tasks")
        .select("id")
        .eq("organization_id", organizationId)
        .in("project_id", memberProjectIds);
      projectTaskIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    }
    type PartRow = {
      task_id: string;
      role: string;
      tasks: { project_id: string | null } | { project_id: string | null }[] | null;
    };
    return buildTaskScope({
      participantRows: ((partRes.data ?? []) as PartRow[]).map((r) => {
        const task = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
        return { taskId: r.task_id, role: r.role, projectId: task?.project_id ?? null };
      }),
      memberProjectIds,
      projectTaskIds,
    });
  },
);

/** 세션 뷰어의 투두 가시 범위(요청당 메모이즈). */
export function getTaskScope(session: AppSession): Promise<TaskScope> {
  return loadTaskScope(session.user.id, session.organization.id);
}

/** 현재 사용자에게 보이는 모든 업무(RLS 로 참여자 멤버십 범위). */
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
    .is("deleted_at", null) // 소프트 삭제: 삭제된 업무를 숨긴다(실행 취소하면 복원됨)
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

/** 반복 회차 하나의 기록된 상태(완료/건너뜀/이동). `task_occurrence_state` 참고. */
export type OccurrenceStateRecord = {
  taskId: string;
  occurrenceDate: string;
  state: OccurrenceState;
  completedByUserId: string | null;
  movedToDate: string | null;
};

/** PostgREST 한 번 응답의 최대 행 수(Supabase 기본 `max-rows`). 이보다 많으면 조용히 잘린다. */
const PAGE_SIZE = 1000;
/** `.in("task_id", …)` 한 번에 넣는 id 수 — UUID 150개면 URL 이 6KB 남짓이라 안전하다. */
const ID_CHUNK = 150;

/**
 * 범위 안 작업 id 로 좁혀 회차 테이블을 **빠짐없이** 읽는다(2026-10-28).
 *
 * 예전에는 조직 전체를 한 번에 읽어서 PostgREST 의 1000행 상한에 걸리면 나머지가 조용히 빠졌고,
 * 빠진 완료 회차가 화면에서 다시 «밀림» 으로 나타났다. 이제 id 묶음마다 `range` 로 끝까지 넘긴다.
 * 읽기가 한 번이라도 실패하면 `null` — 반쪽 결과를 정상처럼 내보내지 않는다.
 */
async function selectOccurrenceRowsByTask<Row>(
  taskIds: string[],
  fetchPage: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<Row[] | null> {
  const out: Row[] = [];
  for (let i = 0; i < taskIds.length; i += ID_CHUNK) {
    const chunk = taskIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await fetchPage(chunk, from, from + PAGE_SIZE - 1);
      if (error) return null;
      const rows = (data ?? []) as Row[];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
  }
  return out;
}

/**
 * 보이는 반복 업무의 회차 단위 상태 행(RLS + 참여 범위).
 * 날짜별 회차 렌더(완료 상태), 지난 미완료 감지(기록 없음 = 아직 열림),
 * 건너뜀/이동 해석에 쓴다. `OCCURRENCE_STATE_WINDOW_DAYS`(400일) 안만 읽고, 밀린 회차 계산
 * (`outstandingOverdueOccurrences`)도 같은 창으로 잘라서 창 밖 회차가 «밀림» 으로 되살아나지 않는다.
 */
export async function getOccurrenceStates(session: AppSession): Promise<OccurrenceStateRecord[]> {
  const supabase = await getSupabaseServerClient();
  const scope = await getTaskScope(session);
  const since = ymdShift(tokyoToday(), -OCCURRENCE_STATE_WINDOW_DAYS);
  type Row = {
    task_id: string;
    occurrence_date: string;
    state: string;
    completed_by_user_id: string | null;
    moved_to_date: string | null;
  };
  const rows = await selectOccurrenceRowsByTask<Row>([...scope.taskIds], (chunk, from, to) =>
    supabase
      .from("task_occurrence_state")
      .select("task_id, occurrence_date, state, completed_by_user_id, moved_to_date")
      .eq("organization_id", session.organization.id)
      .in("task_id", chunk)
      .gte("occurrence_date", since)
      .order("task_id", { ascending: true })
      .order("occurrence_date", { ascending: true })
      .range(from, to),
  );
  if (!rows) return [];
  return rows.map((r) => ({
    taskId: r.task_id,
    occurrenceDate: r.occurrence_date,
    state: r.state as OccurrenceState,
    completedByUserId: r.completed_by_user_id,
    movedToDate: r.moved_to_date,
  }));
}

/**
 * 도쿄 하루 동안의 업무 순 완료 하나, `completed`/`reopened` 로그에서 도출.
 * `at` 은 마지막 `completed` 이벤트의 타임스탬프로, 하루 그룹 안에서 행을 정렬하는 데 쓴다.
 */
export type TaskCompletionRecord = {
  taskId: string;
  day: string;
  byUserId: string | null;
  at: string;
};

/**
 * `task_updates` 의 완료 이력 (`tasks.status` 가 아님).
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
  // 키 = `${taskId}|${day}`
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

/** 반복 회차 하나의 수동 정렬 위치. `task_occurrence_order` 참고. */
export type OccurrenceOrderRecord = {
  taskId: string;
  occurrenceDate: string;
  sortOrder: number;
};

/**
 * 반복 회차의 날짜별 수동 위치(RLS 범위).
 *
 * `getOccurrenceStates` 처럼 롤링 구간으로 제한한다 — 먼 과거 날짜의 위치는
 * 렌더되지 않으므로 클라이언트로 보낼 이유가 없다.
 */
export async function getOccurrenceOrders(session: AppSession): Promise<OccurrenceOrderRecord[]> {
  const supabase = await getSupabaseServerClient();
  const scope = await getTaskScope(session);
  const since = ymdShift(tokyoToday(), -OCCURRENCE_STATE_WINDOW_DAYS);
  type Row = { task_id: string; occurrence_date: string; sort_order: number };
  // 상태 행과 같은 이유로 범위 id 로 좁히고 끝까지 넘긴다(2026-10-28, 1000행 상한).
  const rows = await selectOccurrenceRowsByTask<Row>([...scope.taskIds], (chunk, from, to) =>
    supabase
      .from("task_occurrence_order")
      .select("task_id, occurrence_date, sort_order")
      .eq("organization_id", session.organization.id)
      .in("task_id", chunk)
      .gte("occurrence_date", since)
      .order("task_id", { ascending: true })
      .order("occurrence_date", { ascending: true })
      .range(from, to),
  );
  if (!rows) return [];
  return rows.map((r) => ({
    taskId: r.task_id,
    occurrenceDate: r.occurrence_date,
    sortOrder: r.sort_order,
  }));
}

/** 프로젝트에 속한 모든 업무(RLS 범위: 보는 사람이 프로젝트 참여자여야 함). */
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

/** 참여자 + 전체 업데이트 로그를 가진 업무 하나, 세션 조직 범위. */
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
    // URL 의 형식이 깨진(UUID 아님) id → 500 크래시가 아니라 not-found 로 처리한다.
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

/** 공유 수신자로 고를 수 있는 활성 조직 멤버(본인 제외). */
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
