import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import ja from "@/lib/i18n/ja.json";
import ko from "@/lib/i18n/ko.json";
import zhHans from "@/lib/i18n/zh-Hans.json";
import { pickLocale } from "@/lib/i18n";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("checkin i18n", () => {
  it("4개 언어의 키가 같다", () => {
    const base = keys(ja).sort();
    for (const dict of [en, zhHans, ko]) expect(keys(dict).sort()).toEqual(base);
  });

  it("잠금 화면은 잠긴 이유 · 길이를 말하지 않고 직원 문의 안내를 보인다(2026-11-13)", () => {
    for (const dict of [ja, en, zhHans, ko]) {
      expect(dict.locked.body).not.toMatch(/[0-9０-９]/);
      expect(dict.locked.staff.length).toBeGreaterThan(0);
    }
  });

  it("Accept-Language 에서 언어를 고른다", () => {
    expect(pickLocale("ko-KR,ko;q=0.9")).toBe("ko");
    expect(pickLocale("zh-CN,zh;q=0.9")).toBe("zh-Hans");
    expect(pickLocale("fr-FR,en;q=0.8")).toBe("en");
    expect(pickLocale("fr-FR")).toBe("ja");
    expect(pickLocale(null)).toBe("ja");
  });
});

describe("checkin i18n 자리표시", () => {
  it("같은 키는 4개 언어 모두 같은 {자리} 를 쓴다", () => {
    const placeholders = (value: string) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(",");
    const flat = (dict: unknown) =>
      Object.fromEntries(
        keys(dict).map((key) => [key, key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict)]),
      ) as Record<string, string>;
    const base = flat(ja);
    for (const dict of [en, zhHans, ko]) {
      const other = flat(dict);
      for (const key of Object.keys(base)) expect([key, placeholders(other[key])]).toEqual([key, placeholders(base[key])]);
    }
  });

  it("빈 문구가 없다", () => {
    for (const dict of [ja, en, zhHans, ko]) {
      for (const key of keys(dict)) {
        const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
        expect([key, typeof value === "string" && value.trim().length > 0]).toEqual([key, true]);
      }
    }
  });
});
