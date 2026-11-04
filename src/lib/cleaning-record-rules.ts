import { roomShareState, storedSessionRoomKey, type RoomRecord } from "@/lib/cleaning-assign/room-key";

/**
 * 「청소한 기록」 기준 하나 (docs/product/45-cleaning-rules-table.md 표 3).
 * = 완료(`status = 'completed'`)이고 처리 끝이 아닌(`closed_without_cleaning = false`) 기록.
 * 근태 · 교통비 · 활동 피드 · 모바일 기록이 이 기준을 따른다. 쿼리로 거를 때는 같은 뜻으로
 * `.eq("status", "completed").eq("closed_without_cleaning", false)` 를 쓰고 이 기준을 주석으로 가리킨다.
 */
export function isCleanedRecord(row: { status: string; closed_without_cleaning?: boolean | null }): boolean {
  return row.status === "completed" && !row.closed_without_cleaning;
}

/** 관리자가 청소 배정에서 「처리 끝」으로 닫은 기록(청소한 시간 없음). */
export function isClosedRecord(row: { closed_without_cleaning?: boolean | null }): boolean {
  return Boolean(row.closed_without_cleaning);
}

/** 기록 줄들이 가리키는 실제 방 수(2인 방 두 기록 = 방 1개, C6). */
export function countDistinctRooms(rows: readonly { room_key?: string | null; room_label: string }[]): number {
  return new Set(rows.map(storedSessionRoomKey)).size;
}

/**
 * 건물 지도(C7)의 방 상태. 처리 끝은 끝남, 그 밖에는 `roomShareState` — 1/2 끝남 · 청소 중은 안 끝난 방(`cleaning`).
 * 기록이 없으면 `none`.
 */
export function dashboardRoomCleanState(
  records: readonly RoomRecord[],
  assigneeIds: readonly string[],
  /** 배정을 읽었나. 못 읽었으면(false) 배정 없음과 구분해, 끝났다고 단정하지 않는다. */
  assigneesKnown = true,
): "none" | "cleaning" | "done" {
  if (records.length === 0) return "none";
  if (records.some((r) => r.closed && (r.status === "completed" || r.status === "in_progress"))) return "done";
  const share = roomShareState(records, assigneeIds);
  if (!assigneesKnown) return share.status === "pending" ? "none" : "cleaning";
  if (share.status === "done") return "done";
  return share.status === "pending" ? "none" : "cleaning";
}

/** 기록 목록 줄의 글자표 — 처리 끝은 청소 종류 대신 「처리 끝」(문서 45 C4). */
export function recordListChip(record: { closed: boolean; taskLabel: string }, closedLabel: string): string {
  return record.closed ? closedLabel : record.taskLabel;
}
