import { describe, expect, it, vi } from "vitest";

// tasks.ts 가 끌어오는 서버 전용 모듈 — 여기서는 순수 날짜/시각 검사만 쓴다.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

import { isValidHm, isValidYmd, normalizeTaskDateTime, taskTimeWithoutDate } from "../tasks";

describe("업무 날짜 · 시각 검사 (2026-10-28)", () => {
  it("달력에 없는 날짜는 거른다", () => {
    expect(isValidYmd("2026-02-28")).toBe(true);
    expect(isValidYmd("2028-02-29")).toBe(true);
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2026-02-31")).toBe(false);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("2026-00-10")).toBe(false);
    expect(isValidYmd("2026-8-1")).toBe(false);
  });

  it("범위 밖 시각은 거른다", () => {
    expect(isValidHm("00:00")).toBe(true);
    expect(isValidHm("23:59")).toBe(true);
    expect(isValidHm("24:00")).toBe(false);
    expect(isValidHm("25:99")).toBe(false);
    expect(isValidHm("12:60")).toBe(false);
  });

  it("25:99 를 넣어도 던지지 않고 시각 없음으로 저장한다", () => {
    expect(() =>
      normalizeTaskDateTime({ scheduledDate: "", dueDate: "2026-10-28", time: "25:99" }),
    ).not.toThrow();
    expect(normalizeTaskDateTime({ scheduledDate: "", dueDate: "2026-10-28", time: "25:99" })).toEqual({
      scheduledDate: null,
      dueAt: "2026-10-27T15:00:00.000Z",
      allDay: true,
      timeLabel: null,
    });
  });

  it("2026-02-31 은 3/3 으로 굴리지 않고 날짜 없음으로 본다", () => {
    expect(normalizeTaskDateTime({ scheduledDate: "", dueDate: "2026-02-31", time: "" }).dueAt).toBeNull();
  });

  it("정상 입력은 그대로", () => {
    expect(normalizeTaskDateTime({ scheduledDate: "", dueDate: "2026-10-28", time: "09:30" })).toEqual({
      scheduledDate: null,
      dueAt: "2026-10-28T00:30:00.000Z",
      allDay: false,
      timeLabel: "09:30",
    });
    expect(taskTimeWithoutDate({ scheduledDate: "", dueDate: "", time: "09:30" })).toBe(true);
  });
});
