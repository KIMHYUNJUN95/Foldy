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

  it("Accept-Language 에서 언어를 고른다", () => {
    expect(pickLocale("ko-KR,ko;q=0.9")).toBe("ko");
    expect(pickLocale("zh-CN,zh;q=0.9")).toBe("zh-Hans");
    expect(pickLocale("fr-FR,en;q=0.8")).toBe("en");
    expect(pickLocale("fr-FR")).toBe("ja");
    expect(pickLocale(null)).toBe("ja");
  });
});
