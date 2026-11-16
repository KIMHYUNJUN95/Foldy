import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { queueItemLine } from "@/components/admin/orders/orders-console-data";

const names = ["필터", "고정 클립", "행주"];

describe("queueItemLine", () => {
  it.each([
    ["ko", "품목 1개", "품목 2개 · 고정 클립", "품목 3개 · 고정 클립 · 행주"],
    ["ja", "1品目", "2品目 · 고정 클립", "3品目 · 고정 클립 · 행주"],
    ["en", "1 item", "2 items · 고정 클립", "3 items · 고정 클립 · 행주"],
  ] as const)("%s 제목 = 첫 품목", (locale, one, two, three) => {
    const t = getDictionary(locale).admin.orders.console;
    expect(queueItemLine("필터", names.slice(0, 1), t)).toBe(one);
    expect(queueItemLine(" 필터 ", names.slice(0, 2), t)).toBe(two);
    expect(queueItemLine("필터", names, t)).toBe(three);
  });

  it("제목이 첫 품목과 다르면 품목을 모두 보인다", () => {
    const t = getDictionary("ko").admin.orders.console;
    expect(queueItemLine("청소 용품", names, t)).toBe("품목 3개 · 필터 · 고정 클립 · 행주");
  });

  it("품목이 없으면 빈 문자열", () => {
    expect(queueItemLine("x", [], getDictionary("en").admin.orders.console)).toBe("");
  });
});
