import type {
  OpsCalendarBar,
  OpsCalendarBlock,
  OpsCalendarDay,
  OpsCalendarRate,
  OpsCalendarRoom,
} from "@/lib/ops-calendar";
import type { OpsRoomStay } from "@/lib/ops-calendar-occupancy";

/**
 * 판매 캘린더 격자의 **행 단위 데이터** — 순수 모듈(2026-09-30 속도).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md
 *
 * ## 왜 행 단위인가
 *
 * 예전에는 서버가 칸 전체를 `Map<"행키|날짜", 요금 객체>`(칸 ~2,900개 × ~150B)로 보냈고, 새로고침
 * (라이브 신호 · 쓰기 반영 · 건물 전환)마다 **모든 객체가 새로** 왔다. 격자의 행(`OpsGridRow`)은
 * 메모돼 있어도 받는 Map 참조가 매번 달라 91행이 전부 다시 그려졌다.
 *
 * 이제 서버가 **행마다** 요금·이력 표시·갭·막대·블록을 묶고 그 내용의 해시(`sig`)를 붙인다. 격자는
 * 직전 행과 `sig` 가 같으면 **직전 객체를 그대로 쓴다**(`reuseStableRows`) — 안 바뀐 행은 참조까지
 * 같아 메모가 걸린다.
 *
 * ## 요금은 날짜 순 배열이다
 *
 * 한 행의 값은 `days` 와 같은 순서(0 = 창의 첫날)의 배열로 싣는다. 칸마다 키 문자열·필드 이름을
 * 반복하지 않아 요금 몫이 대략 1/7 로 준다. 읽을 때는 `decodeRowRate` 가 칸 하나를 되살린다.
 */

/** 격자(클라이언트)가 한 칸에서 실제로 읽는 요금 값. 나머지(재고·blackout·최장 최소숙박)는 서버에서 끝난다. */
export type OpsCellRate = Pick<OpsCalendarRate, "price" | "bookingPrice" | "minStay" | "minStayByUnit">;

export type OpsRowRates = {
  /**
   * 칸마다 한 글자 — `1` 요금 칸이 있다, `0` 없다. **없는 칸은 「안 판다」다**(운영 중 유닛 0,
   * `mergeOpsRateUnits` 가 `null`). 값이 전부 `null` 인 칸과는 다르다 — 예약 `+` 판정이 가른다.
   */
  has: string;
  price: (number | null)[];
  bookingPrice: (number | null)[];
  minStay: (number | null)[];
  /** 운영 중 유닛끼리 최소숙박이 다른 칸만 — `[날짜 순번, 유닛별 값]`. */
  mixed: Array<[number, Array<{ label: string; minStay: number }>]>;
};

export type OpsGridRowData = {
  room: OpsCalendarRoom;
  /** 아래 전부(+ 창의 첫날·길이)의 해시. 같으면 내용이 같다. */
  sig: string;
  rates: OpsRowRates;
  /** 칸마다 한 글자 — `1` 이면 그 칸에 변경 이력이 있다(목록은 호버 때 따로 읽는다). */
  history: string;
  /** 칸마다 한 글자 — `1` 이면 1박 갭. */
  gap: string;
  /** 이 행에 **그릴** 예약 막대 — 서버가 「예약 표시」 필터로 이미 거른 것. 점유 판정에는 쓰지 않는다. */
  bars: OpsCalendarBar[];
  /**
   * 이 행을 **차지하는** 확정 숙박 — 필터와 무관(2026-11-26, `ops-calendar-occupancy.ts`). 팔린 밤 · 오늘 빈방 ·
   * 옮기기 충돌 · 가격/최소박 고르기는 막대 대신 이것으로 센다. 확정을 꺼도 팔린 밤은 팔린 밤이다.
   */
  stays: OpsRoomStay[];
  blocks: OpsCalendarBlock[];
};

export function encodeDayFlags(dates: readonly string[], has: (date: string) => boolean): string {
  let flags = "";
  for (const date of dates) flags += has(date) ? "1" : "0";
  return flags;
}

export function dayFlagAt(flags: string, index: number): boolean {
  return flags.charCodeAt(index) === 49; // "1"
}

export function encodeRowRates(
  dates: readonly string[],
  rateAt: (date: string) => OpsCalendarRate | undefined,
): OpsRowRates {
  const encoded: OpsRowRates = { bookingPrice: [], has: "", minStay: [], mixed: [], price: [] };
  dates.forEach((date, index) => {
    const rate = rateAt(date);
    encoded.has += rate ? "1" : "0";
    encoded.price.push(rate?.price ?? null);
    encoded.bookingPrice.push(rate?.bookingPrice ?? null);
    encoded.minStay.push(rate?.minStay ?? null);
    if (rate?.minStayByUnit) encoded.mixed.push([index, rate.minStayByUnit]);
  });
  return encoded;
}

