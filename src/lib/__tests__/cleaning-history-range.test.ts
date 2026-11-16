import { describe, expect, it } from "vitest";
import { resolveHistoryRange } from "@/lib/cleaning-history-range";

describe("resolveHistoryRange", () => {
  const today = "2026-11-16";
  const def = { from: "2026-11-01", to: "2026-11-16" };
  it("기본은 이번 달 1일 – 오늘", () => expect(resolveHistoryRange(today)).toEqual(def));
  it("링크 기간은 그대로", () =>
    expect(resolveHistoryRange(today, "2026-10-01", "2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" }));
  it("한쪽만 · 거꾸로 · 없는 날짜 · 형식 오류는 기본", () => {
    expect(resolveHistoryRange(today, "2026-10-01")).toEqual(def);
    expect(resolveHistoryRange(today, "2026-10-31", "2026-10-01")).toEqual(def);
    expect(resolveHistoryRange(today, "2026-02-30", "2026-03-01")).toEqual(def);
    expect(resolveHistoryRange(today, "abc", "def")).toEqual(def);
  });
});
