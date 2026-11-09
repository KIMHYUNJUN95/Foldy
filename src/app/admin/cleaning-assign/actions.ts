"use server";

import { revalidatePath } from "next/cache";
import { loadCleaningRoomOptions } from "@/lib/automation/data";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { addDays, isDateKey, isMonthKey, minutesToLabel, timeToMinutes } from "@/lib/cleaning-assign/day-state";
import {
  computeDaySuggestions,
  computeMonthSuggestions,
  loadFieldMembers,
  loadMonthBoard,
  loadMonthOpenCounts,
  type MonthBoard,
} from "@/lib/cleaning-assign/data";
import { loadPersonShift, type PersonShift } from "@/lib/cleaning-assign/person-shift";
import { checkAddExtraRoom } from "@/lib/cleaning-assign/extra-room";
import { canHoldRoom, canSwapPerson, applyHoldSteps, holdRemovedUserIds, holdUpsertRow, personHasRoomRecord, releaseHoldSteps, restoreIdsAfterRelease, suggestionsInProperties } from "@/lib/cleaning-assign/room-rules";
import { loadAssignDayRooms, loadDaySessionRows, MAX_DEFER_DAYS } from "@/lib/cleaning-assign/rooms";
import { FLAG_THRESHOLD_OPTIONS, isAssignRuleKey, normalizeAssignRules, TRAINEE_CHECK_STEP, type AssignRule } from "@/lib/cleaning-assign/rules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  guardAssignAction,
  assigner,
  cancelledUserIds,
  changed,
  ensureApplication,
  isEditableDate,
  isFieldMember,
  isUuid,
  revalidate,
  type AssignFail,
  type AssignOk,
} from "@/actions/cleaning-assign-guards";

/**
 * 청소 배정 — 관리자 서버 액션(`cleaning.assign`). 모든 쓰기는 service-role, 권한은 여기서 다시 본다(CLAUDE.md §6).
 *
 * **방 하나씩 저장한다** — 하루를 통째로 덮어쓰는 저장이 없다. 같은 사람을 같은 방에 두 번 넣는 것은 DB 유일 제약이 막고,
 * 이미 바뀐 것을 또 바꾸려 하면 `conflict` 를 돌려준다(화면이 「방금 다른 담당자가 바꿨어요」 + 새로 불러오기).
 * docs/product/37-cleaning-shift-assignment.md 「4-2-f」
 */

export type { AssignFail, AssignOk } from "@/actions/cleaning-assign-guards";

// 방 하나씩 넣고 빼기(`assignToRoom` · `unassignFromRoom`)는 모바일 청소 현황판도 쓰므로 `src/actions/cleaning-assign-room.ts` 로 옮겼다(2026-10-28).

// ── 담당 바꾸기 · 넘기기(`cleaning.assign` + `cleaning.assign_swap`) ───────────────────────────────

export type RoomMove = { roomKey: string; fromUserId: string; toUserId: string };

/**
 * 여러 방의 담당을 한 번에 옮긴다 — 서로 바꾸기 = 양쪽 방향 이동 묶음, 넘기기 = 한 방향, 실행 취소 = 거꾸로 이동.
 * DB 함수(`cleaning_reassign_rooms`)가 한 트랜잭션으로 옮기고, 하나라도 이미 바뀌었으면 전부 되돌려 `conflict`.
 * 기록이 있는 사람은 옮기지 않는다 — 판단은 사람 단위(문서 45 표 2 `canSwapPerson`). 청소 중 · 끝난 방도 기록 없는 사람은 옮길 수 있고,
 * 미룸 · 처리 끝 · 예약 취소된 방은 잠근다. RPC 는 상태를 보지 않으므로 여기서 막는다. 받는 사람은 현장 멤버여야 하고 신청이 없으면 「관리자가 넣음」 신청을 만든다.
 * 출근 시각은 사람마다 그대로(신청 줄에 있다). docs/product/37-cleaning-shift-assignment.md 「담당 교체」
 */
export async function reassignRooms(input: { date: string; moves: RoomMove[] }): Promise<AssignOk<{ moved: number }> | AssignFail> {
  return guardAssignAction("reassignRooms", () => reassignRoomsBody(input));
}

