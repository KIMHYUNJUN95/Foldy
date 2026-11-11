// 연차 1차 점검 수정(2026-11-11) — 사용일 기준 차감(H3) · 기준 잔여 소멸 유지(M9) · 말일 입사(LOW) · 기간 상한(LOW).
import { describe, expect, it } from "vitest";
import {
  baseLeaveBarTotals,
  computeAnnualLeaveSummary,
  getScheduledGrants,
  leaveDaysTooLong,
  leaveUsagesFromRows,
  MAX_LEAVE_REQUEST_DAYS,
  normalizeLeaveDays,
  normalizeLeaveRequest,
} from "../annual-leave";

describe("H3 — 승인된 사용은 그 사용일에 살아 있는 묶음에서만 빠진다", () => {
  // 입사 2020-01-01. 기준일 2021-01-01 잔여 0. 이후 부여: 2021-07-01 11일(2023-07-01 소멸),
  // 2022-07-01 12일(2024-07-01 소멸), 2023-07-01 14일(2025-07-01 소멸).
  const base = { hireDate: "2020-01-01", baselineDate: "2021-01-01", baselineAmount: 0, asOf: "2024-01-01" };

  it("소멸된 묶음이 소멸 뒤에 쓴 휴가를 떠안지 않는다 (예전: 26일로 부풀었다)", () => {
    const summary = computeAnnualLeaveSummary({
      ...base,
      usages: [{ date: "2023-10-01", days: 11, pool: "base" }],
    });
    // 2023-10-01 에 살아 있는 묶음: 2022-07-01(12) · 2023-07-01(14). 오래된 것부터 → 12 - 11 = 1, 14 그대로.
    expect(summary.baseRemaining).toBe(15);
  });

  it("소멸 전에 쓴 휴가는 그때 살아 있던 가장 오래된 묶음에서 빠진다", () => {
    const summary = computeAnnualLeaveSummary({
      ...base,
      usages: [{ date: "2022-08-01", days: 11, pool: "base" }],
    });
    // 2022-08-01 에는 2021-07-01(11) 이 가장 오래돼 그걸 다 쓴다 — 그 묶음은 이미 소멸이라 영향 없음.
    expect(summary.baseRemaining).toBe(12 + 14);
  });

  it("어느 묶음도 받을 수 없는 사용은 잔여를 음수로 만든다(초과 승인)", () => {
    const summary = computeAnnualLeaveSummary({
      ...base,
      usages: [{ date: "2023-10-01", days: 30, pool: "base" }],
    });
    expect(summary.baseOverflow).toBe(4);
    expect(summary.baseRemaining).toBe(-4);
  });

  it("앞으로 쓸 휴가는 그날 살아 있는 지금 묶음에서 먼저 빠진다", () => {
    const summary = computeAnnualLeaveSummary({
      ...base,
      usages: [{ date: "2024-03-01", days: 5, pool: "base" }],
    });
    expect(summary.baseRemaining).toBe(26 - 5);
  });

  it("지금 묶음이 그날까지 소멸되면 그 뒤 새 부여에서 빠지고 오늘 잔여는 그대로다", () => {
    // 2024-07-01 에 2022 묶음(12) 소멸, 같은 날 새 부여(16). 2024-08-01 사용 16일.
    const summary = computeAnnualLeaveSummary({
      ...base,
      usages: [{ date: "2024-08-01", days: 16, pool: "base" }],
    });
    // 2023 묶음 14일을 다 쓰고 남은 2일은 2024-07-01 부여에서 — 오늘(2024-01-01) 잔여는 12 + 0.
    expect(summary.baseRemaining).toBe(12);
    expect(summary.baseOverflow).toBe(0);
  });

  it("leaveUsagesFromRows — 유급은 base, 특별은 bonus, 경조 · 기타는 빠진다", () => {
    expect(
      leaveUsagesFromRows([
        { leave_type: "paid", days_count: 2, start_date: "2026-01-05" },
        { leave_type: "special", days_count: "1.5", start_date: "2026-02-01" },
        { leave_type: "annual", days_count: 3, start_date: "2026-03-01" },
        { leave_type: "other", days_count: 1, start_date: "2026-03-02" },
      ]),
    ).toEqual([
      { date: "2026-01-05", days: 2, pool: "base" },
      { date: "2026-02-01", days: 1.5, pool: "bonus" },
    ]);
  });
});

describe("M9 — 기준 잔여는 자기가 대신한 부여분의 소멸일을 이어받는다", () => {
  it("기준 잔여가 영원히 남지 않는다 — 가장 새 부여분부터 채운 소멸일", () => {
    // 입사 2020-01-15, 기준일 2026-01-01 잔여 5. 그날 살아 있던 부여: 2024-07-15(16, 2026-07-15 소멸),
    // 2025-07-15(18, 2027-07-15 소멸). 남은 5일은 가장 새 부여분(2025-07-15)으로 본다.
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2026-01-01",
      baselineAmount: 5,
      asOf: "2026-08-01",
    });
    const baseline = summary.buckets.filter((b) => b.kind === "baseline");
    expect(baseline.map((b) => [b.amount, b.expiresOn])).toEqual([[5, "2027-07-15"]]);
    expect(summary.baseRemaining).toBe(5 + 20); // 2026-07-15 부여 20일 더함

    const later = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2026-01-01",
      baselineAmount: 5,
      asOf: "2027-07-16",
    });
    expect(later.buckets.find((b) => b.kind === "baseline")?.expired).toBe(true);
  });

  it("최근 부여보다 많은 기준 잔여는 더 오래된 부여분의 소멸일로 나눠진다", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2026-01-01",
      baselineAmount: 20,
      asOf: "2026-02-01",
    });
    const parts = summary.buckets
      .filter((b) => b.kind === "baseline")
      .map((b) => [b.amount, b.expiresOn])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    expect(parts).toEqual([
      [2, "2026-07-15"],
      [18, "2027-07-15"],
    ]);
  });

  it("살아 있는 부여가 없을 때(입사 6개월 전 수동 입력)는 소멸일을 모른다", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2026-01-15",
      baselineDate: "2026-03-01",
      baselineAmount: 3,
      asOf: "2026-04-01",
    });
    const baseline = summary.buckets.find((b) => b.kind === "baseline");
    expect(baseline?.expiresOn).toBeNull();
    expect(summary.baseRemaining).toBe(3);
  });
});

