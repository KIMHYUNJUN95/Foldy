import { describe, expect, it } from "vitest";

import { ARRIVED_TODAY, LEAVING_JAPAN, routeChoiceOf, routeValueOf } from "../guest/route";

describe("전 숙박지 · 다음 행선지 값", () => {
  it("고른 것 → 명부 값", () => {
    expect(routeValueOf("prev", { kind: "border" })).toBe(ARRIVED_TODAY);
    expect(routeValueOf("next", { kind: "border" })).toBe(LEAVING_JAPAN);
    expect(routeValueOf("prev", { kind: "city", city: "osaka" })).toBe("大阪");
    expect(routeValueOf("next", { kind: "other", text: "  Sapporo   city " })).toBe("Sapporo city");
    expect(routeValueOf("next", { kind: "other", text: "   " })).toBeNull();
    expect(routeValueOf("prev", { kind: "other", text: "x".repeat(80) })).toHaveLength(60);
  });

  it("명부 값 → 고른 것(왕복)", () => {
    expect(routeChoiceOf("prev", ARRIVED_TODAY)).toEqual({ kind: "border" });
    expect(routeChoiceOf("next", LEAVING_JAPAN)).toEqual({ kind: "border" });
    // 방향이 다르면 국경 값도 직접 쓴 글로 본다.
    expect(routeChoiceOf("next", ARRIVED_TODAY)).toEqual({ kind: "other", text: ARRIVED_TODAY });
    expect(routeChoiceOf("prev", "京都")).toEqual({ kind: "city", city: "kyoto" });
    expect(routeChoiceOf("prev", "Taipei home")).toEqual({ kind: "other", text: "Taipei home" });
    expect(routeChoiceOf("prev", null)).toBeNull();
    expect(routeChoiceOf("prev", " ")).toBeNull();
  });
});
