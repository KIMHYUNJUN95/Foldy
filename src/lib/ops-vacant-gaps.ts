import type { OpsSelectionCell } from "@/lib/ops-calendar-selection";

/**
 * 빈 구간 목록 — 판매 캘린더. **순수하다.**
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「빈 구간 목록」 (2026-10-29)
 *
 * 보고 있는 기간에서 **오늘 이후 · 예약도 차단도 없는** 밤을 방마다 이어진 구간으로 묶는다.
 * - 「오늘 빈방」(`ops-vacant-today.ts`)과 기준이 다르다 — 그쪽은 차단도 빈방으로 센다(격자를 거르는 필터).
 *   여기는 **팔 수 있는 밤**이라 차단은 뺀다.
 * - 구간 끝(`checkOut`)은 마지막 빈 밤의 다음 날이다. 보는 기간 끝까지 비어 있으면 `openEnded`.
 * - 가격은 요금이 있는 밤만 평균한다(없으면 `null`). 최소 숙박은 첫 밤 값.
 * - 데스크톱 격자와 모바일 판매 캘린더가 같은 규칙을 쓴다.
 */
export type OpsVacantGap = {
  roomKey: string;
  /** 첫 빈 밤(= 체크인). */
  start: string;
  /** 마지막 빈 밤의 다음 날(= 체크아웃). */
  checkOut: string;
  /** 빈 밤 날짜(격자 칸 선택에 그대로 쓴다). */
  dates: string[];
  nights: number;
  averagePrice: number | null;
  minStay: number | null;
  /** 보는 기간 끝까지 비어 있다 — 그 뒤는 아직 모른다. */
  openEnded: boolean;
};

export type OpsVacantGapLength = "all" | "n1" | "n2" | "n3";
export type OpsVacantGapSort = "near" | "long" | "property";

const nextDay = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

export function opsVacantGaps(args: {
  /** 격자 줄 순서. */
  roomKeys: readonly string[];
  /** 보는 기간의 날짜(오름차순, 도쿄 운영일). */
  dates: readonly string[];
  today: string;
  isSold: (roomKey: string, date: string) => boolean;
  isBlocked: (roomKey: string, date: string) => boolean;
  priceAt: (roomKey: string, date: string) => number | null;
  minStayAt: (roomKey: string, date: string) => number | null;
}): OpsVacantGap[] {
  const future = args.dates.filter((date) => date >= args.today);
  const last = args.dates.at(-1);
  const gaps: OpsVacantGap[] = [];
  for (const roomKey of args.roomKeys) {
    let run: string[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const prices = run.map((date) => args.priceAt(roomKey, date)).filter((price): price is number => price != null);
      gaps.push({
        averagePrice: prices.length > 0 ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : null,
        checkOut: nextDay(run[run.length - 1]),
        dates: run,
        minStay: args.minStayAt(roomKey, run[0]),
        nights: run.length,
        openEnded: run[run.length - 1] === last,
        roomKey,
        start: run[0],
      });
      run = [];
    };
    for (const date of future) {
      if (args.isSold(roomKey, date) || args.isBlocked(roomKey, date)) flush();
      else run.push(date);
    }
    flush();
  }
  return gaps;
}

export function filterOpsVacantGaps(gaps: readonly OpsVacantGap[], length: OpsVacantGapLength): OpsVacantGap[] {
  if (length === "all") return [...gaps];
  if (length === "n1") return gaps.filter((gap) => gap.nights === 1);
  if (length === "n2") return gaps.filter((gap) => gap.nights === 2);
  return gaps.filter((gap) => gap.nights >= 3);
}

/** `property` 는 격자 줄 순서(= `roomKeys` 순서)를 따른다 — 건물별 머리글은 그리는 쪽이 넣는다. */
export function sortOpsVacantGaps(
  gaps: readonly OpsVacantGap[],
  sort: OpsVacantGapSort,
  roomKeys: readonly string[],
): OpsVacantGap[] {
  const row = new Map(roomKeys.map((key, index) => [key, index]));
  const byRow = (a: OpsVacantGap, b: OpsVacantGap) => (row.get(a.roomKey) ?? 0) - (row.get(b.roomKey) ?? 0);
  const byStart = (a: OpsVacantGap, b: OpsVacantGap) => a.start.localeCompare(b.start);
  return [...gaps].sort((a, b) => {
    if (sort === "long") return b.nights - a.nights || byStart(a, b) || byRow(a, b);
    if (sort === "property") return byRow(a, b) || byStart(a, b);
    return byStart(a, b) || byRow(a, b);
  });
}

export function countOpsVacantGaps(gaps: readonly OpsVacantGap[]) {
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  let nights = 0;
  for (const gap of gaps) {
    nights += gap.nights;
    if (gap.nights === 1) n1 += 1;
    else if (gap.nights === 2) n2 += 1;
    else n3 += 1;
  }
  return { all: gaps.length, n1, n2, n3, nights };
}

/** 오늘 밤(0) · 내일 밤(1)부터 비는 구간만 급하다. 그 밖은 `null`. */
export function opsVacantGapUrgency(gap: OpsVacantGap, today: string): "tonight" | "tomorrow" | null {
  if (gap.start === today) return "tonight";
  if (gap.start === nextDay(today)) return "tomorrow";
  return null;
}

export const opsVacantGapCells = (gap: OpsVacantGap): OpsSelectionCell[] =>
  gap.dates.map((date) => ({ date, roomKey: gap.roomKey }));
