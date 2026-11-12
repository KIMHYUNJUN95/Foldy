/**
 * 같은 방에 겹치는 막대를 줄(레인)로 나눈다 — **순수 모듈**, 모바일 · PC 예약 캘린더 공용 (2026-11-12).
 *
 * 예전엔 모바일에만 있었고 PC 월간 보드는 겹치는 예약을 한 줄에 겹쳐 그려 아래 막대가 가려졌다(이중 예약 · 수기 예약을
 * 놓쳤다). 구간은 **반열림** `[start, end)` — 퇴실 = 입실(같은 날 교체)은 겹치지 않는다. 눈금 단위(px · 날 수)는 부르는 쪽 마음.
 */
export type LaneRange = { start: number; end: number };

export function assignLanes<T>(
  items: readonly T[],
  rangeOf: (item: T) => LaneRange,
): { placed: Array<LaneRange & { item: T; lane: number }>; laneCount: number } {
  const withRange = items.map((item) => ({ ...rangeOf(item), item }));
  const sorted = [...withRange].sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));
  const lanes: LaneRange[][] = [];
  const placed: Array<LaneRange & { item: T; lane: number }> = [];
  for (const entry of sorted) {
    let lane = 0;
    for (; lane < lanes.length; lane += 1) {
      if (!lanes[lane].some((other) => entry.start < other.end && other.start < entry.end)) break;
    }
    if (lane === lanes.length) lanes.push([]);
    lanes[lane].push({ start: entry.start, end: entry.end });
    placed.push({ ...entry, lane });
  }
  return { placed, laneCount: Math.max(1, lanes.length) };
}