async function reassignRoomsBody(input: { date: string; moves: RoomMove[] }): Promise<AssignOk<{ moved: number }> | AssignFail> {
  const session = await assigner();
  if (!session || !session.capabilities.includes("cleaning.assign_swap")) return { ok: false, reason: "forbidden" };
  const moves = Array.isArray(input.moves) ? input.moves : [];
  if (
    !isEditableDate(input.date) ||
    moves.length === 0 ||
    moves.length > 80 ||
    moves.some((m) => !m || typeof m.roomKey !== "string" || !isUuid(m.fromUserId) || !isUuid(m.toUserId) || m.fromUserId === m.toUserId)
  ) {
    return { ok: false, reason: "invalid" };
  }
  // 같은 사람 · 같은 방이 두 번 나오면 안 된다(한 줄을 두 번 옮길 수 없음).
  if (new Set(moves.map((m) => `${m.roomKey}|${m.fromUserId}`)).size !== moves.length) return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const [rooms, members, sessions] = await Promise.all([
    loadAssignDayRooms(supabase, organizationId, input.date, session.user.id),
    loadFieldMembers(supabase, organizationId),
    loadDaySessionRows(supabase, organizationId, input.date),
  ]);
  const memberIds = new Set(members.map((m) => m.userId));
  const roomBy = new Map(rooms.map((r) => [r.roomKey, r]));
  for (const m of moves) {
    const room = roomBy.get(m.roomKey);
    if (!memberIds.has(m.toUserId)) return { ok: false, reason: "invalid" };
    // 화면을 그린 뒤 방이 바뀐 경우 — 입력이 틀린 게 아니다(`stale`, 새로 읽고 안내).
    if (!room) return { ok: false, reason: "stale" };
    const hasRecord = personHasRoomRecord(sessions, room, m.fromUserId);
    if (!canSwapPerson(room, hasRecord)) return { ok: false, reason: hasRecord ? "has_record" : "stale" };
  }
  const cancelledTargets = await cancelledUserIds(organizationId, input.date, [...new Set(moves.map((m) => m.toUserId))]);
  if (cancelledTargets === null) return { ok: false, reason: "error" };
  if (cancelledTargets.size > 0) return { ok: false, reason: "cancelled" };
  const result = await supabase.rpc("cleaning_reassign_rooms", {
    p_actor: session.user.id,
    p_moves: moves.map((m) => ({ from_user_id: m.fromUserId, room_key: m.roomKey, to_user_id: m.toUserId })),
    p_organization_id: organizationId,
    p_work_date: input.date,
  });
  if (result.error) {
    if (result.error.message?.includes("conflict")) return { ok: false, reason: "conflict" };
    console.error("[cleaning-assign] reassign failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  const applied = await Promise.all([...new Set(moves.map((m) => m.toUserId))].map((userId) => ensureApplication(organizationId, userId, input.date, session.user.id)));
  // 옮기기는 이미 저장됐다(트랜잭션) — 화면을 새로 읽게 하고 실패를 알린다.
  await changed(session.organization.id);
  if (applied.includes(false)) return { ok: false, reason: "error" };
  return { moved: Number(result.data ?? moves.length), ok: true };
}

/**
 * 제안대로 넣기 · 고정 인력 먼저 넣기 — 제안은 서버가 다시 계산한다. 이미 들어간 줄은 건너뛴다(동시에 눌러도 겹치지 않음).
 * `properties` = 화면에 보이는 건물(「내 건물」 거르기). 서버도 그 건물 방만 넣는다 — 버튼의 「N개」와 실제로 넣는 수가 같다(문서 45 A12).
 * 없으면(전 건물 보기) 전 건물.
 */
export async function applyDaySuggestions(input: { date: string; onlyFixed?: boolean; properties?: string[] | null }): Promise<AssignOk<{ added: number }> | AssignFail> {
  return guardAssignAction("applyDaySuggestions", () => applyDaySuggestionsBody(input));
}

async function applyDaySuggestionsBody(input: { date: string; onlyFixed?: boolean; properties?: string[] | null }): Promise<AssignOk<{ added: number }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date)) return { ok: false, reason: "invalid" };
  const properties = input.properties ?? null;
  if (properties !== null && (!Array.isArray(properties) || properties.length > 40 || properties.some((name) => typeof name !== "string" || name.length === 0 || name.length > 80))) {
    return { ok: false, reason: "invalid" };
  }
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const suggestions = suggestionsInProperties(await computeDaySuggestions(supabase, organizationId, input.date, Boolean(input.onlyFixed), session.user.id), properties);
  if (suggestions.length === 0) return { added: 0, ok: true };
  const result = await supabase
    .from("cleaning_assignments")
    .upsert(
      suggestions.map((s) => ({
        created_by: session.user.id,
        organization_id: organizationId,
        property_name: s.propertyName,
        room_key: s.roomKey,
        room_label: s.roomLabel,
        user_id: s.userId,
        work_date: input.date,
      })),
      { ignoreDuplicates: true, onConflict: "organization_id,work_date,room_key,user_id" },
    )
    .select("id");
  if (result.error) {
    console.error("[cleaning-assign] apply suggestions failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  await changed(session.organization.id);
  return { added: (result.data ?? []).length, ok: true };
}

// ── 사람 — 대신 넣기 · 그날 일정 취소 · 취소 요청 처리 · 그날 출근 시각 ──────────────────────────

export async function addApplicantForDay(input: { date: string; userId: string }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("addApplicantForDay", () => addApplicantForDayBody(input));
}

async function addApplicantForDayBody(input: { date: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId)) return { ok: false, reason: "invalid" };
  if (!(await isFieldMember(session.organization.id, input.userId))) return { ok: false, reason: "invalid" };
  // 「다시 넣기」 — 관리자 취소를 푸는 유일한 길.
  if (!(await ensureApplication(session.organization.id, input.userId, input.date, session.user.id, { revive: true }))) return { ok: false, reason: "error" };
  await changed(session.organization.id);
  return { ok: true };
}



export async function setDayStartTime(input: { date: string; userId: string; time: string | null }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("setDayStartTime", () => setDayStartTimeBody(input));
}

