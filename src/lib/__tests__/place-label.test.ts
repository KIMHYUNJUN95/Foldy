import { describe, expect, it } from "vitest";
import { distinctRoom, placeLine } from "@/lib/place-label";

describe("위치 줄", () => {
  it("방이 건물과 같으면 건물만", () => {
    expect(placeLine("오쿠보A", "오쿠보A", "건물 전체")).toBe("오쿠보A");
  });
  it("방이 있으면 건물 · 방", () => {
    expect(placeLine("오쿠보A", "201", "건물 전체")).toBe("오쿠보A · 201");
  });
  it("방이 비었거나 - 이면 건물 전체", () => {
    expect(placeLine("오쿠보A", null, "건물 전체")).toBe("오쿠보A · 건물 전체");
    expect(placeLine("오쿠보A", "-", "건물 전체")).toBe("오쿠보A · 건물 전체");
    expect(placeLine("오쿠보A", "  ", "건물 전체")).toBe("오쿠보A · 건물 전체");
  });
  it("distinctRoom 은 공백 · - 를 null 로", () => {
    expect(distinctRoom(" - ", "x")).toBeNull();
  });
});
