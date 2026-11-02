import { describe, expect, it } from "vitest";
import { canRecordInRoom, physicalKeyOf, roomRecordDecision, roomShareState, roomWriteErrorKind, sameRoomRecords, sessionRoomKeyLookup, sessionRoomKeyOf, shouldOfferStart, storedSessionRoomKey } from "@/lib/cleaning-assign/room-key";

// 2인 방 — 각자 기록(2026-11-02 점검 C1). 청소 기록의 방 키는 배정 방 키와 같은 모양이어야 배정된 사람을 알아볼 수 있다.
describe("sessionRoomKeyOf — 청소 기록 라벨 → 배정 방 키", () => {
  it("이름표 규칙이 있는 건물은 라벨만으로 배정 키와 같다", () => {
    expect(sessionRoomKeyOf("아라키초A 201")).toBe(physicalKeyOf("아라키초A", "201").roomKey);
  });
  it("아라키초 쉬는 계정 라벨도 같은 방 키", () => {
    expect(sessionRoomKeyOf("아라키초A 401_2_2")).toBe(sessionRoomKeyOf("아라키초A 401"));
  });
  it("이름표 없는 새 건물은 카탈로그로 배정 키를 만든다", () => {
    const catalog = [{ propertyName: "새건물", canonicalRoomLabel: "101" }];
    expect(sessionRoomKeyOf("새건물 101", catalog)).toBe(physicalKeyOf("새건물", "101").roomKey);
  });
  it("카탈로그에도 없으면 라벨 그대로(DB 도 같은 대체)", () => {
    expect(sessionRoomKeyOf("모르는곳 9")).toBe("모르는곳 9");
  });
});

describe("storedSessionRoomKey", () => {
  it("저장된 room_key 가 있으면 그것", () => {
    expect(storedSessionRoomKey({ room_key: "새건물_101", room_label: "새건물 101" })).toBe("새건물_101");
  });
  it("예전 기록(room_key 없음)은 라벨에서", () => {
    expect(storedSessionRoomKey({ room_key: null, room_label: "아라키초A 201" })).toBe(sessionRoomKeyOf("아라키초A 201"));
  });
});

describe("canRecordInRoom — 배정된 사람은 자기 자리, 배정 안 된 사람은 빈 방만", () => {
  it("배정된 사람은 같이 하는 사람이 먼저 시작 · 끝내도 자기 기록을 넣는다", () => {
    expect(canRecordInRoom({ assigned: true, hasOwnRecord: false, othersWithRecord: 1 })).toBe(true);
  });
  it("배정 안 된 사람이 먼저 해도 배정된 사람 자리는 남는다", () => {
    expect(canRecordInRoom({ assigned: true, hasOwnRecord: false, othersWithRecord: 2 })).toBe(true);
  });
  it("배정 안 된 사람은 아무도 안 한 방만(배정 없는 방은 한 사람)", () => {
    expect(canRecordInRoom({ assigned: false, hasOwnRecord: false, othersWithRecord: 0 })).toBe(true);
    expect(canRecordInRoom({ assigned: false, hasOwnRecord: false, othersWithRecord: 1 })).toBe(false);
  });
  it("같은 사람은 한 방에 기록 하나", () => {
    expect(canRecordInRoom({ assigned: true, hasOwnRecord: true, othersWithRecord: 0 })).toBe(false);
  });
});

const rec = (staffId: string, status: string, closed = false) => ({ staffId, status, closed });

describe("roomRecordDecision — 서버 판정 하나(시작 · 강제 완료 · DB 트리거)", () => {
  it("처리 끝 방은 누구든 resolved", () => {
    expect(roomRecordDecision([rec("admin", "completed", true)], "b", true)).toBe("resolved");
  });
  it("내 기록이 있으면 own", () => {
    expect(roomRecordDecision([rec("b", "in_progress")], "b", true)).toBe("own");
  });
  it("배정된 사람은 남이 먼저 해도 ok, 배정 안 된 사람은 taken", () => {
    expect(roomRecordDecision([rec("a", "completed")], "b", true)).toBe("ok");
    expect(roomRecordDecision([rec("a", "completed")], "c", false)).toBe("taken");
  });
  it("취소된 기록은 세지 않는다", () => {
    expect(roomRecordDecision([rec("a", "cancelled")], "c", false)).toBe("ok");
  });
});