async function setDayStartTimeBody(input: { date: string; userId: string; time: string | null }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  const minutes = input.time === null ? null : timeToMinutes(input.time);
  if (!isEditableDate(input.date) || !isUuid(input.userId) || (input.time !== null && minutes === null)) return { ok: false, reason: "invalid" };
  // 시각을 넣을 때만 현장 멤버인지 본다 — 다른 넣기 액션과 같은 기준(문서 45 A17, 2026-11-09). 지우기(null)는 비활성 · 탈퇴한 사람의
  // 남은 신청 줄도 지울 수 있다(아래 조건이 조직 · 사람 · 날짜 줄만 고치고 새 줄은 만들지 않는다).
  // 취소된 날에 시각을 넣으면 되살린 것처럼 보인다 — 넣기만 막고 지우기(null)는 그대로 둔다(2026-11-02).
  if (minutes !== null) {
    if (!(await isFieldMember(session.organization.id, input.userId))) return { ok: false, reason: "invalid" };
    const cancelledDay = await cancelledUserIds(session.organization.id, input.date, [input.userId]);
    if (cancelledDay === null) return { ok: false, reason: "error" };
    if (cancelledDay.has(input.userId)) return { ok: false, reason: "cancelled" };
    if (!(await ensureApplication(session.organization.id, input.userId, input.date, session.user.id))) return { ok: false, reason: "error" };
  }
  // 지우기(null)는 있는 신청 줄만 고친다 — 없는 줄을 새로 만들면 신청하지 않은 사람이 「관리자가 넣음」 신청자로 생긴다(A17).
  const result = await getSupabaseServiceClient()
    .from("cleaning_shift_applications")
    .update({ start_time: minutes === null ? null : `${minutesToLabel(minutes).padStart(5, "0")}:00`, updated_at: new Date().toISOString() })
    .eq("organization_id", session.organization.id)
    .eq("user_id", input.userId)
    .eq("work_date", input.date);
  if (result.error) return { ok: false, reason: "error" };
  await changed(session.organization.id);
  return { ok: true };
}

// ── 방 — 직접 추가 · 미루기 · 처리 끝 ───────────────────────────────────────────────────────────

export async function addRoomForDay(input: { date: string; roomKey: string; note?: string; userIds?: string[] }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("addRoomForDay", () => addRoomForDayBody(input));
}

async function addRoomForDayBody(input: { date: string; roomKey: string; note?: string; userIds?: string[] }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  // 청소 중 · 끝난 방, 미룸 · 처리 끝 방에는 수기 줄을 더하지 않는다. 예약이 취소된 방은 목록에 없어 수기 방으로 추가된다(문서 45 A1~A6).
  // 자동화 화면 「청소 명단」도 같은 판단을 부른다(A16).
  const checked = await checkAddExtraRoom(supabase, organizationId, input.date, input.roomKey, session.user.id);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const option = checked.option;
  const note = String(input.note ?? "").trim().slice(0, 60);
  // 함께 넣을 사람 중 그날 일정이 취소된 사람이 있으면 아무것도 쓰지 않고 알린다 — 조용히 빼면 방이 채워진 것처럼 보인다(2026-11-02).
  const members = new Set((await loadFieldMembers(supabase, organizationId)).map((member) => member.userId));
  const userIds = [...new Set((input.userIds ?? []).filter((id) => isUuid(id) && members.has(id)))].slice(0, 5);
  const cancelledPicked = await cancelledUserIds(organizationId, input.date, userIds);
  if (cancelledPicked === null) {
    console.error("[cleaning-assign] add room cancelled read failed");
    return { ok: false, reason: "error" };
  }
  if (cancelledPicked.size > 0) return { ok: false, reason: "cancelled" };
  // 원래 있던 수기 방은 실패해도 남긴다 — 이번에 새로 만든 줄만 되돌린다.
  const extraBefore = await supabase.from("cleaning_list_extra_rooms").select("room_key").eq("organization_id", organizationId).eq("target_date", input.date).eq("room_key", option.roomKey).maybeSingle();
  if (extraBefore.error) {
    console.error("[cleaning-assign] extra room read failed", { code: extraBefore.error.code });
    return { ok: false, reason: "error" };
  }
  const extra = await supabase.from("cleaning_list_extra_rooms").upsert(
    {
      created_by: session.user.id,
      note: note || null,
      organization_id: organizationId,
      property_name: option.propertyName,
      room_key: option.roomKey,
      room_label: option.roomLabel,
      target_date: input.date,
    },
    { onConflict: "organization_id,target_date,room_key" },
  );
  if (extra.error) {
    console.error("[cleaning-assign] extra room failed", { code: extra.error.code });
    return { ok: false, reason: "error" };
  }
  if (userIds.length > 0) {
    // 배정 · 신청이 실패하면 방 추가도 되돌린다 — 「실패」라고 하고 사람 없는 수기 방이 남으면 안 된다.
    const rollback = async (assignmentIds: string[]): Promise<AssignFail> => {
      const undoAssign = assignmentIds.length > 0 ? await supabase.from("cleaning_assignments").delete().eq("organization_id", organizationId).in("id", assignmentIds) : { error: null };
      const undoExtra = extraBefore.data ? { error: null } : await supabase.from("cleaning_list_extra_rooms").delete().eq("organization_id", organizationId).eq("target_date", input.date).eq("room_key", option.roomKey);
      if (undoAssign.error || undoExtra.error) console.error("[cleaning-assign] add room rollback failed", { assign: undoAssign.error?.code, extra: undoExtra.error?.code });
      return { ok: false, reason: "error" };
    };
    const insert = await supabase
      .from("cleaning_assignments")
      .upsert(
        userIds.map((userId) => ({
          created_by: session.user.id,
          organization_id: organizationId,
          property_name: option.propertyName,
          room_key: option.roomKey,
          room_label: option.roomLabel,
          user_id: userId,
          work_date: input.date,
        })),
        { ignoreDuplicates: true, onConflict: "organization_id,work_date,room_key,user_id" },
      )
      .select("id");
    if (insert.error) {
      console.error("[cleaning-assign] add room assign failed", { code: insert.error.code });
      return rollback([]);
    }
    const insertedIds = (insert.data ?? []).map((row) => row.id);
    const applied = await Promise.all(userIds.map((userId) => ensureApplication(organizationId, userId, input.date, session.user.id)));
    if (applied.includes(false)) return rollback(insertedIds);
  }
  await changed(session.organization.id);
  return { ok: true };
}

