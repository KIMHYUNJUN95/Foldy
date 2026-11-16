import { describe, expect, it } from "vitest";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { boardLateParts, boardLateText } from "@/lib/cleaning-board-late";

describe("boardLateText", () => {
  it("ko — 1시간 미만은 N분 지남, 이상은 시작 예정 N시간 M분 지남", () => {
    const c = getCleaningAssignCopy("ko");
    expect(boardLateText(45, "ko", c)).toBe("45분 지남");
    expect(boardLateText(60, "ko", c)).toBe("시작 예정 1시간 지남");
    expect(boardLateText(493, "ko", c)).toBe("시작 예정 8시간 13분 지남");
    expect(boardLateText(493, "ko", c, "tag")).toBe("8시간 13분 늦음");
  });
  it("ja · en", () => {
    expect(boardLateText(30, "ja", getCleaningAssignCopy("ja"))).toBe("30分経過");
    expect(boardLateText(75, "ja", getCleaningAssignCopy("ja"))).toBe("開始予定から1時間15分経過");
    expect(boardLateText(30, "en", getCleaningAssignCopy("en"))).toBe("30m past start time");
    expect(boardLateText(75, "en", getCleaningAssignCopy("en"))).toBe("Due to start 1h 15m ago");
    expect(boardLateText(75, "en", getCleaningAssignCopy("en"), "tag")).toBe("1h 15m late");
  });
  it("parts — 시간 덩어리를 따로 돌려준다(화면이 nowrap 으로 감싼다)", () => {
    expect(boardLateParts(493, "ja", getCleaningAssignCopy("ja"))).toEqual({ after: "経過", before: "開始予定から", t: "8時間13分" });
    expect(boardLateParts(30, "en", getCleaningAssignCopy("en"))).toEqual({ after: " past start time", before: "", t: "30m" });
  });
});