describe("shouldOfferStart — 화면 규칙 하나(오늘 내 방 · 청소 화면)", () => {
  const assignees = new Set(["a", "b"]);
  it("같이 배정된 사람 기록만 있으면 내 몫을 내민다", () => {
    expect(shouldOfferStart([rec("a", "completed")], "b", assignees)).toBe(true);
  });
  it("배정 안 된 사람이 해 둔 방은 내밀지 않는다(이미 치운 방)", () => {
    expect(shouldOfferStart([rec("c", "completed")], "b", assignees)).toBe(false);
  });
  it("처리 끝 방 · 내 기록 있는 방은 내밀지 않는다", () => {
    expect(shouldOfferStart([rec("admin", "completed", true)], "b", assignees)).toBe(false);
    expect(shouldOfferStart([rec("b", "completed")], "b", assignees)).toBe(false);
  });
  it("배정 안 된 사람은 빈 방만", () => {
    expect(shouldOfferStart([], "c", assignees)).toBe(true);
    expect(shouldOfferStart([rec("a", "in_progress")], "c", assignees)).toBe(false);
  });
});

describe("roomShareState — 방 기준 상태(「1/2 끝남」)", () => {
  it("2인 방 한 사람만 끝내면 progress + partial 1/2", () => {
    expect(roomShareState([rec("a", "completed")], ["a", "b"])).toEqual({ status: "progress", done: 1, need: 2, partial: true });
  });
  it("둘 다 끝내야 done", () => {
    expect(roomShareState([rec("a", "completed"), rec("b", "completed")], ["a", "b"]).status).toBe("done");
  });
  it("누가 청소 중이면 partial 이 아닌 progress", () => {
    expect(roomShareState([rec("a", "completed"), rec("b", "in_progress")], ["a", "b"])).toMatchObject({ status: "progress", partial: false });
  });
  it("배정 없는 방 · 1인 방은 한 사람이 끝내면 done", () => {
    expect(roomShareState([rec("c", "completed")], []).status).toBe("done");
    expect(roomShareState([rec("c", "completed")], ["b"]).status).toBe("done");
  });
  it("배정 안 된 사람이 끝낸 것도 센다(그 방을 치웠다)", () => {
    expect(roomShareState([rec("a", "completed"), rec("c", "completed")], ["a", "b"]).status).toBe("done");
  });
  it("같은 사람이 두 번 끝낸 기록은 한 사람", () => {
    expect(roomShareState([rec("a", "completed"), rec("a", "completed")], ["a", "b"])).toMatchObject({ done: 1, partial: true });
  });
  it("기록 없음 · 처리 끝 · 취소만은 pending", () => {
    expect(roomShareState([], ["a"]).status).toBe("pending");
    expect(roomShareState([rec("admin", "completed", true), rec("a", "cancelled")], ["a"]).status).toBe("pending");
  });
});

describe("roomWriteErrorKind — DB 가 막은 이유(시작 · 강제 완료 공용)", () => {
  it("처리 끝 · 자리 없음 · 한 사람 한 방 · 진행 중 하나 · 그 밖", () => {
    expect(roomWriteErrorKind({ message: "cleaning_room_full", details: "resolved" })).toBe("resolved");
    expect(roomWriteErrorKind({ message: "cleaning_room_full", details: "taken" })).toBe("taken");
    expect(roomWriteErrorKind({ message: 'duplicate key value violates unique constraint "cleaning_sessions_one_per_user_room_day_idx"' })).toBe("taken");
    expect(roomWriteErrorKind({ message: 'duplicate key value violates unique constraint "cleaning_sessions_one_active_per_org_user_idx"' })).toBe("active");
    expect(roomWriteErrorKind({ message: 'duplicate key value violates unique constraint "other_idx"' })).toBeNull();
  });
});

describe("sessionRoomKeyLookup — sessionRoomKeyOf 와 같은 결과", () => {
  it("새 건물 · 규칙 건물 · 모르는 라벨", () => {
    const catalog = [{ propertyName: "새건물", canonicalRoomLabel: "101" }];
    const lookup = sessionRoomKeyLookup(catalog);
    for (const label of ["새건물 101", "아라키초A 401_2_2", "모르는곳 9"]) expect(lookup(label)).toBe(sessionRoomKeyOf(label, catalog));
  });
});

describe("sameRoomRecords — 같은 방 묶기(DB 트리거와 같음)", () => {
  const rows = [
    { room_key: null, room_label: "아라키초A 401_2_2", staff_user_id: "a", status: "completed", closed_without_cleaning: false },
    { room_key: null, room_label: "아라키초A 501", staff_user_id: "b", status: "completed", closed_without_cleaning: false },
  ];
  it("쉬는 계정 라벨도 같은 방, 다른 방은 뺀다", () => {
    expect(sameRoomRecords(rows, "아라키초A 401", sessionRoomKeyOf("아라키초A 401")).map((row) => row.staffId)).toEqual(["a"]);
  });
});
