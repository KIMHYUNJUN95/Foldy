import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { BoardPerson, BoardRoom } from "@/lib/cleaning-assign/data";
import { shiftDayState } from "@/lib/cleaning-assign/day-state";
import { physicalKeyOf, sessionRoomKeyLookup } from "@/lib/cleaning-assign/room-key";
import { shortRoomKeys } from "@/lib/cleaning-assign/suggest";
import { activeDeferUntil } from "@/lib/cleaning-assign/room-rules";
import { consoleWhoIds, forceCompleteDefaultStaff, needMoreCount } from "@/lib/cleaning-assign/room-rules";
import { recordListChip } from "@/lib/cleaning-record-rules";
import { addWarningText, assignFailText, fill, getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import {
  buildDayRooms,
  canAddPerson,
  canAddRoom,
  canHoldRoom,
  canRemovePerson,
  canRequestCancel,
  canSwapPerson,
  carryBadgeDays,
  cleanedRoomCount,
  cleaningListStart,
  consolePartial,
  applyHoldSteps,
  countOpenRooms,
  directAddWarnings,
  forceCompleteEndAllowed,
  holdBlocksAddRoom,
  holdRemovedUserIds,
  holdUpsertRow,
  indexSessions,
  isOpenSectionRoom,
  personHasRoomRecord,
  planCancelDay,
  releaseHoldSteps,
  restoreIdsAfterRelease,
  roomStartBlock,
  sessionCloseFields,
  sortOpenSection,
  startableListTargets,
  suggestInputsForDay,
  swapOverCapNames,
  type AssignRoom,
  type DayRoomSeed,
  type HoldRow,
  type SessionRow,
} from "@/lib/cleaning-assign/room-rules";
import { DEFAULT_ASSIGN_RULES } from "@/lib/cleaning-assign/rules";
import { DAILY_CAP, leftAfterSuggest, overDailyCap, roomWeight, suggestAssignments, type SuggestPerson, type SuggestRoom } from "@/lib/cleaning-assign/suggest";
import { todaySkipReason } from "@/lib/cleaning-assign/task-kind";
import { buildCleaningBoard } from "@/lib/cleaning-board";

/**
 * docs/product/45-cleaning-rules-table.md 의 **줄마다 하나**. 테스트 이름 앞의 ID 가 표의 ID 다.
 * C1 · C2 · C3 · C4 · C6 · C7 은 `cleaning-record-rules.test.ts`.
 */

const TODAY = "2026-11-10";
const YESTERDAY = "2026-11-09";
const TWO_AGO = "2026-11-08";
const TOMORROW = "2026-11-11";

const key401 = physicalKeyOf("아라키초A", "401");
const key402 = physicalKeyOf("아라키초A", "402");

const seed = (key = key401, extra: Partial<DayRoomSeed> = {}): DayRoomSeed => ({ ...key, source: "checkout", note: null, ...extra });
const range = (byDate: Record<string, DayRoomSeed[]>) => new Map(Object.entries(byDate).map(([date, list]) => [date, new Map(list.map((room) => [room.roomKey, room]))]));
const session = (cleaning_date: string, staff_user_id: string, status = "completed", extra: Partial<SessionRow> = {}): SessionRow => ({
  cleaning_date,
  closed_without_cleaning: false,
  room_key: key401.roomKey,
  room_label: key401.sessionRoomLabel,
  staff_user_id,
  status,
  ...extra,
});
const hold = (origin_date: string, kind: "defer" | "resolved", until_date: string | null, madeOn: string = origin_date): HoldRow => ({
  created_at: `${madeOn}T03:00:00.000Z`,
  kind,
  origin_date,
  property_name: key401.propertyName,
  reason: null,
  room_key: key401.roomKey,
  room_label: key401.roomLabel,
  until_date,
});

function day(input: {
  date?: string;
  today?: string;
  seeds?: DayRoomSeed[];
  past?: Record<string, DayRoomSeed[]>;
  usedDays?: string[];
  sessions?: SessionRow[];
  holds?: HoldRow[];
  assignees?: Record<string, string[]>;
  usual?: Record<string, number>;
}): AssignRoom[] {
  return buildDayRooms({
    assignees: new Map(Object.entries(input.assignees ?? {})),
    date: input.date ?? TODAY,
    holds: input.holds ?? [],
    range: range(input.past ?? {}),
    seeds: input.seeds ?? [],
    sessions: indexSessions(input.sessions ?? []),
    today: input.today ?? TODAY,
    usedDays: input.usedDays ?? [],
    usual: new Map(Object.entries(input.usual ?? {})),
  });
}
const only = (rooms: AssignRoom[]) => {
  expect(rooms).toHaveLength(1);
  return rooms[0];
};

describe("표 1 — 방이 어떻게 보이고 시작되나", () => {
  it("R1 오늘 체크아웃, 기록 없음 → 대기, 시작 됨", () => {
    const room = only(day({ seeds: [seed()] }));
    expect(room.status).toBe("pending");
    expect(carryBadgeDays(room)).toBeNull();
    expect(roomStartBlock(room, false)).toBeNull();
  });

  it("R2 지난 날 못 한 방을 오늘 볼 때 → 「N일째」, 시작 됨", () => {
    const room = only(day({ past: { [TWO_AGO]: [seed()] }, usedDays: [TWO_AGO] }));
    expect(room.source).toBe("carry");
    expect(carryBadgeDays(room)).toBe(3);
    expect(roomStartBlock(room, false)).toBeNull();
  });

  it("R3 지난 방 + 오늘 체크아웃 → 한 줄, 「N일째」 표시, 시작 됨", () => {
    const room = only(day({ past: { [YESTERDAY]: [seed()] }, seeds: [seed()], usedDays: [YESTERDAY] }));
    expect(room.source).toBe("checkout");
    expect(carryBadgeDays(room)).toBe(2);
    expect(isOpenSectionRoom({ ...room, cancelled: false, people: [] })).toBe(true);
    expect(roomStartBlock(room, false)).toBeNull();
  });

  it("R4 오늘 방이 안 끝난 채 내일을 볼 때 → 그날 체크아웃만, 밀려 오지 않음", () => {
    const rooms = day({ date: TOMORROW, past: { [TODAY]: [seed(key401)] }, seeds: [seed(key402)], usedDays: [TODAY] });
    expect(only(rooms).roomKey).toBe(key402.roomKey);
  });

  it("R4 앞날은 그날로 미룬 방은 나온다 · 그보다 앞서 끝나는 미룸은 안 나온다", () => {
    const toTomorrow = day({ date: TOMORROW, holds: [hold(TODAY, "defer", TOMORROW)], past: { [TODAY]: [seed()] }, usedDays: [TODAY] });
    expect(only(toTomorrow).source).toBe("carry");
    const dayAfter = day({ date: "2026-11-12", holds: [hold(TODAY, "defer", TOMORROW)], past: { [TODAY]: [seed()] }, usedDays: [TODAY] });
    expect(dayAfter).toHaveLength(0);
  });

  it("R4 7일보다 앞서 미룬 방도 앞날엔 정한 날만 나온다", () => {
    const old = "2026-10-20";
    expect(day({ date: TOMORROW, holds: [hold(old, "defer", TODAY)] })).toHaveLength(0);
    expect(only(day({ date: TOMORROW, holds: [hold(old, "defer", TOMORROW)] })).source).toBe("carry");
  });

  it("R4 지난 날을 볼 때는 그날 기준으로 밀려 온 방을 보여 준다(기록 정리용)", () => {
    const room = only(day({ date: YESTERDAY, past: { [TWO_AGO]: [seed()] }, usedDays: [TWO_AGO] }));
    expect(carryBadgeDays(room)).toBe(2);
  });

  it("R5 어제 한 명만 끝낸 2인 방 → 치운 방으로 보고 다음 날 안 나옴", () => {
    const rooms = day({ past: { [YESTERDAY]: [seed()] }, sessions: [session(YESTERDAY, "a")], usedDays: [YESTERDAY] });
    expect(rooms).toHaveLength(0);
  });

  it("R6 어제 취소 또는 「못 했어요」 → 다음 날 「2일째」, 시작 됨", () => {
    const room = only(day({ past: { [YESTERDAY]: [seed()] }, sessions: [session(YESTERDAY, "a", "cancelled")], usedDays: [YESTERDAY] }));
    expect(carryBadgeDays(room)).toBe(2);
    expect(roomStartBlock(room, false)).toBeNull();
  });

  it("R7 오늘 미룸 → 「N일로 미룸」, 되돌리기 있음, 시작 막음", () => {
    const room = only(day({ holds: [hold(TODAY, "defer", TOMORROW)], seeds: [seed()] }));
    expect(room.deferredUntil).toBe(TOMORROW);
    expect(roomStartBlock(room, true)).toBe("held");
  });

  it("R7 밀려 온 방을 오늘 미룸 → 오늘 목록에 남고 시작 막음", () => {
    const room = only(day({ holds: [hold(YESTERDAY, "defer", TOMORROW, TODAY)], past: { [YESTERDAY]: [seed()] }, usedDays: [YESTERDAY] }));
    expect(room.deferredUntil).toBe(TOMORROW);
    expect(room.carriedFrom).toBe(YESTERDAY);
    expect(roomStartBlock(room, true)).toBe("held");
  });

  it("R8 미룬 기간 중 → 안 나옴, 시작 막음", () => {
    const rooms = day({ holds: [hold(YESTERDAY, "defer", TOMORROW)], past: { [YESTERDAY]: [seed()] }, usedDays: [YESTERDAY] });
    expect(rooms).toHaveLength(0);
    expect(roomStartBlock(undefined, true)).toBe("held");
  });

  it("R9 미룬 기간 중 미룬 날 뒤의 새 체크아웃 → 대기, 시작 됨", () => {
    const room = only(day({ holds: [hold(YESTERDAY, "defer", TOMORROW)], past: { [YESTERDAY]: [seed()] }, seeds: [seed()], usedDays: [YESTERDAY] }));
    expect(room.deferredUntil).toBeNull();
    expect(room.status).toBe("pending");
    // 하루 보기와 같은 판단 — 미룸 줄이 살아 있어도 방이 정상으로 나오면 시작을 막지 않는다.
    expect(roomStartBlock(room, true)).toBeNull();
  });

  it("R10 정한 날 도착 → 미배정 맨 위 구역, 시작 됨", () => {
    const room = only(day({ holds: [hold(YESTERDAY, "defer", TODAY)], past: { [YESTERDAY]: [seed()] }, usedDays: [YESTERDAY] }));
    expect(room.deferredUntil).toBeNull();
    expect(isOpenSectionRoom({ ...room, cancelled: false, people: [] })).toBe(true);
    expect(roomStartBlock(room, false)).toBeNull();
  });

  it("R11 기간 지난 방을 다시 미룸 → 저장 줄이 만든 시각을 지금으로 바꾸고, 오늘 목록에 남아 되돌리기 됨, 시작 막음", () => {
    const row = holdUpsertRow(
      { closedSessionId: null, createdBy: "admin", kind: "defer", organizationId: "org", originDate: TWO_AGO, reason: "", removedUserIds: [], room: key401, until: TOMORROW, viewedDate: TODAY },
      `${TODAY}T03:00:00.000Z`,
    );
    expect(row.created_at).toBe(`${TODAY}T03:00:00.000Z`);
    const room = only(day({ holds: [{ ...hold(TWO_AGO, "defer", TOMORROW), created_at: row.created_at }], past: { [TWO_AGO]: [seed()] }, usedDays: [TWO_AGO] }));
    expect(room.deferredUntil).toBe(TOMORROW);
    expect(room.carriedFrom).toBe(TWO_AGO);
    expect(roomStartBlock(room, true)).toBe("held");
  });

  it("R12 처리 끝 → 끝남, 되돌리기 있음, 시작 막음", () => {
    const room = only(day({ holds: [hold(TODAY, "resolved", null)], seeds: [seed()], sessions: [session(TODAY, "admin", "completed", { closed_without_cleaning: true })] }));
    expect(room.status).toBe("done");
    expect(room.resolvedHold).toBe(true);
    expect(roomStartBlock(room, false)).toBe("resolved");
  });

  it("R13 배정 뒤 예약 취소 → 알바에게는 흐리게, 시작 막음", () => {
    expect(todaySkipReason({ changed: true, deferredUntil: null, hasSession: false, resolvedHold: false, status: "pending" })).toBe("booking");
    expect(cleaningListStart({ cleaningList: [], settingList: [] }, key401.sessionRoomLabel)).toBeNull();
  });
});

const caps = {
  A1: { partial: null, status: "pending" as const },
  A2: { partial: null, status: "progress" as const },
  A3: { partial: { done: 1, need: 2 }, status: "progress" as const },
  A4: { partial: null, status: "done" as const },
};
const capRoom = (over: Partial<Parameters<typeof canAddPerson>[0]>) => ({ cancelled: false, deferredUntil: null, partial: null, resolvedHold: false, status: "pending" as const, ...over });

describe("표 2 — 배정을 바꿀 수 있나", () => {
  it("A1 대기: 넣기 · 빼기 · 교체 · 미루기 · 방 추가 됨", () => {
    const room = capRoom(caps.A1);
    expect([canAddPerson(room), canRemovePerson(room, false), canSwapPerson(room, false), canHoldRoom(room), canAddRoom(room, false)]).toEqual([true, true, true, true, true]);
  });

  it("A2 청소 중: 기록 없는 사람만 빼기 · 교체, 나머지 막음", () => {
    const room = capRoom(caps.A2);
    expect([canAddPerson(room), canRemovePerson(room, false), canSwapPerson(room, false)]).toEqual([false, true, true]);
    expect([canRemovePerson(room, true), canSwapPerson(room, true), canHoldRoom(room), canAddRoom(room, false)]).toEqual([false, false, false, false]);
  });

  it("A3 1/2 끝남: 기록 없는 사람 빼기 됨(빼면 「끝남」), 나머지 막음", () => {
    const room = capRoom(caps.A3);
    expect([canAddPerson(room), canRemovePerson(room, false), canRemovePerson(room, true), canHoldRoom(room), canAddRoom(room, false)]).toEqual([false, true, false, false, false]);
    // 뺀 뒤 — 끝낸 사람 수가 남은 배정 인원에 닿아 방이 끝남.
    const after = only(day({ assignees: { [key401.roomKey]: ["a"] }, seeds: [seed()], sessions: [session(TODAY, "a")] }));
    expect(after.status).toBe("done");
    const before = only(day({ assignees: { [key401.roomKey]: ["a", "b"] }, seeds: [seed()], sessions: [session(TODAY, "a")] }));
    expect(before.partial).toEqual({ done: 1, need: 2 });
  });

  it("A4 끝남: 기록 없는 사람 빼기 됨, 기록 있는 사람 · 넣기 · 미루기 · 방 추가 막음", () => {
    const room = capRoom(caps.A4);
    expect([canAddPerson(room), canRemovePerson(room, false), canRemovePerson(room, true), canHoldRoom(room), canAddRoom(room, false)]).toEqual([false, true, false, false, false]);
  });

  it("A5 미룸 · 처리 끝: 모두 막음(되돌린 뒤에)", () => {
    for (const room of [capRoom({ deferredUntil: TOMORROW }), capRoom({ resolvedHold: true, status: "done" })]) {
      expect([canAddPerson(room), canRemovePerson(room, false), canSwapPerson(room, false), canHoldRoom(room), canAddRoom(room, false)]).toEqual([false, false, false, false, false]);
    }
    // 목록에 안 나오는 미룬 기간(R8) 방도 방 추가를 막는다.
    expect(holdBlocksAddRoom(hold(YESTERDAY, "defer", TOMORROW), TODAY)).toBe(true);
    expect(holdBlocksAddRoom(hold(YESTERDAY, "defer", TODAY), TODAY)).toBe(false);
    expect(holdBlocksAddRoom(hold(TODAY, "resolved", null), TODAY)).toBe(true);
    // 지난 처리 끝은 새 일에 걸리지 않는다.
    expect(holdBlocksAddRoom(hold(YESTERDAY, "resolved", null), TODAY)).toBe(false);
    expect(canAddRoom(undefined, true)).toBe(false);
  });

  it("A6 예약 취소됨: 기록 없는 사람 빼기만, 교체 잠금, 수기 방으로 추가 됨", () => {
    const room = capRoom({ cancelled: true });
    expect([canAddPerson(room), canRemovePerson(room, false), canRemovePerson(room, true), canSwapPerson(room, false), canAddRoom(room, false)]).toEqual([false, true, false, false, true]);
  });

  it("기록 판정 — 진행 중 · 완료만, 취소 · 처리 끝은 기록이 아니다 · 같은 실제 방 다른 계정 라벨도 같은 방", () => {
    const room = { roomKey: key401.roomKey, sessionRoomLabel: key401.sessionRoomLabel };
    expect(personHasRoomRecord([session(TODAY, "a", "in_progress")], room, "a")).toBe(true);
    expect(personHasRoomRecord([session(TODAY, "a")], room, "a")).toBe(true);
    expect(personHasRoomRecord([session(TODAY, "a")], room, "b")).toBe(false);
    expect(personHasRoomRecord([session(TODAY, "a", "cancelled")], room, "a")).toBe(false);
    expect(personHasRoomRecord([session(TODAY, "a", "completed", { closed_without_cleaning: true })], room, "a")).toBe(false);
    expect(personHasRoomRecord([session(TODAY, "a", "completed", { room_key: null, room_label: "아라키초A 401_2_2" })], room, "a")).toBe(true);
  });

  const assignment = (id: string, key = key401) => ({ id, propertyName: key.propertyName, roomKey: key.roomKey, roomLabel: key.roomLabel });

  it("A7 일정 취소 — 그날 청소 중이면 막는다", () => {
    const plan = planCancelDay([assignment("x")], [session(TODAY, "a", "in_progress")], "a");
    expect(plan.blocked).toBe(true);
    expect(plan.removeIds).toEqual([]);
  });

  it("A7 일정 취소 — 끝낸 방의 배정은 남기고 시작 안 한 방만 뺀다", () => {
    const plan = planCancelDay([assignment("done"), assignment("todo", key402)], [session(TODAY, "a")], "a");
    expect(plan.blocked).toBe(false);
    expect(plan.removeIds).toEqual(["todo"]);
    expect(plan.keepIds).toEqual(["done"]);
  });

  it("A7 끝낸 방만 남은 취소자 — 달력이 「배정 없음」으로 숨기지 않는다, 방이 없으면 「배정 없음」", () => {
    expect(shiftDayState({ applied: true, cancelled: true, isPast: false, myRooms: 1, openRooms: 0, totalRooms: 1 })).toBe("assigned");
    expect(shiftDayState({ applied: true, cancelled: true, isPast: true, myRooms: 1, openRooms: 0, totalRooms: 1 })).toBe("worked");
    expect(shiftDayState({ applied: true, cancelled: true, isPast: false, myRooms: 0, openRooms: 0, totalRooms: 1 })).toBe("none");
  });

  it("A8 되돌리기 — 그 사이 시작된 방이면 사람을 다시 넣지 않는다", () => {
    const room = { roomKey: key401.roomKey, sessionRoomLabel: key401.sessionRoomLabel };
    expect(restoreIdsAfterRelease({ candidates: ["a", "b"], rows: [session(TODAY, "c", "in_progress")], room })).toEqual([]);
    expect(restoreIdsAfterRelease({ candidates: ["a"], rows: [session(TODAY, "c")], room })).toEqual([]);
    expect(restoreIdsAfterRelease({ candidates: ["a", "b"], rows: [], room })).toEqual(["a", "b"]);
    // 처리 끝이 남긴 기록은 「시작」이 아니다.
    expect(restoreIdsAfterRelease({ candidates: ["a"], rows: [session(TODAY, "admin", "completed", { closed_without_cleaning: true })], room })).toEqual(["a"]);
  });

  it("A9 강제 완료 — 미래 시각은 거절, 지금까지는 허용", () => {
    const now = Date.parse("2026-11-10T05:00:30.000Z");
    expect(forceCompleteEndAllowed("2026-11-10T05:00:00.000Z", now)).toBe(true);
    expect(forceCompleteEndAllowed("2026-11-10T05:01:00.000Z", now)).toBe(false);
  });

  it("A9 미룬 방의 강제 완료는 허용 — 끝난 기록이 있으면 다음 날 밀려 오지 않고 되돌려도 사람을 다시 넣지 않는다", () => {
    const forced = session(TODAY, "a");
    const today = only(day({ holds: [hold(TODAY, "defer", TOMORROW)], seeds: [seed()], sessions: [forced] }));
    expect(today.deferredUntil).toBe(TOMORROW);
    expect(today.status).toBe("done");
    expect(day({ date: TOMORROW, holds: [hold(TODAY, "defer", TOMORROW)], past: { [TODAY]: [seed()] }, sessions: [forced], usedDays: [TODAY] })).toHaveLength(0);
  });

  it("A10 일괄 처리 — 배정 저장이 실패하면 미룸 줄을 지우지 않고 실패로 돌려준다", async () => {
    const ports = {
      deleteClosedSessions: vi.fn(async () => ({ error: false })),
      deleteHold: vi.fn(async () => ({ error: false })),
      deleteRestored: vi.fn(async () => ({ error: false })),
      reportRollback: vi.fn(),
      restore: vi.fn(async () => ({ error: true, insertedIds: [] })),
    };
    await expect(releaseHoldSteps(["a"], [], ports)).resolves.toBe("error");
    expect(ports.deleteHold).not.toHaveBeenCalled();
  });

  it("A10 일괄 처리 — 미룸 줄 지우기가 실패하면 방금 넣은 배정을 되돌린다", async () => {
    const ports = {
      deleteClosedSessions: vi.fn(async () => ({ error: false })),
      deleteHold: vi.fn(async () => ({ error: true })),
      deleteRestored: vi.fn(async () => ({ error: false })),
      reportRollback: vi.fn(),
      restore: vi.fn(async () => ({ error: false, insertedIds: ["row1"] })),
    };
    await expect(releaseHoldSteps(["a"], [], ports)).resolves.toBe("error");
    expect(ports.deleteRestored).toHaveBeenCalledWith(["row1"]);
    expect(ports.reportRollback).not.toHaveBeenCalled();
  });

  it("A10 일괄 처리 — 되살린 배정의 되돌리기가 실패하면 알린다(무시하지 않는다)", async () => {
    const ports = {
      deleteClosedSessions: vi.fn(async () => ({ error: false })),
      deleteHold: vi.fn(async () => ({ error: true })),
      deleteRestored: vi.fn(async () => ({ error: true })),
      reportRollback: vi.fn(),
      restore: vi.fn(async () => ({ error: false, insertedIds: ["row1"] })),
    };
    await expect(releaseHoldSteps(["a"], [], ports)).resolves.toBe("error");
    expect(ports.reportRollback).toHaveBeenCalledWith("restored_assignments");
  });

  it("A10 일괄 처리 — 처리 끝 기록을 미룸 줄보다 먼저 지워, 어디서 실패해도 다시 시도할 수 있다", async () => {
    const order: string[] = [];
    const ports = {
      deleteClosedSessions: vi.fn(async () => {
        order.push("closed");
        return { error: false };
      }),
      deleteHold: vi.fn(async () => {
        order.push("hold");
        return { error: false };
      }),
      deleteRestored: vi.fn(async () => ({ error: false })),
      reportRollback: vi.fn(),
      restore: vi.fn(async () => {
        order.push("restore");
        return { error: false, insertedIds: [] };
      }),
    };
    await expect(releaseHoldSteps(["a"], ["s1"], ports)).resolves.toBe("ok");
    expect(order).toEqual(["restore", "closed", "hold"]);
  });
});

describe("표 3 — 어떤 기록을 어떻게 세나", () => {
  it("C5 비교표 청소 수 — 자기 기록이 있는 방만 1개, 나누지 않는다", () => {
    const rows = [
      session(TODAY, "a"),
      session(TODAY, "b"), // 같은 방 다른 사람 — b 몫
      session(TODAY, "a", "completed", { room_key: key402.roomKey, room_label: key402.sessionRoomLabel }),
      session(YESTERDAY, "a"), // 다른 날 같은 방은 또 1개
      session(TODAY, "c", "in_progress"),
      session(TODAY, "d", "cancelled"),
      session(TODAY, "e", "completed", { closed_without_cleaning: true }),
    ];
    expect(cleanedRoomCount(rows, "a")).toBe(3);
    expect(cleanedRoomCount(rows, "b")).toBe(1);
    expect(cleanedRoomCount(rows, "c")).toBe(0);
    expect(cleanedRoomCount(rows, "d")).toBe(0);
    expect(cleanedRoomCount(rows, "e")).toBe(0);
  });

  it("C8 PC 콘솔 수기 · 밀려 온 2인 방 — 한 명만 끝내면 「1/2 끝남」 + 빠진 사람", () => {
    const rows = [{ closed_without_cleaning: false, staff_user_id: "a", status: "completed" }];
    expect(consolePartial(rows, ["a", "b"], "done")).toEqual({ missingAssignees: ["b"], partial: { done: 1, need: 2 } });
    expect(consolePartial(rows, ["a"], "done")).toEqual({ missingAssignees: [], partial: null });
    expect(consolePartial(rows, [], "done")).toEqual({ missingAssignees: [], partial: null });
    expect(consolePartial([{ closed_without_cleaning: true, staff_user_id: "m", status: "completed" }], ["a", "b"], "done").partial).toBeNull();
  });

  it("C9 월 보기 미배정 — 날짜 범위보다 앞에서 만든 미룸도 제외", () => {
    const rooms = day({ date: TOMORROW, holds: [hold(YESTERDAY, "defer", "2026-11-13", TOMORROW)], past: { [YESTERDAY]: [seed()] }, seeds: [seed()], usedDays: [] });
    expect(countOpenRooms(rooms, new Set())).toBe(0);
  });

  it("C9 월 보기 미배정 — 청소 중 · 끝난 방 · 처리 끝 · 미룸은 세지 않고 배정된 방도 세지 않는다", () => {
    const seeds = [seed(key401), seed(key402)];
    expect(countOpenRooms(day({ seeds }), new Set())).toBe(2);
    expect(countOpenRooms(day({ seeds, sessions: [session(TODAY, "a", "in_progress")] }), new Set())).toBe(1);
    expect(countOpenRooms(day({ seeds, sessions: [session(TODAY, "a")] }), new Set())).toBe(1);
    expect(countOpenRooms(day({ holds: [hold(TODAY, "resolved", null)], seeds }), new Set())).toBe(1);
    expect(countOpenRooms(day({ holds: [hold(TODAY, "defer", TOMORROW)], seeds }), new Set())).toBe(1);
    expect(countOpenRooms(day({ seeds }), new Set([key401.roomKey]))).toBe(1);
  });

  it("C9 월 제안 — 하루 보기와 같은 계산으로 끝난 방 · 미룸을 제안하지 않는다", () => {
    const rooms = day({ holds: [hold(TODAY, "defer", TOMORROW)], seeds: [seed(key401), seed(key402)], sessions: [session(TODAY, "a", "completed", { room_key: key402.roomKey, room_label: key402.sessionRoomLabel })] });
    const { suggestRooms } = suggestInputsForDay({ assignments: [], people: [], rooms });
    expect(suggestRooms).toEqual([]);
  });

  it("C10 알바 「배정 없음」 — 미룸 · 처리 끝 방은 미배정으로 세지 않는다", () => {
    const rooms = day({ holds: [hold(TODAY, "defer", TOMORROW), { ...hold(TODAY, "resolved", null), room_key: key402.roomKey }], seeds: [seed(key401), seed(key402)] });
    const open = countOpenRooms(rooms, new Set());
    expect(open).toBe(0);
    expect(shiftDayState({ applied: true, cancelled: false, isPast: false, myRooms: 0, openRooms: open, totalRooms: rooms.length })).toBe("none");
  });

  const boardRoom = (roomKey: string, over: Partial<BoardRoom>): BoardRoom => ({
    ...key401,
    arrivingGuestName: null,
    arrivingGuests: null,
    cancelled: false,
    carriedFrom: null,
    carryDays: 0,
    deferredUntil: null,
    hasTurnover: false,
    holdReason: null,
    nextCheckInDate: null,
    nextGuestName: null,
    nextGuests: null,
    note: null,
    partial: null,
    people: [],
    resolvedHold: false,
    roomKey,
    source: "checkout",
    status: "pending",
    suggested: [],
    usualHeadcount: 1,
    ...over,
  });
  const boardPeople = (ids: string[]) => ids.map((userId) => ({ userId, name: userId, startMinutes: 600 }) as BoardPerson);
  const seat = (userId: string, hasRecord: boolean) => ({ at: "", by: null, hasRecord, name: userId, trainee: false, userId });

  it("C11 「늦음」 — 같은 방 동료의 시작은 내 시작이 아니다", () => {
    const { rows } = buildCleaningBoard({
      now: new Date(),
      nowMinutes: 700,
      people: boardPeople(["me", "mate", "solo"]),
      rooms: [boardRoom("shared", { people: [seat("me", false), seat("mate", true)], status: "progress" }), boardRoom("mine", { people: [seat("me", false)] })],
      sessions: new Map(),
    });
    expect(rows.find((row) => row.roomKey === "mine")?.kind).toBe("late");
  });

  it("C11 「늦음」 — 본인이 다른 방을 시작했으면 차례 기다림이다", () => {
    const { rows } = buildCleaningBoard({
      now: new Date(),
      nowMinutes: 700,
      people: boardPeople(["me"]),
      rooms: [boardRoom("first", { people: [seat("me", true)], status: "progress" }), boardRoom("next", { people: [seat("me", false)] })],
      sessions: new Map(),
    });
    expect(rows.find((row) => row.roomKey === "next")?.kind).toBe("waiting");
  });

  it("A2 모바일 현황판 — 청소 중 방은 넣기 막고, 기록 없는 사람만 뺄 수 있다", () => {
    const { rows } = buildCleaningBoard({
      now: new Date(),
      nowMinutes: 700,
      people: boardPeople(["a", "b"]),
      rooms: [boardRoom("r", { people: [seat("a", true), seat("b", false)], status: "progress" })],
      sessions: new Map(),
    });
    expect(rows[0].canAdd).toBe(false);
    expect(rows[0].people.map((p) => p.removable)).toEqual([false, true]);
    expect(rows[0].editable).toBe(true);
  });

  it("C12 어제 기록 닫기 — 끝내기 · 취소 모두 소요 0초(서버 규칙)", () => {
    const now = new Date("2026-11-10T02:00:00.000Z");
    const started = "2026-11-09T02:00:00.000Z";
    expect(sessionCloseFields({ cleaned: true, cleaningDate: YESTERDAY, now, startedAt: started, today: TODAY })).toEqual({ completed_at: started, duration_seconds: 0, status: "completed" });
    expect(sessionCloseFields({ cleaned: false, cleaningDate: YESTERDAY, now, startedAt: started, today: TODAY })).toEqual({ completed_at: now.toISOString(), duration_seconds: 0, status: "cancelled" });
  });

  it("C12 오늘 기록은 실제 소요 시간을 그대로 남긴다", () => {
    const now = new Date("2026-11-10T02:00:00.000Z");
    const started = "2026-11-10T01:30:00.000Z";
    expect(sessionCloseFields({ cleaned: true, cleaningDate: TODAY, now, startedAt: started, today: TODAY })).toEqual({ completed_at: now.toISOString(), duration_seconds: 1800, status: "completed" });
    expect(sessionCloseFields({ cleaned: false, cleaningDate: TODAY, now, startedAt: started, today: TODAY }).duration_seconds).toBe(1800);
  });

  it("C13 /mobile/cleaning 시작 — 목록 방은 서버가 다시 확인, 종류도 서버가 정함, 예약 취소면 막음", () => {
    const targets = { cleaningList: [{ sessionRoomLabel: "아라키초A 401" }], settingList: [{ sessionRoomLabel: "아라키초A 402" }] };
    expect(cleaningListStart(targets, "아라키초A 401")).toEqual({ taskKey: "checkout" });
    expect(cleaningListStart(targets, "아라키초A 402")).toEqual({ taskKey: "simple" });
    // 쉬는 계정 라벨도 같은 실제 방.
    expect(cleaningListStart(targets, "아라키초A 401_2_2")).toEqual({ taskKey: "checkout" });
    expect(cleaningListStart(targets, "아라키초A 403")).toBeNull();
  });
});

describe("표 4 — 하루 몫 상한", () => {
  const rules = [...DEFAULT_ASSIGN_RULES];
  const person = (userId: string, extra: Partial<SuggestPerson> = {}): SuggestPerson => ({
    loadToday: 0,
    monthDays: 0,
    priority: false,
    propertiesToday: [],
    startMinutes: null,
    trainee: false,
    trainer: false,
    userId,
    ...extra,
  });
  const small = (roomKey: string, extra: Partial<SuggestRoom> = {}): SuggestRoom => ({ assigned: [], need: 1, propertyName: "A", roomKey, weight: 1, ...extra });
  const big = (roomKey: string, extra: Partial<SuggestRoom> = {}): SuggestRoom => ({ assigned: [], need: 1, propertyName: "A", roomKey, weight: 1.5, ...extra });
  const loadOf = (out: { userId: string; roomKey: string }[], userId: string, rooms: SuggestRoom[]) =>
    out.filter((s) => s.userId === userId).reduce((sum, s) => sum + rooms.find((r) => r.roomKey === s.roomKey)!.weight, 0);

  it("L1 작은 방 1, 큰 방(보통 인원 2명 이상) 1.5, 한 사람 상한 3", () => {
    expect(roomWeight(1)).toBe(1);
    expect(roomWeight(2)).toBe(1.5);
    expect(roomWeight(3)).toBe(1.5);
    expect(DAILY_CAP).toBe(3);
  });

  it("L2 2인 큰 방은 각자 큰 방 1개(1.5)로 센다", () => {
    const rooms = [big("b", { need: 2 })];
    const out = suggestAssignments({ fixedTiers: {}, people: [person("a"), person("c")], rooms, rules });
    expect(out.map((s) => s.userId).sort()).toEqual(["a", "c"]);
    expect(loadOf(out, "a", rooms)).toBe(1.5);
    expect(loadOf(out, "c", rooms)).toBe(1.5);
  });

  it("L3 가능한 조합 — 작은 3 · 큰 2 · 큰 1 + 작은 1", () => {
    const three = [small("s1"), small("s2"), small("s3"), small("s4")];
    expect(suggestAssignments({ fixedTiers: {}, people: [person("a")], rooms: three, rules })).toHaveLength(3);
    const twoBig = [big("b1"), big("b2"), small("s1")];
    expect(suggestAssignments({ fixedTiers: {}, people: [person("a")], rooms: twoBig, rules }).map((s) => s.roomKey)).toEqual(["b1", "b2"]);
    const mix = [big("b1"), small("s1"), small("s2")];
    expect(suggestAssignments({ fixedTiers: {}, people: [person("a")], rooms: mix, rules }).map((s) => s.roomKey)).toEqual(["b1", "s1"]);
    expect(overDailyCap(2.5, 1)).toBe(true);
    expect(overDailyCap(1.5, 1.5)).toBe(false);
  });

  it("L4 제안은 상한을 넘겨 넣지 않고, 이미 넣은 방도 몫에 포함한다", () => {
    expect(suggestAssignments({ fixedTiers: {}, people: [person("a", { loadToday: 2.5 })], rooms: [small("s1")], rules })).toEqual([]);
    expect(suggestAssignments({ fixedTiers: {}, people: [person("a", { loadToday: 2 })], rooms: [small("s1"), small("s2")], rules })).toHaveLength(1);
  });

  it("L4 「고정 인력 먼저」도 상한을 넘기지 않는다", () => {
    const rooms = [small("s1"), small("s2"), small("s3"), small("s4")];
    const out = suggestAssignments({ fixedTiers: { A: { a: 1 } }, onlyFixed: true, people: [person("a")], rooms, rules });
    expect(out).toHaveLength(3);
  });

  it("L4 큰 방 몫 — 무게로 고르게 나눈다(몫 계산도 무게 기준)", () => {
    const rooms = [big("b1"), small("s1")];
    const out = suggestAssignments({ fixedTiers: {}, people: [person("a"), person("c")], rooms, rules });
    expect(out).toEqual([
      { roomKey: "b1", userId: "a" },
      { roomKey: "s1", userId: "c" },
    ]);
  });

  it("L4 하루 입력 — 이미 넣은 큰 방이 몫에 1.5 로 들어간다, 취소된 방은 몫이 아니다", () => {
    const rooms = day({ seeds: [seed(key401), seed(key402)], usual: { [key401.roomKey]: 2 } });
    const { suggestPeople, suggestRooms } = suggestInputsForDay({
      assignments: [
        { propertyName: key401.propertyName, roomKey: key401.roomKey, userId: "a" },
        { propertyName: "취소", roomKey: "ghost", userId: "a" },
      ],
      people: [{ monthDays: 0, priority: false, startMinutes: null, trainee: false, trainer: false, userId: "a" }],
      rooms,
    });
    expect(suggestPeople[0].loadToday).toBe(1.5);
    expect(suggestRooms.find((r) => r.roomKey === key401.roomKey)?.weight).toBe(1.5);
    expect(suggestRooms.find((r) => r.roomKey === key402.roomKey)?.weight).toBe(1);
  });

  it("L5 넘는 방은 미배정으로 두고 「N개 남음」을 센다", () => {
    const rooms = [small("s1"), small("s2"), small("s3"), small("s4"), small("s5")];
    const out = suggestAssignments({ fixedTiers: {}, people: [person("a")], rooms, rules });
    expect(leftAfterSuggest(rooms, out)).toBe(2);
    expect(leftAfterSuggest([big("b", { need: 2 })], [{ roomKey: "b", userId: "a" }])).toBe(1);
    expect(leftAfterSuggest([small("s1")], [{ roomKey: "s1", userId: "a" }])).toBe(0);
  });

  it("L6 직접 넣기는 막지 않고 확인만 — 상한을 넘는지 판단만 한다", () => {
    expect(overDailyCap(3, 1)).toBe(true);
    expect(overDailyCap(2, 1)).toBe(false);
    // 제안과 달리 canAddPerson 은 몫을 보지 않는다.
    expect(canAddPerson(capRoom(caps.A1))).toBe(true);
  });
});

describe("독립 리뷰 지적 (2026-11-04)", () => {
  // ── L6 ──
  it("L6 여러 명 넣기 — 보통 인원 초과 · 하루 몫 초과를 같은 판단으로 돌려준다", () => {
    const people = [
      { load: 2.5, name: "A" },
      { load: 0, name: "B" },
    ];
    expect(directAddWarnings({ assignedCount: 0, usualHeadcount: 1 }, people)).toEqual({ overCapNames: ["A"], overHeadcount: true, total: 2 });
    expect(directAddWarnings({ assignedCount: 0, usualHeadcount: 2 }, [{ load: 0, name: "B" }])).toEqual({ overCapNames: [], overHeadcount: false, total: 1 });
    // 사람을 안 넣으면 아무 경고도 없다(빼기만 · 방만 추가).
    expect(directAddWarnings({ assignedCount: 3, usualHeadcount: 1 }, [])).toEqual({ overCapNames: [], overHeadcount: false, total: 3 });
  });

  it("L6 교체 — 바꾼 뒤 하루 몫을 넘는 사람만, 받는 방이 있는 사람만", () => {
    const small = { usualHeadcount: 1 };
    const big = { usualHeadcount: 2 };
    expect(swapOverCapNames({ load: 3, name: "A" }, { load: 1, name: "B" }, [small], [big])).toEqual(["A"]);
    expect(swapOverCapNames({ load: 3.5, name: "A" }, { load: 1, name: "B" }, [], [])).toEqual([]);
    expect(swapOverCapNames({ load: 1, name: "A" }, { load: 3, name: "B" }, [small], [])).toEqual(["B"]);
  });

  it("L6 확인 창 문구 — 인원 초과 먼저, 몫 초과는 보조 줄, ko · ja · en 모두 자리표 없이 채워진다", () => {
    for (const locale of ["ko", "ja", "en"] as const) {
      const copy = getCleaningAssignCopy(locale);
      const both = addWarningText(copy, { overCapNames: ["A"], overHeadcount: true, total: 2 }, { room: "401", usual: 1 });
      expect(both.title).toBe(fill(copy.overTitle, { n: 1, room: "401" }));
      expect(both.confirm).toBe(fill(copy.overConfirm, { total: 2 }));
      expect(both.hint).toContain("A");
      const capOnly = addWarningText(copy, { overCapNames: ["A", "B"], overHeadcount: false, total: 1 }, { room: "401", usual: 2 });
      expect(capOnly.title).toBe(copy.capManyTitle);
      expect(capOnly.confirm).toBe(copy.capConfirm);
      expect(capOnly.hint).toBeNull();
      for (const text of [both.title, both.body, both.confirm, both.hint ?? "", capOnly.title, capOnly.body]) expect(text).not.toMatch(/[{}]/);
    }
  });

  // ── R1 · R9 · R11 — 어제 보기에서 건 미룸 ──
  const heldFrom = (viewedDate: string, originDate: string, until: string | null, kind: "defer" | "resolved" = "defer") =>
    ({
      ...hold(originDate, kind, until),
      created_at: holdUpsertRow(
        { closedSessionId: null, createdBy: "admin", kind, organizationId: "org", originDate, reason: "", removedUserIds: [], room: key401, until, viewedDate },
        `${TODAY}T03:00:00.000Z`,
      ).created_at,
    }) as HoldRow;

  it("R1 어제 보기에서 미뤄도 오늘 새 체크아웃은 정상 방이고 시작된다", () => {
    const room = only(day({ holds: [heldFrom(YESTERDAY, YESTERDAY, TOMORROW)], past: { [YESTERDAY]: [seed()] }, seeds: [seed()], usedDays: [YESTERDAY] }));
    expect(room.deferredUntil).toBeNull();
    expect(roomStartBlock(room, true)).toBeNull();
  });

  it("R9 어제 보기에서 처리 끝을 눌러도 오늘 새 체크아웃은 덮지 않는다", () => {
    const room = only(day({ holds: [heldFrom(YESTERDAY, YESTERDAY, null, "resolved")], past: { [YESTERDAY]: [seed()] }, seeds: [seed()], usedDays: [YESTERDAY] }));
    expect(room.resolvedHold).toBe(false);
    expect(roomStartBlock(room, false)).toBeNull();
  });

  it("R11 어제 보기에서 다시 미룬 방 — 어제 보기에 줄과 되돌리기가 남는다", () => {
    const row = heldFrom(YESTERDAY, TWO_AGO, TOMORROW);
    const room = only(day({ date: YESTERDAY, holds: [row], past: { [TWO_AGO]: [seed()] }, usedDays: [TWO_AGO] }));
    expect(room.deferredUntil).toBe(TOMORROW);
    expect(room.carriedFrom).toBe(TWO_AGO);
  });

  it("R11 오늘 보기에서 건 미룸은 지금 시각을 그대로 쓴다", () => {
    expect(heldFrom(TODAY, TODAY, TOMORROW).created_at).toBe(`${TODAY}T03:00:00.000Z`);
  });

  // ── A8 ──
  it("A8 기간이 지난 줄을 다시 걸면 지금 배정만 남긴다 — 그날 배정한 적 없는 사람이 되살아나지 않게", () => {
    expect(holdRemovedUserIds({ kind: "defer", removed_user_ids: ["old"], until_date: TODAY }, ["now"], TODAY)).toEqual(["now"]);
    expect(holdRemovedUserIds({ kind: "defer", removed_user_ids: ["old"], until_date: YESTERDAY }, [], TODAY)).toEqual([]);
  });

  it("A8 아직 효력이 있는 줄이면 전에 뺀 사람과 합친다", () => {
    expect(holdRemovedUserIds({ kind: "defer", removed_user_ids: ["old"], until_date: TOMORROW }, ["now"], TODAY)).toEqual(["old", "now"]);
    expect(holdRemovedUserIds(null, ["now"], TODAY)).toEqual(["now"]);
  });

  // ── A10 — 쓰기 순서 시뮬레이션 ──
  type World = { hold: boolean; closed: boolean; assigned: boolean };
  const holdPorts = (world: World, failAt: string | null, rollbackFails = false) => {
    const fail = (step: string) => step === failAt;
    return {
      deleteClosed: vi.fn(async () => {
        if (rollbackFails) return { error: true };
        world.closed = false;
        return { error: false };
      }),
      insertClosed: vi.fn(async () => {
        if (fail("insertClosed")) return { error: true, id: null };
        world.closed = true;
        return { error: false, id: "s1" };
      }),
      linkClosed: vi.fn(async () => ({ error: fail("linkClosed") })),
      removeAssignments: vi.fn(async () => {
        if (fail("removeAssignments")) return { error: true };
        world.assigned = false;
        return { error: false };
      }),
      reportRollback: vi.fn(),
      saveHold: vi.fn(async () => {
        if (fail("saveHold")) return { error: true };
        world.hold = true;
        return { error: false };
      }),
      undoHold: vi.fn(async () => {
        if (rollbackFails) return { error: true };
        world.hold = false;
        return { error: false };
      }),
    };
  };
  const release = (world: World, failAt: string | null = null) =>
    releaseHoldSteps(["a"], world.closed ? ["s1"] : [], {
      deleteClosedSessions: async () => {
        if (failAt === "closed") return { error: true };
        world.closed = false;
        return { error: false };
      },
      deleteHold: async () => {
        if (failAt === "hold") return { error: true };
        world.hold = false;
        return { error: false };
      },
      deleteRestored: async () => {
        world.assigned = false;
        return { error: false };
      },
      reportRollback: () => {},
      restore: async () => {
        if (failAt === "restore") return { error: true, insertedIds: [] };
        world.assigned = true;
        return { error: false, insertedIds: ["r"] };
      },
    });

  for (const step of ["saveHold", "insertClosed", "linkClosed", "removeAssignments"]) {
    it(`A10 처리 끝 저장이 ${step} 에서 실패 — 원래대로 돌아가고 같은 동작을 다시 시도할 수 있다`, async () => {
      const world: World = { assigned: true, closed: false, hold: false };
      await expect(applyHoldSteps("resolved", holdPorts(world, step))).resolves.toBe("error");
      expect(world).toEqual({ assigned: true, closed: false, hold: false });
      await expect(applyHoldSteps("resolved", holdPorts(world, null))).resolves.toBe("ok");
      expect(world).toEqual({ assigned: false, closed: true, hold: true });
    });
  }

  for (const step of ["linkClosed", "removeAssignments"]) {
    it(`A10 ${step} 실패에 되돌리기까지 실패 — 알리고, 처리 끝 기록만 남는 일은 없으며 되돌리기로 풀린다`, async () => {
      const world: World = { assigned: true, closed: false, hold: false };
      const ports = holdPorts(world, step, true);
      await expect(applyHoldSteps("resolved", ports)).resolves.toBe("error");
      expect(ports.reportRollback).toHaveBeenCalled();
      // 「대기로 보이는데 시작은 room_resolved」 상태(미룸 줄 없이 처리 끝 기록만)가 되면 안 된다.
      expect(world.closed && !world.hold).toBe(false);
      await expect(release(world)).resolves.toBe("ok");
      expect(world).toEqual({ assigned: true, closed: false, hold: false });
    });
  }

  for (const step of ["restore", "closed", "hold"]) {
    it(`A10 되돌리기가 ${step} 에서 실패 — 미룸 줄이 남아 다시 시도할 수 있다`, async () => {
      const world: World = { assigned: false, closed: true, hold: true };
      await expect(release(world, step)).resolves.toBe("error");
      expect(world.hold).toBe(true);
      expect(world.assigned).toBe(false);
      await expect(release(world)).resolves.toBe("ok");
      expect(world).toEqual({ assigned: true, closed: false, hold: false });
    });
  }

  // ── R7 · R8 ──
  const target = (key = key401) => ({ roomKey: key.roomKey, sessionRoomLabel: key.sessionRoomLabel });
  it("R7 오늘 미룬 방은 청소 목록에서 거른다", () => {
    const rooms = day({ holds: [hold(TODAY, "defer", TOMORROW)], seeds: [seed(), seed(key402)] });
    expect(startableListTargets([target(), target(key402)], rooms, new Set([key401.roomKey])).map((t) => t.roomKey)).toEqual([key402.roomKey]);
  });

  it("R8 미룬 기간 중이라 하루 목록에 없는 방도 거른다", () => {
    expect(startableListTargets([target()], [], new Set([key401.roomKey]))).toEqual([]);
  });

  it("R9 미룬 기간 중 새 체크아웃은 하루 보기대로 남긴다", () => {
    const rooms = day({ holds: [hold(TWO_AGO, "defer", TOMORROW)], past: { [TWO_AGO]: [seed()] }, seeds: [seed()], usedDays: [TWO_AGO] });
    expect(startableListTargets([target()], rooms, new Set([key401.roomKey]))).toHaveLength(1);
  });

  // ── C13 ──
  it("C13 목록에서 시작하는 폼은 모두 source=list 를 보낸다(셋팅 시트 포함)", () => {
    for (const file of ["src/app/mobile/cleaning/page.tsx", "src/components/cleaning/setting-targets-sheet.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/name="source"[^>]*value="list"/);
    }
  });

  // ── A7 ──
  it("A7 일정이 취소된 날(끝낸 방만 남음)에는 취소 요청을 내밀지 않는다", () => {
    expect(canRequestCancel({ cancelled: true, date: TODAY, today: TODAY })).toBe(false);
    expect(canRequestCancel({ cancelled: false, date: TODAY, today: TODAY })).toBe(true);
    expect(canRequestCancel({ cancelled: false, date: YESTERDAY, today: TODAY })).toBe(false);
  });

  // ── L5 ──
  it("L5 남는 방을 방 키로 돌려줘, 화면이 눈앞 목록으로 셀 수 있다", () => {
    const rooms = [
      { assigned: [], need: 1, propertyName: "아라키초A", roomKey: "r1", weight: 1 },
      { assigned: [], need: 1, propertyName: "다른 건물", roomKey: "r2", weight: 1 },
    ];
    expect(shortRoomKeys(rooms, [])).toEqual(["r1", "r2"]);
    expect(shortRoomKeys(rooms, [{ propertyName: "아라키초A", reason: "", roomKey: "r1", roomLabel: "", userId: "a" } as never])).toEqual(["r2"]);
  });

  // ── R4 뒤 ──
  it("R4 앞날에 이미 넣어 둔 밀린 방 배정 — 아직 안 끝났으면 앞날 목록에 남아 「취소됨」이 되지 않는다", () => {
    const room = only(day({ assignees: { [key401.roomKey]: ["a"] }, date: TOMORROW, past: { [TODAY]: [seed()] }, usedDays: [TODAY] }));
    expect(room.source).toBe("carry");
    expect(room.carriedFrom).toBe(TODAY);
  });

  it("R4 앞날 배정이 있어도 이미 청소된 방은 목록에 없다 — 관리자가 정리하도록 「취소됨」으로 남는다", () => {
    expect(day({ assignees: { [key401.roomKey]: ["a"] }, date: TOMORROW, past: { [TODAY]: [seed()] }, sessions: [session(TODAY, "a")], usedDays: [TODAY] })).toEqual([]);
  });

  it("R4 배정이 없는 밀린 방은 앞날에 여전히 안 나온다", () => {
    expect(day({ date: TOMORROW, past: { [TODAY]: [seed()] }, usedDays: [TODAY] })).toEqual([]);
  });

  // ── 미룸 줄이 그날 방 전부를 끌어오던 것 ──
  it("R10 7일보다 오래된 미룸 줄은 그 방만 끌어온다 — 그날 다른 방까지 끌어오지 않는다", () => {
    const old = "2026-10-20";
    const rooms = day({ holds: [hold(old, "defer", TODAY)], past: { [old]: [seed(), seed(key402)] } });
    expect(rooms.map((room) => room.roomKey)).toEqual([key401.roomKey]);
  });

  it("R10 최근 며칠 안이어도 배정을 쓰지 않은 날의 미룸 줄은 그 방만 끌어온다", () => {
    const rooms = day({ holds: [hold(TWO_AGO, "defer", TODAY)], past: { [TWO_AGO]: [seed(), seed(key402)] } });
    expect(rooms.map((room) => room.roomKey)).toEqual([key401.roomKey]);
  });

  // ── R10 맨 위 ──
  it("R10 미배정 구역 — 정한 날 도착한 · 밀려 온 방이 맨 위, 오래된 순, 나머지는 원래 순서", () => {
    const row = (roomKey: string, carriedFrom: string | null) => ({ carriedFrom, roomKey });
    const sorted = sortOpenSection([row("a", null), row("b", TWO_AGO), row("c", null), row("d", "2026-11-01")]);
    expect(sorted.map((room) => room.roomKey)).toEqual(["d", "b", "a", "c"]);
  });

  // ── 데모 실행 지적 ──
  it("A1 끝난 · 청소 중인 방에는 「N명 더 필요」를 내밀지 않는다(넣을 수 없음)", () => {
    const base = { deferredUntil: null, partial: null, resolvedHold: false, usualHeadcount: 2 };
    expect(needMoreCount({ ...base, status: "pending" }, 1)).toBe(1);
    expect(needMoreCount({ ...base, status: "done" }, 1)).toBe(0);
    expect(needMoreCount({ ...base, partial: { done: 1, need: 2 }, status: "progress" }, 1)).toBe(0);
    expect(needMoreCount({ ...base, status: "progress" }, 1)).toBe(0);
    expect(needMoreCount({ ...base, deferredUntil: TOMORROW, status: "pending" }, 0)).toBe(0);
    expect(needMoreCount({ ...base, status: "pending" }, 2)).toBe(0);
  });

  it("R8 미룬 기간이라 목록에서 빠진 배정 방 — 「예약 바뀜」이 아니라 미룸 문구", () => {
    expect(todaySkipReason({ changed: true, deferredUntil: TOMORROW, hasSession: false, resolvedHold: false, status: "pending" })).toBe("held");
    expect(todaySkipReason({ changed: true, deferredUntil: null, hasSession: false, resolvedHold: false, status: "pending" })).toBe("booking");
  });

  it("R8 그날 효력이 있는 미룸의 정한 날을 방 키로 돌려준다", () => {
    const rows = [hold(TWO_AGO, "defer", TOMORROW), { ...hold(TWO_AGO, "defer", TODAY), room_key: "ended" }, { ...hold(TODAY, "resolved", null), room_key: "resolved" }];
    expect([...activeDeferUntil(rows, TODAY)]).toEqual([[key401.roomKey, TOMORROW]]);
  });

  it("C4 기록 목록 줄 — 처리 끝은 글자로 보인다", () => {
    expect(recordListChip({ closed: true, taskLabel: "체크아웃" }, "처리 끝")).toBe("처리 끝");
    expect(recordListChip({ closed: false, taskLabel: "체크아웃" }, "처리 끝")).toBe("체크아웃");
  });

  it("거절 문구 — 상태가 바뀐 거절은 「저장 실패」가 아니라 새로 읽었다는 문구(ko · ja · en)", () => {
    for (const locale of ["ko", "ja", "en"] as const) {
      const copy = getCleaningAssignCopy(locale);
      expect(assignFailText("stale", copy)).toBe(copy.errRoomChanged);
      expect(copy.errRoomChanged).not.toBe(copy.failed);
      expect(assignFailText("invalid", copy)).toBe(copy.failed);
    }
  });

  it("en 단수 — 숫자 1 뒤 복수형이 나오지 않는다(1 guests · 1 rooms)", () => {
    const en = getCleaningAssignCopy("en") as unknown as Record<string, string>;
    for (const [key, text] of Object.entries(en)) {
      if (typeof text !== "string") continue;
      const words = Object.fromEntries([...text.matchAll(/\{(\w+)\}/g)].map((m) => [m[1], 1]));
      expect(fill(text, words), key).not.toMatch(/\b1 (rooms|guests|days|people|buildings)\b/);
    }
    expect(fill(en.roomsN, { n: 21 })).toBe("21 rooms");
    expect(fill(en.roomsN, { n: 1 })).toBe("1 room");
  });

  it("ko 호칭 — 「이름 님」 띄어쓰기 하나", () => {
    const ko = getCleaningAssignCopy("ko") as unknown as Record<string, string>;
    for (const [key, text] of Object.entries(ko)) if (typeof text === "string") expect(text, key).not.toMatch(/\}님/);
  });
});

describe("강제 완료 창 담당 칸 (2026-11-04)", () => {
  const known = () => true;
  it("기록의 담당이 있으면 그 사람", () => {
    expect(forceCompleteDefaultStaff({ assigneeIds: ["b"], staffId: "a" }, known)).toBe("a");
  });
  it("기록 없고 배정 한 명이면 그 사람을 미리 채운다", () => {
    expect(forceCompleteDefaultStaff({ assigneeIds: ["a", "a"], staffId: null }, known)).toBe("a");
  });
  it("배정이 두 명 이상이거나 없으면 비워 둔다", () => {
    expect(forceCompleteDefaultStaff({ assigneeIds: ["a", "b"], staffId: null }, known)).toBe("");
    expect(forceCompleteDefaultStaff({ assigneeIds: [], staffId: null }, known)).toBe("");
  });
  it("고를 수 있는 목록에 없는 사람은 채우지 않는다", () => {
    expect(forceCompleteDefaultStaff({ assigneeIds: ["a"], staffId: null }, () => false)).toBe("");
  });
});

describe("콘솔 대기 카드 담당 (2026-11-04)", () => {
  it("담당 칸 · 거르기 · 검색은 그날 그 방의 기록한 사람 + 배정된 사람 모두(중복 없이)", () => {
    expect(consoleWhoIds({ assigneeIds: ["a", "b", "a"], staffId: null, workers: [] })).toEqual(["a", "b"]);
    expect(consoleWhoIds({ assigneeIds: ["a", "b"], staffId: "a", workers: [{ staffId: "a" }] })).toEqual(["a", "b"]);
    expect(consoleWhoIds({ assigneeIds: ["a"], staffId: "a", workers: [{ staffId: "a" }, { staffId: "c" }] })).toEqual(["a", "c"]);
    expect(consoleWhoIds({ assigneeIds: [], staffId: null, workers: [] })).toEqual([]);
  });

  it("직원별 요약은 사람별 기록만 센다 — 담당 칸의 배정된 사람과 섞이지 않는다", () => {
    const board = readFileSync("src/components/admin/cleaning/cleaning-today-board.tsx", "utf8");
    expect(board).toMatch(/const worked = tasks\.filter\(\(task\) => !task\.closed\)\.flatMap\(\(task\) => task\.workers\)/);
  });

  it("목록 시작 거르기 — 막는 미룸이 없으면 하루 목록을 읽지 않아도 결과가 같다", () => {
    const target = (key = key401) => ({ roomKey: key.roomKey, sessionRoomLabel: key.sessionRoomLabel });
    const list = [target(), target(physicalKeyOf("아라키초A", "402"))];
    const scenarios: { holds: HoldRow[]; rooms: Parameters<typeof startableListTargets>[1] }[] = [
      { holds: [], rooms: day({ holds: [], seeds: [seed()] }) },
      { holds: [hold(TWO_AGO, "defer", YESTERDAY)], rooms: day({ holds: [hold(TWO_AGO, "defer", YESTERDAY)], past: { [TWO_AGO]: [seed()] }, seeds: [seed()], usedDays: [TWO_AGO] }) },
      { holds: [hold(TWO_AGO, "resolved", null)], rooms: day({ holds: [hold(TWO_AGO, "resolved", null)], past: { [TWO_AGO]: [seed()] }, seeds: [seed()], usedDays: [TWO_AGO] }) },
    ];
    for (const { holds, rooms } of scenarios) {
      const blocked = new Set(holds.filter((row) => holdBlocksAddRoom(row, TODAY)).map((row) => row.room_key));
      expect(blocked.size).toBe(0);
      expect(startableListTargets(list, [], blocked)).toEqual(startableListTargets(list, rooms, blocked));
    }
    // 막는 줄이 있으면 키 집합이 비지 않아 하루 목록을 읽는다.
    const active = hold(TODAY, "resolved", null);
    expect(holdBlocksAddRoom(active, TODAY)).toBe(true);
    expect(readFileSync("src/app/mobile/cleaning/page.tsx", "utf8")).toMatch(/holds\.size > 0 \? await loadAssignDayRooms/);
  });

  it("오늘 내 방은 기록 · 미룸 읽기를 오늘 · 내일이 나눠 쓴다", () => {
    const source = readFileSync("src/lib/cleaning-assign/data.ts", "utf8");
    expect(source).toMatch(/createSharedRoomReads\(supabase, organizationId, date, tomorrow\)/);
    expect(source).toMatch(/loadAssignDayRooms\(supabase, organizationId, date, null, shared\)/);
    expect(source).toMatch(/loadRangeDayRooms\(supabase, organizationId, tomorrow, tomorrow, null, shared\)/);
  });

  it("현황판 보조 줄은 줄 수를 자르지 않는다 — 긴 건물 이름 뒤의 날짜도 보인다", () => {
    const css = readFileSync("src/components/mobile/cleaning-board/cleaning-board.css", "utf8");
    expect(css).not.toMatch(/\.cbd-main span \{[^}]*(line-clamp|nowrap)/);
  });

  it("같이 일하는 사람 이름은 세로로 깨지지 않는다 — 이름은 한 줄, 방 목록이 줄어든다", () => {
    const css = readFileSync("src/components/mobile/shift/shift.css", "utf8");
    expect(css).toMatch(/\.shf-mate b \{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.shf-mate span \{[^}]*min-width: 0/);
  });

  it("방 키는 어긋나지 않는다 — 배정 저장 키와 콘솔이 찾는 키가 건물마다 같다", () => {
    const catalog = [
      { canonicalRoomLabel: "AB401", propertyName: "아라키초B" },
      { canonicalRoomLabel: "401_2_2", propertyName: "아라키초A" },
      { canonicalRoomLabel: "오쿠보A", propertyName: "오쿠보A" },
    ];
    const assignKeyOf = sessionRoomKeyLookup(catalog);
    for (const entry of catalog) {
      const stored = physicalKeyOf(entry.propertyName, entry.canonicalRoomLabel);
      expect(assignKeyOf(stored.sessionRoomLabel)).toBe(stored.roomKey);
    }
    expect(physicalKeyOf("아라키초B", "Ab401").roomKey).toBe("아라키초B_401");
    expect(assignKeyOf("아라키초B AB401")).toBe("아라키초B_401");
  });

  it("콘솔이 배정을 카드에 싣고, 줄 · 패널 · 담당 거르기가 같은 함수를 쓴다", () => {
    expect(readFileSync("src/lib/admin-cleaning.ts", "utf8")).toMatch(/assigneeIds: assignees/);
    const board = readFileSync("src/components/admin/cleaning/cleaning-today-board.tsx", "utf8");
    expect(board.match(/consoleWhoIds\(task\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(readFileSync("src/components/admin/cleaning/cleaning-detail-panel.tsx", "utf8")).toMatch(/consoleWhoIds\(task\)/);
  });

  it("미룸 · 처리 끝 · 예약 바뀜 문구는 세 언어 모두 「청소 안 함」까지 말한다", () => {
    for (const [locale, word] of [["ko", "청소 안 함"], ["ja", "清掃なし"], ["en", "no cleaning"]] as const) {
      const copy = getCleaningAssignCopy(locale);
      for (const text of [copy.stateHeldRoom, copy.stateResolvedRoom, copy.stateChangedRoom]) expect(text).toContain(word);
    }
  });
});
