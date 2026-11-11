import { describe, expect, it } from "vitest";
import { resolveAttendancePreviewState } from "@/lib/attendance-preview-state";

// 근태 홈 `?state=` 가짜 미리보기(2026-11-11) — 운영에서는 무시한다. 운영 직원이 주소만 바꿔 「근무 중」 가짜 화면을 볼 수 없게.
describe("resolveAttendancePreviewState", () => {
  it("개발 환경에서만 받는다", () => {
    expect(resolveAttendancePreviewState("open", "development")).toBe("open");
    expect(resolveAttendancePreviewState("break", "test")).toBe("break");
    expect(resolveAttendancePreviewState("open", "production")).toBeNull();
  });
  it("모르는 값은 무시", () => {
    expect(resolveAttendancePreviewState("weird", "development")).toBeNull();
    expect(resolveAttendancePreviewState(undefined, "development")).toBeNull();
  });
});
