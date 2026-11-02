"use server";

import { revalidatePath } from "next/cache";
import { getTodayWorkState } from "@/lib/attendance-sessions";
import { closeStaleSessionCore, completeSessionCore, reopenSessionCore, startSessionCore, type SessionOpResult } from "@/lib/cleaning-session-ops";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { loadAssignments } from "@/lib/cleaning-assign/data";
import { loadAssignDayRooms, loadStayKeysOrEmpty } from "@/lib/cleaning-assign/rooms";
import { holdSkipReason, todayTaskKey, type TodayTaskKey } from "@/lib/cleaning-assign/task-kind";
import { buildSessionRoomLabel, physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 오늘 내 방 — 그 자리에서 청소 시작 · 끝내기 · 끝내기 되돌리기(2026-10-28, 시안 2riUcpk…).
 * 예전엔 「501 청소 시작」이 청소 화면으로 넘어가 방을 다시 골라야 했다. 이제 결과를 돌려주고 화면은 그대로 둔다.
 * 검사 · 저장은 청소 화면과 같은 `cleaning-session-ops`. docs/product/37-cleaning-shift-assignment.md 「4-3」
 */

const PATHS = ["/mobile/shift/today", "/mobile/cleaning", "/admin/cleaning"];

function refresh() {
  for (const path of PATHS) revalidatePath(path);
}

async function worker() {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session) || !session.capabilities.includes("cleaning.work")) return null;
  return session;
}

export async function startMyRoom(
  input: { roomLabel: string; date?: string },
): Promise<SessionOpResult<{ sessionId: string; startedAt: string; noClockIn: boolean }>> {
  const session = await worker();
  if (!session) return { ok: false, error: "not_allowed" };
  const roomLabel = typeof input.roomLabel === "string" ? input.roomLabel.trim() : "";
  if (!roomLabel) return { ok: false, error: "invalid_selection" };
  // 이름표 규칙이 없는 새 건물은 물리 방 키가 없다 — 그때는 청소 기록 이름(「건물 방」)으로 맞춘다.
  const physical = physicalRoomKeyOfSessionLabel(roomLabel);

  // 오늘 청소 목록에 아직 있는 방인지 · 내 배정인지 · 미룬 방이 아닌지 · 청소 종류는 서버가 다시 본다(2026-11-02 점검 B) —
  // 화면이 낡았어도 예약이 취소 · 변경돼 목록에서 빠진 방, 남의 방, 관리자가 미룬 방은 시작하지 않는다.
  // 종류는 예약으로 정한다(클라이언트 값을 받지 않는다). 출근 기록 확인도 같이 읽는다.
  const service = getSupabaseServiceClient();
  const today = getCleaningOperatingDateKey();
  // 화면을 띄워 둔 채 운영일이 넘어갔으면 「예약이 바뀌었어요」가 아니라 「날짜가 바뀌었어요」 — 화면은 새로 읽는다.
  if (typeof input.date === "string" && input.date !== today) return { ok: false, error: "day_changed" };
  const org = session.organization.id;
  const [dayRooms, stayKeys, mine, workState] = await Promise.all([
    loadAssignDayRooms(service, org, today, null).catch((error: unknown) => {
      console.error("[startMyRoom] day rooms", error);
      return null;
    }),
    // 예약(묵는 중 · 오늘 체크인)은 수기 추가 · 밀려 온 방의 종류에만 쓴다 — 못 읽으면 체크아웃 청소(화면과 같은 처리).
    loadStayKeysOrEmpty(service, org, today),
    loadAssignments(service, org, today, today, session.user.id).catch((error: unknown) => {
      console.error("[startMyRoom] assignments", error);
      return null;
    }),
    getTodayWorkState(org, session.user.id),
  ]);
  // 배정 확인은 꼭 한다(가벼운 읽기 — 실패하면 막는다).
  if (!mine) return { ok: false, error: "start_failed" };
  const assigned = mine.find(
    (row) => (physical !== null && row.roomKey === physical) || buildSessionRoomLabel(row.propertyName, row.roomLabel) === roomLabel,
  );
  if (!assigned) return { ok: false, error: "not_assigned" };
  // 하루 목록을 못 읽으면(일시 오류) 막지 않고 예전처럼 체크아웃 청소로 시작한다 — 목록 · 미룸 확인만 건너뛴다(로그는 남김).
  let taskKey: TodayTaskKey = "checkout";
  if (dayRooms) {
    const room = dayRooms.find((item) => item.roomKey === assigned.roomKey);
    if (!room) return { ok: false, error: "room_changed" };
    // 미룸 · 처리 끝 — 화면의 흐린 줄과 같은 규칙(`todaySkipReason`). 이미 시작한 기록은 `startSessionCore` 가 따로 막는다.
    const skip = holdSkipReason(room);
    if (skip === "resolved") return { ok: false, error: "room_resolved" };
    if (skip) return { ok: false, error: "room_held" };
    taskKey = todayTaskKey(room, stayKeys);
  }

  // 오늘 출근 기록이 없으면 「출근 기록이 아직 없어요 · 출근하기」를 띄운다(2026-10-29 사용자 결정) — 시작은 막지 않는다.
  const result = await startSessionCore(session, roomLabel, taskKey, today);
  if (!result.ok) return result;
  refresh();
  return { ...result, noClockIn: workState === "none" };
}

export async function finishMyRoom(input: { sessionId: string }): Promise<SessionOpResult<{ durationSeconds: number }>> {
  const session = await worker();
  if (!session) return { ok: false, error: "not_allowed" };
  const result = await completeSessionCore(session, typeof input.sessionId === "string" ? input.sessionId : "", "");
  if (result.ok) refresh();
  return result;
}

/**
 * 지난 날 끝내지 못한 내 청소를 닫는다 — 그래야 오늘 방을 시작할 수 있다. 알바가 「청소했어요」(완료) · 「못 했어요」(취소)를
 * 고른다(2026-11-02 사용자 결정). `closeStaleSessionCore` 설명 참고.
 */
export async function closeStaleMyRoom(input: { sessionId: string; cleaned: boolean }): Promise<SessionOpResult> {
  const session = await worker();
  if (!session) return { ok: false, error: "not_allowed" };
  const result = await closeStaleSessionCore(session, typeof input.sessionId === "string" ? input.sessionId : "", input.cleaned === true);
  if (result.ok) refresh();
  return result;
}

export async function undoFinishMyRoom(input: { sessionId: string }): Promise<SessionOpResult> {
  const session = await worker();
  if (!session) return { ok: false, error: "not_allowed" };
  const result = await reopenSessionCore(session, typeof input.sessionId === "string" ? input.sessionId : "");
  if (result.ok) refresh();
  return result;
}
