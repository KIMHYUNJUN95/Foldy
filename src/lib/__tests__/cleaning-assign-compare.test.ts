import { describe, expect, it } from "vitest";

import { computeCompare, flaggedRows } from "@/lib/cleaning-assign/compare";
import type { CompareRow } from "@/lib/cleaning-assign/data";

/**
 * 청소 월 비교표 — 화면과 Excel · PDF 가 같은 계산을 쓴다(docs/product/37 「4-4」).
 * 평균 방당 급여는 비교에 넣은 사람(견습 · 직원 제외, 청소 0 제외)의 합 ÷ 합.
 */

const row = (over: Partial<CompareRow>): CompareRow => ({
  assigned: 10,
  cleaned: 10,
  days: 5,
  fixedTier: null,
  name: "A",
  paidMinutes: 600,
  pay: 50000,
  priority: false,
  role: "part_time_staff",
  trainee: false,
  userId: "a",
  ...over,
});

describe("computeCompare", () => {
  const rows = [
    row({ userId: "a", name: "A", pay: 50000, cleaned: 10 }),
    row({ userId: "b", name: "B", pay: 50000, cleaned: 10 }),
    row({ userId: "c", name: "C", pay: 80000, cleaned: 10 }),
    row({ userId: "t", name: "T", pay: 30000, cleaned: 2, trainee: true }),
    row({ userId: "s", name: "S", pay: 200000, cleaned: 5, role: "staff" }),
  ];

  it("견습 · 직원을 빼면 평균에 들어가지 않고 벗어남도 없다", () => {
    const { avg, rows: out } = computeCompare(rows, true);
    expect(avg).toBe(6000);
    expect(out.find((r) => r.userId === "t")).toMatchObject({ dev: null, excluded: "trainee" });
    expect(out.find((r) => r.userId === "s")).toMatchObject({ dev: null, excluded: "staff" });
    expect(out.find((r) => r.userId === "c")?.dev).toBe(33);
    // 비교에 든 사람이 먼저, 그 안에서 방당 급여 높은 순.
    expect(out.map((r) => r.userId)).toEqual(["c", "a", "b", "s", "t"]);
  });

  it("빼지 않으면 모두 평균에 들어간다", () => {
    const { avg, rows: out } = computeCompare(rows, false);
    expect(avg).toBe(410000 / 37);
    expect(out.every((r) => r.excluded === null)).toBe(true);
  });

  it("청소 0 인 사람은 방당 값이 없다", () => {
    const { rows: out } = computeCompare([row({ cleaned: 0 })], true);
    expect(out[0]).toMatchObject({ dev: null, perMinutes: null, perRoom: null });
  });

  it("기준을 넘은 사람만 많이 벗어난 순으로", () => {
    const { rows: out } = computeCompare(rows, true);
    expect(flaggedRows(out, 25).map((r) => r.userId)).toEqual(["c"]);
    expect(flaggedRows(out, 10).map((r) => r.userId)).toEqual(["c", "a", "b"]);
  });
});
