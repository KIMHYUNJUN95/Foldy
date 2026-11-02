import { describe, expect, it } from "vitest";
import { pickForceCompleteTarget, resolveForceCompleteDate } from "@/lib/cleaning";
import { sessionRoomKeyOf } from "@/lib/cleaning-assign/room-key";

// 강제 완료는 콘솔이 보고 있던 운영일로 저장된다 — 과거 화면에서 누른 완료가 오늘로 저장되면
// 오늘 청소 큐에서 같은 방이 「완료」로 빠진다(2026-10-19).
describe("resolveForceCompleteDate", () => {
  const today = "2026-10-19";

  it("keeps today and past operating dates", () => {
    expect(resolveForceCompleteDate("2026-10-19", today)).toBe("2026-10-19");
    expect(resolveForceCompleteDate("2026-10-12", today)).toBe("2026-10-12");
  });

  it("rejects future dates", () => {
    expect(resolveForceCompleteDate("2026-10-20", today)).toBeNull();
  });

  it("rejects malformed or impossible dates", () => {
    expect(resolveForceCompleteDate("", today)).toBeNull();
    expect(resolveForceCompleteDate("2026-10-1", today)).toBeNull();
    expect(resolveForceCompleteDate("2026-02-30", today)).toBeNull();
    expect(resolveForceCompleteDate("2026-10-19T00:00", today)).toBeNull();
  });
});

// 세션 id 없이 들어온 강제 완료 — 같은 날 같은 실제 방에 기록이 있으면 새로 넣지도, 남의 기록을 가로채지도 않는다(2026-11-02 점검 수정).
describe("pickForceCompleteTarget", () => {
  const label = "아라키초A 401";
  const key = sessionRoomKeyOf(label);
  const row = (room_label: string, status: string, staff_user_id = "a", closed_without_cleaning = false) => ({ room_key: null, room_label, status, staff_user_id, closed_without_cleaning });

  it("inserts when the room has no record that day", () => {
    expect(pickForceCompleteTarget([row("아라키초A 402", "completed")], label, key, "b", false)).toBe("insert");
  });

  it("blocks when the room is already completed — even under the other account label", () => {
    expect(pickForceCompleteTarget([row("아라키초A 401_2_2", "completed")], label, key, "b", false)).toBe("processed");
  });

  it("blocks instead of taking over someone's in-progress record", () => {
    expect(pickForceCompleteTarget([row(label, "in_progress")], label, key, "b", false)).toBe("processed");
  });

  it("ignores cancelled records", () => {
    expect(pickForceCompleteTarget([row(label, "cancelled")], label, key, "b", false)).toBe("insert");
  });

  // 2인 방(2026-11-02 점검 C1) — 각자 기록.
  it("lets an assigned partner get their own record when the other already finished", () => {
    expect(pickForceCompleteTarget([row(label, "completed", "a")], label, key, "b", true)).toBe("insert");
  });

  it("never gives the same person a second record in the same room", () => {
    expect(pickForceCompleteTarget([row(label, "completed", "a")], label, key, "a", true)).toBe("processed");
  });

  it("an unassigned person cannot take an assigned person's place; resolved rooms are closed", () => {
    expect(pickForceCompleteTarget([row(label, "completed", "a")], label, key, "c", false)).toBe("processed");
    expect(pickForceCompleteTarget([row(label, "completed", "admin", true)], label, key, "b", true)).toBe("processed");
  });

  it("matches by stored room_key too (new building without label rules)", () => {
    expect(pickForceCompleteTarget([{ ...row("새건물 101", "completed"), room_key: "새건물_101" }], "새건물 101", "새건물_101", "b", false)).toBe("processed");
  });
});
