import { describe, expect, it } from "vitest";
import { distinctRoom, lostDueLine } from "@/lib/lost-found-constants";

const c = { dueOn: "D-{n}", dOver: "{n}일 경과" };

describe("분실물 자동 폐기 표시", () => {
  it("남은 날과 날짜를 한 줄에", () => {
    expect(lostDueLine(14, "2026-11-30", "ko", c)).toBe("D-14 · 11월 30일");
    expect(lostDueLine(14, "2026-11-30", "en", c)).toBe("D-14 · Nov 30");
  });
  it("지난 건은 경과 일수", () => {
    expect(lostDueLine(-2, "2026-11-14", "ko", c)).toBe("2일 경과 · 11월 14일");
  });
});

describe("한 채짜리 건물 이름 중복", () => {
  it("방 이름이 건물 이름과 같으면 방을 뺀다", () => {
    expect(distinctRoom("오쿠보A", "오쿠보A")).toBeNull();
    expect(distinctRoom("201", "오쿠보A")).toBe("201");
    expect(distinctRoom("-", "오쿠보A")).toBeNull();
    expect(distinctRoom(null, "오쿠보A")).toBeNull();
  });
});
