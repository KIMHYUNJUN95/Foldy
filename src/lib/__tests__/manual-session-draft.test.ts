import { describe, expect, it } from "vitest";
import { isManualDraftDirty, pickerPopoverOpen } from "@/components/admin/attendance/manual-session-draft";

// 근무 수기 입력 창(2026-11-11) — 친 내용이 있으면 Esc · 바깥 눌러 닫기 전에 묻는다.
describe("isManualDraftDirty", () => {
  const empty = { userId: "", date: "2026-11-11", clockIn: "", clockOut: "", location: "", reason: "" };
  it("처음 그대로면 묻지 않는다", () => {
    expect(isManualDraftDirty(empty, "2026-11-11")).toBe(false);
  });
  it("무엇이든 바꿨으면 묻는다(날짜 포함, 공백만은 빈 것)", () => {
    expect(isManualDraftDirty({ ...empty, reason: "누락" }, "2026-11-11")).toBe(true);
    expect(isManualDraftDirty({ ...empty, date: "2026-11-10" }, "2026-11-11")).toBe(true);
    expect(isManualDraftDirty({ ...empty, userId: "u" }, "2026-11-11")).toBe(true);
    expect(isManualDraftDirty({ ...empty, location: "   " }, "2026-11-11")).toBe(false);
  });
});

describe("pickerPopoverOpen — Esc 는 열린 날짜 · 시각 고르기 창이 먼저 쓴다", () => {
  const root = (open: string[]) => ({ querySelector: (sel: string) => (sel.split(",").some((s) => open.includes(s.trim())) ? {} : null) });
  it("날짜 · 시각 창이 열려 있으면 true", () => {
    expect(pickerPopoverOpen(root([".adp__pop"]))).toBe(true);
    expect(pickerPopoverOpen(root([".atp__pop"]))).toBe(true);
  });
  it("아무 창도 없으면 false", () => {
    expect(pickerPopoverOpen(root([]))).toBe(false);
    expect(pickerPopoverOpen(null)).toBe(false);
  });
});