/**
 * 못 한 방 · 오늘 방 처리 — `defer`(untilDate 까지 숨겼다가 그날 미배정 맨 위로) · `resolved`(청소가 필요 없게 됨, 처리 끝).
 * `originDate` = 원래 청소해야 했던 날(밀려 온 방이면 그날, 오늘 방이면 오늘).
 */
export async function holdRoom(input: { date: string; roomKey: string; originDate: string; kind: "defer" | "resolved"; untilDate?: string; reason?: string }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("holdRoom", () => holdRoomBody(input));
}

async function holdRoomBody(input: { date: string; roomKey: string; originDate: string; kind: "defer" | "resolved"; untilDate?: string; reason?: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isDateKey(input.originDate) || input.originDate > input.date) return { ok: false, reason: "invalid" };
  if (input.kind !== "defer" && input.kind !== "resolved") return { ok: false, reason: "invalid" };
  const until = input.kind === "defer" ? (input.untilDate ?? addDays(input.date, 1)) : null;
  if (until !== null && (!isDateKey(until) || until <= input.date || until > addDays(input.date, MAX_DEFER_DAYS))) return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const room = (await loadAssignDayRooms(supabase, organizationId, input.date, session.user.id)).find((item) => item.roomKey === input.roomKey);
  // 화면을 그린 뒤 방이 바뀐 경우 — 입력이 틀린 게 아니다(`stale`, 새로 읽고 안내).
  if (!room) return { ok: false, reason: "stale" };
  // 청소 중 · 끝난 방, 이미 미룬 방, 이미 처리 끝인 방에는 다시 걸지 않는다(먼저 되돌린 뒤에). 원래 날짜는 서버가 아는 값과 같아야 한다.
  if (!canHoldRoom(room)) return { ok: false, reason: "stale" };
  if (input.originDate !== (room.carriedFrom ?? input.date)) return { ok: false, reason: "stale" };
  const reason = String(input.reason ?? "").trim().slice(0, 120);
  // 그날 이 방 배정은 뺀다 — 뺀 사람을 미룸 줄에 남겨 「되돌리기」가 다시 넣게. 기간이 지난 줄을 다시 걸 때는 지금 배정만(문서 45 A8).
  const [current, previous] = await Promise.all([
    supabase.from("cleaning_assignments").select("user_id").eq("organization_id", organizationId).eq("work_date", input.date).eq("room_key", room.roomKey),
    supabase.from("cleaning_room_holds").select("*").eq("organization_id", organizationId).eq("room_key", room.roomKey).eq("origin_date", input.originDate).maybeSingle(),
  ]);
  if (current.error || previous.error) {
    console.error("[cleaning-assign] hold read failed", { current: current.error?.code, previous: previous.error?.code });
    return { ok: false, reason: "error" };
  }
  const removedUserIds = holdRemovedUserIds(previous.data, (current.data ?? []).map((row) => row.user_id), input.date);
  // 처리 끝은 청소 대시보드 강제완료처럼 그날 청소 기록(완료)을 남긴다 — 「처리 끝 · 청소 안 함」 표시(`closed_without_cleaning`),
  // 담당자는 누른 관리자 · 소요 시간 없음, 사람별 숫자에서는 빠진다. 되돌리기가 지우도록 미룸 줄에 기록 id 를 둔다.
  // 기존 줄을 바꿔 거는 경우(기간이 지난 미룸 등) 전에 남긴 「처리 끝」 청소 기록은 먼저 지운다 — 고아 완료 기록 방지.
  const oldClosedId = previous.data?.closed_session_id ?? null;
  if (oldClosedId) {
    const removedOld = await supabase.from("cleaning_sessions").delete().eq("organization_id", organizationId).eq("closed_without_cleaning", true).eq("id", oldClosedId);
    if (removedOld.error) {
      console.error("[cleaning-assign] old closed session delete failed", { code: removedOld.error.code });
      return { ok: false, reason: "error" };
    }
  }
  const outcome = await applyHoldSteps(input.kind, {
    deleteClosed: async (id) => {
      const removed = await supabase.from("cleaning_sessions").delete().eq("organization_id", organizationId).eq("closed_without_cleaning", true).eq("id", id);
      return { error: Boolean(removed.error) };
    },
    insertClosed: async () => {
      const now = new Date().toISOString();
      const closed = await supabase
        .from("cleaning_sessions")
        .insert({
          cleaning_date: input.date,
          closed_without_cleaning: true,
          completed_at: now,
          completed_by_admin: session.user.id,
          // 완료 기록은 소요 시간이 있어야 한다(DB 제약) — 0 으로 두고 화면은 「처리 끝」 기록의 소요를 비운다.
          duration_seconds: 0,
          notes: reason || null,
          organization_id: organizationId,
          room_key: room.roomKey,
          room_label: room.sessionRoomLabel,
          staff_user_id: session.user.id,
          started_at: now,
          status: "completed",
          task_label: "checkout",
        })
        .select("id")
        .single();
      if (closed.error) console.error("[cleaning-assign] closed session failed", { code: closed.error.code });
      return { error: Boolean(closed.error), id: closed.data?.id ?? null };
    },
    linkClosed: async (id) => {
      const linked = await supabase.from("cleaning_room_holds").update({ closed_session_id: id }).eq("organization_id", organizationId).eq("room_key", room.roomKey).eq("origin_date", input.originDate);
      return { error: Boolean(linked.error) };
    },
    removeAssignments: async () => {
      const removed = await supabase.from("cleaning_assignments").delete().eq("organization_id", organizationId).eq("work_date", input.date).eq("room_key", room.roomKey);
      if (removed.error) console.error("[cleaning-assign] hold remove assignments failed", { code: removed.error.code });
      return { error: Boolean(removed.error) };
    },
    reportRollback: (what) => console.error("[cleaning-assign] hold rollback failed", { what }),
    saveHold: async () => {
      const saved = await supabase
        .from("cleaning_room_holds")
        .upsert(holdUpsertRow({ closedSessionId: null, createdBy: session.user.id, kind: input.kind, organizationId, originDate: input.originDate, reason, removedUserIds, room, until, viewedDate: input.date }, new Date().toISOString()), {
          onConflict: "organization_id,room_key,origin_date",
        });
      if (saved.error) console.error("[cleaning-assign] hold failed", { code: saved.error.code });
      return { error: Boolean(saved.error) };
    },
    // 원래 줄(기간 지난 미룸)이 있었으면 그대로 되돌리고, 없었으면 지운다.
    undoHold: async () => {
      const undone = previous.data
        ? await supabase.from("cleaning_room_holds").upsert({ ...previous.data, closed_session_id: oldClosedId ? null : previous.data.closed_session_id }, { onConflict: "organization_id,room_key,origin_date" })
        : await supabase.from("cleaning_room_holds").delete().eq("organization_id", organizationId).eq("room_key", room.roomKey).eq("origin_date", input.originDate);
      return { error: Boolean(undone.error) };
    },
  });
  // 되돌리기까지 실패하면 방이 미룸 · 처리 끝으로 남을 수 있다 — 어느 쪽이든 화면을 새로 읽게 한다.
  await changed(organizationId);
  return outcome === "ok" ? { ok: true } : { ok: false, reason: "error" };
}

