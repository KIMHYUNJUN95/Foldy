import { describe, expect, it } from "vitest";
import { capReopenDate, checksLeft, placeholdersLeft, segmentDraft } from "@/components/guest-messages/ai-assist-model";

describe("segmentDraft", () => {
  it("marks the first exact occurrence of each check and every placeholder", () => {
    const text = "Use [code] at 11am. Again [code].";
    expect(segmentDraft(text, ["11am"], ["[code]"])).toEqual([
      { text: "Use ", kind: "plain" },
      { text: "[code]", kind: "slot" },
      { text: " at ", kind: "plain" },
      { text: "11am", kind: "check" },
      { text: ". Again ", kind: "plain" },
      { text: "[code]", kind: "slot" },
      { text: ".", kind: "plain" },
    ]);
  });

  it("drops marks whose text was edited away and keeps the text intact", () => {
    const text = "Hello, from 10am.";
    const segments = segmentDraft(text, ["11am", ""], ["[code]"]);
    expect(segments).toEqual([{ text, kind: "plain" }]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
  });

  it("skips an overlapping mark instead of splitting text twice", () => {
    const text = "Door [code] here";
    const segments = segmentDraft(text, ["[code] here"], ["[code]"]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.filter((s) => s.kind !== "plain")).toEqual([{ text: "[code]", kind: "slot" }]);
  });
});

describe("placeholdersLeft · checksLeft", () => {
  it("only counts what is still in the text", () => {
    expect(placeholdersLeft("a [code] b", ["[code]", "[wifi]"])).toEqual(["[code]"]);
    expect(placeholdersLeft("a 1234 b", ["[code]"])).toEqual([]);
    expect(checksLeft("from 11am", [{ text: "11am" }, { text: "1st floor" }])).toBe(1);
  });
});

describe("capReopenDate", () => {
  it("rolls to the first of next month, December to January", () => {
    expect(capReopenDate("2026-11-18")).toEqual({ year: 2026, month: 12 });
    expect(capReopenDate("2026-12-31")).toEqual({ year: 2027, month: 1 });
  });
});
