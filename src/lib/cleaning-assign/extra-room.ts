import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCleaningRoomOptions } from "@/lib/automation/data";
import { canAddRoom, canRemoveExtraRoom } from "@/lib/cleaning-assign/room-rules";
import { loadAddBlockedRoomKeys, loadAssignDayRooms, loadRangeDayRooms } from "@/lib/cleaning-assign/rooms";
import type { Database } from "@/types/database";

/**
 * 청소 명단 수기 방(`cleaning_list_extra_rooms`) 더하기 · 빼기 판단 — 청소 배정 「+ 방 추가」(`addRoomForDay`)와
 * 자동화 화면 「청소 명단」(`addCleaningExtraRoom` · `removeCleaningExtraRoom`)이 **같은 함수**를 부른다(문서 45 A1~A6 「방 추가」 열 · A16, 2026-11-09).
 * 예전엔 자동화 화면이 상황표를 건너뛰어 청소 중 · 끝난 방 · 미룬 방에도 줄을 더했고, 배정이 든 방을 빼 배정이 「취소됨」 유령으로 남았다.
 * 권한 확인은 부르는 쪽이 먼저 한다(서버 전용, 액션 아님).
 */

type Client = SupabaseClient<Database>;

export type ExtraRoomOption = { roomKey: string; propertyName: string; roomLabel: string };

/** 더해도 되나 — 객실 카탈로그에 없는 방은 `invalid`, 청소 중 · 끝남 · 미룸 · 처리 끝 방은 `stale`(화면을 그린 뒤 바뀐 경우 포함). */
export async function checkAddExtraRoom(
  supabase: Client,
  organizationId: string,
  date: string,
  roomKey: string,
  ownerId: string | null,
): Promise<{ ok: true; option: ExtraRoomOption } | { ok: false; reason: "invalid" | "stale" }> {
  const [options, rooms, addBlocked] = await Promise.all([
    loadCleaningRoomOptions(supabase, organizationId),
    loadAssignDayRooms(supabase, organizationId, date, ownerId),
    loadAddBlockedRoomKeys(supabase, organizationId, date),
  ]);
  const option = options.find((item) => item.roomKey === roomKey);
  if (!option) return { ok: false, reason: "invalid" };
  // 예약이 취소된 방은 목록에 없어 수기 방으로 추가된다(A6).
  if (!canAddRoom(rooms.find((item) => item.roomKey === roomKey), addBlocked.has(roomKey))) return { ok: false, reason: "stale" };
  return { ok: true, option: { propertyName: option.propertyName, roomKey: option.roomKey, roomLabel: option.roomLabel } };
}

/**
 * 수기 방 빼기(A16 · `canRemoveExtraRoom`) — 체크아웃 · 밀려 온 방이기도 하면 줄을 지워도 방이 남으므로 뺀다. 그 밖에는 대기 방이고
 * 그날 그 방에 아무도 배정되지 않았을 때만. 미룬 기간 · 처리 끝이라 목록에 없는 방도 막는다(「방 추가」와 같은 `loadAddBlockedRoomKeys`).
 * 막히면 `in_use`(청소 배정에서 먼저 정리). 방 목록은 체크인 정보 없이 읽는다.
 */
export async function removeExtraRoom(
  supabase: Client,
  organizationId: string,
  date: string,
  roomKey: string,
): Promise<{ ok: true } | { ok: false; reason: "in_use" | "error" }> {
  const [plans, addBlocked, assignments] = await Promise.all([
    loadRangeDayRooms(supabase, organizationId, date, date, null),
    loadAddBlockedRoomKeys(supabase, organizationId, date),
    supabase.from("cleaning_assignments").select("id").eq("organization_id", organizationId).eq("work_date", date).eq("room_key", roomKey),
  ]);
  if (assignments.error) {
    console.error("[cleaning-assign] extra room assignments read failed", { code: assignments.error.code });
    return { ok: false, reason: "error" };
  }
  const room = (plans.get(date) ?? []).find((item) => item.roomKey === roomKey);
  if (!canRemoveExtraRoom(room, (assignments.data ?? []).length, addBlocked.has(roomKey))) return { ok: false, reason: "in_use" };
  const removed = await supabase.from("cleaning_list_extra_rooms").delete().eq("organization_id", organizationId).eq("target_date", date).eq("room_key", roomKey);
  if (removed.error) {
    console.error("[cleaning-assign] extra room remove failed", { code: removed.error.code });
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}
