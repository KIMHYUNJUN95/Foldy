import { describe, expect, it } from "vitest";
import { emptyCell, type RevenueCell } from "@/lib/ops-revenue";
import { hasComparisonRecord, bridgeScale, buildBridge, findNewRooms, groupProperties, growthDrivers, newRoomShare, niceUnit, topMover } from "@/lib/ops-revenue-compare";

const cell = (revenue: number, occupied = revenue > 0 ? 10 : 0): RevenueCell => ({ ...emptyCell(), availableNights: 30, occupiedNights: occupied, revenue });

// 2026-09 vs 2025-09 실제 숫자(34번 「저쪽과 숫자 대조」 뒤)
const A = {
  STAY: cell(18896449), 가부키초: cell(7229863), 다카다노바바: cell(6555141), 아라키초A: cell(8643857), 아라키초B: cell(11445033),
  오쿠보B: cell(1754141), 오쿠보C: cell(1245084),
};
const B = {
  STAY: cell(0), 가부키초: cell(7425330), 다카다노바바: cell(8363609), 아라키초A: cell(11105133), 아라키초B: cell(10304846),
  오쿠보B: cell(0), 오쿠보C: cell(1401707),
};
const names = Object.keys(A);

describe("groupProperties", () => {
  it("두 기간 모두 · A 만 · B 만", () => {
    const g = groupProperties([...names, "닫힌곳"], A, { ...B, 닫힌곳: cell(500000) });
    expect(g.fresh.sort()).toEqual(["STAY", "오쿠보B"]);
    expect(g.closed).toEqual(["닫힌곳"]);
    expect(g.existing).toHaveLength(5);
  });
});

describe("buildBridge", () => {
  it("B → 기존 변화 → 신규(큰 순) → A, 마지막 누적 = A 합계", () => {
    const steps = buildBridge(groupProperties(names, A, B), A, B);
    expect(steps.map((s) => s.role)).toEqual(["totalB", "existing", "fresh", "fresh", "totalA"]);
    expect(steps[0].to).toBe(38600625); // 건물별 반올림 값의 합(실제 합계 ¥38,600,626 과 1엔)
    expect(steps[1].kind).toBe("down");
    expect(Math.round(steps[1].to - steps[1].from)).toBe(-3481647);
    expect(steps[2].names).toEqual(["STAY"]);
    expect(Math.round(steps[3].to)).toBe(55769568);
    expect(Math.round(steps[4].to)).toBe(55769568);
  });
  it("신규가 많으면 큰 둘 + 나머지 하나로, 판매가 없어진 건물은 빼는 몫", () => {
    const a = { x: cell(100), n1: cell(50), n2: cell(40), n3: cell(30), n4: cell(20) };
    const b = { x: cell(100), gone: cell(60) };
    const steps = buildBridge(groupProperties(["x", "n1", "n2", "n3", "n4", "gone"], a, b), a, b);
    expect(steps.map((s) => s.role)).toEqual(["totalB", "fresh", "fresh", "freshOther", "closed", "totalA"]);
    expect(steps[3].names).toEqual(["n3", "n4"]);
    expect(steps[4].kind).toBe("down");
    expect(steps.at(-2)!.to).toBe(steps.at(-1)!.to);
  });
});

describe("bridgeScale · niceUnit", () => {
  it("1 · 2 · 5 단위", () => {
    expect(niceUnit(11_000_000)).toBe(20_000_000);
    expect(niceUnit(9_000_000)).toBe(10_000_000);
    expect(niceUnit(4_200)).toBe(5_000);
  });
  it("누적 최솟값 근처부터 — 작은 차이가 보이게", () => {
    const scale = bridgeScale(buildBridge(groupProperties(names, A, B), A, B));
    expect(scale.base).toBeGreaterThan(0);
    expect(scale.base).toBeLessThanOrEqual(35118978);
    expect(scale.top).toBeGreaterThanOrEqual(55769568);
  });
  it("차이가 크면 0 부터", () => {
    const a = { x: cell(100_000_000) };
    const b = { x: cell(10_000_000) };
    expect(bridgeScale(buildBridge(groupProperties(["x"], a, b), a, b)).base).toBe(0);
  });
});

