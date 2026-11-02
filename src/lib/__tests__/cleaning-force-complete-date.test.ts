import { describe, expect, it } from "vitest";
import { pickForceCompleteTarget, resolveForceCompleteDate } from "@/lib/cleaning";

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
  // 실제 방 키 흉내: 「아라키초A 401_2_2」 → 「아라키초A 401」.
  const physical = (label: string) => label.replace(/_\d+_\d+$/, "");

  it("inserts when the room has no record that day", () => {
    expect(pickForceCompleteTarget([{ room_label: "아라키초A 402", status: "completed" }], "아라키초A 401", physical)).toBe("insert");
  });

  it("blocks when the room is already completed — even under the other account label", () => {
    expect(pickForceCompleteTarget([{ room_label: "아라키초A 401_2_2", status: "completed" }], "아라키초A 401", physical)).toBe("processed");
  });

  it("blocks instead of taking over someone's in-progress record", () => {
    expect(pickForceCompleteTarget([{ room_label: "아라키초A 401", status: "in_progress" }], "아라키초A 401", physical)).toBe("processed");
  });

  it("ignores cancelled records", () => {
    expect(pickForceCompleteTarget([{ room_label: "아라키초A 401", status: "cancelled" }], "아라키초A 401", physical)).toBe("insert");
  });
});
