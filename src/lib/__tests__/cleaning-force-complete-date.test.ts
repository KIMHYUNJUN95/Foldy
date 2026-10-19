import { describe, expect, it } from "vitest";
import { resolveForceCompleteDate } from "@/lib/cleaning";

// 강제 완료는 콘솔이 보고 있던 운영일로 저장된다 — 과거 화면에서 누른 완료가 오늘로 저장되면
// 오늘 청소 큐에서 같은 방이 「완료」로 빠진다(2026-10-19).
describe("resolveForceCompleteDate", () => {
  const today = "2026-10-19";

  it("keeps today and past operating dates", () => {
    expect(resolveForceCompleteDate("2026-10-19", today)).toBe("2026-10-19");
    expect(resolveForceCompleteDate("2026-10-12", today)).toBe("2026-10-12");
  });

  it("rejects future dates", () => {
    expect(resolveForceCompleteDate("2026-10-20", today)).toBeNull();
  });

  it("rejects malformed or impossible dates", () => {
    expect(resolveForceCompleteDate("", today)).toBeNull();
    expect(resolveForceCompleteDate("2026-10-1", today)).toBeNull();
    expect(resolveForceCompleteDate("2026-02-30", today)).toBeNull();
    expect(resolveForceCompleteDate("2026-10-19T00:00", today)).toBeNull();
  });
});