describe("LOW — 말일 입사의 부여일은 다음 달로 넘어가지 않는다", () => {
  it("8/31 입사 → 첫 부여 2/28 (3/3 아님)", () => {
    const first = getScheduledGrants("2020-08-31", "2021-12-31").find((g) => g.kind === "base");
    expect(first?.date).toBe("2021-02-28");
  });
  it("윤년 2월은 29일", () => {
    const first = getScheduledGrants("2019-08-31", "2020-12-31").find((g) => g.kind === "base");
    expect(first?.date).toBe("2020-02-29");
  });
});

describe("LOW — 신청 기간 상한", () => {
  it(`${MAX_LEAVE_REQUEST_DAYS}일 넘는 신청은 너무 길다`, () => {
    expect(leaveDaysTooLong(MAX_LEAVE_REQUEST_DAYS)).toBe(false);
    expect(leaveDaysTooLong(MAX_LEAVE_REQUEST_DAYS + 1)).toBe(true);
  });
});

describe("원래 휴무로 뺀 날짜(2026-11-11 사용자 결정 안 A)", () => {
  const base = { leaveType: "paid" as const, startDate: "2026-12-01", endDate: "2026-12-07", durationUnit: "full" as const };

  it("일수 = 기간 날짜 수 − 뺀 날짜 수, 뺀 날짜는 정렬해 돌려준다", () => {
    expect(normalizeLeaveRequest({ ...base, excludedDates: ["2026-12-06", "2026-12-05"] })).toEqual({
      ok: true,
      value: { startDate: "2026-12-01", endDate: "2026-12-07", durationUnit: "full", daysCount: 5, excludedDates: ["2026-12-05", "2026-12-06"] },
    });
  });

  it("뺀 날짜가 없으면 예전 계산 그대로", () => {
    expect(normalizeLeaveRequest(base)).toEqual({
      ok: true,
      value: { startDate: "2026-12-01", endDate: "2026-12-07", durationUnit: "full", daysCount: 7, excludedDates: [] },
    });
  });

  it("기간 밖 · 중복 · 없는 날짜 · 전부 빼기는 거절", () => {
    expect(normalizeLeaveRequest({ ...base, excludedDates: ["2026-12-08"] })).toEqual({ ok: false, error: "invalid_excluded_dates" });
    expect(normalizeLeaveRequest({ ...base, excludedDates: ["2026-12-02", "2026-12-02"] })).toEqual({ ok: false, error: "invalid_excluded_dates" });
    expect(normalizeLeaveRequest({ ...base, excludedDates: ["2026-02-30"] })).toEqual({ ok: false, error: "invalid_excluded_dates" });
    expect(
      normalizeLeaveRequest({ ...base, endDate: "2026-12-02", excludedDates: ["2026-12-01", "2026-12-02"] }),
    ).toEqual({ ok: false, error: "invalid_excluded_dates" });
  });

  it("반차 · 경조는 뺀 날짜를 받지 않는다", () => {
    expect(normalizeLeaveRequest({ ...base, durationUnit: "am", excludedDates: ["2026-12-01"] })).toEqual({ ok: false, error: "invalid_excluded_dates" });
    expect(normalizeLeaveRequest({ ...base, leaveType: "annual", excludedDates: ["2026-12-01"] })).toEqual({ ok: false, error: "invalid_excluded_dates" });
  });

  it(`기간이 ${MAX_LEAVE_REQUEST_DAYS}일을 넘으면 too_long (뺀 날짜와 상관없이)`, () => {
    expect(normalizeLeaveRequest({ ...base, endDate: "2027-03-01" })).toEqual({ ok: false, error: "too_long" });
  });

  it("normalizeLeaveDays 는 같은 계산의 값만(틀리면 null)", () => {
    expect(normalizeLeaveDays({ ...base, excludedDates: ["2026-12-05"] })?.daysCount).toBe(6);
    expect(normalizeLeaveDays({ ...base, excludedDates: ["2026-12-09"] })).toBeNull();
  });
});

describe("모바일 연차 홈 막대 — 살아 있는 묶음만", () => {
  it("소멸된 묶음의 부여 일수를 「부여 · 사용」에 더하지 않는다", () => {
    // 2024-01-01 기준 살아 있는 묶음: 2022-07-01(12) · 2023-07-01(14). 2021-07-01(11) 은 소멸.
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-01",
      baselineDate: "2021-01-01",
      baselineAmount: 0,
      asOf: "2024-01-01",
      usages: [{ date: "2023-10-01", days: 11, pool: "base" }],
    });
    expect(baseLeaveBarTotals(summary)).toEqual({ granted: 26, used: 11 });
  });
});