describe("topMover", () => {
  it("기존 건물 중 금액으로 가장 많이 늘어난 곳 — 퍼센트가 아니라", () => {
    const g = groupProperties(names, A, B);
    expect(topMover(g.existing, A, B)?.name).toBe("아라키초B");
    // small 은 +400% 지만 +¥400,000, big 은 +5% 지만 +¥500,000 — 금액이 큰 big
    const a = { big: cell(10_500_000), small: cell(500_000) };
    const b = { big: cell(10_000_000), small: cell(100_000) };
    expect(topMover(["big", "small"], a, b)?.name).toBe("big");
  });
  it("늘어난 곳이 없으면 가장 많이 줄어든 곳", () => {
    expect(topMover(["다카다노바바", "가부키초"], A, B)?.name).toBe("다카다노바바");
  });
});

describe("growthDrivers", () => {
  it("판매 박 효과 + 단가 효과 + 신규 + 없어진 건물 = 총 증감", () => {
    const g = groupProperties([...names, "닫힌곳"], A, { ...B, 닫힌곳: cell(500000) });
    const { drivers, total, totalPoints } = growthDrivers(g, A, { ...B, 닫힌곳: cell(500000) });
    const sum = drivers.reduce((acc, d) => acc + d.value, 0);
    expect(Math.round(sum)).toBe(Math.round(total));
    // 픽스처의 판매 박이 모두 같아(10) 판매 박 효과는 0 — 빠진다
    expect(drivers.map((d) => d.key)).toEqual(["price", "fresh", "closed"]);
    const pointSum = drivers.reduce((acc, d) => acc + (d.points ?? 0), 0);
    expect(pointSum).toBeCloseTo(totalPoints ?? 0, 9);
  });
  it("판매 박 효과 = (판매 박 차이) × B 단가", () => {
    const a = { x: { ...cell(3000, 30) } };
    const b = { x: { ...cell(2000, 20) } };
    const { drivers } = growthDrivers(groupProperties(["x"], a, b), a, b);
    expect(drivers.find((d) => d.key === "volume")?.value).toBe(1000);
    expect(drivers.find((d) => d.key === "price")).toBeUndefined();
  });
});

describe("새 객실(기존 건물) — 건물 숫자는 그대로, 몫만 떼어 낸다", () => {
  const rooms = { 가부키초: [{ key: "K::802", label: "802" }, { key: "K::803", label: "803" }] };
  const first = { "K::802": "2024-06-01", "K::803": "2025-10-31" };
  it("첫 판매일이 B 끝 뒤 · A 끝까지인 방만", () => {
    expect(findNewRooms(["가부키초"], rooms, first, "2025-09-30", "2026-09-30").map((r) => r.label)).toEqual(["803"]);
    expect(findNewRooms(["가부키초"], rooms, first, "2025-11-30", "2026-09-30")).toEqual([]);
    // A 가 B 보다 앞이면 없다
    expect(findNewRooms(["가부키초"], rooms, first, "2026-09-30", "2025-09-30")).toEqual([]);
  });
  it("브리지 · 기여 막대 — 새 객실 단계가 생기고 합계는 같다", () => {
    const a = { 가부키초: cell(1_000_000, 50) };
    const b = { 가부키초: cell(700_000, 40) };
    const aRooms = { "K::802": cell(800_000, 40), "K::803": cell(200_000, 10) };
    const bRooms = { "K::802": cell(700_000, 40) };
    const share = newRoomShare(findNewRooms(["가부키초"], rooms, first, "2025-09-30", "2026-09-30"), aRooms, bRooms);
    const g = groupProperties(["가부키초"], a, b);
    const steps = buildBridge(g, a, b, 3, share);
    expect(steps.map((s) => s.role)).toEqual(["totalB", "existing", "newRooms", "totalA"]);
    expect(steps[1].to - steps[1].from).toBe(100_000); // 802 만의 변화
    expect(steps[2].to - steps[2].from).toBe(200_000); // 803
    expect(steps[2].to).toBe(1_000_000);
    const d = growthDrivers(g, a, b, share);
    expect(d.drivers.map((x) => x.key)).toEqual(["price", "newRooms"]); // 802 판매 박 같음(40) → 판매 박 효과 0
    expect(d.drivers.reduce((sum, x) => sum + x.value, 0)).toBe(300_000);
    expect(d.total).toBe(300_000);
  });
});

describe("hasComparisonRecord — B 기간 기록 있음", () => {
  it("매출 0 이면 기록 없음", () => {
    expect(hasComparisonRecord(0)).toBe(false);
    expect(hasComparisonRecord(1)).toBe(true);
  });
});