/** 순번 한 칸의 요금. 칸이 없으면(「안 판다」) `undefined`. */
export function decodeRowRate(rates: OpsRowRates, index: number): OpsCellRate | undefined {
  if (index < 0 || !dayFlagAt(rates.has, index)) return undefined;
  const mixed = rates.mixed.find(([at]) => at === index);
  return {
    bookingPrice: rates.bookingPrice[index] ?? null,
    minStay: rates.minStay[index] ?? null,
    minStayByUnit: mixed ? mixed[1] : null,
    price: rates.price[index] ?? null,
  };
}

/**
 * 문자열 → 짧은 해시(cyrb53, 53비트 → 36진수). 암호용이 아니다 — 「이 행이 바뀌었나」만 가른다.
 * 91행 사이의 우연한 충돌 확률은 사실상 0 이다.
 */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function buildGridRowData(args: {
  room: OpsCalendarRoom;
  dates: readonly string[];
  rateAt: (date: string) => OpsCalendarRate | undefined;
  hasHistory: (date: string) => boolean;
  isGap: (date: string) => boolean;
  bars: OpsCalendarBar[];
  blocks: OpsCalendarBlock[];
  stays: OpsRoomStay[];
}): OpsGridRowData {
  const rates = encodeRowRates(args.dates, args.rateAt);
  const history = encodeDayFlags(args.dates, args.hasHistory);
  const gap = encodeDayFlags(args.dates, args.isGap);
  // 창이 옮겨지면 같은 배열이라도 뜻이 달라진다 — 창의 첫날·길이도 해시에 넣는다.
  const sig = hashString(
    JSON.stringify([args.dates[0] ?? "", args.dates.length, args.room, rates, history, gap, args.bars, args.blocks, args.stays]),
  );
  return { bars: args.bars, blocks: args.blocks, gap, history, rates, room: args.room, sig, stays: args.stays };
}

/**
 * 새로 받은 행들 중 **내용이 같은 행은 직전 객체로 바꿔 끼운다.** 전부 같으면 직전 배열 자체를 돌려준다.
 *
 * 격자는 이 결과를 행 메모의 입력으로 쓴다 — 안 바뀐 행은 참조가 같아 다시 그리지 않는다.
 */
export function reuseStableRows(
  previous: readonly OpsGridRowData[],
  next: readonly OpsGridRowData[],
): OpsGridRowData[] {
  const byKey = new Map(previous.map((row) => [row.room.key, row]));
  let changed = previous.length !== next.length;
  const result = next.map((row, index) => {
    const old = byKey.get(row.room.key);
    const kept = old && old.sig === row.sig ? old : row;
    if (kept !== previous[index]) changed = true;
    return kept;
  });
  return changed ? result : (previous as OpsGridRowData[]);
}

/** 행들 → `(행키, 날짜) → 칸 요금`. 패널·호버 카드·예약 패널처럼 행 밖에서 칸을 읽을 때 쓴다. */
export function buildRowRateLookup(
  rows: readonly OpsGridRowData[],
  dates: readonly string[],
): (roomKey: string, date: string) => OpsCellRate | undefined {
  const rowByKey = new Map(rows.map((row) => [row.room.key, row]));
  const indexByDate = new Map(dates.map((date, index) => [date, index]));
  return (roomKey, date) => {
    const row = rowByKey.get(roomKey);
    const index = indexByDate.get(date);
    if (!row || index === undefined) return undefined;
    return decodeRowRate(row.rates, index);
  };
}

/** 행들의 확정 숙박을 한 목록으로(격자 밖의 점유 판정 — 오늘 빈방 · 팔린 칸 · 옮기기 충돌). */
export function rowStays(rows: readonly OpsGridRowData[]): OpsRoomStay[] {
  return rows.flatMap((row) => row.stays);
}

/** 행들의 1박 갭 칸 → `행키|YYYY-MM-DD` 집합(격자 밖의 갭 선택·갭 맥락이 쓰는 모양). */
export function rowGapCellKeys(rows: readonly OpsGridRowData[], dates: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    dates.forEach((date, index) => {
      if (dayFlagAt(row.gap, index)) keys.add(`${row.room.key}|${date}`);
    });
  }
  return keys;
}

/**
 * 두 가로축이 **내용까지** 같은가. 새로고침마다 `days` 는 새 배열로 오는데, 같은 창이면 직전 배열을
 * 계속 써야 행 메모가 안 깨진다.
 */
export function sameOpsDays(
  a: readonly OpsCalendarDay[],
  b: readonly OpsCalendarDay[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.date !== y.date ||
      x.isToday !== y.isToday ||
      x.isWeekend !== y.isWeekend ||
      x.startsMonth !== y.startsMonth ||
      x.day !== y.day ||
      x.weekday !== y.weekday
    ) {
      return false;
    }
  }
  return true;
}
