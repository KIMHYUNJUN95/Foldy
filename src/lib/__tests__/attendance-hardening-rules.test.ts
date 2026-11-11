import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));

import {
  ATTENDANCE_ADMIN_EDITABLE_REVIEW_STATES,
  ATTENDANCE_GPS_MAX_ACCURACY_METERS,
  ATTENDANCE_MAX_SHIFT_MINUTES,
  ATTENDANCE_MAX_SITE_RADIUS_METERS,
  exceedsMaxShift,
  isGpsAccuracyTooLow,
  isPayableReviewState,
  isValidSiteRadius,
} from "@/lib/attendance";
import { staffCorrectionTimesProblem } from "@/lib/attendance-clock";
import { countBlockingSessions } from "@/lib/attendance-finalization";
import { correctionStatusForPay, payExcludeReason } from "@/lib/attendance-pay-calculation";

/**
 * 근태 점검 1차(2026-11-11) — 마감 판정 · 급여 제외 · 정정 시각 · 위치 정확도 규칙의 회귀 가드.
 */

const session = (review_state: string, extra: Partial<{ status: string; clock_out_at: string | null }> = {}) => ({
  id: "s1",
  operating_date: "2026-10-05",
  clock_in_at: "2026-10-05T00:00:00.000Z",
  clock_out_at: "2026-10-05T09:00:00.000Z",
  status: "completed",
  review_state,
  ...extra,
});

describe("급여에 넣는 검토 상태 = 마감을 막지 않는 검토 상태 (M3)", () => {
  it("normal · approved_correction 만 급여에 들어간다", () => {
    expect(isPayableReviewState("normal")).toBe(true);
    expect(isPayableReviewState("approved_correction")).toBe(true);
    for (const rs of ["review_required", "pending_correction", "rejected_correction", "weird"]) {
      expect(isPayableReviewState(rs)).toBe(false);
    }
  });

  it("급여에서 빠지는 검토 상태는 모두 마감을 막는다 — 0원이 마감 금액으로 굳지 않게", () => {
    for (const rs of ["review_required", "pending_correction", "rejected_correction"]) {
      const s = session(rs);
      expect(payExcludeReason(s, null)).toBe("review_required");
      expect(countBlockingSessions([s]).reviewRequired).toBe(1);
    }
    expect(countBlockingSessions([session("normal"), session("approved_correction")]).reviewRequired).toBe(0);
  });

  it("무효 세션은 검토 상태와 무관하게 막지 않는다", () => {
    expect(countBlockingSessions([session("rejected_correction", { status: "invalid" })]).reviewRequired).toBe(0);
  });

  it("관리자 직접 수정이 고를 수 있는 검토 상태는 normal · review_required 둘뿐", () => {
    expect([...ATTENDANCE_ADMIN_EDITABLE_REVIEW_STATES]).toEqual(["normal", "review_required"]);
  });
});

describe("마감된 달의 대기 정정은 급여에서 그 날을 빼지 않는다 (H1)", () => {
  it("마감 전이면 대기 정정은 그대로 '정정 대기'", () => {
    expect(correctionStatusForPay("requested", false)).toBe("requested");
    expect(correctionStatusForPay("in_review", false)).toBe("in_review");
  });

  it("마감된 달이면 대기 정정은 무시한다(마감 금액과 같은 계산)", () => {
    expect(correctionStatusForPay("requested", true)).toBeNull();
    expect(correctionStatusForPay("in_review", true)).toBeNull();
    expect(payExcludeReason(session("normal"), correctionStatusForPay("requested", true))).toBeNull();
  });

  it("처리 끝난 정정 상태는 그대로 넘긴다", () => {
    expect(correctionStatusForPay("approved", true)).toBe("approved");
    expect(correctionStatusForPay(null, true)).toBeNull();
  });
});

describe("직원 정정 요청 — 퇴근은 출근보다 뒤, 자정 넘김 없음 (M2)", () => {
  const at = (hhmm: string, day = "2026-10-05") => new Date(`${day}T${hhmm}:00+09:00`).toISOString();

  it("퇴근이 희망 출근보다 앞서거나 같으면 거절", () => {
    expect(staffCorrectionTimesProblem({ clockInAt: at("22:00"), clockOutAt: at("06:00") })).toBe("clock_order");
    expect(staffCorrectionTimesProblem({ clockInAt: at("09:00"), clockOutAt: at("09:00") })).toBe("clock_order");
  });

  it("희망 출근이 없으면 세션의 실제 출근과 비교한다", () => {
    expect(
      staffCorrectionTimesProblem({ clockInAt: null, clockOutAt: at("08:00"), sessionClockInAt: at("09:00") }),
    ).toBe("clock_order");
    expect(
      staffCorrectionTimesProblem({ clockInAt: null, clockOutAt: at("18:00"), sessionClockInAt: at("09:00") }),
    ).toBeNull();
  });

  it("희망 출근만 바꾸면 세션의 실제 퇴근과 비교한다", () => {
    expect(
      staffCorrectionTimesProblem({ clockInAt: at("19:00"), clockOutAt: null, sessionClockOutAt: at("18:00") }),
    ).toBe("clock_order");
  });

  it("16시간을 넘는 근무는 거절", () => {
    expect(staffCorrectionTimesProblem({ clockInAt: at("06:00"), clockOutAt: at("22:01") })).toBe("too_long");
    expect(staffCorrectionTimesProblem({ clockInAt: at("07:30"), clockOutAt: at("23:30") })).toBeNull();
  });

  it("비교할 시각이 없으면 통과", () => {
    expect(staffCorrectionTimesProblem({ clockInAt: null, clockOutAt: at("18:00") })).toBeNull();
    expect(staffCorrectionTimesProblem({ clockInAt: at("09:00"), clockOutAt: null })).toBeNull();
  });
});