/**
 * 미루기 · 처리 끝 되돌리기 — 방이 다시 미배정으로, 미룰 때 뺀 사람(`removed_user_ids`)도 그날 배정에 다시 넣는다.
 * 5초 「실행 취소」 토스트와 방 줄의 「되돌리기」가 같은 동작이다. 그 사이 시작된 방이면 미룸만 지우고 사람은 다시 넣지 않는다(문서 45 A8).
 * 저장 순서는 `releaseHoldSteps` — 배정이 실패하면 미룸 줄을 지우지 않는다(A10).
 */
export async function releaseHold(input: { date: string; roomKey: string; originDate: string }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("releaseHold", () => releaseHoldBody(input));
}

async function releaseHoldBody(input: { date: string; roomKey: string; originDate: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isDateKey(input.originDate) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  // 지우기 전에 되돌릴 수 있는지부터 정한다 — 뺀 사람을 다시 넣어야 하는데 방을 못 찾으면 줄을 남겨 두고 conflict.
  const existing = await supabase
    .from("cleaning_room_holds")
    .select("removed_user_ids, closed_session_id")
    .eq("organization_id", organizationId)
    .eq("room_key", input.roomKey)
    .eq("origin_date", input.originDate);
  if (existing.error) {
    console.error("[cleaning-assign] release read failed", { code: existing.error.code });
    return { ok: false, reason: "error" };
  }
  if ((existing.data ?? []).length === 0) return { ok: false, reason: "conflict" };
  const restore = [...new Set((existing.data ?? []).flatMap((row) => row.removed_user_ids ?? []))].slice(0, 10);
  const room = restore.length > 0 && isEditableDate(input.date) ? (await loadAssignDayRooms(supabase, organizationId, input.date, session.user.id)).find((item) => item.roomKey === input.roomKey) : undefined;
  if (restore.length > 0 && isEditableDate(input.date) && !room) return { ok: false, reason: "conflict" };
  // 다시 넣을 사람도 **지우기 전에** 정한다 — 지운 뒤에 읽다 실패하면 `removed_user_ids` 가 사라져 뺀 사람을 되찾을 길이 없다.
  // 그 사이 그날 일정을 취소한 사람은 다시 넣지 않는다 — 취소된 날을 살리는 건 「다시 넣기」 하나뿐(2026-11-02 점검 A4).
  let restoreIds: string[] = [];
  if (room) {
    const [members, cancelled, sessions] = await Promise.all([
      Promise.all(restore.map((userId) => isFieldMember(organizationId, userId))),
      cancelledUserIds(organizationId, input.date, restore),
      loadDaySessionRows(supabase, organizationId, input.date),
    ]);
    if (cancelled === null) return { ok: false, reason: "error" };
    restoreIds = restoreIdsAfterRelease({ candidates: restore.filter((userId, index) => members[index] && !cancelled.has(userId)), room, rows: sessions });
  }
  // 지울 처리 끝 기록 — 줄에 적힌 것 + 저장 도중 실패로 줄에 이어지지 못한 그날 그 방 기록(`applyHoldSteps`).
  const orphans = await supabase.from("cleaning_sessions").select("id").eq("organization_id", organizationId).eq("closed_without_cleaning", true).eq("room_key", input.roomKey).eq("cleaning_date", input.date);
  if (orphans.error) {
    console.error("[cleaning-assign] release orphan read failed", { code: orphans.error.code });
    return { ok: false, reason: "error" };
  }
  const closedIds = [...new Set([...(existing.data ?? []).map((row) => row.closed_session_id), ...(orphans.data ?? []).map((row) => row.id)].filter((id): id is string => Boolean(id)))];
  const outcome = await releaseHoldSteps(restoreIds, closedIds, {
    deleteClosedSessions: async (ids) => {
      // 처리 끝이 남긴 청소 기록만 지운다(표시가 붙은 것만 — 실제 청소 기록은 건드리지 않는다).
      const removed = await supabase.from("cleaning_sessions").delete().eq("organization_id", organizationId).eq("closed_without_cleaning", true).in("id", [...ids]);
      return { error: Boolean(removed.error) };
    },
    deleteHold: async () => {
      const removed = await supabase.from("cleaning_room_holds").delete().eq("organization_id", organizationId).eq("room_key", input.roomKey).eq("origin_date", input.originDate);
      return { error: Boolean(removed.error) };
    },
    deleteRestored: async (rowIds) => {
      const removed = await supabase.from("cleaning_assignments").delete().eq("organization_id", organizationId).in("id", rowIds);
      return { error: Boolean(removed.error) };
    },
    reportRollback: (what) => console.error("[cleaning-assign] release rollback failed", { what }),
    restore: async (ids) => {
      const rows = ids.map((userId) => ({
        created_by: session.user.id,
        organization_id: organizationId,
        property_name: room!.propertyName,
        room_key: room!.roomKey,
        room_label: room!.roomLabel,
        user_id: userId,
        work_date: input.date,
      }));
      const inserted = await supabase.from("cleaning_assignments").upsert(rows, { ignoreDuplicates: true, onConflict: "organization_id,work_date,room_key,user_id" }).select("id");
      if (inserted.error) console.error("[cleaning-assign] restore failed", { code: inserted.error.code });
      return { error: Boolean(inserted.error), insertedIds: (inserted.data ?? []).map((row) => row.id) };
    },
  });
  if (outcome === "error") return { ok: false, reason: "error" };
  await changed(session.organization.id);
  return { ok: true };
}

// ── 월 보기 ──────────────────────────────────────────────────────────────────────────────────────

/** 하루 보기 달력의 날짜별 미배정 수(오늘부터) — 달을 넘길 때마다 부른다. */
export async function loadOpenCountsForMonth(input: { ym: string }): Promise<AssignOk<{ counts: Record<string, number> }> | AssignFail> {
  return guardAssignAction("loadOpenCountsForMonth", () => loadOpenCountsForMonthBody(input));
}

async function loadOpenCountsForMonthBody(input: { ym: string }): Promise<AssignOk<{ counts: Record<string, number> }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isMonthKey(input.ym)) return { ok: false, reason: "invalid" };
  const counts = await loadMonthOpenCounts(getSupabaseServiceClient(), session.organization.id, input.ym, getCleaningOperatingDateKey());
  return { counts, ok: true };
}

