import {
  buildRoomKey,
  buildSessionRoomLabel,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  physicalRoomKeyOfSessionLabel,
} from "@/lib/room-label-normalization";

/**
 * 예약 · 객실 라벨 → 배정 방 키(물리 방, 아라키초 `_2` 계정 접음). 순수 모듈.
 *
 * 수기 추가 방(`cleaning_list_extra_rooms.room_key`)은 객실 카탈로그(`getActiveRoomCatalog` → `loadCleaningRoomOptions`)가
 * 같은 식 — 정규 건물 + 표시 라벨(`getDisplayRoomLabel(정규 건물, 정규 라벨)`) — 으로 만든다. 예약에서 만든 키와 모양이 같아야
 * 「오늘 내 방」 청소 종류(`todayTaskKey`)가 맞는다(회귀 테스트: `src/lib/__tests__/cleaning-assign-task-kind.test.ts`).
 */
export function physicalKeyOf(propertyName: string, roomLabel: string): { roomKey: string; propertyName: string; roomLabel: string; sessionRoomLabel: string } {
  const cp = getCanonicalPropertyName(propertyName);
  const cr = getCanonicalRoomLabel(cp, roomLabel);
  const display = getDisplayRoomLabel(cp, cr);
  return { roomKey: buildRoomKey(cp, display), propertyName: cp, roomLabel: display === cp ? cp : display, sessionRoomLabel: buildSessionRoomLabel(cp, cr) };
}

/**
 * 청소 기록 라벨(「건물 방」) → 실제 방 키(`cleaning_sessions.room_key`, 배정 `room_key` 와 같은 모양, 2026-11-02 점검 C1).
 * 이름표 규칙이 있는 건물은 라벨만으로 만들고, 없는 새 건물은 객실 카탈로그에서 같은 라벨을 찾아 만든다.
 * 둘 다 안 되면 라벨 그대로 — DB 트리거도 비어 있는 키를 라벨로 본다(그때 배정 확인은 안 맞아 빈 방만 시작).
 */
export function sessionRoomKeyOf(
  roomLabel: string,
  catalog?: readonly { propertyName: string; canonicalRoomLabel: string }[],
): string {
  return sessionRoomKeyLookup(catalog)(roomLabel);
}

/** `sessionRoomKeyOf` 를 여러 번 부를 때 — 카탈로그를 한 번만 훑어 둔다(같은 결과). */
export function sessionRoomKeyLookup(
  catalog?: readonly { propertyName: string; canonicalRoomLabel: string }[],
): (roomLabel: string) => string {
  const byLabel = new Map<string, string>();
  for (const entry of catalog ?? []) {
    const label = buildSessionRoomLabel(entry.propertyName, entry.canonicalRoomLabel);
    if (!byLabel.has(label)) byLabel.set(label, physicalKeyOf(entry.propertyName, entry.canonicalRoomLabel).roomKey);
  }
  return (roomLabel) => physicalRoomKeyOfSessionLabel(roomLabel) ?? byLabel.get(roomLabel) ?? roomLabel;
}

/** 저장된 청소 기록의 실제 방 키 — `room_key` 가 있으면 그것, 없으면(예전 기록) 라벨에서 만든다. */
export function storedSessionRoomKey(row: { room_key?: string | null; room_label: string }): string {
  return row.room_key ?? physicalRoomKeyOfSessionLabel(row.room_label) ?? row.room_label;
}

/**
 * 그 방에 내 청소 기록을 넣을 수 있나(2인 방 각자 기록, 2026-11-02 사용자 결정 ① · 점검 C1).
 * - 그날 그 방에 **배정된 사람**: 내 기록이 없으면 언제나 — 배정된 자리는 그 사람 몫이라 남이 먼저 해도 빼앗기지 않는다.
 * - **배정 안 된 사람**(배정 없는 방 포함): 그 방에 아직 아무 기록이 없을 때만 — 배정 없는 방은 예전처럼 한 사람.
 * 「처리 끝」 방은 부르는 쪽이 먼저 막는다. DB 트리거 `cleaning_sessions_enforce_room_capacity` 와 같은 규칙.
 */
export function canRecordInRoom(input: { assigned: boolean; hasOwnRecord: boolean; othersWithRecord: number }): boolean {
  if (input.hasOwnRecord) return false;
  return input.assigned || input.othersWithRecord === 0;
}

/** 한 방 그날 기록 한 줄(판정용) — 진행 중 · 완료만 의미가 있고, 나머지 상태는 판정에서 빠진다. */
export type RoomRecord = { staffId: string; status: string; closed: boolean };

/** 그날 기록 중 **같은 방**(저장된 `room_key` 또는 같은 라벨 — DB 트리거와 같은 묶기) → 판정용 줄. */
export function sameRoomRecords(
  rows: readonly { room_key?: string | null; room_label: string; staff_user_id: string; status: string; closed_without_cleaning?: boolean | null }[],
  roomLabel: string,
  roomKey: string,
): RoomRecord[] {
  return rows
    .filter((row) => row.room_label === roomLabel || storedSessionRoomKey(row) === roomKey)
    .map((row) => ({ staffId: row.staff_user_id, status: row.status, closed: Boolean(row.closed_without_cleaning) }));
}

