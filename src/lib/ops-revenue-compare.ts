/**
 * 매출 비교(A vs B) — 건물 나누기 · 차이 분해(브리지) · 눈금 · 요점 재료. **순수하다.**
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 비교」
 *
 * 칸(`RevenueCell`)은 매출 화면과 같은 식으로 서버가 낸 것(`getOpsRevenueCompareData`). 여기는 합계에 넣을 건물을
 * 골라 더하고, B → A 차이를 「기존 건물의 변화 + 새로 판 건물 + 판매가 없어진 건물」로 나눈다.
 */

import { emptyCell, metricsOf, sumMetrics, type RevenueCell, type RevenueMetrics } from "@/lib/ops-revenue";

export type CompareCells = Record<string, RevenueCell | undefined>;

/** 그 기간에 팔았나 — 판매 박이나 매출이 있으면. */
export function hasSales(cell: RevenueCell | undefined): boolean {
  return !!cell && (cell.occupiedNights > 0 || cell.revenue !== 0);
}

export type CompareGroups = {
  /** 두 기간 모두 판 건물. */
  existing: string[];
  /** A 에만 판 건물(새로 열었거나 그동안 쉬었던). */
  fresh: string[];
  /** B 에만 판 건물. */
  closed: string[];
};

export function groupProperties(names: readonly string[], a: CompareCells, b: CompareCells): CompareGroups {
  const groups: CompareGroups = { closed: [], existing: [], fresh: [] };
  for (const name of names) {
    const inA = hasSales(a[name]);
    const inB = hasSales(b[name]);
    if (inA && inB) groups.existing.push(name);
    else if (inA) groups.fresh.push(name);
    else if (inB) groups.closed.push(name);
  }
  return groups;
}

export const totalOf = (names: readonly string[], cells: CompareCells): RevenueMetrics => sumMetrics(names.map((name) => cells[name]));

/**
 * 기존 건물의 **새 객실** — 그 객실 행의 첫 판매일이 B 기간 뒤이고 A 기간 안(또는 앞)인 방(2026-10-08 사용자 「새로 오픈도 자주 한다」).
 * 건물 숫자 · 분모는 바꾸지 않는다(사용자: 「베드24 숫자와 같아야 한다」) — 차이 분해에서 몫만 떼어 낸다.
 * 첫 판매일 = 그 방 확정 예약 중 가장 이른 체크인(듀얼 유닛은 한 행). A 가 B 보다 앞이면 늘 빈 목록이다.
 */
export function findNewRooms(
  existing: readonly string[],
  rooms: Record<string, Array<{ key: string; label: string }>>,
  firstSale: Record<string, string>,
  bEnd: string,
  aEnd: string,
): Array<{ key: string; property: string; label: string }> {
  const out: Array<{ key: string; property: string; label: string }> = [];
  for (const property of existing) {
    for (const room of rooms[property] ?? []) {
      const first = firstSale[room.key];
      if (first && first > bEnd && first <= aEnd) out.push({ key: room.key, label: room.label, property });
    }
  }
  return out;
}

/** 새 객실 몫 — 차이 분해 · 기여 막대에 넘긴다. */
export type NewRoomShare = { a: RevenueMetrics; b: RevenueMetrics; labels: string[] };

export function newRoomShare(rooms: ReturnType<typeof findNewRooms>, aRooms: CompareCells, bRooms: CompareCells): NewRoomShare | null {
  if (rooms.length === 0) return null;
  return {
    a: sumMetrics(rooms.map((room) => aRooms[room.key])),
    b: sumMetrics(rooms.map((room) => bRooms[room.key])),
    labels: rooms.map((room) => `${room.property} ${room.label}`),
  };
}

/** 기존 건물 합에서 새 객실 몫을 뺀 것(같은 방들끼리의 변화). */
function minusShare(total: RevenueMetrics, share: RevenueMetrics | null): RevenueMetrics {
  if (!share) return total;
  const cell = emptyCell();
  cell.revenue = total.revenue - share.revenue;
  cell.occupiedNights = total.occupiedNights - share.occupiedNights;
  cell.availableNights = total.availableNights - share.availableNights;
  cell.commission = total.commission - share.commission;
  return metricsOf(cell);
}