export async function previewMonthSuggestions(input: { ym: string }): Promise<AssignOk<{ board: MonthBoard; proposals: Array<{ workDate: string; userId: string; roomKey: string }>; openTotal: number; shortDays: string[]; leftTotal: number }> | AssignFail> {
  return guardAssignAction("previewMonthSuggestions", () => previewMonthSuggestionsBody(input));
}

async function previewMonthSuggestionsBody(input: { ym: string }): Promise<AssignOk<{ board: MonthBoard; proposals: Array<{ workDate: string; userId: string; roomKey: string }>; openTotal: number; shortDays: string[]; leftTotal: number }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isMonthKey(input.ym)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const today = getCleaningOperatingDateKey();
  const [board, result] = await Promise.all([
    loadMonthBoard(supabase, session.organization.id, input.ym, session.user.id),
    computeMonthSuggestions(supabase, session.organization.id, input.ym, today, session.user.id),
  ]);
  return {
    board,
    leftTotal: result.leftTotal,
    ok: true,
    openTotal: result.openTotal,
    proposals: result.suggestions.map((s) => ({ roomKey: s.roomKey, userId: s.userId, workDate: s.workDate })),
    shortDays: result.shortDays,
  };
}

export async function applyMonthSuggestions(input: { ym: string }): Promise<AssignOk<{ added: number }> | AssignFail> {
  return guardAssignAction("applyMonthSuggestions", () => applyMonthSuggestionsBody(input));
}

async function applyMonthSuggestionsBody(input: { ym: string }): Promise<AssignOk<{ added: number }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isMonthKey(input.ym)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const { suggestions } = await computeMonthSuggestions(supabase, organizationId, input.ym, getCleaningOperatingDateKey(), session.user.id);
  if (suggestions.length === 0) return { added: 0, ok: true };
  const result = await supabase
    .from("cleaning_assignments")
    .upsert(
      suggestions.map((s) => ({
        created_by: session.user.id,
        organization_id: organizationId,
        property_name: s.propertyName,
        room_key: s.roomKey,
        room_label: s.roomLabel,
        user_id: s.userId,
        work_date: s.workDate,
      })),
      { ignoreDuplicates: true, onConflict: "organization_id,work_date,room_key,user_id" },
    )
    .select("id");
  if (result.error) {
    console.error("[cleaning-assign] apply month failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  await changed(session.organization.id);
  return { added: (result.data ?? []).length, ok: true };
}


/** 사람별 시프트 달력(월 보기 오른쪽 패널) — 읽기만. 현장 인원이 아니면 null. docs/product/37 「4-6」 */
export async function loadPersonShiftForPanel(input: { userId: string; ym: string }): Promise<AssignOk<{ data: PersonShift }> | AssignFail> {
  return guardAssignAction("loadPersonShiftForPanel", () => loadPersonShiftForPanelBody(input));
}

async function loadPersonShiftForPanelBody(input: { userId: string; ym: string }): Promise<AssignOk<{ data: PersonShift }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isUuid(input.userId) || !isMonthKey(input.ym)) return { ok: false, reason: "invalid" };
  const data = await loadPersonShift(getSupabaseServiceClient(), session.organization.id, input.userId, input.ym, getCleaningOperatingDateKey(), session.user.id).catch(() => null);
  if (!data) return { ok: false, reason: "invalid" };
  return { data, ok: true };
}

