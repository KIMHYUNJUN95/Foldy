import { describe, expect, it } from "vitest";
import {
  isWithinCoalesceWindow,
  mergePriceJobRoomUpdates,
  type MergeableJob,
} from "@/lib/beds24/price-job-merge";
import { cellOwnerJobIds, isMergeableSibling } from "@/lib/beds24/price-job-worker";

/**
 * 작업 합치기.
 *
 * 틀리면 **중간 상태가 채널로 나간다** — 5만원으로 바꿨다가 6만원으로 바꿨는데 5만원이
 * 실제로 팔릴 수 있다. 순서가 결과를 바꾸면 안 된다.
 *
 * 계약: docs/product/33-calendar-write-features.md 「작업 큐」
 */

function job(id: string, createdAt: string, dates: Record<string, { p1?: number; m?: number }>): MergeableJob {
  return {
    createdAt,
    id,
    roomUpdates: [{ dates, externalRoomId: "450096", roomLabel: "오쿠보C" }],
  };
}

describe("isWithinCoalesceWindow", () => {
  it("2분 안이면 합친다", () => {
    expect(isWithinCoalesceWindow("2026-09-24T10:00:00Z", "2026-09-24T10:01:30Z")).toBe(true);
  });

  it("2분을 넘으면 안 합친다 — 오래된 작업이 빨려 들어오면 안 된다", () => {
    expect(isWithinCoalesceWindow("2026-09-24T10:00:00Z", "2026-09-24T10:03:00Z")).toBe(false);
  });

  it("앞뒤 순서와 무관하다", () => {
    expect(isWithinCoalesceWindow("2026-09-24T10:01:30Z", "2026-09-24T10:00:00Z")).toBe(true);
  });
});

describe("mergePriceJobRoomUpdates", () => {
  it("같은 날짜는 **나중 작업**이 이긴다", () => {
    const merged = mergePriceJobRoomUpdates([
      job("a", "2026-09-24T10:00:00Z", { "2026-10-01": { p1: 50000 } }),
      job("b", "2026-09-24T10:01:00Z", { "2026-10-01": { p1: 60000 } }),
    ]);
    expect(merged[0].dates["2026-10-01"]).toEqual({ p1: 60000 });
  });

  it("입력 순서가 바뀌어도 결과가 같다", () => {
    // 워커가 어떤 순서로 집어 오든 같은 값이 나가야 한다.
    const a = job("a", "2026-09-24T10:00:00Z", { "2026-10-01": { p1: 50000 } });
    const b = job("b", "2026-09-24T10:01:00Z", { "2026-10-01": { p1: 60000 } });
    expect(mergePriceJobRoomUpdates([a, b])).toEqual(mergePriceJobRoomUpdates([b, a]));
  });

  it("서로 다른 날짜는 둘 다 남는다", () => {
    const merged = mergePriceJobRoomUpdates([
      job("a", "2026-09-24T10:00:00Z", { "2026-10-01": { p1: 50000 } }),
      job("b", "2026-09-24T10:01:00Z", { "2026-10-02": { p1: 60000 } }),
    ]);
    expect(Object.keys(merged[0].dates).sort()).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("같은 날짜는 **항목별로 섞지 않고 통째로** 덮는다", () => {
    // 뒤 작업의 의도가 「이 날짜는 최소숙박만 건드린다」이므로 그대로 둔다.
    const merged = mergePriceJobRoomUpdates([
      job("a", "2026-09-24T10:00:00Z", { "2026-10-01": { p1: 50000 } }),
      job("b", "2026-09-24T10:01:00Z", { "2026-10-01": { m: 1 } }),
    ]);
    expect(merged[0].dates["2026-10-01"]).toEqual({ m: 1 });
  });

  it("객실이 다르면 따로 모은다", () => {
    const merged = mergePriceJobRoomUpdates([
      { createdAt: "2026-09-24T10:00:00Z", id: "a", roomUpdates: [
        { dates: { "2026-10-01": { p1: 1 } }, externalRoomId: "450096", roomLabel: null },
        { dates: { "2026-10-01": { p1: 2 } }, externalRoomId: "383971", roomLabel: null },
      ] },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("라벨은 있는 쪽을 남긴다", () => {
    const merged = mergePriceJobRoomUpdates([
      { createdAt: "2026-09-24T10:00:00Z", id: "a", roomUpdates: [
        { dates: { "2026-10-01": { p1: 1 } }, externalRoomId: "450096", roomLabel: null },
      ] },
      { createdAt: "2026-09-24T10:01:00Z", id: "b", roomUpdates: [
        { dates: { "2026-10-02": { p1: 2 } }, externalRoomId: "450096", roomLabel: "오쿠보C" },
      ] },
    ]);
    expect(merged[0].roomLabel).toBe("오쿠보C");
  });

  it("빈 목록이면 빈 결과", () => {
    expect(mergePriceJobRoomUpdates([])).toEqual([]);
  });
});

/**
 * 합쳐도 되는 형제(2026-10-26) — 다른 사람 · 다른 방식의 작업을 흡수하면 이력이 첫 작업 사람 · 방식으로 남고, 흡수된 사람의
 * 「되돌리기」가 칸을 못 찾았다.
 */
describe("isMergeableSibling", () => {
  const base = { adjust_mode: "amount", created_at: "2026-10-01T00:00:00Z", percent_value: null, requested_by: "u1" };

  it("같은 사람 · 같은 방식 · 2분 안이면 합친다", () => {
    expect(isMergeableSibling(base, { ...base, created_at: "2026-10-01T00:01:00Z" })).toBe(true);
  });

  it("다른 사람의 작업은 합치지 않는다", () => {
    expect(isMergeableSibling(base, { ...base, requested_by: "u2" })).toBe(false);
  });

  it("방식이나 퍼센트가 다르면 합치지 않는다", () => {
    expect(isMergeableSibling(base, { ...base, adjust_mode: "percent", percent_value: 10 })).toBe(false);
    const percent = { ...base, adjust_mode: "percent", percent_value: 10 };
    expect(isMergeableSibling(percent, { ...percent, percent_value: -10 })).toBe(false);
    expect(isMergeableSibling(base, { ...base, adjust_mode: "revert" })).toBe(false);
  });

  it("2분을 넘으면 같은 사람이어도 합치지 않는다", () => {
    expect(isMergeableSibling(base, { ...base, created_at: "2026-10-01T00:03:00Z" })).toBe(false);
  });
});

describe("cellOwnerJobIds — 칸마다 값을 낸 작업(변경 이력의 job_id)", () => {
  it("같은 칸은 늦은 작업, 다른 칸은 각자의 작업", () => {
    const owner = cellOwnerJobIds([
      job("late", "2026-10-01T00:01:00Z", { "2026-10-05": { p1: 12000 } }),
      job("early", "2026-10-01T00:00:00Z", { "2026-10-05": { p1: 10000 }, "2026-10-06": { p1: 10000 } }),
    ]);
    expect(owner.get("450096|2026-10-05")).toBe("late");
    expect(owner.get("450096|2026-10-06")).toBe("early");
  });
});