export type BridgeStep = {
  kind: "B" | "A" | "up" | "down";
  /** 무엇의 몫인가 — 화면이 문구를 고른다. */
  role: "totalB" | "totalA" | "existing" | "newRooms" | "fresh" | "freshOther" | "closed";
  /** `fresh` · `closed` 는 건물 이름, `freshOther` 는 묶인 건물들. */
  names: string[];
  /** 막대 아래 · 위(누적 금액). 합계 막대는 `from = 0`. */
  from: number;
  to: number;
};

/**
 * B 합계 → 기존 건물 변화 → 새로 판 건물(큰 순, `maxFresh` 개 넘으면 나머지는 하나로) → 판매가 없어진 건물 → A 합계.
 * 몫이 0 인 단계는 뺀다. 마지막 누적은 언제나 A 합계와 같다(테스트로 고정).
 */
export function buildBridge(groups: CompareGroups, a: CompareCells, b: CompareCells, maxFresh = 3, newRooms: NewRoomShare | null = null): BridgeStep[] {
  const bTotal = totalOf([...groups.existing, ...groups.closed], b).revenue;
  const aTotal = totalOf([...groups.existing, ...groups.fresh], a).revenue;
  const steps: BridgeStep[] = [{ from: 0, kind: "B", names: [], role: "totalB", to: bTotal }];
  let running = bTotal;
  const push = (role: BridgeStep["role"], names: string[], delta: number) => {
    if (delta === 0) return;
    steps.push({ from: running, kind: delta >= 0 ? "up" : "down", names, role, to: running + delta });
    running += delta;
  };
  const aEx = minusShare(totalOf(groups.existing, a), newRooms?.a ?? null);
  const bEx = minusShare(totalOf(groups.existing, b), newRooms?.b ?? null);
  push("existing", groups.existing, aEx.revenue - bEx.revenue);
  if (newRooms) push("newRooms", newRooms.labels, newRooms.a.revenue - newRooms.b.revenue);
  const fresh = [...groups.fresh].sort((x, y) => (a[y]?.revenue ?? 0) - (a[x]?.revenue ?? 0));
  const head = fresh.length > maxFresh ? fresh.slice(0, maxFresh - 1) : fresh;
  for (const name of head) push("fresh", [name], a[name]?.revenue ?? 0);
  const rest = fresh.slice(head.length);
  if (rest.length > 0) push("freshOther", rest, totalOf(rest, a).revenue);
  if (groups.closed.length > 0) push("closed", groups.closed, -totalOf(groups.closed, b).revenue);
  steps.push({ from: 0, kind: "A", names: [], role: "totalA", to: aTotal });
  return steps;
}

/** 1 · 2 · 5 × 10ⁿ 중 `raw` 이상인 가장 작은 값. */
export function niceUnit(raw: number): number {
  if (!(raw > 0)) return 1;
  const exp = Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    const unit = m * 10 ** exp;
    if (unit >= raw) return unit;
  }
  return 10 ** (exp + 1);
}

/**
 * 브리지 눈금 — 작은 차이가 보이게 0 이 아니라 **누적 최솟값 근처부터** 시작한다(합계 막대 아래는 물결 = 생략).
 * 최솟값이 최댓값의 35% 아래면 0 부터(잘라 낼 이유가 없다). 눈금 칸은 4개 안팎.
 */
export function bridgeScale(steps: readonly BridgeStep[]): { base: number; top: number; unit: number; ticks: number[] } {
  const values = steps.flatMap((step) => (step.kind === "A" || step.kind === "B" ? [step.to] : [step.from, step.to]));
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const unit = niceUnit(max / 5);
  const top = Math.ceil((max * 1.04) / unit) * unit;
  let base = Math.floor((min * 0.85) / unit) * unit;
  if (base < 0 || min < max * 0.35) base = 0;
  const ticks: number[] = [];
  for (let v = base; v <= top + 0.5; v += unit) ticks.push(v);
  return { base, ticks, top, unit };
}

