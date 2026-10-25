import { describe, expect, it } from "vitest";
import {
  dailyHeiWithholding,
  hasWithholdingTable,
  monthlyWithholding,
  withholdingTableYears,
} from "@/lib/withholding-tax";
import { TABLE_2026 } from "@/lib/withholding-tax/table-2026";
import { TABLE_2027 } from "@/lib/withholding-tax/table-2027";

describe("국세청 표 데이터", () => {
  it.each([TABLE_2026, TABLE_2027])("$year 년 표 구간이 빈틈 없이 이어지고 열 수가 맞다", (table) => {
    for (const rows of [table.monthly, table.dailyHei]) {
      for (let i = 1; i < rows.length; i += 1) expect(rows[i][0]).toBe(rows[i - 1][1]);
    }
    expect(table.monthly.every((r) => r.length === 11)).toBe(true);
    expect(table.dailyHei.every((r) => r.length === 3)).toBe(true);
    expect(table.monthly.at(-1)![1]).toBe(740000);
    expect(table.dailyHei.at(-1)![1]).toBe(24000);
  });

  it("표가 있는 해만 조회한다 — 없는 해는 null", () => {
    expect(withholdingTableYears()).toEqual([2026, 2027]);
    expect(hasWithholdingTable(2028)).toBe(false);
    expect(monthlyWithholding(2028, "kou", 200000)).toBeNull();
    expect(dailyHeiWithholding(2025, 12000)).toBeNull();
  });
});

describe("monthlyWithholding — 月額表", () => {
  it("국세청 안내 예시: 令和8年分 · 社会保険料控除後 30만엔 · 부양 1人 = 6,320엔", () => {
    expect(monthlyWithholding(2026, "kou", 300000, 1)).toBe(6320);
  });

  it("甲: 표 첫 줄(2026 105,000엔) 미만은 0, 첫 줄은 170엔", () => {
    expect(monthlyWithholding(2026, "kou", 104999)).toBe(0);
    expect(monthlyWithholding(2026, "kou", 105000)).toBe(170);
    expect(monthlyWithholding(2027, "kou", 110999)).toBe(0);
    expect(monthlyWithholding(2027, "kou", 111000)).toBe(140);
  });

  it("구간은 以上 ≤ x < 未満", () => {
    expect(monthlyWithholding(2026, "kou", 106999)).toBe(170);
    expect(monthlyWithholding(2026, "kou", 107000)).toBe(280);
  });

  it("乙: 표 첫 줄 미만은 금액 × 3.063%(엔 미만 버림), 하한 없음", () => {
    expect(monthlyWithholding(2026, "otsu", 9000)).toBe(275);
    expect(monthlyWithholding(2026, "otsu", 100000)).toBe(3063);
    expect(monthlyWithholding(2026, "otsu", 105000)).toBe(3800);
    // 2027 년은 3.063% 구간이 111,000엔까지
    expect(monthlyWithholding(2027, "otsu", 110000)).toBe(3369);
  });

  it("부양 인원 열 — 7人 넘으면 7人 열", () => {
    const row = TABLE_2026.monthly.find((r) => r[0] <= 400000 && 400000 < r[1])!;
    expect(monthlyWithholding(2026, "kou", 400000, 3)).toBe(row[5]);
    expect(monthlyWithholding(2026, "kou", 400000, 9)).toBe(row[9]);
  });

  it("표 끝 산식 — 740,000엔부터", () => {
    expect(monthlyWithholding(2026, "kou", 740000)).toBe(71680);
    // 71,680 + (750,000 − 740,000) × 20.42% = 73,722
    expect(monthlyWithholding(2026, "kou", 750000)).toBe(73722);
    // 乙: 259,200 + 10,000 × 40.84% = 263,284
    expect(monthlyWithholding(2026, "otsu", 750000)).toBe(263284);
    expect(monthlyWithholding(2026, "kou", 790000)).toBe(81890);
  });

  it("0 이하는 0", () => {
    expect(monthlyWithholding(2026, "otsu", 0)).toBe(0);
    expect(monthlyWithholding(2026, "kou", -5000)).toBe(0);
  });
});

describe("dailyHeiWithholding — 日額表 丙欄", () => {
  it("2026 년은 하루 9,800엔부터 붙는다(엑셀의 9,300엔은 옛 기준)", () => {
    expect(dailyHeiWithholding(2026, 9300)).toBe(0);
    expect(dailyHeiWithholding(2026, 9799)).toBe(0);
    expect(dailyHeiWithholding(2026, 9800)).toBe(1);
  });

  it("2027 년은 10,000엔부터", () => {
    expect(dailyHeiWithholding(2027, 9999)).toBe(0);
    expect(dailyHeiWithholding(2027, 10000)).toBe(1);
  });

  it("표 끝 산식 — 24,000엔부터", () => {
    expect(dailyHeiWithholding(2026, 24000)).toBe(746);
    // 746 + 1,000 × 10.21% = 848.1 → 848
    expect(dailyHeiWithholding(2026, 25000)).toBe(848);
    expect(dailyHeiWithholding(2026, 26500)).toBe(1001);
  });
});
