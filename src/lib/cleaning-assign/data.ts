import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { rolesWithCapability } from "@/config/capabilities";
import {
  addDays,
  defaultStartMinutes,
  monthDays,
  monthOf,
  shiftDayState,
  timeToMinutes,
  type ShiftDayState,
} from "@/lib/cleaning-assign/day-state";
import { compareAssignRooms, loadAssignDayRooms, loadHeldRoomKeys, loadRangeRooms, type AssignRoom } from "@/lib/cleaning-assign/rooms";
import { DEFAULT_FLAG_THRESHOLD, normalizeAssignRules, TRAINEE_FIRST_CHECK, type AssignRule } from "@/lib/cleaning-assign/rules";
import { suggestAssignments, type SuggestPerson, type SuggestRoom, type Suggestion } from "@/lib/cleaning-assign/suggest";
import { physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { Database } from "@/types/database";

/**
 * 청소 배정 — 화면들이 쓰는 데이터. 모든 읽기는 service-role(표가 RLS 정책 없음) — **호출하는 쪽이 권한 키를 먼저 확인**한다
 * (`cleaning.assign` = 하루 · 월 · 설정 · 비교표, `cleaning.work` = 내 시프트 · 오늘 내 방).
 * docs/product/37-cleaning-shift-assignment.md
 */

type Client = SupabaseClient<Database>;

// ── 사람 ─────────────────────────────────────────────────────────────────────────────────────────

export type FieldMember = {
  userId: string;
  name: string;
  role: string;
  phone: string;
};

/** 현장 인원 = 권한 키 `cleaning.work` 를 역할로 받는 활성 멤버(청소 화면의 담당자 목록과 같은 기준). */
export async function loadFieldMembers(supabase: Client, organizationId: string): Promise<FieldMember[]> {
  const memberships = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", rolesWithCapability("cleaning.work"));
  if (memberships.error) throw new Error(memberships.error.message);
  const rows = memberships.data ?? [];
  if (rows.length === 0) return [];
  const profiles = await supabase.from("profiles").select("id, name, phone_number").in("id", rows.map((row) => row.user_id));
  if (profiles.error) throw new Error(profiles.error.message);
  const byId = new Map((profiles.data ?? []).map((row) => [row.id, row]));
  return rows
    .map((row) => ({ userId: row.user_id, role: row.role as string, name: byId.get(row.user_id)?.name ?? "—", phone: byId.get(row.user_id)?.phone_number ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export type StaffProfile = {
  priority: boolean;
  trainee: boolean;
  traineeCheckAt: number;
  trainer: boolean;
  defaultStartMinutes: number | null;
  memo: string | null;
  mainProperties: string[];
};

const EMPTY_PROFILE: StaffProfile = {
  priority: false,
  trainee: false,
  traineeCheckAt: TRAINEE_FIRST_CHECK,
  trainer: false,
  defaultStartMinutes: null,
  memo: null,
  mainProperties: [],
};

export async function loadStaffProfiles(supabase: Client, organizationId: string): Promise<Map<string, StaffProfile>> {
  const result = await supabase.from("cleaning_staff_profiles").select("*").eq("organization_id", organizationId);
  if (result.error) throw new Error(result.error.message);
  return new Map(
    (result.data ?? []).map((row) => [
      row.user_id,
      {
        priority: row.priority,
        trainee: row.trainee,
        traineeCheckAt: row.trainee_check_at,
        trainer: row.trainer,
        defaultStartMinutes: timeToMinutes(row.default_start_time),
        memo: row.memo,
        mainProperties: row.main_properties ?? [],
      },
    ]),
  );
}

export function profileOf(profiles: Map<string, StaffProfile>, userId: string): StaffProfile {
  return profiles.get(userId) ?? EMPTY_PROFILE;
}

/** 견습 담당 — 현장 매니저이거나 「견습 담당」 표시. */
export function isTrainer(member: { role: string }, profile: StaffProfile): boolean {
  return profile.trainer || member.role === "field_manager";
}

// ── 설정 ─────────────────────────────────────────────────────────────────────────────────────────

export type AssignSettings = {
  rules: AssignRule[];
  flagThreshold: number;
  updatedAt: string | null;
  updatedByName: string | null;
};

export async function loadAssignSettings(supabase: Client, organizationId: string): Promise<AssignSettings> {
  const result = await supabase.from("cleaning_assign_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const row = result.data;
  let updatedByName: string | null = null;
  if (row?.updated_by) {
    const profile = await supabase.from("profiles").select("name").eq("id", row.updated_by).maybeSingle();
    updatedByName = profile.data?.name ?? null;
  }
  return {
    rules: normalizeAssignRules(row?.rules ?? null),
    flagThreshold: row?.flag_threshold ?? DEFAULT_FLAG_THRESHOLD,
    updatedAt: row?.updated_at ?? null,
    updatedByName,
  };
}

/** 건물 → (사람 → 순위). */
export async function loadFixedTiers(supabase: Client, organizationId: string): Promise<Record<string, Record<string, number>>> {
  const result = await supabase
    .from("cleaning_fixed_staff")
    .select("property_name, user_id, tier, position")
    .eq("organization_id", organizationId)
    .order("tier")
    .order("position");
  if (result.error) throw new Error(result.error.message);
  const out: Record<string, Record<string, number>> = {};
  for (const row of result.data ?? []) {
    out[row.property_name] ??= {};
    out[row.property_name][row.user_id] = row.tier;
  }
  return out;
}

export type FixedStaffRow = { propertyName: string; userId: string; tier: number; position: number };

export async function loadFixedStaffRows(supabase: Client, organizationId: string): Promise<FixedStaffRow[]> {
  const result = await supabase
    .from("cleaning_fixed_staff")
    .select("property_name, user_id, tier, position")
    .eq("organization_id", organizationId)
    .order("tier")
    .order("position");
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((row) => ({ propertyName: row.property_name, userId: row.user_id, tier: row.tier, position: row.position }));
}

// ── 배정 · 신청 원본 ─────────────────────────────────────────────────────────────────────────────

export type AssignmentRow = {
  id: string;
  workDate: string;
  roomKey: string;
  propertyName: string;
  roomLabel: string;
  userId: string;
  createdBy: string | null;
  createdAt: string;
};

export async function loadAssignments(supabase: Client, organizationId: string, from: string, to: string, userId?: string): Promise<AssignmentRow[]> {
  // 한 달이면 방 수십 개 × 2~3명이라 1,000줄(Supabase 한 번 상한)을 넘는다 — 페이지로 끝까지 읽는다.
  const result = await readAllPages<{ id: string; work_date: string; room_key: string; property_name: string; room_label: string; user_id: string; created_by: string | null; created_at: string }>((start, end) => {
    let query = supabase
      .from("cleaning_assignments")
      .select("id, work_date, room_key, property_name, room_label, user_id, created_by, created_at")
      .eq("organization_id", organizationId)
      .gte("work_date", from)
      .lte("work_date", to);
    if (userId) query = query.eq("user_id", userId);
    return query.order("created_at").order("id").range(start, end);
  });
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((row) => ({
    createdAt: row.created_at,
    createdBy: row.created_by,
    id: row.id,
    propertyName: row.property_name,
    roomKey: row.room_key,
    roomLabel: row.room_label,
    userId: row.user_id,
    workDate: row.work_date,
  }));
}

export type ApplicationRow = {
  userId: string;
  workDate: string;
  source: "self" | "admin";
  startMinutes: number | null;
  cancelledAt: string | null;
  cancelRequestedAt: string | null;
  cancelRequestNote: string | null;
};

export async function loadApplications(supabase: Client, organizationId: string, from: string, to: string, userId?: string): Promise<ApplicationRow[]> {
  const result = await readAllPages<{ user_id: string; work_date: string; source: string; start_time: string | null; cancelled_at: string | null; cancel_requested_at: string | null; cancel_request_note: string | null }>((start, end) => {
    let query = supabase
      .from("cleaning_shift_applications")
      .select("user_id, work_date, source, start_time, cancelled_at, cancel_requested_at, cancel_request_note")
      .eq("organization_id", organizationId)
      .gte("work_date", from)
      .lte("work_date", to);
    if (userId) query = query.eq("user_id", userId);
    return query.order("work_date").order("user_id").range(start, end);
  });
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((row) => ({
    cancelRequestNote: row.cancel_request_note,
    cancelRequestedAt: row.cancel_requested_at,
    cancelledAt: row.cancelled_at,
    source: row.source === "admin" ? "admin" : "self",
    startMinutes: timeToMinutes(row.start_time),
    userId: row.user_id,
    workDate: row.work_date,
  }));
}

/** 견습 횟수 = 배정된 날 수(전 건물 통합) · 건물별 날 수. */
async function loadTraineeCounts(
  supabase: Client,
  organizationId: string,
  userIds: string[],
  until: string,
): Promise<Map<string, { total: number; byProperty: Record<string, number> }>> {
  const out = new Map<string, { total: number; byProperty: Record<string, number> }>();
  if (userIds.length === 0) return out;
  // 전 기간 누적이라 금방 1,000줄을 넘는다 — 페이지로 끝까지.
  const result = await readAllPages<{ user_id: string; work_date: string; property_name: string }>((start, end) =>
    supabase
      .from("cleaning_assignments")
      .select("user_id, work_date, property_name")
      .eq("organization_id", organizationId)
      .in("user_id", userIds)
      .lte("work_date", until)
      .order("id")
      .range(start, end),
  );
  if (result.error) throw new Error(result.error.message);
  const days = new Map<string, Set<string>>();
  const props = new Map<string, Map<string, Set<string>>>();
  for (const row of result.data ?? []) {
    let d = days.get(row.user_id);
    if (!d) days.set(row.user_id, (d = new Set()));
    d.add(row.work_date);
    let p = props.get(row.user_id);
    if (!p) props.set(row.user_id, (p = new Map()));
    let pd = p.get(row.property_name);
    if (!pd) p.set(row.property_name, (pd = new Set()));
    pd.add(row.work_date);
  }
  for (const userId of userIds) {
    const byProperty: Record<string, number> = {};
    for (const [prop, set] of props.get(userId) ?? []) byProperty[prop] = set.size;
    out.set(userId, { total: days.get(userId)?.size ?? 0, byProperty });
  }
  return out;
}

/** 최근 출근 · 이번 달 출근 일수 — 근태 기록 기준(신청 안 한 사람 목록 · 연락할 사람 고르기). */
async function loadAttendanceActivity(
  supabase: Client,
  organizationId: string,
  userIds: string[],
  date: string,
): Promise<Map<string, { last: string | null; monthDays: number }>> {
  const out = new Map<string, { last: string | null; monthDays: number }>();
  if (userIds.length === 0) return out;
  // 90일 × 현장 수십 명 — 1,000줄을 넘는다.
  const result = await readAllPages<{ user_id: string; operating_date: string }>((start, end) =>
    supabase
      .from("attendance_sessions")
      .select("user_id, operating_date")
      .eq("organization_id", organizationId)
      .in("user_id", userIds)
      .gte("operating_date", addDays(date, -90))
      .lte("operating_date", date)
      .order("id")
      .range(start, end),
  );
  if (result.error) throw new Error(result.error.message);
  const ym = monthOf(date);
  const month = new Map<string, Set<string>>();
  for (const row of result.data ?? []) {
    const prev = out.get(row.user_id);
    const last = !prev?.last || row.operating_date > prev.last ? row.operating_date : prev.last;
    out.set(row.user_id, { last, monthDays: prev?.monthDays ?? 0 });
    if (row.operating_date.startsWith(ym)) {
      let set = month.get(row.user_id);
      if (!set) month.set(row.user_id, (set = new Set()));
      set.add(row.operating_date);
    }
  }
  for (const [userId, set] of month) {
    const prev = out.get(userId)!;
    out.set(userId, { ...prev, monthDays: set.size });
  }
  return out;
}

// ── 하루 보기 ────────────────────────────────────────────────────────────────────────────────────

export type BoardRoomPerson = { userId: string; name: string; trainee: boolean; by: string | null; at: string };

export type BoardRoom = AssignRoom & {
  /** 배정했는데 그 사이 예약이 취소된 방(목록에서 사라짐) — 「취소됨」으로 남긴다. */
  cancelled: boolean;
  people: BoardRoomPerson[];
  /** 제안(그 방에 넣을 사람들) — 미배정 · 인원 모자란 방만. */
  suggested: { userId: string; name: string }[];
};

export type BoardPerson = {
  userId: string;
  name: string;
  role: string;
  phone: string;
  applied: boolean;
  source: "self" | "admin" | null;
  cancelled: boolean;
  cancelRequested: boolean;
  cancelRequestNote: string | null;
  startMinutes: number;
  startException: boolean;
  priority: boolean;
  trainee: boolean;
  traineeCount: number;
  traineeByProperty: Record<string, number>;
  traineeAsk: boolean;
  trainer: boolean;
  memo: string | null;
  fixed: { propertyName: string; tier: number }[];
  rooms: { roomKey: string; propertyName: string; roomLabel: string; withOthers: number }[];
  lastWorked: string | null;
  monthDays: number;
};

export type DayBoard = {
  date: string;
  rooms: BoardRoom[];
  people: BoardPerson[];
  rules: AssignRule[];
  mainProperties: string[];
  properties: string[];
  lastChange: { name: string; at: string } | null;
  counts: { rooms: number; open: number; applied: number; assigned: number; waiting: number; notApplied: number };
};

function needOf(room: AssignRoom, assigned: number): number {
  if (room.status !== "pending" || room.deferredUntil) return 0;
  return Math.max(0, room.usualHeadcount - assigned);
}

type DayBuild = { board: DayBoard; suggestPeople: SuggestPerson[]; suggestRooms: SuggestRoom[]; fixedTiers: Record<string, Record<string, number>> };

export async function loadDayBoard(supabase: Client, organizationId: string, date: string, viewerId: string): Promise<DayBoard> {
  return (await buildDay(supabase, organizationId, date, viewerId)).board;
}

async function buildDay(supabase: Client, organizationId: string, date: string, viewerId: string): Promise<DayBuild> {
  const [rooms, members, profiles, settings, fixedTiers, assignments, applications] = await Promise.all([
    loadAssignDayRooms(supabase, organizationId, date),
    loadFieldMembers(supabase, organizationId),
    loadStaffProfiles(supabase, organizationId),
    loadAssignSettings(supabase, organizationId),
    loadFixedTiers(supabase, organizationId),
    loadAssignments(supabase, organizationId, date, date),
    loadApplications(supabase, organizationId, date, date),
  ]);
  const memberById = new Map(members.map((m) => [m.userId, m]));
  // 신청자 · 배정자 중 현장 목록 밖(역할이 바뀐 사람 등)도 이름은 보여야 한다.
  const extraIds = [...new Set([...assignments.map((a) => a.userId), ...applications.map((a) => a.userId), ...assignments.map((a) => a.createdBy).filter((id): id is string => Boolean(id))])].filter((id) => !memberById.has(id));
  const names = new Map(members.map((m) => [m.userId, m.name]));
  if (extraIds.length > 0) {
    const extra = await supabase.from("profiles").select("id, name").in("id", extraIds);
    for (const row of extra.data ?? []) names.set(row.id, row.name);
  }
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "—") : null);

  const ym = monthOf(date);
  const allIds = [...new Set([...members.map((m) => m.userId), ...applications.map((a) => a.userId)])];
  const [traineeCounts, activity, monthAssignments] = await Promise.all([
    loadTraineeCounts(supabase, organizationId, allIds, date),
    loadAttendanceActivity(supabase, organizationId, allIds, date),
    loadAssignments(supabase, organizationId, `${ym}-01`, monthDays(ym).at(-1)!),
  ]);
  const monthDaysBy = new Map<string, Set<string>>();
  for (const row of monthAssignments) {
    let set = monthDaysBy.get(row.userId);
    if (!set) monthDaysBy.set(row.userId, (set = new Set()));
    set.add(row.workDate);
  }

  const appByUser = new Map(applications.map((a) => [a.userId, a]));
  const byRoom = new Map<string, AssignmentRow[]>();
  const byUser = new Map<string, AssignmentRow[]>();
  for (const row of assignments) {
    byRoom.set(row.roomKey, [...(byRoom.get(row.roomKey) ?? []), row]);
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  }

  // 방 목록에 없는 배정(그 사이 예약이 취소된 방) — 「취소됨」으로 남긴다.
  const roomByKey = new Map(rooms.map((room) => [room.roomKey, room]));
  const cancelledRooms: AssignRoom[] = [];
  for (const [roomKey, rows] of byRoom) {
    if (roomByKey.has(roomKey)) continue;
    const first = rows[0];
    const ghost: AssignRoom = {
      arrivingGuests: null,
      arrivingGuestName: null,
      carriedFrom: null,
      carryDays: 0,
      deferredUntil: null,
      resolvedHold: false,
      hasTurnover: false,
      holdReason: null,
      nextCheckInDate: null,
      nextGuests: null,
      nextGuestName: null,
      note: null,
      propertyName: first.propertyName,
      roomKey,
      roomLabel: first.roomLabel,
      sessionRoomLabel: first.roomLabel,
      source: "checkout",
      status: "pending",
      usualHeadcount: 1,
    };
    cancelledRooms.push(ghost);
  }

  // 제안 — 신청했고 그날 일정이 살아 있는 사람만.
  const suggestPeople: SuggestPerson[] = [];
  for (const app of applications) {
    if (app.cancelledAt) continue;
    const member = memberById.get(app.userId) ?? { role: "part_time_staff" };
    const profile = profileOf(profiles, app.userId);
    const mine = byUser.get(app.userId) ?? [];
    suggestPeople.push({
      monthDays: monthDaysBy.get(app.userId)?.size ?? 0,
      priority: profile.priority,
      propertiesToday: [...new Set(mine.map((row) => row.propertyName))],
      roomsToday: mine.length,
      startMinutes: app.startMinutes ?? profile.defaultStartMinutes ?? defaultStartMinutes(member.role),
      trainee: profile.trainee,
      trainer: isTrainer(member, profile),
      userId: app.userId,
    });
  }
  const suggestRooms: SuggestRoom[] = rooms
    .map((room) => ({ assigned: (byRoom.get(room.roomKey) ?? []).map((row) => row.userId), need: needOf(room, (byRoom.get(room.roomKey) ?? []).length), propertyName: room.propertyName, roomKey: room.roomKey }))
    .filter((room) => room.need > 0)
    // 밀려 온 방 먼저.
    .sort((a, b) => Number(roomByKey.get(b.roomKey)!.source === "carry") - Number(roomByKey.get(a.roomKey)!.source === "carry"));
  const suggestions = suggestAssignments({ fixedTiers, people: suggestPeople, rooms: suggestRooms, rules: settings.rules });
  const suggestedBy = new Map<string, string[]>();
  for (const s of suggestions) suggestedBy.set(s.roomKey, [...(suggestedBy.get(s.roomKey) ?? []), s.userId]);

  const traineeByUser = (userId: string) => traineeCounts.get(userId) ?? { total: 0, byProperty: {} };
  const cancelledKeys = new Set(cancelledRooms.map((room) => room.roomKey));
  const boardRooms: BoardRoom[] = [...rooms, ...cancelledRooms].map((room) => ({
    ...room,
    cancelled: cancelledKeys.has(room.roomKey),
    people: (byRoom.get(room.roomKey) ?? []).map((row) => ({
      at: row.createdAt,
      by: nameOf(row.createdBy),
      name: nameOf(row.userId) ?? "—",
      trainee: profileOf(profiles, row.userId).trainee,
      userId: row.userId,
    })),
    suggested: (suggestedBy.get(room.roomKey) ?? []).map((userId) => ({ name: nameOf(userId) ?? "—", userId })),
  }));

  const fixedByUser = new Map<string, { propertyName: string; tier: number }[]>();
  for (const [propertyName, tiers] of Object.entries(fixedTiers)) {
    for (const [userId, tier] of Object.entries(tiers)) fixedByUser.set(userId, [...(fixedByUser.get(userId) ?? []), { propertyName, tier }]);
  }

  const people: BoardPerson[] = allIds.map((userId) => {
    const member = memberById.get(userId) ?? { name: nameOf(userId) ?? "—", phone: "", role: "part_time_staff", userId };
    const app = appByUser.get(userId) ?? null;
    const profile = profileOf(profiles, userId);
    const counts = traineeByUser(userId);
    const base = profile.defaultStartMinutes ?? defaultStartMinutes(member.role);
    const mine = byUser.get(userId) ?? [];
    return {
      applied: Boolean(app),
      cancelRequestNote: app?.cancelRequestNote ?? null,
      cancelRequested: Boolean(app?.cancelRequestedAt) && !app?.cancelledAt,
      cancelled: Boolean(app?.cancelledAt),
      fixed: (fixedByUser.get(userId) ?? []).sort((a, b) => a.tier - b.tier),
      lastWorked: activity.get(userId)?.last ?? null,
      memo: profile.memo,
      monthDays: activity.get(userId)?.monthDays ?? 0,
      name: member.name,
      phone: member.phone,
      priority: profile.priority,
      role: member.role,
      rooms: mine
        .map((row) => ({ propertyName: row.propertyName, roomKey: row.roomKey, roomLabel: row.roomLabel, withOthers: (byRoom.get(row.roomKey)?.length ?? 1) - 1 }))
        .sort(compareAssignRooms),
      source: app?.source ?? null,
      startException: app?.startMinutes != null && app.startMinutes !== base,
      startMinutes: app?.startMinutes ?? base,
      trainee: profile.trainee,
      traineeAsk: profile.trainee && counts.total >= profile.traineeCheckAt,
      traineeByProperty: counts.byProperty,
      traineeCount: counts.total,
      trainer: isTrainer(member, profile),
      userId,
    };
  });

  const applied = people.filter((p) => p.applied && !p.cancelled);
  const latest = assignments.at(-1) ?? null;
  const activeRooms = boardRooms.filter((room) => !room.cancelled);
  const board: DayBoard = {
    counts: {
      applied: applied.length,
      assigned: applied.filter((p) => p.rooms.length > 0).length,
      notApplied: people.filter((p) => !p.applied && members.some((m) => m.userId === p.userId)).length,
      open: activeRooms.filter((room) => room.people.length === 0 && room.status === "pending" && !room.deferredUntil).length,
      rooms: activeRooms.length,
      waiting: applied.filter((p) => p.rooms.length === 0).length,
    },
    date,
    lastChange: latest ? { at: latest.createdAt, name: nameOf(latest.createdBy) ?? "—" } : null,
    mainProperties: profileOf(profiles, viewerId).mainProperties,
    people,
    properties: [...new Set(boardRooms.map((room) => room.propertyName))],
    rooms: boardRooms,
    rules: settings.rules,
  };
  return { board, fixedTiers, suggestPeople, suggestRooms };
}

/** 하루 보기의 제안을 서버에서 다시 계산(「고정 인력 먼저 넣기」 · 「제안대로 넣기」 서버 액션이 쓴다 — 화면 값을 믿지 않는다). */
export async function computeDaySuggestions(
  supabase: Client,
  organizationId: string,
  date: string,
  onlyFixed: boolean,
): Promise<Array<Suggestion & { propertyName: string; roomLabel: string }>> {
  const day = await buildDay(supabase, organizationId, date, "");
  const byKey = new Map(day.board.rooms.map((room) => [room.roomKey, room]));
  return suggestAssignments({ fixedTiers: day.fixedTiers, onlyFixed, people: day.suggestPeople, rooms: day.suggestRooms, rules: day.board.rules }).map((s) => ({
    ...s,
    propertyName: byKey.get(s.roomKey)!.propertyName,
    roomLabel: byKey.get(s.roomKey)!.roomLabel,
  }));
}

// ── 월 보기 ──────────────────────────────────────────────────────────────────────────────────────

export type MonthCell = { applied: boolean; cancelled: boolean; rooms: number };

export type MonthBoard = {
  ym: string;
  days: string[];
  totals: { date: string; rooms: number; applied: number; open: number }[];
  people: { userId: string; name: string; tag: "fixed" | "priority" | "trainee" | null; fixedTier: number | null; trainee: number; total: number; cells: MonthCell[] }[];
};

/**
 * 날짜별 미배정 방 수(오늘부터 그달 끝까지) — 하루 보기 날짜 고르기 달력에 숫자로 표시. 월 보기 미배정 수와 같은 기준(퇴실 + 수기 추가 − 배정 − 미룸 · 처리 끝).
 * 지난날은 세지 않는다(월 보기도 지난날 경고를 빨갛게 그리지 않는다).
 */
export async function loadMonthOpenCounts(supabase: Client, organizationId: string, ym: string, today: string): Promise<Record<string, number>> {
  const days = monthDays(ym).filter((date) => date >= today);
  if (days.length === 0) return {};
  const from = days[0];
  const to = days.at(-1)!;
  const [range, assignments, held] = await Promise.all([
    loadRangeRooms(supabase, organizationId, from, to),
    loadAssignments(supabase, organizationId, from, to),
    loadHeldRoomKeys(supabase, organizationId, from, to),
  ]);
  const assigned = new Set(assignments.map((row) => `${row.workDate}|${row.roomKey}`));
  const out: Record<string, number> = {};
  for (const date of days) {
    const open = [...(range.get(date)?.keys() ?? [])].filter((key) => !assigned.has(`${date}|${key}`) && !held.has(`${date}|${key}`)).length;
    if (open > 0) out[date] = open;
  }
  return out;
}

export async function loadMonthBoard(supabase: Client, organizationId: string, ym: string): Promise<MonthBoard> {
  const days = monthDays(ym);
  const from = days[0];
  const to = days.at(-1)!;
  const [range, members, profiles, fixedTiers, assignments, applications, held] = await Promise.all([
    loadRangeRooms(supabase, organizationId, from, to),
    loadFieldMembers(supabase, organizationId),
    loadStaffProfiles(supabase, organizationId),
    loadFixedTiers(supabase, organizationId),
    loadAssignments(supabase, organizationId, from, to),
    loadApplications(supabase, organizationId, from, to),
    loadHeldRoomKeys(supabase, organizationId, from, to),
  ]);
  const assignedRooms = new Map<string, Set<string>>();
  const cellRooms = new Map<string, number>();
  for (const row of assignments) {
    let set = assignedRooms.get(row.workDate);
    if (!set) assignedRooms.set(row.workDate, (set = new Set()));
    set.add(row.roomKey);
    cellRooms.set(`${row.userId}|${row.workDate}`, (cellRooms.get(`${row.userId}|${row.workDate}`) ?? 0) + 1);
  }
  const appKey = new Map(applications.map((a) => [`${a.userId}|${a.workDate}`, a]));
  const totals = days.map((date) => {
    const rooms = range.get(date)?.size ?? 0;
    const assigned = assignedRooms.get(date) ?? new Set<string>();
    const open = [...(range.get(date)?.keys() ?? [])].filter((key) => !assigned.has(key) && !held.has(`${date}|${key}`)).length;
    return { applied: applications.filter((a) => a.workDate === date && !a.cancelledAt).length, date, open, rooms };
  });
  const ids = [...new Set([...members.map((m) => m.userId), ...applications.map((a) => a.userId), ...assignments.map((a) => a.userId)])];
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const missing = ids.filter((id) => !names.has(id));
  if (missing.length > 0) {
    const extra = await supabase.from("profiles").select("id, name").in("id", missing);
    for (const row of extra.data ?? []) names.set(row.id, row.name);
  }
  const bestTier = (userId: string) => {
    const tiers = Object.values(fixedTiers).map((t) => t[userId]).filter((t): t is number => t !== undefined);
    return tiers.length ? Math.min(...tiers) : null;
  };
  const people = ids
    .map((userId) => {
      const profile = profileOf(profiles, userId);
      const cells = days.map((date) => {
        const app = appKey.get(`${userId}|${date}`);
        return { applied: Boolean(app), cancelled: Boolean(app?.cancelledAt), rooms: cellRooms.get(`${userId}|${date}`) ?? 0 };
      });
      const tier = bestTier(userId);
      return {
        cells,
        fixedTier: tier,
        name: names.get(userId) ?? "—",
        tag: tier ? ("fixed" as const) : profile.trainee ? ("trainee" as const) : profile.priority ? ("priority" as const) : null,
        total: cells.reduce((sum, c) => sum + c.rooms, 0),
        trainee: 0,
        userId,
      };
    })
    // 이번 달에 신청이나 배정이 있는 사람 먼저, 그 안에서 고정 순위 · 이름.
    .sort((a, b) => {
      const activeA = a.cells.some((c) => c.applied || c.rooms > 0) ? 0 : 1;
      const activeB = b.cells.some((c) => c.applied || c.rooms > 0) ? 0 : 1;
      return activeA - activeB || (a.fixedTier ?? 99) - (b.fixedTier ?? 99) || a.name.localeCompare(b.name, "ko");
    });
  return { days, people, totals, ym };
}

/** 월 자동 제안 — 날짜마다 그날 신청자 · 미배정 방으로 하루 제안을 돌린다(이미 배정된 방은 그대로). */
export async function computeMonthSuggestions(
  supabase: Client,
  organizationId: string,
  ym: string,
  fromDate: string,
): Promise<{ suggestions: Array<Suggestion & { workDate: string; propertyName: string; roomLabel: string }>; openTotal: number; shortDays: string[] }> {
  const days = monthDays(ym).filter((date) => date >= fromDate);
  if (days.length === 0) return { openTotal: 0, shortDays: [], suggestions: [] };
  const [range, members, profiles, fixedTiers, settings, assignments, applications, roomSettings, held] = await Promise.all([
    loadRangeRooms(supabase, organizationId, days[0], days.at(-1)!),
    loadFieldMembers(supabase, organizationId),
    loadStaffProfiles(supabase, organizationId),
    loadFixedTiers(supabase, organizationId),
    loadAssignSettings(supabase, organizationId),
    loadAssignments(supabase, organizationId, days[0], days.at(-1)!),
    loadApplications(supabase, organizationId, days[0], days.at(-1)!),
    supabase.from("cleaning_room_settings").select("room_key, usual_headcount").eq("organization_id", organizationId),
    loadHeldRoomKeys(supabase, organizationId, days[0], days.at(-1)!),
  ]);
  const usual = new Map((roomSettings.data ?? []).map((row) => [row.room_key, row.usual_headcount]));
  const memberById = new Map(members.map((m) => [m.userId, m]));
  // 이번 달 근무 일수(방 수가 아니라 날 수) — 앞날에 제안한 날도 더해 가며 센다(「근무 일수 적은 사람 먼저」).
  const monthDaysOf = new Map<string, Set<string>>();
  const addWorkDay = (userId: string, date: string) => {
    let set = monthDaysOf.get(userId);
    if (!set) monthDaysOf.set(userId, (set = new Set()));
    set.add(date);
  };
  for (const row of assignments) addWorkDay(row.userId, row.workDate);
  const out: Array<Suggestion & { workDate: string; propertyName: string; roomLabel: string }> = [];
  let openTotal = 0;
  const shortDays: string[] = [];
  for (const date of days) {
    const dayRooms = range.get(date);
    if (!dayRooms || dayRooms.size === 0) continue;
    const dayAssign = assignments.filter((a) => a.workDate === date);
    const byRoom = new Map<string, string[]>();
    const byUser = new Map<string, AssignmentRow[]>();
    for (const row of dayAssign) {
      byRoom.set(row.roomKey, [...(byRoom.get(row.roomKey) ?? []), row.userId]);
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    }
    const rooms: SuggestRoom[] = [...dayRooms.values()]
      // 미루거나 처리 끝낸 방은 하루 보기처럼 제안에서 뺀다.
      .filter((room) => !held.has(`${date}|${room.roomKey}`))
      .sort(compareAssignRooms)
      .map((room) => ({ assigned: byRoom.get(room.roomKey) ?? [], need: Math.max(0, (usual.get(room.roomKey) ?? 1) - (byRoom.get(room.roomKey)?.length ?? 0)), propertyName: room.propertyName, roomKey: room.roomKey }))
      .filter((room) => room.need > 0);
    openTotal += rooms.filter((room) => room.assigned.length === 0).length;
    const people: SuggestPerson[] = applications
      .filter((a) => a.workDate === date && !a.cancelledAt)
      .map((a) => {
        const member = memberById.get(a.userId) ?? { role: "part_time_staff" };
        const profile = profileOf(profiles, a.userId);
        const mine = byUser.get(a.userId) ?? [];
        return {
          monthDays: monthDaysOf.get(a.userId)?.size ?? 0,
          priority: profile.priority,
          propertiesToday: [...new Set(mine.map((row) => row.propertyName))],
          roomsToday: mine.length,
          startMinutes: a.startMinutes ?? profile.defaultStartMinutes ?? defaultStartMinutes(member.role),
          trainee: profile.trainee,
          trainer: isTrainer(member, profile),
          userId: a.userId,
        };
      });
    const day = suggestAssignments({ fixedTiers, people, rooms, rules: settings.rules });
    const filledOpen = new Set(day.map((s) => s.roomKey));
    if (rooms.some((room) => room.assigned.length === 0 && !filledOpen.has(room.roomKey))) shortDays.push(date);
    for (const s of day) {
      const room = dayRooms.get(s.roomKey)!;
      out.push({ ...s, propertyName: room.propertyName, roomLabel: room.roomLabel, workDate: date });
      addWorkDay(s.userId, date);
    }
  }
  return { openTotal, shortDays, suggestions: out };
}

// ── 알바 화면 — 내 시프트 · 오늘 내 방 ─────────────────────────────────────────────────────────

export type MyShiftDay = { date: string; state: ShiftDayState; rooms: number; cancelRequested: boolean };

export type MyShiftDetail = {
  date: string;
  state: ShiftDayState;
  startMinutes: number;
  cancelRequested: boolean;
  rooms: { roomKey: string; propertyName: string; roomLabel: string; mates: string[] }[];
  /** 같이 일하는 사람 — 내가 배정된 날 중 오늘 · 내일만(서버가 거른다). */
  mates: { name: string; rooms: string[] }[] | null;
};

export async function loadMyShift(
  supabase: Client,
  organizationId: string,
  userId: string,
  role: string,
  ym: string,
  today: string,
): Promise<{ days: MyShiftDay[]; upcoming: MyShiftDetail[]; details: MyShiftDetail[]; summary: { applied: number; assigned: number } }> {
  const days = monthDays(ym);
  const from = days[0] < today ? days[0] : today;
  const to = addDays(today, 7) > days.at(-1)! ? addDays(today, 7) : days.at(-1)!;
  const [range, myApps, allAssign, profiles] = await Promise.all([
    loadRangeRooms(supabase, organizationId, from, to),
    loadApplications(supabase, organizationId, from, to, userId),
    loadAssignments(supabase, organizationId, from, to),
    loadStaffProfiles(supabase, organizationId),
  ]);
  const profile = profileOf(profiles, userId);
  const base = profile.defaultStartMinutes ?? defaultStartMinutes(role);
  const appBy = new Map(myApps.map((a) => [a.workDate, a]));
  const assignedKeys = new Map<string, Set<string>>();
  const mineBy = new Map<string, AssignmentRow[]>();
  for (const row of allAssign) {
    let set = assignedKeys.get(row.workDate);
    if (!set) assignedKeys.set(row.workDate, (set = new Set()));
    set.add(row.roomKey);
    if (row.userId === userId) mineBy.set(row.workDate, [...(mineBy.get(row.workDate) ?? []), row]);
  }
  const stateOf = (date: string): ShiftDayState => {
    const app = appBy.get(date);
    const total = range.get(date)?.size ?? 0;
    const assigned = assignedKeys.get(date) ?? new Set<string>();
    const open = [...(range.get(date)?.keys() ?? [])].filter((key) => !assigned.has(key)).length;
    return shiftDayState({ applied: Boolean(app), cancelled: Boolean(app?.cancelledAt), isPast: date < today, myRooms: mineBy.get(date)?.length ?? 0, openRooms: open, totalRooms: total });
  };
  const monthList = days.map((date) => ({
    cancelRequested: Boolean(appBy.get(date)?.cancelRequestedAt) && !appBy.get(date)?.cancelledAt,
    date,
    rooms: mineBy.get(date)?.length ?? 0,
    state: stateOf(date),
  }));

  // 다가오는 일정 — 오늘부터 7일 중 신청 · 배정이 있는 날.
  const nameIds = [...new Set(allAssign.map((row) => row.userId))];
  const names = new Map<string, string>();
  if (nameIds.length > 0) {
    const result = await supabase.from("profiles").select("id, name").in("id", nameIds);
    for (const row of result.data ?? []) names.set(row.id, row.name);
  }
  const detailOf = (date: string): MyShiftDetail | null => {
    const app = appBy.get(date);
    const mine = mineBy.get(date) ?? [];
    if (!app && mine.length === 0) return null;
    const dayRows = allAssign.filter((row) => row.workDate === date);
    // 같이 일하는 사람은 내가 배정된 날 중 오늘 · 내일만 — 서버가 데이터를 주지 않는다(불만 · 논쟁 방지, 사용자 결정 2026-10-20).
    const showMates = mine.length > 0 && (date === today || date === addDays(today, 1));
    const matesMap = new Map<string, string[]>();
    if (showMates) {
      for (const row of dayRows) {
        if (row.userId === userId) continue;
        matesMap.set(row.userId, [...(matesMap.get(row.userId) ?? []), `${row.propertyName} ${row.roomLabel}`]);
      }
    }
    return {
      cancelRequested: Boolean(app?.cancelRequestedAt) && !app?.cancelledAt,
      date,
      mates: showMates ? [...matesMap.entries()].map(([id, rooms]) => ({ name: names.get(id) ?? "—", rooms })) : null,
      rooms: mine
        .map((row) => ({
          mates: showMates ? dayRows.filter((r) => r.roomKey === row.roomKey && r.userId !== userId).map((r) => names.get(r.userId) ?? "—") : [],
          propertyName: row.propertyName,
          roomKey: row.roomKey,
          roomLabel: row.roomLabel,
        }))
        .sort(compareAssignRooms),
      startMinutes: app?.startMinutes ?? base,
      state: stateOf(date),
    };
  };
  const upcoming: MyShiftDetail[] = [];
  for (let i = 0; i <= 7; i++) {
    const detail = detailOf(addDays(today, i));
    if (detail) upcoming.push(detail);
  }
  const details = [...new Set([...days, ...upcoming.map((d) => d.date)])]
    .map((date) => detailOf(date))
    .filter((detail): detail is MyShiftDetail => detail !== null);
  return {
    details,
    days: monthList,
    summary: { applied: monthList.filter((d) => appBy.has(d.date)).length, assigned: monthList.filter((d) => d.rooms > 0).length },
    upcoming,
  };
}

export type TodayRoom = AssignRoom & { mates: { name: string; trainee: boolean }[] };

export async function loadTodayRooms(
  supabase: Client,
  organizationId: string,
  userId: string,
  role: string,
  date: string,
): Promise<{
  date: string;
  startMinutes: number;
  rooms: TodayRoom[];
  mates: { name: string; rooms: string[] }[];
  changedLastNight: { at: string; rooms: string[] }[];
  state: ShiftDayState;
  tomorrow: { date: string; state: ShiftDayState; rooms: number };
}> {
  const tomorrow = addDays(date, 1);
  const [dayRooms, assign, apps, profiles, range] = await Promise.all([
    loadAssignDayRooms(supabase, organizationId, date),
    loadAssignments(supabase, organizationId, date, tomorrow),
    loadApplications(supabase, organizationId, date, tomorrow, userId),
    loadStaffProfiles(supabase, organizationId),
    loadRangeRooms(supabase, organizationId, tomorrow, tomorrow),
  ]);
  const todayRows = assign.filter((row) => row.workDate === date);
  const mine = todayRows.filter((row) => row.userId === userId);
  const ids = [...new Set(todayRows.map((row) => row.userId))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const result = await supabase.from("profiles").select("id, name").in("id", ids);
    for (const row of result.data ?? []) names.set(row.id, row.name);
  }
  const roomBy = new Map(dayRooms.map((room) => [room.roomKey, room]));
  const rooms: TodayRoom[] = mine
    .map((row) => {
      const room = roomBy.get(row.roomKey);
      const mates = todayRows
        .filter((r) => r.roomKey === row.roomKey && r.userId !== userId)
        .map((r) => ({ name: names.get(r.userId) ?? "—", trainee: profileOf(profiles, r.userId).trainee }));
      if (room) return { ...room, mates };
      // 그 사이 예약이 취소된 방 — 그래도 보여 준다(관리자가 정리할 때까지).
      return {
        arrivingGuests: null,
        arrivingGuestName: null,
        carriedFrom: null,
        carryDays: 0,
        deferredUntil: null,
        resolvedHold: false,
        hasTurnover: false,
        holdReason: null,
        mates,
        nextCheckInDate: null,
        nextGuests: null,
        nextGuestName: null,
        note: null,
        propertyName: row.propertyName,
        roomKey: row.roomKey,
        roomLabel: row.roomLabel,
        sessionRoomLabel: `${row.propertyName} ${row.roomLabel}`,
        source: "checkout" as const,
        status: "pending" as const,
        usualHeadcount: 1,
      };
    })
    .sort(compareAssignRooms);
  const matesMap = new Map<string, string[]>();
  if (mine.length > 0) {
    for (const row of todayRows) {
      if (row.userId === userId) continue;
      matesMap.set(row.userId, [...(matesMap.get(row.userId) ?? []), `${row.propertyName} ${row.roomLabel}`]);
    }
  }
  // 「어젯밤 바뀜」 — 전날 18시(도쿄) 이후에 더해진 내 방.
  const cutoff = Date.parse(`${addDays(date, -1)}T18:00:00+09:00`);
  const changed = mine.filter((row) => Date.parse(row.createdAt) >= cutoff && Date.parse(row.createdAt) < Date.parse(`${date}T06:00:00+09:00`));
  const app = apps.find((a) => a.workDate === date);
  const profile = profileOf(profiles, userId);
  const base = profile.defaultStartMinutes ?? defaultStartMinutes(role);
  const todayTotal = dayRooms.length;
  const todayOpen = dayRooms.filter((room) => !todayRows.some((r) => r.roomKey === room.roomKey)).length;
  const tApp = apps.find((a) => a.workDate === tomorrow);
  const tRows = assign.filter((row) => row.workDate === tomorrow);
  const tAssigned = new Set(tRows.map((row) => row.roomKey));
  const tRange = range.get(tomorrow);
  const tMine = tRows.filter((row) => row.userId === userId).length;
  return {
    changedLastNight: changed.length ? [{ at: changed.at(-1)!.createdAt, rooms: changed.map((row) => `${row.propertyName} ${row.roomLabel}`) }] : [],
    date,
    mates: [...matesMap.entries()].map(([id, list]) => ({ name: names.get(id) ?? "—", rooms: list })),
    rooms,
    startMinutes: app?.startMinutes ?? base,
    state: shiftDayState({ applied: Boolean(app), cancelled: Boolean(app?.cancelledAt), isPast: false, myRooms: mine.length, openRooms: todayOpen, totalRooms: todayTotal }),
    tomorrow: {
      date: tomorrow,
      rooms: tMine,
      state: shiftDayState({
        applied: Boolean(tApp),
        cancelled: Boolean(tApp?.cancelledAt),
        isPast: false,
        myRooms: tMine,
        openRooms: [...(tRange?.keys() ?? [])].filter((key) => !tAssigned.has(key)).length,
        totalRooms: tRange?.size ?? 0,
      }),
    },
  };
}

// ── Slack 청소 명단 담당자 ───────────────────────────────────────────────────────────────────────

/** 물리 객실 키 → 「이름 · 이름」. 배정이 없는 날이면 빈 지도(수기 담당자 입력이 그대로 쓰인다). */
export async function loadAssignedNamesByRoom(supabase: Client, organizationId: string, date: string): Promise<Map<string, string>> {
  const rows = await loadAssignments(supabase, organizationId, date, date);
  if (rows.length === 0) return new Map();
  const ids = [...new Set(rows.map((row) => row.userId))];
  const profiles = await supabase.from("profiles").select("id, name").in("id", ids);
  const names = new Map((profiles.data ?? []).map((row) => [row.id, row.name]));
  const out = new Map<string, string[]>();
  for (const row of rows) out.set(row.roomKey, [...(out.get(row.roomKey) ?? []), names.get(row.userId) ?? "—"]);
  return new Map([...out.entries()].map(([key, list]) => [key, list.join(" · ").slice(0, 120)]));
}

// ── 배정 설정 화면 ───────────────────────────────────────────────────────────────────────────────

export type SettingsPerson = {
  userId: string;
  name: string;
  role: string;
  profile: StaffProfile;
  defaultStartMinutes: number;
  traineeCount: number;
  lastWorked: string | null;
  monthDays: number;
};

export type SettingsView = {
  settings: AssignSettings;
  people: SettingsPerson[];
  fixed: FixedStaffRow[];
  properties: string[];
  rooms: { roomKey: string; propertyName: string; roomLabel: string; headcount: number }[];
};

export async function loadSettingsView(
  supabase: Client,
  organizationId: string,
  today: string,
  roomOptions: Array<{ roomKey: string; propertyName: string; roomLabel: string }>,
): Promise<SettingsView> {
  const [settings, members, profiles, fixed, roomSettings] = await Promise.all([
    loadAssignSettings(supabase, organizationId),
    loadFieldMembers(supabase, organizationId),
    loadStaffProfiles(supabase, organizationId),
    loadFixedStaffRows(supabase, organizationId),
    supabase.from("cleaning_room_settings").select("room_key, usual_headcount").eq("organization_id", organizationId),
  ]);
  const ids = members.map((m) => m.userId);
  const [trainee, activity] = await Promise.all([
    loadTraineeCounts(supabase, organizationId, ids, today),
    loadAttendanceActivity(supabase, organizationId, ids, today),
  ]);
  const headcount = new Map((roomSettings.data ?? []).map((row) => [row.room_key, row.usual_headcount]));
  return {
    fixed,
    people: members.map((member) => {
      const profile = profileOf(profiles, member.userId);
      return {
        defaultStartMinutes: profile.defaultStartMinutes ?? defaultStartMinutes(member.role),
        lastWorked: activity.get(member.userId)?.last ?? null,
        monthDays: activity.get(member.userId)?.monthDays ?? 0,
        name: member.name,
        profile,
        role: member.role,
        traineeCount: trainee.get(member.userId)?.total ?? 0,
        userId: member.userId,
      };
    }),
    properties: [...new Set(roomOptions.map((option) => option.propertyName))].sort((a, b) => compareAssignRooms({ propertyName: a, roomLabel: "" }, { propertyName: b, roomLabel: "" })),
    rooms: roomOptions
      .map((option) => ({ ...option, headcount: headcount.get(option.roomKey) ?? 1 }))
      .sort(compareAssignRooms),
    settings,
  };
}

// ── 월 비교표(방 수 ↔ 급여) ───────────────────────────────────────────────────────────────────────

export type CompareRow = {
  userId: string;
  name: string;
  role: string;
  trainee: boolean;
  fixedTier: number | null;
  priority: boolean;
  days: number;
  assigned: number;
  /** 청소한 방 — 같이 한 방은 나눠 센다(3명이면 0.33). */
  cleaned: number;
  paidMinutes: number;
  pay: number;
};

/**
 * 사람마다 그달 배정 방 · 청소한 방(그날 그 방 청소 기록이 끝났으면, 같이 들어간 사람 수로 나눔) · 근무 시간 · 급여.
 * 급여는 근태 · 급여 화면과 같은 계산(`getMonthlyPayView`)을 그대로 읽는다 — 급여 계산은 바꾸지 않는다.
 * **호출하는 쪽이 급여 열람 권한을 먼저 확인한다.**
 */
export async function loadCompareRows(
  supabase: Client,
  organizationId: string,
  ym: string,
  payView: (userId: string) => Promise<{ totalPaidMinutes: number; expectedGross: number; finalizedGross: number | null }>,
): Promise<CompareRow[]> {
  const days = monthDays(ym);
  const from = days[0];
  const to = days.at(-1)!;
  const [members, profiles, fixedTiers, assignments, sessions] = await Promise.all([
    loadFieldMembers(supabase, organizationId),
    loadStaffProfiles(supabase, organizationId),
    loadFixedTiers(supabase, organizationId),
    loadAssignments(supabase, organizationId, from, to),
    readAllPages<{ room_label: string; cleaning_date: string }>((start, end) =>
      supabase
        .from("cleaning_sessions")
        .select("room_label, cleaning_date")
        .eq("organization_id", organizationId)
        .eq("status", "completed")
        // 「처리 끝」 기록은 청소한 방이 아니다.
        .eq("closed_without_cleaning", false)
        .gte("cleaning_date", from)
        .lte("cleaning_date", to)
        .order("id")
        .range(start, end),
    ),
  ]);
  if (sessions.error) throw new Error(sessions.error.message);
  const done = new Set<string>();
  for (const row of sessions.data ?? []) {
    const key = physicalRoomKeyOfSessionLabel(row.room_label);
    if (key) done.add(`${row.cleaning_date}|${key}`);
  }
  const perRoom = new Map<string, number>();
  for (const row of assignments) perRoom.set(`${row.workDate}|${row.roomKey}`, (perRoom.get(`${row.workDate}|${row.roomKey}`) ?? 0) + 1);
  const userIds = [...new Set(assignments.map((row) => row.userId))];
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const missing = userIds.filter((id) => !memberById.has(id));
  const names = new Map(members.map((m) => [m.userId, m.name]));
  if (missing.length > 0) {
    const extra = await supabase.from("profiles").select("id, name").in("id", missing);
    for (const row of extra.data ?? []) names.set(row.id, row.name);
  }
  const pays = await Promise.all(userIds.map((id) => payView(id).catch(() => ({ expectedGross: 0, finalizedGross: null, totalPaidMinutes: 0 }))));
  return userIds.map((userId, index) => {
    const mine = assignments.filter((row) => row.userId === userId);
    const cleaned = mine.reduce((sum, row) => (done.has(`${row.workDate}|${row.roomKey}`) ? sum + 1 / (perRoom.get(`${row.workDate}|${row.roomKey}`) ?? 1) : sum), 0);
    const profile = profileOf(profiles, userId);
    const tiers = Object.values(fixedTiers).map((t) => t[userId]).filter((t): t is number => t !== undefined);
    return {
      assigned: mine.length,
      cleaned: Math.round(cleaned * 100) / 100,
      days: new Set(mine.map((row) => row.workDate)).size,
      fixedTier: tiers.length ? Math.min(...tiers) : null,
      name: names.get(userId) ?? "—",
      paidMinutes: pays[index].totalPaidMinutes,
      pay: pays[index].finalizedGross ?? pays[index].expectedGross,
      priority: profile.priority,
      role: memberById.get(userId)?.role ?? "part_time_staff",
      trainee: profile.trainee,
      userId,
    };
  });
}