// ── 배정 설정 ────────────────────────────────────────────────────────────────────────────────────

async function writeSettingLog(organizationId: string, actorId: string, changes: Record<string, unknown>) {
  await getSupabaseServiceClient().from("cleaning_assign_setting_logs").insert({ actor_id: actorId, changes: changes as never, organization_id: organizationId });
}

export async function saveAssignRules(input: { rules: AssignRule[] }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("saveAssignRules", () => saveAssignRulesBody(input));
}

async function saveAssignRulesBody(input: { rules: AssignRule[] }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!Array.isArray(input.rules) || input.rules.some((rule) => !isAssignRuleKey(rule?.key))) return { ok: false, reason: "invalid" };
  const rules = normalizeAssignRules(input.rules);
  const supabase = getSupabaseServiceClient();
  const before = await supabase.from("cleaning_assign_settings").select("rules").eq("organization_id", session.organization.id).eq("owner_id", session.user.id).maybeSingle();
  const result = await supabase
    .from("cleaning_assign_settings")
    .upsert({ organization_id: session.organization.id, owner_id: session.user.id, rules: rules as never, updated_at: new Date().toISOString(), updated_by: session.user.id }, { onConflict: "organization_id,owner_id" });
  if (result.error) return { ok: false, reason: "error" };
  await writeSettingLog(session.organization.id, session.user.id, { after: rules, area: "rules", before: before.data?.rules ?? null });
  revalidate();
  return { ok: true };
}

export async function saveFlagThreshold(input: { threshold: number }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("saveFlagThreshold", () => saveFlagThresholdBody(input));
}

async function saveFlagThresholdBody(input: { threshold: number }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!(FLAG_THRESHOLD_OPTIONS as readonly number[]).includes(input.threshold)) return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_assign_settings")
    .upsert({ flag_threshold: input.threshold, organization_id: session.organization.id, owner_id: session.user.id, updated_at: new Date().toISOString(), updated_by: session.user.id }, { onConflict: "organization_id,owner_id" });
  if (result.error) return { ok: false, reason: "error" };
  revalidatePath("/admin/cleaning-assign/compare");
  return { ok: true };
}

/** 건물 하나의 고정 인력 전체를 바꾼다(순위 · 순서). 빈 목록이면 그 건물 고정 인력을 지운다. */
export async function saveFixedStaff(input: { propertyName: string; entries: Array<{ userId: string; tier: number }> }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("saveFixedStaff", () => saveFixedStaffBody(input));
}

async function saveFixedStaffBody(input: { propertyName: string; entries: Array<{ userId: string; tier: number }> }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  const propertyName = String(input.propertyName ?? "").trim();
  if (!propertyName || propertyName.length > 80 || !Array.isArray(input.entries) || input.entries.length > 60) return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const members = new Set((await loadFieldMembers(supabase, organizationId)).map((member) => member.userId));
  const seen = new Set<string>();
  const rows: Array<{ organization_id: string; owner_id: string; property_name: string; user_id: string; tier: number; position: number }> = [];
  for (const entry of input.entries) {
    if (!isUuid(entry.userId) || !members.has(entry.userId) || seen.has(entry.userId)) return { ok: false, reason: "invalid" };
    if (!Number.isInteger(entry.tier) || entry.tier < 1 || entry.tier > 9) return { ok: false, reason: "invalid" };
    seen.add(entry.userId);
    rows.push({ organization_id: organizationId, owner_id: session.user.id, position: rows.filter((row) => row.tier === entry.tier).length, property_name: propertyName, tier: entry.tier, user_id: entry.userId });
  }
  const before = await supabase.from("cleaning_fixed_staff").select("user_id, tier, position").eq("organization_id", organizationId).eq("owner_id", session.user.id).eq("property_name", propertyName);
  if (before.error) return { ok: false, reason: "error" };
  const del = await supabase.from("cleaning_fixed_staff").delete().eq("organization_id", organizationId).eq("owner_id", session.user.id).eq("property_name", propertyName);
  if (del.error) return { ok: false, reason: "error" };
  if (rows.length > 0) {
    const insert = await supabase.from("cleaning_fixed_staff").insert(rows);
    if (insert.error) {
      // 지운 뒤 넣기가 실패하면 원래 목록을 되살린다(고정 인력이 통째로 사라지지 않게).
      const restoreRows = (before.data ?? []).map((row) => ({ organization_id: organizationId, owner_id: session.user.id, position: row.position, property_name: propertyName, tier: row.tier, user_id: row.user_id }));
      if (restoreRows.length > 0) {
        const back = await supabase.from("cleaning_fixed_staff").insert(restoreRows);
        if (back.error) console.error("[cleaning-assign] fixed staff restore failed", { code: back.error.code });
      }
      return { ok: false, reason: "error" };
    }
  }
  await writeSettingLog(organizationId, session.user.id, { after: rows.map((r) => ({ tier: r.tier, userId: r.user_id })), area: "fixed", before: before.data ?? [], propertyName });
  revalidate();
  return { ok: true };
}

