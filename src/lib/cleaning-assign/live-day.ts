import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { liveAssignments } from "@/lib/cleaning-assign/room-rules";
import { createSharedRoomReads, loadRangeDayRooms } from "@/lib/cleaning-assign/rooms";
import type { Database } from "@/types/database";

/**
 * 「그날 살아 있는 배정」 한 날 판단 — 서버 공용 하나(문서 45 C14, 2026-11-09 리뷰).
 * 알바 신청 빼기(`toggleMyShift`) · 취소 요청(`requestShiftCancel`) · 관리자 월 칸 신청 빼기(`toggleApplicationForUser`)가 부른다.
 * 판단은 범위 화면과 같은 `liveAssignments`(목록에 없고 그 사람 기록도 없는 배정 = 유령). 방 목록은 `loadRangeDayRooms` — 체크인 정보는 읽지 않는다.
 * 그날 배정이 없으면 방 목록을 읽지 않는다. 읽기 실패는 throw(부르는 쪽이 error 로 돌려준다).
 */

type Client = SupabaseClient<Database>;

export type DayAssignmentRow = { id: string; workDate: string; roomKey: string; userId: string; propertyName: string; roomLabel: string };

export async function loadLiveAssignmentsOfDay(supabase: Client, organizationId: string, date: string, userId?: string): Promise<DayAssignmentRow[]> {
  let query = supabase.from("cleaning_assignments").select("id, work_date, room_key, user_id, property_name, room_label").eq("organization_id", organizationId).eq("work_date", date);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((row) => ({ id: row.id, propertyName: row.property_name, roomKey: row.room_key, roomLabel: row.room_label, userId: row.user_id, workDate: row.work_date }));
  if (rows.length === 0) return [];
  const shared = createSharedRoomReads(supabase, organizationId, date, date);
  const [plans, records] = await Promise.all([loadRangeDayRooms(supabase, organizationId, date, date, null, shared), shared.sessions(date, date)]);
  return liveAssignments(rows, plans, records);
}