describe("최대 근무 길이 (M2 — 관리자 경로 공용)", () => {
  it("16시간 = 960분", () => {
    expect(ATTENDANCE_MAX_SHIFT_MINUTES).toBe(960);
  });
  it("정확히 16시간은 괜찮고 1분이라도 넘으면 걸린다", () => {
    const start = "2026-10-05T00:00:00.000Z";
    expect(exceedsMaxShift(start, "2026-10-05T16:00:00.000Z")).toBe(false);
    expect(exceedsMaxShift(start, "2026-10-05T16:01:00.000Z")).toBe(true);
    expect(exceedsMaxShift(start, null)).toBe(false);
  });
});

describe("위치 정확도 · 현장 반경 상한 (M15)", () => {
  it("정확도 상한은 100m 한 곳", () => {
    expect(ATTENDANCE_GPS_MAX_ACCURACY_METERS).toBe(100);
    expect(isGpsAccuracyTooLow(100)).toBe(false);
    expect(isGpsAccuracyTooLow(100.5)).toBe(true);
    expect(isGpsAccuracyTooLow(null)).toBe(false);
    expect(isGpsAccuracyTooLow(Number.NaN)).toBe(false);
  });

  it("현장 반경은 1~500m 정수", () => {
    expect(ATTENDANCE_MAX_SITE_RADIUS_METERS).toBe(500);
    expect(isValidSiteRadius(100)).toBe(true);
    expect(isValidSiteRadius(500)).toBe(true);
    expect(isValidSiteRadius(501)).toBe(false);
    expect(isValidSiteRadius(0)).toBe(false);
    expect(isValidSiteRadius(12.5)).toBe(false);
    expect(isValidSiteRadius(null)).toBe(false);
  });
});

describe("마감을 막는 근무 목록 — 날짜 · 이유 코드", () => {
  it("검토 상태 · 열린 근무 이유를 하나씩, 무효는 빼고, 날짜 순", async () => {
    const { listBlockingSessions } = await import("@/lib/attendance-finalization");
    const rows = [
      { id: "a", user_id: "u", operating_date: "2026-09-05", status: "completed", review_state: "pending_correction", clock_out_at: "x" },
      { id: "b", user_id: "u", operating_date: "2026-09-01", status: "completed", review_state: "review_required", clock_out_at: "x" },
      { id: "c", user_id: "u", operating_date: "2026-09-03", status: "open", review_state: "normal", clock_out_at: null },
      { id: "d", user_id: "u", operating_date: "2026-09-04", status: "invalid", review_state: "rejected_correction", clock_out_at: "x" },
      { id: "e", user_id: "u", operating_date: "2026-09-02", status: "completed", review_state: "normal", clock_out_at: "x" },
    ];
    expect(listBlockingSessions(rows)).toEqual([
      { sessionId: "b", userId: "u", date: "2026-09-01", reason: "review_required" },
      { sessionId: "c", userId: "u", date: "2026-09-03", reason: "open" },
      { sessionId: "a", userId: "u", date: "2026-09-05", reason: "pending_correction" },
    ]);
  });
});

describe("「검토 필요」 탭에 넣을 근무 — 마감을 막는 근무와 같은 기준", () => {
  it("지급 안 되는 검토 상태면 넣는다(열린 정정이 걸린 것 · 무효는 뺀다)", async () => {
    const { needsReviewRow } = await import("@/lib/attendance");
    const base = { status: "completed", hasOpenCorrection: false };
    expect(needsReviewRow({ ...base, reviewState: "review_required" })).toBe(true);
    expect(needsReviewRow({ ...base, reviewState: "rejected_correction" })).toBe(true);
    // 요청이 닫혔는데 근무만 「정정 대기」로 남은 것 — 마감을 막는데 어디에도 안 보였다.
    expect(needsReviewRow({ ...base, reviewState: "pending_correction" })).toBe(true);
    expect(needsReviewRow({ ...base, reviewState: "pending_correction", hasOpenCorrection: true })).toBe(false);
    expect(needsReviewRow({ ...base, reviewState: "normal" })).toBe(false);
    expect(needsReviewRow({ ...base, reviewState: "approved_correction" })).toBe(false);
    expect(needsReviewRow({ status: "invalid", reviewState: "rejected_correction", hasOpenCorrection: false })).toBe(false);
  });

  it("DB 로 거를 검토 상태 목록 = 지급 안 되는 상태", async () => {
    const { ATTENDANCE_NEEDS_REVIEW_STATES, isPayableReviewState } = await import("@/lib/attendance");
    expect([...ATTENDANCE_NEEDS_REVIEW_STATES].sort()).toEqual(["pending_correction", "rejected_correction", "review_required"]);
    expect(ATTENDANCE_NEEDS_REVIEW_STATES.every((s) => !isPayableReviewState(s))).toBe(true);
  });
});
