import { describe, expect, it } from "vitest";
import {
  computeAnnualLeaveSummary,
  filterLeaveLedger,
  getScheduledGrants,
  leaveSpansOverlap,
  normalizeLeaveDays,
} from "../annual-leave";

describe("annual-leave accrual schedule", () => {
  it("grants 10/11/12 days at 6/18/30 months, then +2/year up to the 20-day cap", () => {
    const grants = getScheduledGrants("2020-01-15", "2027-06-01").filter((g) => g.kind === "base");
    expect(grants.slice(0, 7).map((g) => g.amount)).toEqual([10, 11, 12, 14, 16, 18, 20]);
    expect(grants.slice(0, 7).map((g) => g.date)).toEqual([
      "2020-07-15",
      "2021-07-15",
      "2022-07-15",
      "2023-07-15",
      "2024-07-15",
      "2025-07-15",
      "2026-07-15",
    ]);
    // 상한에 도달한 뒤에는 20일로 유지된다
    expect(grants[7].amount).toBe(20);
  });

  it("grants a one-time +4 bonus at the 4-year mark, separate from the base cap", () => {
    const grants = getScheduledGrants("2020-01-15", "2025-01-01");
    const bonuses = grants.filter((g) => g.kind === "bonus");
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0]).toEqual({ kind: "bonus", date: "2024-01-15", amount: 4 });
  });
});

describe("computeAnnualLeaveSummary", () => {
  it("keeps the baseline untouched by the engine's expiry logic", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2026-01-01",
      baselineAmount: 5,
      asOf: "2030-01-01",
    });
    const baseline = summary.buckets.find((b) => b.kind === "baseline");
    expect(baseline?.expiresOn).toBeNull();
    expect(baseline?.expired).toBe(false);
    expect(baseline?.remaining).toBe(5);
  });

  it("adds grants that land after the baseline date, ignores ones before it", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2026-07-01",
      baselineAmount: 5,
      asOf: "2026-08-01",
    });
    // 2026-07-15 부여분(20일, 위 표 기준)은 기준일 이후에 들어온다
    expect(summary.remaining).toBe(5 + 20);
  });

  it("lapses an unused grant 2 years after it was granted", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2022-08-01",
      baselineAmount: 0,
      // 2023-07-15 부여분(14일)은 2025-07-15 에 만료된다 — 그 하루 뒤로 확인
      asOf: "2025-07-16",
    });
    const grantBucket = summary.buckets.find((b) => b.grantedOn === "2023-07-15");
    expect(grantBucket?.expired).toBe(true);
    expect(grantBucket?.remaining).toBe(0);
  });

  it("consumes used days FIFO, oldest bucket first", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2026-07-01",
      baselineAmount: 5,
      usedDays: 8,
      asOf: "2026-08-01",
    });
    const baseline = summary.buckets.find((b) => b.kind === "baseline");
    const grant = summary.buckets.find((b) => b.kind === "base" && b.grantedOn === "2026-07-15");
    expect(baseline?.remaining).toBe(0); // 5일 먼저 전부 소진
    expect(grant?.remaining).toBe(17); // 남은 사용 3일이 20일 부여분에서 차감된다
    expect(summary.remaining).toBe(17);
  });

  it("reports the next upcoming grant", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2026-01-01",
      baselineAmount: 0,
      asOf: "2026-06-01",
    });
    expect(summary.nextGrant).toEqual({ kind: "base", date: "2026-07-15", amount: 20 });
  });

  it("keeps the 4-year bonus (특별휴가) pool separate from the paid-leave (유급) pool", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2023-06-01",
      baselineAmount: 0,
      // 보너스는 2024-01-15 에 부여; 2년 만료보다 한참 앞에서 확인
      asOf: "2024-02-01",
    });
    expect(summary.bonusRemaining).toBe(4);
    expect(summary.baseRemaining).toBe(summary.remaining - 4);
    expect(summary.baseRemaining + summary.bonusRemaining).toBe(summary.remaining);
  });

  it("only draws specialUsedDays from the bonus pool, never the paid-leave pool", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      // 2023-07-15 기본 부여 뒤, 2024-07-15 부여 앞 — 오직
      // 2024-01-15 보너스 부여분만 이 구간에 들어온다
      baselineDate: "2023-08-01",
      baselineAmount: 10,
      usedDays: 0,
      specialUsedDays: 3,
      asOf: "2024-02-01",
    });
    expect(summary.bonusRemaining).toBe(1); // 4일 보너스 - 3일 특별 사용
    expect(summary.baseRemaining).toBe(10); // specialUsedDays 의 영향을 받지 않음
  });

  it("tracks a pre-existing 특별휴가 starting balance (bonusBaselineAmount) in the bonus pool, not the base pool", () => {
    const summary = computeAnnualLeaveSummary({
      hireDate: "2020-01-15",
      baselineDate: "2023-08-01",
      baselineAmount: 10,
      bonusBaselineAmount: 2,
      // 4년차 보너스 부여(2024-01-15) 앞이라 수동 보너스 기준값만 적용된다
      asOf: "2023-12-01",
    });
    expect(summary.baseRemaining).toBe(10);
    expect(summary.bonusRemaining).toBe(2);
  });
});

