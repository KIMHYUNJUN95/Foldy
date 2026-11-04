import { describe, expect, it } from "vitest";
import { countDistinctRooms, dashboardRoomCleanState, isCleanedRecord, isClosedRecord } from "@/lib/cleaning-record-rules";

// 기준표 docs/product/45-cleaning-rules-table.md 표 3 — 「청소한 기록」 = 완료이고 처리 끝이 아닌 기록.
const row = (status: string, closed = false) => ({ status, closed_without_cleaning: closed });

describe("C1 근태 청소 객실 · C2 교통비 후보 · C3 활동 피드 — 청소한 기록 판정", () => {
  it("완료 + 처리 끝 아님만 청소한 기록", () => {
    expect(isCleanedRecord(row("completed"))).toBe(true);
  });
  it("C1 취소는 청소한 기록이 아니다", () => {
    expect(isCleanedRecord(row("cancelled"))).toBe(false);
  });
  it("C2 진행 중은 청소한 기록이 아니다", () => {
    expect(isCleanedRecord(row("in_progress"))).toBe(false);
  });
  it("C3 처리 끝은 청소한 기록이 아니다", () => {
    expect(isCleanedRecord(row("completed", true))).toBe(false);
    expect(isClosedRecord(row("completed", true))).toBe(true);
    expect(isClosedRecord({ closed_without_cleaning: null })).toBe(false);
  });
});

describe("C6 배지 · 대시보드 숫자 — 방 수로 센다", () => {
  it("같은 방 두 사람 기록은 방 1개", () => {
    const a = { room_key: "아라키초A|402", room_label: "아라키초A 402" };
    const b = { room_key: "아라키초A|402", room_label: "아라키초A 402" };
    const c = { room_key: null, room_label: "오쿠보A" };
    expect(countDistinctRooms([a, b, c])).toBe(2);
  });
});

describe("C7 건물 지도 — 방 상태", () => {
  const rec = (staffId: string, status: string, closed = false) => ({ staffId, status, closed });
  it("2인 방에서 한 명만 끝내면 안 끝난 방", () => {
    expect(dashboardRoomCleanState([rec("a", "completed")], ["a", "b"])).toBe("cleaning");
  });
  it("두 명 모두 끝내면 끝남", () => {
    expect(dashboardRoomCleanState([rec("a", "completed"), rec("b", "completed")], ["a", "b"])).toBe("done");
  });
  it("처리 끝은 끝남", () => {
    expect(dashboardRoomCleanState([rec("a", "completed", true)], ["a", "b"])).toBe("done");
  });
  it("청소 중이면 안 끝난 방", () => {
    expect(dashboardRoomCleanState([rec("a", "in_progress")], ["a"])).toBe("cleaning");
  });
  it("C7 배정을 못 읽었으면 한 명 끝낸 방을 끝남으로 단정하지 않는다(읽기 실패 ≠ 배정 없음)", () => {
    expect(dashboardRoomCleanState([rec("a", "completed")], [], false)).toBe("cleaning");
    expect(dashboardRoomCleanState([rec("a", "completed", true)], [], false)).toBe("done");
  });
  it("배정 없는 방은 한 명이 끝내면 끝남", () => {
    expect(dashboardRoomCleanState([rec("a", "completed")], [])).toBe("done");
  });
});
