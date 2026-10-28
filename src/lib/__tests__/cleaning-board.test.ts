import { describe, expect, it } from "vitest";
import type { BoardPerson, BoardRoom } from "@/lib/cleaning-assign/data";
import { attentionRows, buildCleaningBoard, matchesFilter, orderAssignCandidates } from "@/lib/cleaning-board";

function room(roomKey: string, over: Partial<BoardRoom> = {}): BoardRoom {
  return {
    arrivingGuestName: null,
    arrivingGuests: 2,
    cancelled: false,
    carriedFrom: null,
    carryDays: 0,
    deferredUntil: null,
    hasTurnover: true,
    holdReason: null,
    nextCheckInDate: null,
    nextGuestName: null,
    nextGuests: null,
    note: null,
    people: [],
    propertyName: "아라키초A",
    resolvedHold: false,
    roomKey,
    roomLabel: roomKey,
    sessionRoomLabel: roomKey,
    source: "checkout",
    status: "pending",
    suggested: [],
    usualHeadcount: 1,
    ...over,
  };
}

function person(userId: string, over: Partial<BoardPerson> = {}): BoardPerson {
  return {
    applied: true,
    cancelRequestNote: null,
    cancelRequested: false,
    cancelled: false,
    fixed: [],
    lastWorked: null,
    memo: null,
    monthDays: 0,
    name: userId,
    phone: "",
    priority: false,
    role: "part_time_staff",
    rooms: [],
    source: "self",
    startException: false,
    startMinutes: 9 * 60 + 45,
    trainee: false,
    traineeAsk: false,
    traineeByProperty: {},
    traineeCount: 0,
    trainer: false,
    userId,
    ...over,
  };
}

const assigned = (userId: string) => ({ at: "", by: null, name: userId, trainee: false, userId });
const now = new Date("2026-10-28T02:20:00Z"); // 도쿄 11:20

describe("buildCleaningBoard", () => {
  it("방마다 상태 하나 — 끝남 · 청소 중(흐른 분) · 담당 없음 · 대기", () => {
    const { rows, summary } = buildCleaningBoard({
      now,
      nowMinutes: 11 * 60 + 20,
      people: [person("a"), person("b", { startMinutes: 11 * 60 })],
      rooms: [
        room("101", { people: [assigned("a")], status: "done" }),
        room("201", { people: [assigned("a")], status: "progress" }),
        room("301"),
        room("401", { people: [assigned("b")] }),
      ],
      sessions: new Map([
        ["101", { completedAt: "2026-10-28T01:42:00Z", startedAt: "2026-10-28T01:10:00Z" }],
        ["201", { completedAt: null, startedAt: "2026-10-28T01:57:00Z" }],
      ]),
    });
    expect(rows.map((r) => r.kind)).toEqual(["done", "progress", "open", "waiting"]);
    expect(rows[0].completedAt).toBe("2026-10-28T01:42:00Z");
    expect(rows[1].elapsedMinutes).toBe(23);
    expect(summary).toEqual({ done: 1, open: 1, progress: 1, total: 4, waiting: 1 });
  });

  it("출근 30분 지나도록 담당 누구도 시작 안 했으면 늦음, 다른 방을 하는 중이면 늦음 아님", () => {
    const { rows } = buildCleaningBoard({
      now,
      nowMinutes: 11 * 60 + 20,
      people: [person("late", { startMinutes: 10 * 60 + 30 }), person("busy", { startMinutes: 9 * 60 })],
      rooms: [
        room("302", { people: [assigned("late")] }),
        room("501", { people: [assigned("busy")], status: "progress" }),
        room("502", { people: [assigned("busy")] }),
      ],
      sessions: new Map(),
    });
    expect(rows[0]).toMatchObject({ kind: "late", lateMinutes: 50, plannedName: "late", plannedStartMinutes: 630 });
    expect(rows[2].kind).toBe("waiting");
  });

  it("오늘이 아니면 늦음 · 흐른 분을 계산하지 않는다", () => {
    const { rows } = buildCleaningBoard({
      now,
      nowMinutes: null,
      people: [person("a", { startMinutes: 0 })],
      rooms: [room("1", { people: [assigned("a")] }), room("2", { people: [assigned("a")], status: "progress" })],
      sessions: new Map([["2", { completedAt: null, startedAt: "2026-10-28T00:00:00Z" }]]),
    });
    expect(rows[0].kind).toBe("waiting");
    expect(rows[1].elapsedMinutes).toBeNull();
  });

  it("미룬 방 · 처리 끝 방 · 취소된 방은 그리지 않는다", () => {
    const { rows } = buildCleaningBoard({
      now,
      nowMinutes: 600,
      people: [],
      rooms: [room("a", { deferredUntil: "2026-10-29" }), room("b", { resolvedHold: true, status: "done" }), room("c", { cancelled: true }), room("d")],
      sessions: new Map(),
    });
    expect(rows.map((r) => r.roomKey)).toEqual(["d"]);
  });

  it("시작 전 방만 담당을 바꿀 수 있다", () => {
    const { rows } = buildCleaningBoard({
      now,
      nowMinutes: 600,
      people: [],
      rooms: [room("a"), room("b", { status: "progress" }), room("c", { status: "done" })],
      sessions: new Map(),
    });
    expect(rows.map((r) => r.editable)).toEqual([true, false, false]);
  });
});

describe("attentionRows · matchesFilter", () => {
  const { rows } = buildCleaningBoard({
    now,
    nowMinutes: 12 * 60,
    people: [person("x", { startMinutes: 11 * 60 }), person("y", { startMinutes: 10 * 60 })],
    rooms: [room("w1", { people: [assigned("x")] }), room("o1"), room("w2", { people: [assigned("y")] })],
    sessions: new Map(),
  });

  it("담당 없음 먼저, 늦은 방은 많이 늦은 순", () => {
    expect(attentionRows(rows).map((r) => r.roomKey)).toEqual(["o1", "w2", "w1"]);
  });

  it("대기 거르기에는 늦은 방도 들어간다", () => {
    expect(rows.filter((r) => matchesFilter(r, "waiting")).map((r) => r.roomKey)).toEqual(["w1", "w2"]);
    expect(rows.filter((r) => matchesFilter(r, "open")).map((r) => r.roomKey)).toEqual(["o1"]);
  });
});

describe("orderAssignCandidates", () => {
  it("오늘 나온 사람 중 같은 건물 먼저, 방 적은 순 · 신청 안 한 사람은 따로", () => {
    const people = [
      person("many", { rooms: [{ propertyName: "가부키초", roomKey: "1", roomLabel: "1", withOthers: 0 }, { propertyName: "가부키초", roomKey: "2", roomLabel: "2", withOthers: 0 }] }),
      person("few", { rooms: [{ propertyName: "바바", roomKey: "3", roomLabel: "3", withOthers: 0 }] }),
      person("same", { rooms: [{ propertyName: "아라키초A", roomKey: "4", roomLabel: "4", withOthers: 0 }, { propertyName: "아라키초A", roomKey: "5", roomLabel: "5", withOthers: 0 }, { propertyName: "아라키초A", roomKey: "6", roomLabel: "6", withOthers: 0 }] }),
      person("off", { applied: false }),
      person("cancelled", { cancelled: true }),
    ];
    const { today, others } = orderAssignCandidates(people, "아라키초A");
    expect(today.map((p) => p.userId)).toEqual(["same", "few", "many"]);
    expect(others.map((p) => p.userId)).toEqual(["cancelled", "off"]);
  });
});
