import { afterEach, describe, expect, it, vi } from "vitest";
import { tokyoToday } from "@/lib/tokyo-date";

describe("tokyoToday", () => {
  afterEach(() => vi.useRealTimers());
  it("UTC 15시 이후는 도쿄 기준 다음 날", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T16:30:00Z"));
    expect(tokyoToday()).toBe("2026-11-10");
  });
});
