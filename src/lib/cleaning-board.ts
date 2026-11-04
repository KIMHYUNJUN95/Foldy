import type { BoardPerson, BoardRoom } from "@/lib/cleaning-assign/data";
import { canAddPerson, canRemovePerson } from "@/lib/cleaning-assign/room-rules";

/**
 * 모바일 청소 현황판(관리자 · 2026-10-28, 시안 2riUcpk…) — 배정 하루 보기(`loadDayBoard`)와 오늘 청소 기록을 합쳐
 * 방마다 한 상태로 정리한다. 화면은 이것만 그린다(계산은 여기 한 곳, 테스트: `__tests__/cleaning-board.test.ts`).
 *
 * - 끝남: 오늘 끝낸 기록이 있음
 * - 청소 중: 진행 중 기록 — 흐른 분. 2인 방에서 일부만 끝냈으면 「1/2 끝남」(`partial`, 흐른 분 없음)
 * - 늦음: 담당이 있는데 담당 누구도 **자기 기록**이 없고(같은 방 동료의 시작은 내 시작이 아니다, 문서 45 C11), 가장 이른 출근 시각에서 30분이 지남
 * - 대기: 담당이 있고 아직 시작 전(늦음 아님)
 * - 담당 없음: 담당이 아무도 없음
 *
 * 미룬 방 · 「처리 끝」으로 둔 방 · 예약이 취소된 방은 현황판에 그리지 않는다(PC 배정 화면에서 다룬다).
 */

export const LATE_GRACE_MINUTES = 30;

export type BoardKind = "done" | "progress" | "late" | "waiting" | "open";
export type BoardFilter = "all" | "done" | "progress" | "waiting" | "open";

export type BoardSessionInfo = { startedAt: string; completedAt: string | null };

export type CleaningBoardRow = {
  roomKey: string;
  propertyName: string;
  roomLabel: string;
  kind: BoardKind;
  /** `removable` — 이 사람을 뺄 수 있나(기록 있는 사람은 못 뺀다, 문서 45 표 2). */
  people: { userId: string; name: string; removable: boolean }[];
  /** 청소 중 — 흐른 분. */
  elapsedMinutes: number | null;
  /** 2인 방 일부만 끝냄(「1/2 끝남」) — `kind` 는 progress. 계산은 `roomShareState`(방 상태와 같은 곳). */
  partial: { done: number; need: number } | null;
  /** 끝남 — 끝난 시각(ISO). */
  completedAt: string | null;
  /** 늦음 — 출근 시각에서 지난 분 · 출근 시각(분) · 그 사람 이름. */
  lateMinutes: number | null;
  plannedStartMinutes: number | null;
  plannedName: string | null;
  arrivingGuests: number | null;
  hasTurnover: boolean;
  usualHeadcount: number;
  /** 사람을 더 넣을 수 있나 — 대기 방만(문서 45 A1~A4). */
  canAdd: boolean;
  /** 담당을 여기서 바꿀 수 있나 — 넣을 수 있거나 뺄 수 있는 사람이 있을 때. 청소 중 · 끝난 방도 기록 없는 사람은 뺄 수 있다. */
  editable: boolean;
};

export type CleaningBoardSummary = { total: number; done: number; progress: number; waiting: number; open: number };

