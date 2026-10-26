import { settleYen } from "@/lib/attendance-pay-calculation";
import { TABLE_2026 } from "./table-2026";
import { TABLE_2027 } from "./table-2027";
import type { WithholdingTable } from "./types";

/**
 * 원천세(源泉所得税) 조회 — 국세청 표 그대로. docs/product/39 §3-D · §4-B.
 *
 * - 어느 해 표를 쓰는지는 **지급일**의 해로 정한다(12월분을 1월에 주면 새해 표). 표가 없는 해는 `null` —
 *   부르는 쪽이 「세금표 없음」으로 막는다(추측해서 지난해 표를 쓰지 않는다).
 * - 표 숫자는 생성 파일(`table-<year>.ts`), 표 끝 고액 구간의 산식은 아래 `TIERS`(표 아래 글이라 손으로 옮김).
 * - 산식 결과의 1엔 미만은 버린다.
 */

export type { WithholdingTable } from "./types";

const TABLES: Record<number, WithholdingTable> = { 2026: TABLE_2026, 2027: TABLE_2027 };

type Tier = { from: number; base: number; rate: number };

/**
 * 표 끝 산식 구간 — 「N円の場合の税額に、N円を超える金額の r% に相当する金額を加算」.
 * 甲은 부양 인원별 base 8개(0~7人), 乙 · 丙은 하나. 출처는 같은 해 국세청 표 아래 글.
 */
const TIERS: Record<
  number,
  { kou: { from: number; base: readonly number[]; rate: number }[]; otsu: Tier[]; hei: Tier[] }
> = {
  2026: {
    kou: [
      { from: 740000, base: [71680, 65210, 58750, 52290, 45810, 39350, 32890, 26410], rate: 0.2042 },
      { from: 790000, base: [81890, 75420, 68960, 62500, 56020, 49560, 43100, 36620], rate: 0.23483 },
      { from: 960000, base: [121820, 115340, 108880, 102420, 95940, 89480, 83020, 76540], rate: 0.33693 },
      { from: 1710000, base: [374520, 368040, 361580, 355120, 348640, 342180, 335720, 329240], rate: 0.4084 },
      { from: 2130000, base: [549440, 542970, 536500, 530040, 523570, 517110, 510640, 504170], rate: 0.4084 },
      { from: 2170000, base: [571220, 564750, 558280, 551820, 545350, 538880, 532420, 525950], rate: 0.4084 },
      { from: 2210000, base: [593000, 586520, 580060, 573600, 567120, 560660, 554200, 547730], rate: 0.4084 },
      { from: 2250000, base: [614770, 608300, 601840, 595380, 588900, 582440, 575980, 569500], rate: 0.4084 },
      { from: 3500000, base: [1125270, 1118800, 1112340, 1105880, 1099400, 1092940, 1086480, 1080000], rate: 0.45945 },
    ],
    otsu: [
      { from: 740000, base: 259200, rate: 0.4084 },
      { from: 1710000, base: 655400, rate: 0.45945 },
    ],
    hei: [
      { from: 24000, base: 746, rate: 0.1021 },
      { from: 26500, base: 1001, rate: 0.2042 },
      { from: 32500, base: 2226, rate: 0.25525 },
      { from: 57500, base: 8608, rate: 0.33693 },
      { from: 116500, base: 28486, rate: 0.4084 },
    ],
  },
  2027: {
    kou: [
      { from: 740000, base: [71000, 64540, 58060, 51600, 45140, 38670, 32200, 25740], rate: 0.2042 },
      { from: 790000, base: [81210, 74750, 68270, 61810, 55350, 48880, 42410, 35950], rate: 0.23483 },
      { from: 960000, base: [121130, 114670, 108200, 101730, 95270, 88800, 82330, 75870], rate: 0.33693 },
      { from: 1720000, base: [377200, 370740, 364270, 357800, 351340, 344870, 338400, 331940], rate: 0.4084 },
      { from: 2130000, base: [549410, 542950, 536470, 530010, 523550, 517080, 510610, 504150], rate: 0.4084 },
      { from: 2170000, base: [571190, 564730, 558250, 551790, 545330, 538850, 532390, 525930], rate: 0.4084 },
      { from: 2210000, base: [592970, 586500, 580030, 573570, 567100, 560630, 554170, 547710], rate: 0.4084 },
      { from: 2250000, base: [614740, 608280, 601810, 595350, 588880, 582410, 575950, 569480], rate: 0.4084 },
      { from: 3500000, base: [1125240, 1118780, 1112310, 1105850, 1099380, 1092910, 1086450, 1079980], rate: 0.45945 },
    ],
    otsu: [
      { from: 740000, base: 259000, rate: 0.4084 },
      { from: 1720000, base: 659300, rate: 0.45945 },
    ],
    hei: [
      { from: 24000, base: 731, rate: 0.1021 },
      { from: 26500, base: 986, rate: 0.2042 },
      { from: 32500, base: 2211, rate: 0.25525 },
      { from: 58000, base: 8720, rate: 0.33693 },
      { from: 116500, base: 28430, rate: 0.4084 },
    ],
  },
};

