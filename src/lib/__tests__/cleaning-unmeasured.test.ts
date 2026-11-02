import { describe, expect, it } from "vitest";
import { isUnmeasuredSession } from "@/lib/cleaning-unmeasured";

const base = {
  status: "completed",
  started_at: "2026-11-01T05:00:00+00:00",
  completed_at: "2026-11-01T05:00:00+00:00",
  duration_seconds: 0,
  closed_without_cleaning: false,
};

describe("isUnmeasuredSession — 다음 날 「청소했어요」로 닫은 기록", () => {
  it("완료 · 0초 · 끝 = 시작이면 시각 모름", () => {
    expect(isUnmeasuredSession(base)).toBe(true);
  });
  it("같은 순간을 다른 표기로 저장해도 같은 시각으로 본다", () => {
    expect(isUnmeasuredSession({ ...base, completed_at: "2026-11-01T14:00:00+09:00" })).toBe(true);
  });
  it("1초 안에 끝낸 정상 기록(끝 ≠ 시작)은 아니다 — 강제 완료로 덮어쓰지 않게", () => {
    expect(isUnmeasuredSession({ ...base, completed_at: "2026-11-01T05:00:00.400+00:00" })).toBe(false);
  });
  it("처리 끝 · 취소 · 진행 중 · 소요가 있는 기록은 아니다", () => {
    expect(isUnmeasuredSession({ ...base, closed_without_cleaning: true })).toBe(false);
    expect(isUnmeasuredSession({ ...base, status: "cancelled" })).toBe(false);
    expect(isUnmeasuredSession({ ...base, status: "in_progress", completed_at: null, duration_seconds: null })).toBe(false);
    expect(isUnmeasuredSession({ ...base, duration_seconds: 60 })).toBe(false);
  });
});
