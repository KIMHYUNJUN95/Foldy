import { describe, expect, it } from "vitest";
import { correctionMatchesFix } from "@/lib/attendance-correction-close";

const req = (inAt: string | null, outAt: string | null) => ({ desired_clock_in_at: inAt, desired_clock_out_at: outAt });

describe("correctionMatchesFix — 수동 정정이 대기 중 정정 요청을 승인 / 반려로 닫는 기준", () => {
  it("퇴근 누락: 바란 퇴근 시각 그대로 고치면 승인", () => {
    expect(correctionMatchesFix(req(null, "2026-10-21T09:00:00.000Z"), "2026-10-21T00:06:00Z", "2026-10-21T18:00:00+09:00")).toBe(true);
  });
  it("표기가 달라도 같은 순간이면 같다", () => {
    expect(correctionMatchesFix(req("2026-10-17T00:00:00+00:00", null), "2026-10-17T09:00:00+09:00", null)).toBe(true);
  });
  it("다른 시각으로 고치면 반려", () => {
    expect(correctionMatchesFix(req(null, "2026-10-21T18:00:00+09:00"), "2026-10-21T09:06:00+09:00", "2026-10-21T18:30:00+09:00")).toBe(false);
  });
  it("출근 · 퇴근을 둘 다 바랐으면 둘 다 맞아야 승인", () => {
    const r = req("2026-10-21T09:00:00+09:00", "2026-10-21T18:00:00+09:00");
    expect(correctionMatchesFix(r, "2026-10-21T09:00:00+09:00", "2026-10-21T18:00:00+09:00")).toBe(true);
    expect(correctionMatchesFix(r, "2026-10-21T09:00:00+09:00", null)).toBe(false);
  });
  it("바란 시각이 없는 요청(근무지 · 기타)은 승인으로 보지 않는다", () => {
    expect(correctionMatchesFix(req(null, null), "2026-10-21T09:00:00+09:00", "2026-10-21T18:00:00+09:00")).toBe(false);
  });
});
