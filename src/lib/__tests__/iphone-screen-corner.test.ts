import { describe, expect, it } from "vitest";
import { iphoneScreenCorner } from "@/lib/swipe-back/history-model";

describe("iphoneScreenCorner", () => {
  it("기종별 값 — 세로 · 가로 어느 쪽이든", () => {
    expect(iphoneScreenCorner(390, 844, 3)).toBe(47.33);
    expect(iphoneScreenCorner(844, 390, 3)).toBe(47.33);
    expect(iphoneScreenCorner(393, 852, 3)).toBe(55);
    expect(iphoneScreenCorner(402, 874, 3)).toBe(62);
    expect(iphoneScreenCorner(440, 956, 3)).toBe(62);
  });
  it("같은 크기는 배율로 가린다 — XR · 11(@2x) 와 XS Max · 11 Pro Max(@3x)", () => {
    expect(iphoneScreenCorner(414, 896, 2)).toBe(41.5);
    expect(iphoneScreenCorner(414, 896, 3)).toBe(39);
  });
  it("홈 버튼 기종은 각진 모서리(0)", () => {
    expect(iphoneScreenCorner(375, 667, 2)).toBe(0);
    expect(iphoneScreenCorner(414, 736, 3)).toBe(0);
  });
  it("모르는 크기는 null", () => {
    expect(iphoneScreenCorner(500, 1000, 3)).toBeNull();
  });
});