/** B 기간에 판매 기록이 있나 — 없으면 증감 대신 「비교할 기록 없음」 로 보인다. */
export function hasComparisonRecord(bRevenue: number): boolean {
  return bRevenue > 0;
}

/** 0 이 아니면 증감률(%), B 가 0 이면 `null`. */
export function changePctOrNull(a: number, b: number): number | null {
  return b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null;
}

/**
 * 기존 건물 중 매출이 **금액으로** 가장 많이 늘어난 건물(없으면 가장 많이 줄어든 건물). 퍼센트로 고르면 전년 매출이 작은
 * 건물이 +500% 로 뽑힌다(2026-10-08 사용자 화면 — 오쿠보B +513.7%). 표시는 증감률을 같이 준다.
 */
export function topMover(
  existing: readonly string[],
  a: CompareCells,
  b: CompareCells,
): { name: string; pct: number | null; delta: number } | null {
  const moves = existing.map((name) => {
    const av = a[name]?.revenue ?? 0;
    const bv = b[name]?.revenue ?? 0;
    return { delta: av - bv, name, pct: changePctOrNull(av, bv) };
  });
  if (moves.length === 0) return null;
  const up = moves.filter((move) => move.delta > 0).sort((x, y) => y.delta - x.delta);
  if (up.length > 0) return up[0];
  return [...moves].sort((x, y) => x.delta - y.delta)[0];
}

export type GrowthDriver = {
  key: "volume" | "price" | "newRooms" | "fresh" | "closed";
  /** 엔. */
  value: number;
  /** B 합계 대비 %p — 다 더하면 총 증감률. B 합계가 0 이면 `null`. */
  points: number | null;
};

/**
 * 총 증감을 무엇이 만들었나(2026-10-08 — 다이얼 대신). 매출 = 판매 박 × 객실 단가라서 기존 건물의 변화를 정확히 둘로 나눈다:
 * 판매 박 효과 = (판매 박 A − B) × 단가 B, 단가 효과 = 나머지(= (단가 A − 단가 B) × 판매 박 A). 그리고 새로 판 건물(+) ·
 * 판매가 없어진 건물(−). 넷의 합 = A 합계 − B 합계(테스트). 몫이 0 인 항목은 뺀다.
 */
export function growthDrivers(
  groups: CompareGroups,
  a: CompareCells,
  b: CompareCells,
  newRooms: NewRoomShare | null = null,
): { total: number; totalPoints: number | null; drivers: GrowthDriver[]; existingA: RevenueMetrics; existingB: RevenueMetrics } {
  // 판매 박 · 단가 효과는 **같은 방들끼리** — 새 객실 몫은 따로 한 줄(2026-10-08).
  const aEx = minusShare(totalOf(groups.existing, a), newRooms?.a ?? null);
  const bEx = minusShare(totalOf(groups.existing, b), newRooms?.b ?? null);
  const bTotal = totalOf([...groups.existing, ...groups.closed], b).revenue;
  const aTotal = totalOf([...groups.existing, ...groups.fresh], a).revenue;
  const volume = bEx.occupiedNights > 0 ? (aEx.occupiedNights - bEx.occupiedNights) * bEx.adr : 0;
  const price = aEx.revenue - bEx.revenue - volume;
  const rooms = newRooms ? newRooms.a.revenue - newRooms.b.revenue : 0;
  const fresh = totalOf(groups.fresh, a).revenue;
  const closed = -totalOf(groups.closed, b).revenue;
  const points = (value: number) => (bTotal !== 0 ? (value / Math.abs(bTotal)) * 100 : null);
  const drivers: GrowthDriver[] = (
    [
      ["volume", volume],
      ["price", price],
      ["newRooms", rooms],
      ["fresh", fresh],
      ["closed", closed],
    ] as const
  )
    .filter(([, value]) => Math.round(value) !== 0)
    .map(([key, value]) => ({ key, points: points(value), value }));
  return { drivers, existingA: aEx, existingB: bEx, total: aTotal - bTotal, totalPoints: points(aTotal - bTotal) };
}
