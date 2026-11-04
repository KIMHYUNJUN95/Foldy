"use server";

import { canAddPerson, canRemovePerson, ghostAssignRoom, personHasRoomRecord } from "@/lib/cleaning-assign/room-rules";
import { loadAssignDayRooms, loadDaySessionRows } from "@/lib/cleaning-assign/rooms";
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
  type AssignFail,
  type AssignOk,
} from "@/actions/cleaning-assign-guards";

/**
 * 방 하나에 사람 넣기 · 빼기 — PC 배정 화면과 모바일 청소 현황판이 같이 쓴다(2026-10-28 · `/admin/cleaning-assign/actions.ts` 에서 옮김).
 * 권한은 `cleaning.assign` — 없으면 `forbidden` 결과(redirect 하지 않는다). 모든 쓰기는 service-role, 권한은 여기서 다시 본다.
 * 같은 사람을 같은 방에 두 번 넣는 것은 DB 유일 제약이 막고 `conflict` 를 돌려준다.
 * docs/product/37-cleaning-shift-assignment.md 「4-2-f」 · 07-cleaning-workflow.md 「모바일 청소 현황판」
 */

export async function assignToRoom(input: { date: string; roomKey: string; userId: string }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("assignToRoom", () => assignToRoomBody(input));
}

async function assignToRoomBody(input: { date: string; roomKey: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const [rooms, member, cancelled] = await Promise.all([
    loadAssignDayRooms(supabase, organizationId, input.date, session.user.id),
    isFieldMember(organizationId, input.userId),
    cancelledUserIds(organizationId, input.date, [input.userId]),
  ]);
  const room = rooms.find((item) => item.roomKey === input.roomKey);
  // 대기 방에만 넣는다(문서 45 A1~A6) — 청소 중 · 끝난 방, 미룸 · 처리 끝(되돌린 뒤에), 예약 취소된 방(목록에 없음)은 받지 않는다.
  if (!member) return { ok: false, reason: "invalid" };
  // 화면을 그린 뒤 방이 바뀐 경우 — 입력이 틀린 게 아니다(`stale`, 새로 읽고 안내).
  if (!room || !canAddPerson(room)) return { ok: false, reason: "stale" };
  if (cancelled === null) return { ok: false, reason: "error" };
  if (cancelled.has(input.userId)) return { ok: false, reason: "cancelled" };
  const result = await supabase.from("cleaning_assignments").insert({
    created_by: session.user.id,
    organization_id: organizationId,
    property_name: room.propertyName,
    room_key: room.roomKey,
    room_label: room.roomLabel,
    user_id: input.userId,
    work_date: input.date,
  });
  if (result.error) {
    if (result.error.code === "23505") return { ok: false, reason: "conflict" };
    console.error("[cleaning-assign] assign failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  if (!(await ensureApplication(organizationId, input.userId, input.date, session.user.id))) {
    // 신청 줄 없는 배정을 남기지 않는다.
    const undone = await supabase.from("cleaning_assignments").delete().eq("organization_id", organizationId).eq("work_date", input.date).eq("room_key", room.roomKey).eq("user_id", input.userId);
    if (undone.error) console.error("[cleaning-assign] assign rollback failed", { code: undone.error.code });
    return { ok: false, reason: "error" };
  }
  await changed(session.organization.id);
  return { ok: true };
}

export async function unassignFromRoom(input: { date: string; roomKey: string; userId: string }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("unassignFromRoom", () => unassignFromRoomBody(input));
}

async function unassignFromRoomBody(input: { date: string; roomKey: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  // 기록이 있는 사람은 그 방에서 빠지지 않는다(문서 45 표 2). 예약 취소된 방은 목록에 없다 — 배정 줄로 같은 판단을 한다(A6).
  const [rooms, assignment, sessions] = await Promise.all([
    loadAssignDayRooms(supabase, organizationId, input.date, session.user.id),
    supabase.from("cleaning_assignments").select("room_key, property_name, room_label").eq("organization_id", organizationId).eq("work_date", input.date).eq("room_key", input.roomKey).eq("user_id", input.userId).maybeSingle(),
    loadDaySessionRows(supabase, organizationId, input.date, input.userId),
  ]);
  if (assignment.error) return { ok: false, reason: "error" };
  if (!assignment.data) return { ok: false, reason: "conflict" };
  const listed = rooms.find((item) => item.roomKey === input.roomKey);
  const room = listed ?? { ...ghostAssignRoom({ propertyName: assignment.data.property_name, roomKey: assignment.data.room_key, roomLabel: assignment.data.room_label }), cancelled: true };
  if (personHasRoomRecord(sessions, room, input.userId)) return { ok: false, reason: "has_record" };
  if (!canRemovePerson(room, false)) return { ok: false, reason: "stale" };
  const result = await supabase
    .from("cleaning_assignments")
    .delete()
    .eq("organization_id", organizationId)
    .eq("work_date", input.date)
    .eq("room_key", input.roomKey)
    .eq("user_id", input.userId)
    .select("id");
  if (result.error) {
    console.error("[cleaning-assign] unassign failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  if ((result.data ?? []).length === 0) return { ok: false, reason: "conflict" };
  await changed(session.organization.id);
  return { ok: true };
}