describe("normalizeLeaveDays — 신청 일수는 서버가 정한다 (2026-10-01)", () => {
  it("종일: 양끝 포함 일수", () => {
    expect(
      normalizeLeaveDays({ leaveType: "paid", startDate: "2026-10-05", endDate: "2026-10-14", durationUnit: "full" }),
    ).toEqual({ startDate: "2026-10-05", endDate: "2026-10-14", durationUnit: "full", daysCount: 10 });
  });

  it("반차: 기간이 길어도 시작일 하루 0.5일", () => {
    expect(
      normalizeLeaveDays({ leaveType: "paid", startDate: "2026-10-05", endDate: "2026-10-14", durationUnit: "am" }),
    ).toEqual({ startDate: "2026-10-05", endDate: "2026-10-05", durationUnit: "am", daysCount: 0.5 });
  });

  it("경조: 시작일부터 고정 3일, 종일", () => {
    expect(
      normalizeLeaveDays({ leaveType: "annual", startDate: "2026-10-30", endDate: "2026-10-30", durationUnit: "pm" }),
    ).toEqual({ startDate: "2026-10-30", endDate: "2026-11-01", durationUnit: "full", daysCount: 3 });
  });

  it("거꾸로 된 기간 · 틀린 날짜는 null", () => {
    expect(
      normalizeLeaveDays({ leaveType: "paid", startDate: "2026-10-14", endDate: "2026-10-05", durationUnit: "full" }),
    ).toBeNull();
    expect(
      normalizeLeaveDays({ leaveType: "paid", startDate: "2026/10/05", endDate: "2026-10-05", durationUnit: "full" }),
    ).toBeNull();
  });
});

describe("leaveSpansOverlap — 같은 사람 휴가 이중 차감 방지", () => {
  const full = (startDate: string, endDate: string) => ({ startDate, endDate, durationUnit: "full" as const });
  const half = (date: string, unit: "am" | "pm") => ({ startDate: date, endDate: date, durationUnit: unit });

  it("separate date ranges do not overlap", () => {
    expect(leaveSpansOverlap(full("2026-11-01", "2026-11-03"), full("2026-11-04", "2026-11-05"))).toBe(false);
  });
  it("touching or nested ranges overlap", () => {
    expect(leaveSpansOverlap(full("2026-11-01", "2026-11-03"), full("2026-11-03", "2026-11-05"))).toBe(true);
    expect(leaveSpansOverlap(full("2026-11-01", "2026-11-10"), full("2026-11-04", "2026-11-05"))).toBe(true);
  });
  it("AM + PM on the same day do not overlap, same half does", () => {
    expect(leaveSpansOverlap(half("2026-11-02", "am"), half("2026-11-02", "pm"))).toBe(false);
    expect(leaveSpansOverlap(half("2026-11-02", "am"), half("2026-11-02", "am"))).toBe(true);
  });
  it("a half day inside a full-day range overlaps", () => {
    expect(leaveSpansOverlap(half("2026-11-02", "pm"), full("2026-11-01", "2026-11-03"))).toBe(true);
  });
});

describe("filterLeaveLedger — 화면과 내보내기 같은 규칙", () => {
  const rows = [
    { status: "approved", processedAt: "2026/10/01 09:00", applicantName: "Kim", reason: "rest", documentNumber: "AL-1", processorName: "Lee" },
    { status: "rejected", processedAt: "2026/10/15 18:00", applicantName: "Sato", reason: "trip", documentNumber: null, processorName: null },
  ];
  it("filters by status, Tokyo processed date range and search", () => {
    expect(filterLeaveLedger(rows, { status: null, query: "", from: "2026-10-01", to: "2026-10-31" })).toHaveLength(2);
    expect(filterLeaveLedger(rows, { status: "approved", query: "", from: "2026-10-01", to: "2026-10-31" })).toHaveLength(1);
    expect(filterLeaveLedger(rows, { status: null, query: "", from: "2026-10-02", to: "2026-10-31" })).toHaveLength(1);
    expect(filterLeaveLedger(rows, { status: null, query: "sato", from: "2026-10-01", to: "2026-10-31" })[0].applicantName).toBe("Sato");
  });
});
