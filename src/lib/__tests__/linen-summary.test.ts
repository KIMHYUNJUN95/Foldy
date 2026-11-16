import { describe, expect, it } from "vitest";
import { linenPhotoCount, summarizeLinenLines } from "@/lib/linen-summary";

describe("summarizeLinenLines", () => {
  it("품목이 없으면 대시", () => expect(summarizeLinenLines([], "외", "종")).toBe("—"));
  it("하나면 이름만", () => expect(summarizeLinenLines([{ name: "수건" }], "외", "종")).toBe("수건"));
  it("여럿이면 첫 품목 외 N종", () => {
    expect(summarizeLinenLines([{ name: "수건" }, { name: "시트" }, { name: "가운" }], "외", "종")).toBe("수건 외 2종");
    expect(summarizeLinenLines([{ name: "Towel" }, { name: "Robe" }], "+", " more")).toBe("Towel + 1 more");
  });
});

describe("linenPhotoCount", () => {
  const en = { wPhotoN: "{n} photos", wPhotoOne: "1 photo" };
  it("0장이면 빈 문자열", () => expect(linenPhotoCount(0, en)).toBe(""));
  it("1장은 단수", () => expect(linenPhotoCount(1, en)).toBe("1 photo"));
  it("여러 장은 복수", () => expect(linenPhotoCount(3, en)).toBe("3 photos"));
});
