import { describe, expect, it } from "vitest";
import { REPORT_SENDING_STUCK_MS, stuckSendingOrFilter } from "@/lib/task-report-stuck";

describe("stuckSendingOrFilter", () => {
  it("틱과 같은 10분 기준", () => {
    expect(REPORT_SENDING_STUCK_MS).toBe(600_000);
  });

  it("claimed_at 이 있으면 그것으로, 없으면 updated_at 으로 본다", () => {
    const now = Date.parse("2026-10-29T01:10:00.000Z");
    expect(stuckSendingOrFilter(now)).toBe(
      'claimed_at.lt."2026-10-29T01:00:00.000Z",and(claimed_at.is.null,updated_at.lt."2026-10-29T01:00:00.000Z")',
    );
  });
});