/** 乙 소액 구간 세율 3.063%(소득세 3% × 부흥특별소득세 포함 1.021). */
const FLAT_RATE = 0.03063;

/** 그해 국세청 표(출력 엑셀의 세금표 시트용). 없으면 `null`. */
export function withholdingTable(year: number): WithholdingTable | null {
  return TABLES[year] ?? null;
}

/** 그해 표가 있나. */
export function hasWithholdingTable(year: number): boolean {
  return year in TABLES && year in TIERS;
}

/** 표가 있는 해(오름차순). */
export function withholdingTableYears(): number[] {
  return Object.keys(TABLES).map(Number).sort((a, b) => a - b);
}

function floorYen(yen: number): number {
  return Math.floor(settleYen(yen));
}

function lastTierAtOrBelow<T extends { from: number }>(tiers: readonly T[], amount: number): T | null {
  let hit: T | null = null;
  for (const t of tiers) if (amount >= t.from) hit = t;
  return hit;
}

function findRow(rows: readonly (readonly number[])[], amount: number): readonly number[] | null {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = rows[mid];
    if (amount < row[0]) hi = mid - 1;
    else if (amount >= row[1]) lo = mid + 1;
    else return row;
  }
  return null;
}

/**
 * 月額表 — 甲(부양 0~7人) · 乙. `amount` 는 그 달 「社会保険料等控除後の給与等の金額」.
 * 그해 표가 없으면 `null`.
 */
export function monthlyWithholding(
  year: number,
  cls: "kou" | "otsu",
  amount: number,
  dependents = 0,
): number | null {
  const table = TABLES[year];
  const tiers = TIERS[year];
  if (!table || !tiers) return null;
  if (amount <= 0) return 0;
  const dep = Math.min(Math.max(Math.trunc(dependents), 0), 7);
  if (amount < table.otsuFlatBelow) return cls === "otsu" ? floorYen(amount * FLAT_RATE) : 0;
  const row = findRow(table.monthly, amount);
  if (row) return cls === "otsu" ? row[10] : row[2 + dep];
  if (cls === "otsu") {
    const t = lastTierAtOrBelow(tiers.otsu, amount)!;
    return floorYen(t.base + (amount - t.from) * t.rate);
  }
  const t = lastTierAtOrBelow(tiers.kou, amount)!;
  return floorYen(t.base[dep] + (amount - t.from) * t.rate);
}

/** 日額表 丙欄 — 하루 「社会保険料等控除後の給与等の金額」. 그해 표가 없으면 `null`. */
export function dailyHeiWithholding(year: number, amount: number): number | null {
  const table = TABLES[year];
  const tiers = TIERS[year];
  if (!table || !tiers) return null;
  if (amount < table.dailyHei[0][0]) return 0;
  const row = findRow(table.dailyHei, amount);
  if (row) return row[2];
  const t = lastTierAtOrBelow(tiers.hei, amount)!;
  return floorYen(t.base + (amount - t.from) * t.rate);
}
