import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, defaultStartMinutes, monthDays, shiftDayState, type ShiftDayState } from "@/lib/cleaning-assign/day-state";
import { loadApplications, loadAssignments, loadFieldMembers, loadProfilesByOwners, loadStaffProfiles, profileOf } from "@/lib/cleaning-assign/data";
import { compareAssignRooms, countOpenRooms, indexPersonRecords, liveAssignments, type PersonRecordRow } from "@/lib/cleaning-assign/room-rules";
import { createSharedRoomReads, loadRangeDayRooms } from "@/lib/cleaning-assign/rooms";
import { buildSessionRoomLabel } from "@/lib/room-label-normalization";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { Database } from "@/types/database";

/**
 * 사람별 시프트 달력 — 관리자가 알바 · 직원 한 명의 한 달을 본다(시안 72AoNd…, 2026-10-23).
 * 달력 모양은 그 사람이 「내 시프트」에서 보는 것과 같고, 관리자만 보는 것을 더한다:
 * 실제로 일한 날(그 사람 청소 기록) · **기록 없음**(지난 날 배정됐는데 그 사람 청소 기록이 하나도 없음) · 취소 요청 · 같이 들어간 사람(모든 날).
 * **호출하는 쪽이 `cleaning.assign` 을 먼저 확인한다.**
 * docs/product/37-cleaning-shift-assignment.md 「4-6」
 */

type Client = SupabaseClient<Database>;

export type PersonShiftDay = {
  date: string;
  state: ShiftDayState;
  rooms: number;
  cancelRequested: boolean;
  /** 지난 날 배정됐는데 그 사람 청소 기록이 하나도 없음. */
  noRecord: boolean;
};

export type PersonShiftRoom = {
  roomKey: string;
  propertyName: string;
  roomLabel: string;
  mates: string[];
  /** 그 사람 청소 기록 — 끝난 것이 있으면 그것, 없으면 시작만 한 것. */
  /** `endUnknown` — 다음 날 「청소했어요」로 닫아 끝낸 시각을 모르는 완료 기록(`isUnmeasuredSession`). */
  session: { startedAt: string; completedAt: string | null; minutes: number | null; endUnknown: boolean } | null;
};

export type PersonShiftDetail = {
  date: string;
  state: ShiftDayState;
  startMinutes: number;
  cancelRequested: boolean;
  cancelRequestedAt: string | null;
  cancelNote: string | null;
  /** 관리자가 넣은 신청인지. */
  byAdmin: boolean;
  assignedBy: string | null;
  assignedAt: string | null;
  /** 그날 아무도 안 들어간 방 수(신청 · 배정 전인 날에 보여 준다). */
  openRooms: number;
  noRecord: boolean;
  rooms: PersonShiftRoom[];
};

export type PersonShift = {
  person: { userId: string; name: string; role: string; phone: string; startMinutes: number; priority: boolean; trainee: boolean };
  ym: string;
  days: PersonShiftDay[];
  details: PersonShiftDetail[];
  summary: { applied: number; assigned: number; rooms: number; worked: number };
};

