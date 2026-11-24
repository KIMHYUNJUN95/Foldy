import { describe, expect, it } from "vitest";
import { canDismissConfirmSheet } from "@/lib/confirm-sheet-dismiss";

describe("확인 시트 닫기 판정", () => {
  it("한가할 때만 닫을 수 있다", () => {
    expect(canDismissConfirmSheet({ running: false, pending: false })).toBe(true);
  });
  it("사진 올리는 중에는 닫을 수 없다", () => {
    expect(canDismissConfirmSheet({ running: true, pending: false })).toBe(false);
  });
  it("저장 요청이 가는 중에는 닫을 수 없다(사진을 지우면 안 됨)", () => {
    expect(canDismissConfirmSheet({ running: false, pending: true })).toBe(false);
    expect(canDismissConfirmSheet({ running: true, pending: true })).toBe(false);
  });
});
