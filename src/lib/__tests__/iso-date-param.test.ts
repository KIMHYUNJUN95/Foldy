import { describe, expect, it } from "vitest";
import { resolveDateRangeParams } from "@/lib/iso-date-param";

const fallback = { from: "2026-08-12", to: "2026-11-10" };

describe("resolveDateRangeParams", () => {
  it("실제 날짜면 그대로 쓴다", () => {
    expect(resolveDateRangeParams("2026-09-01", "2026-09-30", fallback)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("없는 날짜(2월 30일 · 13월)는 기본값으로 돌린다", () => {
    expect(resolveDateRangeParams("2026-02-30", "2026-13-01", fallback)).toEqual(fallback);
  });
  it("형식이 틀리면 기본값", () => {
    expect(resolveDateRangeParams("abc", undefined, fallback)).toEqual(fallback);
  });
  it("한쪽만 틀리면 그쪽만 기본값", () => {
    expect(resolveDateRangeParams("2026-09-01", "zzz", fallback)).toEqual({ from: "2026-09-01", to: "2026-11-10" });
  });
  it("시작이 끝보다 늦으면 둘 다 기본값", () => {
    expect(resolveDateRangeParams("2026-10-01", "2026-09-01", fallback)).toEqual(fallback);
  });
});