export async function loadPersonShift(
  supabase: Client,
  organizationId: string,
  userId: string,
  ym: string,
  today: string,
  viewerId: string,
): Promise<PersonShift | null> {
  const members = await loadFieldMembers(supabase, organizationId);
  const member = members.find((m) => m.userId === userId);
  if (!member) return null;
  const days = monthDays(ym);
  const from = days[0];
  const to = days.at(-1)!;
  const shared = createSharedRoomReads(supabase, organizationId, from, to);
  const [plans, apps, readAssign, sessions, viewerProfiles, records] = await Promise.all([
    loadRangeDayRooms(supabase, organizationId, from, to, null, shared),
    loadApplications(supabase, organizationId, from, to, userId),
    loadAssignments(supabase, organizationId, from, to),
    readAllPages<PersonRecordRow>((start, end) =>
      supabase
        .from("cleaning_sessions")
        .select("room_label, cleaning_date, started_at, completed_at, duration_seconds, status, closed_without_cleaning")
        .eq("organization_id", organizationId)
        .eq("staff_user_id", userId)
        .gte("cleaning_date", from)
        .lte("cleaning_date", to)
        .order("id")
        .range(start, end),
    ),
    loadStaffProfiles(supabase, organizationId, viewerId),
    shared.sessions(from, to),
  ]);
  if (sessions.error) throw new Error(sessions.error.message);
  // 유령 배정(그날 청소할 방 목록에 없는 배정 — 예약 취소 · 날짜 변경, 문서 45 C14)은 배정으로 세지 않는다. 그 달 전체 목록을 읽었다.
  // 그 사람이 그 방을 실제로 청소한 기록이 있으면 유령이 아니다 — 지난 날 실제 청소한 방이 달력에서 빠지지 않게(2026-11-09 리뷰).
  const allAssign = liveAssignments(readAssign, plans, records);

  const appBy = new Map(apps.map((a) => [a.workDate, a]));
  const assignedKeys = new Map<string, Set<string>>();
  const mineBy = new Map<string, typeof allAssign>();
  for (const row of allAssign) {
    let set = assignedKeys.get(row.workDate);
    if (!set) assignedKeys.set(row.workDate, (set = new Set()));
    set.add(row.roomKey);
    if (row.userId === userId) mineBy.set(row.workDate, [...(mineBy.get(row.workDate) ?? []), row]);
  }
  // 그 사람 청소 기록 — 날짜 × 방. 「일한 날」은 청소한 기록(완료 · 처리 끝 아님)만, 취소 · 처리 끝은 기록이 아니다(C15 · `indexPersonRecords`).
  const { cleanedDates: recordDates, sessionBy } = indexPersonRecords(sessions.data ?? []);

  // 출근 시각 — 그날 신청에 적힌 값 → 그 방을 넣은 담당의 설정 → 보는 사람의 설정 → 역할 기본값(내 시프트와 같은 순서 + 보는 사람).
  const owners = [...new Set([...mineBy.values()].flat().map((row) => row.createdBy).filter((id): id is string => Boolean(id)))];
  const ownerProfiles = await loadProfilesByOwners(supabase, organizationId, owners, [userId]);
  const viewerProfile = profileOf(viewerProfiles, userId);
  const baseStart = viewerProfile.defaultStartMinutes ?? defaultStartMinutes(member.role);
  const startOf = (date: string) => {
    const owner = mineBy.get(date)?.[0]?.createdBy;
    return appBy.get(date)?.startMinutes ?? (owner ? ownerProfiles.get(`${owner}|${userId}`)?.defaultStartMinutes : null) ?? baseStart;
  };

  const nameIds = [...new Set(allAssign.map((row) => row.createdBy).concat(allAssign.map((row) => row.userId)).filter((id): id is string => Boolean(id)))];
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const missing = nameIds.filter((id) => !names.has(id));
  if (missing.length > 0) {
    const extra = await supabase.from("profiles").select("id, name").in("id", missing);
    for (const row of extra.data ?? []) names.set(row.id, row.name);
  }

  // 미룸 · 처리 끝 · 끝난 방은 미배정으로 세지 않는다 — 하루 보기와 같은 계산(문서 45 C9 · C10).
  const openOf = (date: string) => countOpenRooms(plans.get(date) ?? [], assignedKeys.get(date) ?? new Set());
  const stateOf = (date: string): ShiftDayState => {
    const app = appBy.get(date);
    return shiftDayState({
      applied: Boolean(app),
      cancelled: Boolean(app?.cancelledAt),
      isPast: date < today,
      myRooms: mineBy.get(date)?.length ?? 0,
      openRooms: openOf(date),
      totalRooms: plans.get(date)?.length ?? 0,
    });
  };

  const dayList: PersonShiftDay[] = days.map((date) => {
    const state = stateOf(date);
    const app = appBy.get(date);
    return {
      cancelRequested: Boolean(app?.cancelRequestedAt) && !app?.cancelledAt,
      date,
      noRecord: state === "worked" && !recordDates.has(date),
      rooms: mineBy.get(date)?.length ?? 0,
      state,
    };
  });

  const details: PersonShiftDetail[] = dayList
    .filter((day) => day.state !== "free" && day.state !== "past")
    .map((day) => {
      const app = appBy.get(day.date);
      const mine = mineBy.get(day.date) ?? [];
      const dayRows = allAssign.filter((row) => row.workDate === day.date);
      const first = [...mine].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      return {
        assignedAt: first?.createdAt ?? null,
        assignedBy: first?.createdBy ? (names.get(first.createdBy) ?? null) : null,
        byAdmin: app?.source === "admin",
        cancelNote: app?.cancelRequestNote ?? null,
        cancelRequested: day.cancelRequested,
        cancelRequestedAt: day.cancelRequested ? (app?.cancelRequestedAt ?? null) : null,
        date: day.date,
        noRecord: day.noRecord,
        openRooms: openOf(day.date),
        rooms: mine
          .map((row) => ({
            mates: dayRows.filter((r) => r.roomKey === row.roomKey && r.userId !== userId).map((r) => names.get(r.userId) ?? "—"),
            propertyName: row.propertyName,
            roomKey: row.roomKey,
            roomLabel: row.roomLabel,
            session:
              sessionBy.get(`${day.date}|${row.roomKey}`) ??
              sessionBy.get(`${day.date}|${buildSessionRoomLabel(row.propertyName, row.roomLabel)}`) ??
              null,
          }))
          .sort(compareAssignRooms),
        startMinutes: startOf(day.date),
        state: day.state,
      };
    });

  const assignedDays = dayList.filter((d) => d.rooms > 0);
  return {
    days: dayList,
    details,
    person: {
      name: member.name,
      phone: member.phone,
      priority: viewerProfile.priority,
      role: member.role,
      startMinutes: baseStart,
      trainee: viewerProfile.trainee,
      userId,
    },
    summary: {
      applied: dayList.filter((d) => appBy.has(d.date) && !appBy.get(d.date)?.cancelledAt).length,
      assigned: assignedDays.length,
      rooms: assignedDays.reduce((sum, d) => sum + d.rooms, 0),
      worked: dayList.filter((d) => d.state === "worked" && !d.noRecord).length,
    },
    ym,
  };
}

/** 이번 주(일~토) 날짜 — 사용자 상세의 「시프트」 줄. */
export function weekOf(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const start = addDays(today, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
