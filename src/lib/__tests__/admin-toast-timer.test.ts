import { describe, expect, it } from "vitest";
import { ADMIN_TOAST_ERROR_MS, adminToastTimerRuns } from "@/components/admin/shared/admin-toast";

// 2차 점검 2 · 9 — 오류 토스트는 읽을 만큼 오래, 멈춤(마우스 · 초점)은 그 토스트에만 걸린다.
describe("adminToastTimerRuns — 멈춤은 그 토스트에만", () => {
  const toast = { id: 2, sticky: false };
  it("runs for a new toast even when the previous toast was hovered", () => {
    expect(adminToastTimerRuns(toast, 1)).toBe(true);
  });
  it("pauses the toast under the pointer", () => {
    expect(adminToastTimerRuns(toast, 2)).toBe(false);
  });
  it("never runs for a sticky toast or no toast", () => {
    expect(adminToastTimerRuns({ id: 3, sticky: true }, null)).toBe(false);
    expect(adminToastTimerRuns(null, null)).toBe(false);
  });
  it("keeps error toasts up long enough to read", () => {
    expect(ADMIN_TOAST_ERROR_MS).toBeGreaterThanOrEqual(4000);
  });
});