/**
 * 청소 기록을 넣다가 DB 가 막은 이유(트리거 `cleaning_room_full` · 유니크 인덱스) — 직원 시작 · 관리자 강제 완료가 같이 쓴다.
 * - `resolved`: 그 사이 관리자가 「처리 끝」(트리거 detail resolved)
 * - `taken`: 배정 안 됐는데 남 기록 있음 · 한 사람 한 방 하루 기록 하나
 * - `active`: 한 사람 진행 중 하나(이미 다른 방 청소 중)
 * - null: 그 밖(진짜 오류 — 「이미 처리됨」으로 감추지 않는다)
 */
export function roomWriteErrorKind(error: { message?: string; details?: string | null } | null): "resolved" | "taken" | "active" | null {
  if (!error) return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (text.includes("cleaning_room_full")) return error.details === "resolved" ? "resolved" : "taken";
  if (text.includes("cleaning_sessions_one_per_user_room_day_idx")) return "taken";
  if (text.includes("one_active_per")) return "active";
  return null;
}

const isLive = (row: RoomRecord) => row.status === "in_progress" || row.status === "completed";

/**
 * 그 방에 이 사람이 기록을 넣을 수 있나 — **서버 판정 하나**(시작 `startSessionCore` · 관리자 강제 완료 `pickForceCompleteTarget`,
 * DB 트리거 `cleaning_sessions_enforce_room_capacity` 와 같은 규칙, 2026-11-02 점검 C1).
 * - `resolved`: 관리자가 「처리 끝」으로 둔 방 — 아무도 넣지 않는다.
 * - `own`: 이 사람이 그 방에 이미 기록이 있음.
 * - `taken`: 배정 안 된 사람인데 그 방에 이미 다른 사람 기록이 있음.
 * - `ok`: 넣어도 됨.
 */
export function roomRecordDecision(rows: readonly RoomRecord[], staffId: string, assigned: boolean): "resolved" | "own" | "taken" | "ok" {
  const live = rows.filter(isLive);
  if (live.some((row) => row.closed)) return "resolved";
  const hasOwnRecord = live.some((row) => row.staffId === staffId);
  if (hasOwnRecord) return "own";
  const othersWithRecord = live.filter((row) => row.staffId !== staffId).length;
  return canRecordInRoom({ assigned, hasOwnRecord, othersWithRecord }) ? "ok" : "taken";
}

/**
 * 화면이 이 사람에게 「시작」을 내밀까 — 오늘 내 방 · 청소 화면(`/mobile/cleaning`)이 같이 쓴다.
 * 서버 판정(`roomRecordDecision`)이 `ok` 이고, 그 방 다른 기록이 **모두 같이 배정된 사람 것**일 때만. 배정 안 된 사람이 이미 해 둔
 * 방은 서버가 막지는 않지만(배정된 자리는 그 사람 몫) 화면은 그 기록으로 보여 준다 — 이미 누가 치운 방을 다시 청소하지 않게.
 */
export function shouldOfferStart(rows: readonly RoomRecord[], staffId: string, assigneeIds: ReadonlySet<string>): boolean {
  if (roomRecordDecision(rows, staffId, assigneeIds.has(staffId)) !== "ok") return false;
  return rows.filter((row) => isLive(row) && row.staffId !== staffId).every((row) => assigneeIds.has(row.staffId));
}

/**
 * 방 하나의 그날 상태(방 기준) — PC 하루 보기 · 모바일 현황판 · PC 청소 현황이 같이 쓴다(2026-11-02 사용자 결정: 2인 방은 「1/2 끝남」).
 * - 누가 청소 중이면 `progress`.
 * - 끝낸 사람 수(`done`)가 필요한 수(`need` = 그날 그 방 배정 인원, 없으면 1)에 닿으면 `done`. 배정 안 된 사람이 끝낸 것도 센다 —
 *   그 사람이 그 방을 치웠고, 오늘 내 방도 그 기록을 「끝남」으로 보여 준다(`shouldOfferStart`). 콘솔 「같이 한 사람 완료 처리」도
 *   「1/2 끝남」일 때만 뜬다(끝난 방에 빠진 사람을 내밀지 않게).
 * - 끝낸 사람이 있지만 모자라면 `progress` + `partial`(「1/2 끝남」) — 아직 다 끝난 방이 아니다.
 * - 아무 기록이 없으면 `pending`. 「처리 끝」 기록은 세지 않는다(부르는 쪽이 따로 「처리 끝」으로 보인다).
 */
export function roomShareState(
  rows: readonly RoomRecord[],
  assigneeIds: readonly string[],
): { status: "pending" | "progress" | "done"; done: number; need: number; partial: boolean } {
  const work = rows.filter((row) => isLive(row) && !row.closed);
  const need = Math.max(1, new Set(assigneeIds).size);
  const done = Math.min(need, new Set(work.filter((row) => row.status === "completed").map((row) => row.staffId)).size);
  if (work.some((row) => row.status === "in_progress")) return { status: "progress", done, need, partial: false };
  if (done >= need) return { status: "done", done, need, partial: false };
  if (done > 0) return { status: "progress", done, need, partial: true };
  return { status: "pending", done, need, partial: false };
}