export function buildCleaningBoard(input: {
  rooms: BoardRoom[];
  people: BoardPerson[];
  sessions: Map<string, BoardSessionInfo>;
  /** 지금 시각(도쿄, 자정부터 분) — 오늘이 아니면 null(늦음 · 흐른 분을 그리지 않는다). */
  nowMinutes: number | null;
  now: Date;
}): { rows: CleaningBoardRow[]; summary: CleaningBoardSummary } {
  const personById = new Map(input.people.map((p) => [p.userId, p]));
  const visible = input.rooms.filter((room) => !room.deferredUntil && !room.resolvedHold && !room.cancelled);

  // 그 사람이 오늘 무언가 시작했는가 — **본인 기록**으로 본다(C11). 다른 방을 청소 중이면 이 방은 「차례 기다림」이지 늦은 게 아니다.
  const startedPeople = new Set<string>();
  for (const room of input.rooms) {
    for (const person of room.people) if (person.hasRecord) startedPeople.add(person.userId);
  }

  const rows = visible.map((room): CleaningBoardRow => {
    // 이름표 규칙이 없는 새 건물은 기록이 「건물 방」 라벨로 묶여 온다 — 방 키로 못 찾으면 그 라벨로 찾는다.
    const session = input.sessions.get(room.roomKey) ?? input.sessions.get(room.sessionRoomLabel) ?? null;
    const people = room.people.map((p) => ({ name: p.name, removable: canRemovePerson(room, p.hasRecord), userId: p.userId }));
    const canAdd = canAddPerson(room);
    let kind: BoardKind;
    let elapsedMinutes: number | null = null;
    let lateMinutes: number | null = null;
    let plannedStartMinutes: number | null = null;
    let plannedName: string | null = null;

    if (room.status === "done") kind = "done";
    else if (room.status === "progress") {
      kind = "progress";
      // 「1/2 끝남」은 지금 청소 중인 사람이 없다 — 끝난 기록의 시작 시각으로 흐른 분을 세지 않는다.
      if (session && input.nowMinutes !== null && !room.partial) {
        elapsedMinutes = Math.max(0, Math.floor((input.now.getTime() - new Date(session.startedAt).getTime()) / 60000));
      }
    } else if (people.length === 0) kind = "open";
    else {
      kind = "waiting";
      const earliest = room.people
        .map((p) => personById.get(p.userId))
        .filter((p): p is BoardPerson => Boolean(p))
        .sort((a, b) => a.startMinutes - b.startMinutes)[0];
      if (earliest) {
        plannedStartMinutes = earliest.startMinutes;
        plannedName = earliest.name;
        const nobodyStarted = room.people.every((p) => !startedPeople.has(p.userId));
        if (input.nowMinutes !== null && nobodyStarted && input.nowMinutes - earliest.startMinutes >= LATE_GRACE_MINUTES) {
          kind = "late";
          lateMinutes = input.nowMinutes - earliest.startMinutes;
        }
      }
    }

    return {
      arrivingGuests: room.arrivingGuests,
      canAdd,
      completedAt: kind === "done" ? (session?.completedAt ?? null) : null,
      editable: canAdd || people.some((p) => p.removable),
      elapsedMinutes,
      partial: kind === "progress" ? room.partial : null,
      hasTurnover: room.hasTurnover,
      kind,
      lateMinutes,
      people,
      plannedName,
      plannedStartMinutes,
      propertyName: room.propertyName,
      roomKey: room.roomKey,
      roomLabel: room.roomLabel,
      usualHeadcount: room.usualHeadcount,
    };
  });

  const summary: CleaningBoardSummary = {
    done: rows.filter((r) => r.kind === "done").length,
    open: rows.filter((r) => r.kind === "open").length,
    progress: rows.filter((r) => r.kind === "progress").length,
    total: rows.length,
    waiting: rows.filter((r) => r.kind === "waiting" || r.kind === "late").length,
  };
  return { rows, summary };
}

/** 「먼저 챙길 방」 — 담당 없음 먼저, 그다음 늦은 방(많이 늦은 순). */
export function attentionRows<R extends CleaningBoardRow>(rows: R[]): R[] {
  const open = rows.filter((r) => r.kind === "open");
  const late = rows.filter((r) => r.kind === "late").sort((a, b) => (b.lateMinutes ?? 0) - (a.lateMinutes ?? 0));
  return [...open, ...late];
}

export function matchesFilter(row: CleaningBoardRow, filter: BoardFilter): boolean {
  if (filter === "all") return true;
  if (filter === "waiting") return row.kind === "waiting" || row.kind === "late";
  return row.kind === filter;
}

/**
 * 담당 넣기 시트의 사람 순서 — 오늘 나온 사람(신청 · 배정)만 위에, 그 방 건물에 이미 방이 있는 사람 먼저, 그다음 방이 적은 사람.
 * 신청하지 않은 현장 인원은 `others` 로 따로(시트에서 접어 둔다).
 */
export type AssignCandidate = Pick<BoardPerson, "userId" | "name" | "applied" | "cancelled"> & { rooms: { propertyName: string }[] };

export function orderAssignCandidates<P extends AssignCandidate>(people: P[], propertyName: string): { today: P[]; others: P[] } {
  const working = (p: P) => (p.applied && !p.cancelled) || p.rooms.length > 0;
  const sameBuilding = (p: P) => p.rooms.some((r) => r.propertyName === propertyName);
  const today = people
    .filter(working)
    .sort((a, b) => Number(sameBuilding(b)) - Number(sameBuilding(a)) || a.rooms.length - b.rooms.length || a.name.localeCompare(b.name));
  const others = people.filter((p) => !working(p)).sort((a, b) => a.name.localeCompare(b.name));
  return { others, today };
}
