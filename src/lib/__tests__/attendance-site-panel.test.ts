import { describe, expect, it } from "vitest";
import { coordsLine, distinctPrintName, radiusPreset } from "@/lib/attendance-site-panel";

describe("distinctPrintName", () => {
  it("비었거나 현장 이름과 같으면 숨긴다", () => {
    expect(distinctPrintName("Demo House", "")).toBeNull();
    expect(distinctPrintName("Demo House", null)).toBeNull();
    expect(distinctPrintName("Demo House", "  Demo House ")).toBeNull();
  });
  it("다르면 다듬어서 돌려준다", () => {
    expect(distinctPrintName("아라키초A", " Arakicho A ")).toBe("Arakicho A");
  });
});

describe("coordsLine", () => {
  it("좌표를 한 줄로", () => {
    expect(coordsLine("35.6938", " 139.7034")).toBe("35.6938, 139.7034");
  });
  it("비었거나 범위 밖이면 null", () => {
    expect(coordsLine("", "139.7")).toBeNull();
    expect(coordsLine("95", "139.7")).toBeNull();
    expect(coordsLine("35.6", "abc")).toBeNull();
  });
});

describe("radiusPreset", () => {
  it("바로 고르기 값만 맞춘다", () => {
    expect(radiusPreset("150")).toBe(150);
    expect(radiusPreset(" 50 ")).toBe(50);
    expect(radiusPreset("80")).toBeNull();
    expect(radiusPreset("")).toBeNull();
  });
});
