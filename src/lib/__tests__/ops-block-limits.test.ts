import { describe, expect, it, vi } from "vitest";

import { blockErrorText, type BlockPanelCopy } from "@/components/admin/ops/ops-block-panel";
import { getDictionary, locales } from "@/lib/i18n";
import { countBlockRanges, exceedsBlockRangeLimit, fillBlockLimitText, MAX_BLOCK_RANGES, overBlockRangeLimit } from "@/lib/ops-block-limits";

vi.mock("server-only", () => ({}));

describe("차단 구간 상한", () => {
  it("넘은 수 = 구간 수 − 60, 넘지 않으면 0", () => {
    expect(overBlockRangeLimit(61)).toBe(1);
    expect(overBlockRangeLimit(75)).toBe(15);
    expect(overBlockRangeLimit(60)).toBe(0);
    expect(overBlockRangeLimit(3)).toBe(0);
  });

  it("상한은 60 이고 60 까지는 통과, 61 부터 넘는다", () => {
    expect(MAX_BLOCK_RANGES).toBe(60);
    expect(exceedsBlockRangeLimit(60)).toBe(false);
    expect(exceedsBlockRangeLimit(61)).toBe(true);
  });

  it("구간은 방 하나의 이어진 날짜 — 이어진 날은 1구간, 끊기면 나뉜다", () => {
    const cells = [
      { date: "2026-12-01", roomKey: "A::101" },
      { date: "2026-12-02", roomKey: "A::101" },
      { date: "2026-12-04", roomKey: "A::101" },
      { date: "2026-12-01", roomKey: "A::102" },
    ];
    expect(countBlockRanges(cells)).toBe(3);
  });

  it("방 61개를 하루씩 고르면 상한을 넘는다", () => {
    const cells = Array.from({ length: 61 }, (_, index) => ({ date: "2026-12-01", roomKey: `A::${index}` }));
    expect(exceedsBlockRangeLimit(countBlockRanges(cells))).toBe(true);
    expect(exceedsBlockRangeLimit(countBlockRanges(cells.slice(0, 60)))).toBe(false);
  });
});

type CalendarCopy = Record<string, string>;
const calendarCopy = (locale: (typeof locales)[number]) =>
  (getDictionary(locale) as unknown as { opsAdmin: { calendar: CalendarCopy } }).opsAdmin.calendar;

describe("차단 구간 상한 문구 — ko · ja · en", () => {
  const keys = ["bkLimitTitle", "bkLimitBody", "bkLimitHint", "bkLimitFoot", "bkReleaseLimitTitle", "bkReleaseLimitBody"] as const;
  const placeholders: Record<(typeof keys)[number], string[]> = {
    bkLimitTitle: ["{max}"],
    bkLimitBody: ["{ranges}", "{over}"],
    bkLimitHint: [],
    bkLimitFoot: ["{over}"],
    bkReleaseLimitTitle: ["{max}"],
    bkReleaseLimitBody: ["{ranges}", "{over}"],
  };

  it.each(locales)("%s — 새 키가 있고 자리표시자가 맞고, 채우면 { 가 남지 않는다", (locale) => {
    const copy = calendarCopy(locale);
    for (const key of keys) {
      expect(copy[key], `${locale} ${key}`).toBeTruthy();
      for (const holder of placeholders[key]) expect(copy[key], `${locale} ${key}`).toContain(holder);
      const filled = fillBlockLimitText(copy[key], 75);
      expect(filled, `${locale} ${key}`).not.toMatch(/[{}]/);
    }
    expect(fillBlockLimitText(copy.bkLimitBody, 75)).toContain("15");
    expect(fillBlockLimitText(copy.bkLimitBody, 75)).toContain("75");
    expect(fillBlockLimitText(copy.bkLimitTitle, 75)).toContain("60");
  });

  it("안 쓰는 옛 키는 지웠다", () => {
    for (const locale of locales) {
      expect(calendarCopy(locale).bkRangeLimitNote).toBeUndefined();
      expect(calendarCopy(locale).bkReleaseRangeLimitNote).toBeUndefined();
    }
  });

  it.each([...keys, "errBkTooManyRanges"])("%s 는 세 언어 문구가 서로 다르다", (key) => {
    if (key === "bkLimitHint") return; // 설명 줄은 숫자가 없어도 언어마다 달라야 한다 — 아래 검사
    const texts = locales.map((locale) => calendarCopy(locale)[key]);
    expect(new Set(texts).size).toBe(locales.length);
  });

  it("구간 설명 줄도 세 언어가 다르다", () => {
    expect(new Set(locales.map((locale) => calendarCopy(locale).bkLimitHint)).size).toBe(locales.length);
  });

  it("blockErrorText(too_many_ranges) 는 {max} 를 60 으로 치환한다", () => {
    for (const locale of locales) {
      const text = blockErrorText(calendarCopy(locale) as unknown as BlockPanelCopy, "too_many_ranges");
      expect(text).toContain("60");
      expect(text).not.toContain("{max}");
    }
  });
});