export type StaffProfilePatch = {
  priority?: boolean;
  trainee?: boolean;
  trainer?: boolean;
  defaultStartTime?: string | null;
  memo?: string | null;
};

export async function saveStaffProfile(input: { userId: string; patch: StaffProfilePatch }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("saveStaffProfile", () => saveStaffProfileBody(input));
}

async function saveStaffProfileBody(input: { userId: string; patch: StaffProfilePatch }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isUuid(input.userId) || !input.patch || typeof input.patch !== "object") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  if (!(await isFieldMember(organizationId, input.userId))) return { ok: false, reason: "invalid" };
  const patch: Record<string, unknown> = {};
  if (typeof input.patch.priority === "boolean") patch.priority = input.patch.priority;
  if (typeof input.patch.trainer === "boolean") patch.trainer = input.patch.trainer;
  if (typeof input.patch.trainee === "boolean") {
    patch.trainee = input.patch.trainee;
    // 견습을 다시 켜면 확인 시점을 처음 값으로.
    if (input.patch.trainee) patch.trainee_check_at = 6;
  }
  if (input.patch.defaultStartTime !== undefined) {
    const minutes = input.patch.defaultStartTime === null ? null : timeToMinutes(input.patch.defaultStartTime);
    if (input.patch.defaultStartTime !== null && minutes === null) return { ok: false, reason: "invalid" };
    patch.default_start_time = minutes === null ? null : `${minutesToLabel(minutes).padStart(5, "0")}:00`;
  }
  if (input.patch.memo !== undefined) {
    const memo = String(input.patch.memo ?? "").trim().slice(0, 200);
    patch.memo = memo || null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_staff_profiles")
    .upsert({ organization_id: organizationId, owner_id: session.user.id, updated_at: new Date().toISOString(), updated_by: session.user.id, user_id: input.userId, ...patch }, { onConflict: "organization_id,owner_id,user_id" });
  if (result.error) {
    console.error("[cleaning-assign] profile save failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  await writeSettingLog(organizationId, session.user.id, { area: "staff", patch: Object.keys(patch).filter((key) => key !== "memo"), userId: input.userId });
  revalidate();
  return { ok: true };
}

/** 「아직 견습인가요?」 — 견습 끝 / 계속 견습(2회 뒤 다시 묻기). */
export async function answerTraineeCheck(input: { userId: string; done: boolean; currentCount: number }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("answerTraineeCheck", () => answerTraineeCheckBody(input));
}

async function answerTraineeCheckBody(input: { userId: string; done: boolean; currentCount: number }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isUuid(input.userId) || !Number.isInteger(input.currentCount) || input.currentCount < 0) return { ok: false, reason: "invalid" };
  if (!(await isFieldMember(session.organization.id, input.userId))) return { ok: false, reason: "invalid" };
  const patch = input.done ? { trainee: false } : { trainee_check_at: Math.min(99, input.currentCount + TRAINEE_CHECK_STEP) };
  const result = await getSupabaseServiceClient()
    .from("cleaning_staff_profiles")
    .upsert({ organization_id: session.organization.id, owner_id: session.user.id, updated_at: new Date().toISOString(), updated_by: session.user.id, user_id: input.userId, ...patch }, { onConflict: "organization_id,owner_id,user_id" });
  if (result.error) return { ok: false, reason: "error" };
  revalidate();
  return { ok: true };
}

/** 객실 보통 인원(큰 방 2명). */
export async function saveRoomHeadcount(input: { roomKey: string; headcount: number }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("saveRoomHeadcount", () => saveRoomHeadcountBody(input));
}

async function saveRoomHeadcountBody(input: { roomKey: string; headcount: number }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (typeof input.roomKey !== "string" || input.roomKey.length === 0 || input.roomKey.length > 80) return { ok: false, reason: "invalid" };
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 5) return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const options = await loadCleaningRoomOptions(supabase, organizationId);
  if (!options.some((option) => option.roomKey === input.roomKey)) return { ok: false, reason: "invalid" };
  const result =
    input.headcount === 1
      ? await supabase.from("cleaning_room_settings").delete().eq("organization_id", organizationId).eq("owner_id", session.user.id).eq("room_key", input.roomKey)
      : await supabase
          .from("cleaning_room_settings")
          .upsert({ organization_id: organizationId, owner_id: session.user.id, room_key: input.roomKey, updated_at: new Date().toISOString(), updated_by: session.user.id, usual_headcount: input.headcount }, { onConflict: "organization_id,owner_id,room_key" });
  if (result.error) return { ok: false, reason: "error" };
  await writeSettingLog(organizationId, session.user.id, { area: "room", headcount: input.headcount, roomKey: input.roomKey });
  revalidate();
  return { ok: true };
}

/** 내 메인 건물(하루 보기 처음 필터) — 본인 것만. */
export async function saveMyMainProperties(input: { properties: string[] }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("saveMyMainProperties", () => saveMyMainPropertiesBody(input));
}

async function saveMyMainPropertiesBody(input: { properties: string[] }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!Array.isArray(input.properties) || input.properties.length > 20 || input.properties.some((p) => typeof p !== "string" || p.length > 80)) return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_staff_profiles")
    .upsert({ main_properties: [...new Set(input.properties)], organization_id: session.organization.id, owner_id: session.user.id, updated_at: new Date().toISOString(), user_id: session.user.id }, { onConflict: "organization_id,owner_id,user_id" });
  if (result.error) return { ok: false, reason: "error" };
  revalidatePath("/admin/cleaning-assign");
  return { ok: true };
}
