import { describe, expect, it } from "vitest";
import { EMPTY_PREP_MANUAL, type PrepManual } from "@/lib/payroll-prep";
import { CARRY_DEFAULT_FIELDS, CARRY_FIELDS, planCarryOver, undoPatch } from "@/lib/payroll-carry-over";

/** 「지난달 값 가져오기」(docs/product/39 §5-A). */
const m = (over: Partial<PrepManual>): PrepManual => ({ ...EMPTY_PREP_MANUAL, ...over });

describe("planCarryOver", () => {
  const source = new Map<string, PrepManual>([
    ["a", m({ special: 2000, memo: "자전거", withholdingOverride: 1500, withholdingOverrideReason: "을 정정", overtime: 3000, prevAdjustment: -1200, yearEndAdjustment: 500, paymentMethodOverride: "cash" })],
    ["b", m({ special: 1000, weekend: 800 })],
    ["c", m({ memo: "그만둠" })],
  ]);

  it("기본 칸(특별 · 원천세 직접 · 메모)만, 빈 칸만, 이번 달 사람만", () => {
    const target = new Map<string, PrepManual>([["b", m({ special: 5000 })]]);
    const plan = planCarryOver(source, target, ["a", "b"], CARRY_DEFAULT_FIELDS);
    expect(plan.entries).toEqual([
      { userId: "a", patch: { special: 2000, withholdingOverride: 1500, withholdingOverrideReason: "을 정정", memo: "자전거" } },
    ]);
    expect(plan.counts).toEqual({ special: 1, withholding: 1, memo: 1, overtimeWeekend: 0 });
    expect(plan).toMatchObject({ people: 1, cells: 3 });
  });

  it("지난달 조정 · 연말정산 · 그 달만 지급 방식은 어떤 칸을 골라도 안 가져온다", () => {
    const plan = planCarryOver(source, new Map(), ["a"], CARRY_FIELDS);
    const patch = plan.entries[0].patch as Record<string, unknown>;
    expect(patch).not.toHaveProperty("prevAdjustment");
    expect(patch).not.toHaveProperty("yearEndAdjustment");
    expect(patch).not.toHaveProperty("paymentMethodOverride");
    expect(patch.overtime).toBe(3000);
  });

  it("잔업 · 주말 — 둘 중 비어 있는 것만, 사람 수는 한 번", () => {
    const plan = planCarryOver(source, new Map([["b", m({ weekend: 100 })]]), ["b"], ["overtimeWeekend"]);
    expect(plan.entries).toEqual([]);
    const plan2 = planCarryOver(source, new Map(), ["b"], ["overtimeWeekend"]);
    expect(plan2.entries).toEqual([{ userId: "b", patch: { weekend: 800 } }]);
    expect(plan2.counts.overtimeWeekend).toBe(1);
  });
});

describe("undoPatch", () => {
  it("가져온 값이 그대로인 칸만 비운다", () => {
    const filled = { special: 2000, memo: "자전거", withholdingOverride: 1500, withholdingOverrideReason: "을 정정" };
    const now = m({ special: 2000, memo: "손으로 고침", withholdingOverride: 1500, withholdingOverrideReason: "을 정정" });
    expect(undoPatch(now, filled)).toEqual({ special: 0, withholdingOverride: null, withholdingOverrideReason: null });
  });
  it("다 고쳤으면 null", () => {
    expect(undoPatch(m({ special: 1 }), { special: 2000 })).toBeNull();
  });
});
