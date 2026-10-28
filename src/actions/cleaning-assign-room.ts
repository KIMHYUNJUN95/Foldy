"use server";

import { loadAssignDayRooms } from "@/lib/cleaning-assign/rooms";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  assigner,
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
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const [rooms, member] = await Promise.all([loadAssignDayRooms(supabase, organizationId, input.date, session.user.id), isFieldMember(organizationId, input.userId)]);
  const room = rooms.find((item) => item.roomKey === input.roomKey);
  // 미뤘거나 처리 끝으로 둔 방에는 넣지 않는다(되돌린 뒤에).
  if (!room || !member || room.status !== "pending" || room.deferredUntil || room.resolvedHold) return { ok: false, reason: "invalid" };
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
  await ensureApplication(organizationId, input.userId, input.date, session.user.id);
  await changed(session.organization.id);
  return { ok: true };
}

export async function unassignFromRoom(input: { date: string; roomKey: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_assignments")
    .delete()
    .eq("organization_id", session.organization.id)
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
